# Mizyun current status

> Fast-changing session handoff. Update this file at the end of every development session. Last updated: **2026-07-17**.

## Snapshot

- **Roadmap phase:** Phase 2 — onboarding, profile, and goals
- **Completed work package:** DATA-001 export + deletion lifecycle
- **Next active work package:** ENG-001 energy-formula research (or MEDIA-001 upload/sign/delete adapter)
- **Branch:** `main`
- **Remote:** `https://github.com/AdamHikl/mizyun`
- **Repository:** `/Users/adam/Documents/mizyun`
- **AI provider:** intentionally disabled; do not enable it during Phase 1
- **Hosted Supabase:** intentionally not created or linked yet
- **iOS simulator:** working; last verified screen is the intentional configuration-required state
- **Android emulator/device:** not configured or verified
- **Local Supabase:** Docker runtime works; migrations, lint, and database tests pass

## Delivered and verified

- Expo SDK 57 application starts and exports a complete iOS Hermes bundle from the pnpm workspace.
- Mobile authentication is behind provider-neutral interfaces and safely detects missing configuration.
- Native sessions use chunked Expo SecureStore storage.
- Fastify has bearer-token protection and `/v1/me`.
- Committed migrations define profiles, goals, body measurements, food entries, exercises, workouts, workout sets, conversations, messages, user-managed memories, internal provider references, and private media.
- User-facing tables receive explicit `authenticated` CRUD grants; `memory_provider_refs` is server/internal-only.
- RLS ownership policies and user indexes cover all current user-owned tables.
- Private-media policies constrain operations to the authenticated user's path.
- Clean local database reset and lint pass.
- Both pgTAP files pass: **55 assertions total**, including cross-user row access, mutation, storage-path isolation, and denial of client access to internal provider references.
- AI orchestration and memory ports exist only with disabled/in-memory implementations. No model API is configured.
- Cross-session sources of truth exist: `goals.md`, `plan.md`, `status.md`, `backlog.md`, requirements, quality gates, research log, and ADRs.
- Validated environment composition: `@mizyun/config` package owns the env reader, Zod schemas, and a closed-world `EXPO_PUBLIC_*` allowlist. API and mobile composition roots call `loadServerConfig()` / `loadMobileConfig()` and receive typed values; no `process.env.*` reads remain at the composition roots.
- Authenticated transport: `@mizyun/api-client` package owns the typed `ApiClient` interface, an `HttpApiClient` that attaches the bearer token from `authClient.getSession()` and normalizes 401/network errors into a discriminated `ApiError` union, and a `DisabledApiClient` for when `EXPO_PUBLIC_API_URL` is absent. The mobile composition root selects the right one based on `loadMobileConfig().apiUrl`.
- End-to-end auth verified: the `apps/api/src/auth.e2e.test.ts` opt-in suite exercised the full GoTrue sign-up → Mailpit confirm → password sign-in → `/v1/me` round-trip through `HttpApiClient` against a real local Supabase stack. Server-side `/v1/me` schema enforcement confirmed via `app.inject` (rejects non-UUID principals with 500). Manual simulator checklist lives at `docs/AUTH_VERIFICATION.md`.
- Account/settings UI: the new **Account** tab (`apps/mobile/src/app/settings.tsx`) loads the verified principal from `/v1/me` via the production `HttpApiClient` and exposes an explicit sign-out wired through `useAuth().signOut()`. The screen renders the disabled-auth and disabled-api placeholder when `.env` is incomplete, and a typed `reducePrincipalState` reducer covers every `ApiError` variant in `apps/mobile/src/features/settings/principal-state.test.ts` (12 vitest cases).
- Recovery and confirmation deep-link flows: `@mizyun/identity` exposes a `DeepLinkPayload` union, a `parseDeepLinkFragment` helper, and three new `AuthClient` methods (`consumeDeepLink`, `updatePassword`, `requestPasswordRecovery`). The Supabase mobile adapter implements them via `supabase.auth.setSession`, `updateUser`, and `resetPasswordForEmail`. A top-level `DeepLinkBridge` in `_layout.tsx` consumes `Linking.getInitialURL` and `Linking.addEventListener("url", ...)` so cold-start and warm-start deep links both reach the auth boundary. The SessionGate shows a new `ResetPasswordScreen` when `recoveryState === true`. Opt-in e2e suite exercises the full recovery round-trip against the running local Supabase: 4/4 tests pass.
- Safe API logging baseline: `apps/api/src/logging.ts` centralises the pino redact list (Authorization, cookie, body.password/email/token/access_token/refresh_token/session, response set-cookie), request/response serializers that include headers and cookies so the redaction is observable, and a `safeErrorSerializer` that strips `error.cause` and `error.errors` chains. `apps/api/src/errors.ts` owns the `apiErrorSchema` envelope via `sendApiError` and `internalErrorBody` helpers plus a typed `ApiErrorCode` union. Both the global error handler and the authentication plugin now route through these helpers. 10 logging tests + 5 envelope tests pass; runtime tests assert no Bearer token / throw-token / downstream cause secret ever reaches the log line, and the pino censor string `[Redacted]` does.
- Private-media signed-URL isolation (SEC-002): the opt-in `apps/api/src/auth.e2e.test.ts` suite gained a `SEC-002: signed URLs are scoped to the verified owner and reject other users` case. It signs up two confirmed users (A and B), uploads an object under `/private-media/<userA>/a-photo.jpg`, then asserts that (i) A can sign their own path, (ii) B cannot sign A's path, (iii) B cannot enumerate a guessed path inside A's folder, and (iv) a non-existent bucket is rejected. No `signedURL` ever appears in a cross-user response body.
- Profile vertical slice (PROF-001): the new `/v1/profile` API route is live. `GET /v1/profile` returns the verified user's profile (auto-creating a default row on first read so the trigger-vs-client race is absorbed). `PUT /v1/profile` accepts a partial patch parsed through `profilePatchSchema`, validated by the domain layer in `@mizyun/core`, and applied via `applyProfilePatch`. All four profile fields (displayName, unitSystem, timezone, birthYear, heightCm) are bounded; nullable fields clear when the patch sets them to `null`. 14 core domain tests + 10 API route tests cover every branch of the patch lifecycle. The `ProfileRepository` port has one in-memory implementation today; the Supabase adapter is the next segment.
- Goal vertical slice (GOAL-001): the new `/v1/goals` API surface is live. `GET /v1/goals/active` returns the user's current active goal (404 if none). `GET /v1/goals/history` returns the full chronological record newest-first. `POST /v1/goals` creates a new active goal with server-generated `id`, `status` (always `active`), and audit timestamps; rejects unknown fields via `goalCreateSchema.strict()`. `PUT /v1/goals/:id` applies a partial patch with status-transition rules (draft → active/archived, active → completed/archived; completed and archived are terminal). All five patchable fields (`status`, `pace`, `target`, `targetDate`, `reviewDate`) are validated by the domain layer in `@mizyun/core`. 25 core domain tests + 14 API route tests cover every branch including cross-user isolation. The `GoalRepository` port has one in-memory implementation today; the SQL partial-unique-index adapter lands in a follow-up segment.
- Onboarding flow (UX-001): the new `OnboardingScreen` walks a fresh user through welcome → displayName → units → primaryGoal in four steps. The wizard reducer (`apps/mobile/src/features/onboarding/onboarding-state.ts`) is pure and vitest-covered (23 cases); the submit function (`submit-onboarding.ts`) sequences a `PUT /v1/profile` then a `POST /v1/goals` through `apiClient` and humanises every `ApiError.kind` into a retryable message (8 vitest cases). The `AuthContext` now carries `profile` and `refreshProfile()` so the `SessionGate` routes any user with `profile.displayName === null` into the wizard, and flips back to the regular tabs once `refreshProfile()` returns the freshly-set displayName.
- Manual food CRUD + daily summary (NUT-001, NUT-002): `/v1/food-entries` covers create / list / get / patch / delete with `from`/`to`/`limit` range filtering. `/v1/food-entries/summary?date=` returns a single-day aggregate, `?from=&to=` returns a per-day array. Numeric totals are nullable when any entry on the day has a null for the field — the UI prompts to backfill rather than report a misleading zero. 33 core + 38 API tests.
- Custom exercise CRUD (EX-001): `/v1/exercises` covers the standard CRUD. List returns sorted by name (case-insensitive) for a stable picker. 22 core + 24 API tests.
- Workout sessions (WO-001): `/v1/workouts` covers CRUD with the same `from`/`to`/`limit` filter shape as food entries. An in-flight workout has `completedAt: null`; setting `completedAt: null` re-opens a finished workout. The schema rejects `completedAt < startedAt`. 26 core + 22 API tests.
- Body measurements (BODY-001): `/v1/body-measurements` is append-only — POST + GET (list with range filter) + GET-by-id + DELETE. No PUT. `weightKg` is bounded to `[30, 250]`; the open `measurements` JSONB blob accepts arbitrary attributes (waist_cm, chest_cm, etc.). 10 core + 19 API tests.
- Workout sets + previous-performance (WO-002): `/v1/workouts/:workoutId/sets` covers POST/GET/DELETE for sets; the route server-generates `sequence` when the client omits it. `/v1/exercises/:exerciseId/recent-sets` returns the user's recent sets plus a summary block (best load, last session volume, total set count). Sets are immutable observations. 21 core + 16 API tests.
- Account export + deletion (DATA-001): `/v1/account/export` returns a single JSON envelope covering every Phase 2 feature (profile, goals, food entries, exercises, workouts, workout sets, body measurements; `conversations` and `privateMedia` reserved for the CONV-* / MEDIA-* segments). `/v1/account/delete/request` issues a 5-minute opaque confirmation token; `/v1/account` accepts it and orchestrates a children-before-parents cascade across every per-feature repository. The token is single-use (retry returns 409 with `confirmation_token_missing`). 10 API tests cover the read path, the request/confirm flow, mismatched tokens, expired challenges, and the cascade effect on the partition. Research log: `docs/RESEARCH_LOG.md` `2026-07-17 — DATA-001 export + deletion lifecycle`.

