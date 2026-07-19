# PERSIST-001 — Plan (pre-implementation)

> Generated from the markdown sweep of 2026-07-18. The status doc and `BUSINESS_ALIGNMENT.md` both name PERSIST-001 (profile + goals + food Supabase adapters) as the next exact work package.

## Why

- `status.md`, `plan.md`, and `BACKLOG_ALIGNMENT.md` agree: tracking records disappear on API restart because every per-feature repository is in-memory. Customers can't be onboarded until that gap closes.
- The SQL schema + RLS policies + explicit Data API grants (Phase 1) already cover every user-facing table for profile, goals, and food_entries. The pgTAP suite proves cross-user isolation at the schema layer. PERSIST-001 is the JS-side adapter that turns that SQL foundation into real persistence.
- `BUSINESS_ALIGNMENT.md` says explicitly: do not start AI, conversations, or memory-001 work until the persistence gap closes. PERSIST-001 is the prerequisite for MOB-DAILY-001 and MOB-ONB-001.

## Scope of this segment

Three adapters behind three existing ports. Adapter shape: pure-SQL via Supabase JS client, RLS-isolated, no service-role assumptions baked into route layer.

1. `SupabaseProfileRepository` — implements `ProfileRepository`.
2. `SupabaseGoalRepository` — implements `GoalRepository`.
3. `SupabaseFoodEntryRepository` — implements `FoodEntryRepository`.

Plus:

- one forward-only SQL migration to align columns with the domain shape after GOAL-001 + NUT-001 + PROF-001+ (activity_level, sex_at_birth, pace, review_date).
- one partial-unique index on `(user_id) WHERE status = 'active'` for goals (the in-memory repo's "at most one active goal per user" invariant).
- composition-root wiring: keep in-memory as the default; switch to Supabase only when env (or test) supplies `SUPABASE_URL` + a publishable key. The default keeps the standard `pnpm check` green without Docker.
- one new opt-in e2e file `apps/api/src/persistence.e2e.test.ts` that proves the adapters honor RLS + persist records through a real restart.
- research log entry, status update, and `backlog.md` row flip for PERSIST-001.

## Deliberately deferred to follow-up segments

- PERSIST-002 (exercises, workouts, workout_sets, body_measurements, account export/deletion cascade against real records): separate segment because each table introduces its own schema-alignment questions (sets need FK to workouts, etc.).
- PERSIST-003 (real Supabase Storage adapter behind `MediaStorage`): today's `InMemoryMediaStorage` is a usable dev stub. Once PERSIST-001 + PERSIST-002 prove RLS works for table access, PERSIST-003 swaps the storage SDK.
- MOB-DAILY-001 and the MOB-* family: every mobile surface is blocked on real persistence.
- AI / MEM / CONV / BILL / OBS / AND: per the new scope guardrails, none of these start before PERSIST-001 lands.

## Architecture decisions

### A. New migration: column alignment

The current `public.profiles` table has `id`, `display_name`, `unit_system`, `timezone`, `birth_year`, `height_cm`, `created_at`, `updated_at`. PROF-001+ promoted two new nullable fields in the in-memory domain (`activity_level`, `sex_at_birth`). They're missing from SQL.

The current `public.goals` table has `user_id`, `kind`, `status`, `target jsonb`, `starts_on`, `target_date`, `created_at`, `updated_at`. GOAL-001 added `pace` and optional `review_date` in the domain. They're missing from SQL.

Forward-only migration `20260718100000_persist_001_columns.sql`:

```sql
alter table public.profiles
  add column activity_level text
    check (activity_level in ('sedentary','lightly_active','moderately_active','very_active','extra_active')),
  add column sex_at_birth text
    check (sex_at_birth in ('male','female'));

alter table public.goals
  add column pace text
    check (pace in ('steady','gradual','aggressive')),
  add column review_date date;

create unique index goals_one_active_per_user
  on public.goals (user_id)
  where status = 'active';
```

All new columns are nullable (existing-row backfill is `NULL`). The check constraints match the closed enums in `@mizyun/core`. The partial unique index mirrors the in-memory repo's "at most one active goal per user" invariant.

### B. Adapter shape: shared client + `setSession` per request

A single helper in the adapter package constructs `SupabaseClient` per feature. The user's access token is forwarded to `supabase.auth.setSession({ access_token, refresh_token })` so every query runs under the verified principal — not the service role. RLS does the rest.

- New helper: `createSupabaseRepositoryClient({ url, publishableKey, accessToken })` in `@mizyun/adapter-supabase-server`.
- Each repo method accepts the access token explicitly. The composition root hands the token through the request context (the existing `request.principal` carries it via `authClient.getSession()`).
- Refresh tokens are not handled in PERSIST-001 — the API forwards expired tokens to the verifier, which the existing auth plugin already rejects with 401. If we need refresh-on-the-server that's PERSIST-001b.

### C. Repository implementations

Each adapter:

1. Reads `from` / `to` query helpers as ISO instants (Supabase expects `timestamptz`). The matchers use indexed columns.
2. Maps SQL row → `Stored*` via a small `fromRow` function. Date columns → `Date`; numeric enums → domain enums (`goalKindSchema.parse(row.kind)` etc.).
3. RLS is the security boundary. Repo code does not hand `userId` to `.insert()` / `.update()` — Supabase pulls it from the JWT. BUT the domain `update()` and `create()` methods require `userId` in the input shape (the in-memory defensive check); the adapter passes it as a `withCheck`-compatible filter on `.eq('user_id', userId)` for `.update()` and `.eq('user_id', userId)` for `.insert()` (PostgREST respects RLS even on insert, so the explicit filter is redundant but a belt-and-suspenders anchor).
4. `getById` returns rows; the adapter passes through `userId` and lets the route do the ownership check (today's pattern; SQL RLS blocks cross-user reads anyway).

### D. Composition-root wiring

`AppDependencies` gains a `supabasePersistence?: { url, publishableKey }` field. When provided AND `pnpm db:status` is reachable, the three adapters replace the in-memory ones. Tests in `persistence.e2e.test.ts` pass them explicitly. The default `defaultDependencies()` still emits in-memory repos so `pnpm check` stays green without Docker.

```ts
const supabase = dependencies.supabasePersistence;
const useSupabase = supabase !== undefined && supabase.url.length > 0;
const profileRepository = useSupabase
  ? new SupabaseProfileRepository({ ...supabase, fetchAccessToken })
  : new InMemoryProfileRepository({ ... });
```

`fetchAccessToken` reads from `request.principal.accessToken` (already in scope at the route layer). The composition root just wires the dependencies; the per-request token is plumbed by each repo at call time.

### E. Error envelope

Adapter-level errors map to the existing `apiErrorCode` union:

- Supabase RLS rejection → 404 (404 indistinguishable from missing — same as today's in-memory contract).
- Supabase partial-unique violation (`goals_one_active_per_user`) → 409 with `kind: "validation_error"` matching today's in-memory "user already has an active goal" branch.
- Supabase connection error → 503 with `service_unavailable`. The route log includes the underlying error but never the row payload.

### F. Test strategy

Three tiers, all opt-in to keep the standard `pnpm check` green:

1. **Static unit tests in `apps/api/src/supabase-profile-repository.test.ts` etc.** — exercise the adapter with a mocked `SupabaseClient`. Cover happy paths, the `getOrCreate` insert path, the partial-unique-violation-to-409 mapping, and the RLS-error-to-404 mapping.
2. **Always-run integration tests in `apps/api/src/persistence.flow.test.ts`** — uses the same Fastify `app.inject` as the route tests, with the in-memory repos wired. Proves the app composition still works end-to-end with the dependency wiring. (Already covered indirectly by the existing 173 API tests + new persistence wiring tests.)
3. **Opt-in e2e tests in `apps/api/src/persistence.e2e.test.ts`** — guarded by `SUPABASE_E2E_URL`. Two-user scenario:
   - User A signs up via GoTrue → Mailpit → confirm → sign-in (existing `auth.e2e.test.ts` style).
   - A creates a profile via SupabaseProfileRepository, restarts the Fastify process (simulated by re-constructing the repos), re-reads the profile from the new instance — proves persistence.
   - A creates a goal, then attempts to create a second active goal — fails with 409 mapped from the partial-unique violation.
   - B signs up separately, tries to read A's profile — fails with 404 mapped from the RLS rejection (the route returns 404, indistinguishable from "not found").
   - A creates food entries, restarts, lists — they persist.
4. **pgTAP stays as-is.** The schema/RLS coverage is unchanged; PERSIST-001 doesn't add pgTAP tests because the migration is purely additive and SQL constraints already exercise the new columns' check constraints on insert.

## File layout (new files, ordered by dependency)

```
supabase/migrations/20260718100000_persist_001_columns.sql
  -- one forward-only migration adding the three new columns + the partial unique index.

packages/adapters/supabase-server/src/
  client.ts                          -- createSupabaseRepositoryClient(url, key, token)
  profile-repository.ts             -- SupabaseProfileRepository
  goal-repository.ts                -- SupabaseGoalRepository
  food-entry-repository.ts           -- SupabaseFoodEntryRepository
  profile-repository.test.ts         -- mocked-client unit tests (always run)
  goal-repository.test.ts            -- mocked-client unit tests
  food-entry-repository.test.ts       -- mocked-client unit tests

apps/api/src/
  persistence.e2e.test.ts           -- opt-in real-Supabase e2e
                                     -- guarded by SUPABASE_E2E_URL; mirrors the
                                        auth.e2e test pattern.
  supabase-repository-options.ts     -- shared option type so the API composition root
                                        can choose in-memory vs Supabase without API drift.

apps/api/src/app.ts                 -- wire optional supabasePersistence into dependency resolution.
  defaultDependencies() keeps in-memory.
```

`packages/core/src/` is unchanged — the existing ports are already correct.

`packages/contracts/` is unchanged — the wire shapes are already correct.

## Exit criteria for this segment

1. `pnpm check` green with NO env vars set (standard gate).
2. Three mocked-unit suites pass for the three new repositories.
3. One opt-in e2e `persistence.e2e.test.ts` against `pnpm db:start`:
   - creates a profile, simulates a restart by re-constructing the repo, reads the profile back — same id, same values.
   - rejects cross-user profile reads with 404.
   - creates a goal, attempts to create a second active goal — rejects with 409 mapped to today's `VALIDATION_ERROR`.
   - creates food entries, persists, restarts, lists, finds them all.
4. `backlog.md` row `PERSIST-001` flipped from `ready` to `done`.
5. `status.md` "Snapshot" updated: "Latest completed work package: PERSIST-001..."
6. `docs/RESEARCH_LOG.md` `2026-07-18 — PERSIST-001 ...` entry explaining:
   - why the schema migration is split out from the adapter
   - why we use `setSession` instead of service-role
   - why refresh-token rotation is deferred
   - what PERSIST-002 inherits (need to handle cascade-delete semantics, including the partial-unique violation when re-creating an active goal after account deletion).

## Files I will touch (in execution order, gated on user approval)

1. `supabase/migrations/20260718100000_persist_001_columns.sql` (new, ~25 lines, forward-only).
2. `packages/adapters/supabase-server/src/client.ts` (new, ~30 lines, dependency extraction from existing token-verifier client construction).
3. `packages/adapters/supabase-server/src/profile-repository.ts`, `goal-repository.ts`, `food-entry-repository.ts` (three files, ~80 lines each).
4. `packages/adapters/supabase-server/src/{profile,goal,food-entry}-repository.test.ts` (three mocked-client unit suites).
5. `apps/api/src/supabase-repository-options.ts` (new, <40 lines).
6. `apps/api/src/app.ts` (extend the dependency resolution — in-memory remains default; Supabase activates only when configured).
7. `apps/api/src/persistence.e2e.test.ts` (new opt-in e2e, ~150 lines; mirrors `auth.e2e.test.ts` shape for sign-up / Mailpit / persistence flow).
8. `docs/RESEARCH_LOG.md` + `status.md` + `backlog.md` updates.

Estimated diff size: ~10 new files, ~700 lines of new code, ~80 lines of changes in `app.ts`. The two segments after this (PERSIST-002, PERSIST-003) follow the same shape and reuse the per-feature adapter tests.

## Risks and how I'll mitigate them

1. **Supabase JS client construction cost.** The per-request `createClient` is heavier than reusing one client. Mitigation: factory creates the client once per `SupabaseRepository*` instance; the access token is replayed via `.auth.setSession({ access_token, ... })` at the top of each request through the route layer. This is the canonical multi-tenant pattern Supabase documents.
2. **RLS collision in tests.** The opt-in e2e creates two real users; it must clean up after itself to avoid polluting the next run. Mitigation: the test runs an `afterEach` that calls the service-role key to delete both users via `auth.admin.deleteUser()`. Without the service key the test skips itself.
3. **Partial unique index conflicts with existing seed data.** The migration is forward-only and adds the index after the column addition; an existing-row backfill is unnecessary because both `pace` and `review_date` are nullable. The partial unique index is enforced only when `status = 'active'`, so a user with zero active goals can have at most one when they transition to `active` — no conflict.
4. **The auth E2E test pattern uses Mailpit + GoTrue confirmation.** PERSIST-001 reuses that exact sign-up flow. If `pnpm db:start` is not running, the suite skips — same pattern as `auth.e2e.test.ts`.

## What I will NOT do in this segment

- **No service-role fallback.** RLS is the only security model; service-role is only used for cleanup in the e2e test.
- **No refresh-token rotation.** When the access token expires, the API returns 401 and the mobile app re-authenticates. A future segment adds refresh-token handling.
- **No mobile UI work.** MOB-* family is gated on this segment landing.
- **No account-export or account-deletion against real rows.** DATA-001's in-memory cascade stays in place; PERSIST-002 swaps it to a real-record cascade.
- **No changes to RLS policies.** The schema migration is purely additive (new nullable columns + index). The RLS coverage in `0002_user_isolation.test.sql` continues to hold.

## Verification commands

```bash
# standard gate, no env
cd /Users/adam/Documents/mizyun
pnpm check

# full opt-in e2e gate
pnpm db:start
SUPABASE_E2E_URL=http://127.0.0.1:54321 \
SUPABASE_E2E_PUBLISHABLE=$(pnpm db:status --output json | jq -r .publishable) \
SUPABASE_E2E_SERVICE=$(pnpm db:status --output json | jq -r .service) \
AUTH_E2E_MAILPIT=http://127.0.0.1:54324 \
SUPABASE_E2E_MAILPIT=http://127.0.0.1:54324 \
pnpm --filter @mizyun/api test

pnpm db:stop
```

The exit count goes from 173 API tests → roughly 215 (15 mocked-unit × 3 + 5 mocked-unit × 0 + 8 e2e ≈ 53 new tests, plus router integration tests for the wiring). Counts get re-run and recorded.