## Verification evidence

Database gate after the explicit-grant migration:

```text
pnpm db:verify
  clean migration reset: passed
  database lint: passed (no schema errors)
  pgTAP: passed (2 files, 55 assertions)
```

The current standard application gate passed:

```text
pnpm check
  formatting: passed
  workspace type checks: passed
  iOS Metro/Hermes bundle: passed (1,562 modules)
  tests: passed (95 always-runs; +3 opt-in e2e against local Supabase when AUTH_E2E_* env is set)
  AUTH-001 e2e (against running local Supabase): 3/3 passed
    - sign-up → Mailpit confirm → sign-in → /v1/me round-trip via HttpApiClient
    - 401 surface → kind: "session_expired"
    - 404 surface → kind: "parse_error" (no fabrication)
  AUTH-003 e2e (against running local Supabase): +1 test
    - recovery email → Mailpit → /auth/v1/verify 303 redirect → fragment parse → /v1/me via HttpApiClient → password rotation → old-password rejection
  OPS-001 logging: 10/10 passed (redact list, serializers, runtime redaction against captured pino stream)
  OPS-001 error envelope: 5/5 passed (apiErrorSchema shape, request-id propagation, x-request-id passthrough)
  Hermes bundle purity: confirmed no SUPABASE_SECRET_KEY / sbp_ / eyJ... JWT literals
  AUTH-002 settings reducer: 12/12 passed (every ApiError variant + success + disabled states)
  AUTH-003 deep-link parser: 9/9 passed (every kind + invalid shapes)
```

Run `pnpm check` again after any new executable change and update this evidence if counts change.

## Important unresolved issue

Supabase CLI 2.109.1 reports localhost URLs, but Docker Desktop currently publishes API `54321`, database `54322`, Studio `54323`, and Mailpit `54324` on `0.0.0.0` and IPv6 `::`.

The official custom-network recipe was tested with `com.docker.network.bridge.host_binding_ipv4=127.0.0.1`; Docker confirmed that option on the network, but the generated Supabase containers still published on all interfaces. The experimental wrapper was removed because it did not provide the promised protection.

Until this is resolved:

- use the local stack only on a trusted network;
- do not put real user data or secrets into it;
- run `pnpm db:stop` when it is not actively needed;
- do not claim the stack is loopback-only based solely on its displayed URLs.

## Not implemented yet

- A validated, shared environment configuration layer for the API and mobile app. ✅ Completed as `@mizyun/config`.
- Authenticated mobile API client. ✅ Completed as `@mizyun/api-client`.
- Real sign-up/sign-in/session restore against local Supabase. ✅ Completed (programmatic e2e + manual checklist).
- Account/settings UI with sign-out, password recovery, and confirmation deep-link flows. ✅ Sign-out done as AUTH-002. ✅ Recovery + confirmation done as AUTH-003.
- Signed-URL API isolation test for private media. Storage path policy tests already pass.
- Profile onboarding, goals UI, food logging, workouts, progress uploads, device steps, or health-platform sync.
- PostgreSQL-backed feature repositories, conversations, or durable memory adapter.
- Any model provider or photo analysis.
- Android emulator/runtime verification.

## Next exact work package

### UX-001 — new-user onboarding flow

1. Read `AGENTS.md`, `goals.md`, `plan.md`, this file, and `docs/QUALITY_GATES.md`.
2. Survey the existing iOS auth surface (AUTH-001 / AUTH-002 / AUTH-003) and the new `/v1/profile` + `/v1/goals` routes. Decide which fields are required on the first screen (display name, units, timezone) vs deferrable (height, birth year, primary goal).
3. Add an `onboarding` route group in `apps/mobile/src/app/` with a sequence of small screens. Each screen validates locally, defers the API write until the user taps Continue on the final screen, and falls back to a retry state when the network drops.
4. Wire the onboarding flow into the SessionGate: a user with no `profile.displayName` (or with a flag column on the profile row) sees the onboarding flow instead of the dashboard; once complete, the flow is skipped.
5. Tests: vitest cases for each onboarding screen's validation; one api test that proves the combined profile + goal write succeeds end-to-end via the real Fastify test instance.
6. Update `docs/AUTH_VERIFICATION.md` with the onboarding path so the iOS simulator manual verification covers it.
7. Run `pnpm check`, `git diff --check`, then update this handoff.

## Commands

```bash
cd /Users/adam/Documents/mizyun
pnpm install
pnpm check
pnpm db:start
pnpm db:verify
pnpm db:stop
pnpm dev:api
pnpm dev:mobile
```

Create `.env` from `.env.example` only when beginning real local authentication. Use the public URL/publishable key from `pnpm db:status`; never place a secret or service-role key in an `EXPO_PUBLIC_` variable. Do not commit `.env`.

## Durable decisions

- ADR-0001 — modular monolith with ports and adapters.
- ADR-0002 — provider-neutral identity boundary.
- ADR-0003 — local-first Supabase development, migration/pgTAP gates, and explicit Data API grants.
- ADR-0004 — validated environment composition (`@mizyun/config`, closed-world mobile allowlist).
- ADR-0005 — provider-neutral authenticated transport (`@mizyun/api-client`, `Result<T, ApiError>` envelope).
- `docs/BEFORE_TESTING.md` — mandatory checklist before enabling an AI provider.

## Handoff note

The repository documents are the handoff. Start with `AGENTS.md`, then follow the source-of-truth order in `docs/SESSION_GUIDE.md`. The active item is CFG-001; do not reopen P1.1 unless database verification regresses or the documented port-exposure issue is being addressed deliberately.
