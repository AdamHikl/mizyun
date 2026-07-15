# Mizyun current status

> Fast-changing session handoff. Update this file at the end of every development session. Last updated: **2026-07-15**.

## Snapshot

- **Roadmap phase:** Phase 1 — backend environment and authenticated data boundary
- **Completed work package:** CFG-001 / P1.2 validated mobile and API environment composition
- **Next active work package:** API-001 provider-neutral authenticated mobile API client
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
  tests: passed (56 total, +41 from @mizyun/config)
  Hermes bundle purity: confirmed no SUPABASE_SECRET_KEY / sbp_ / eyJ... JWT literals
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
- Local `.env` public configuration and a real simulator authentication lifecycle.
- Authenticated mobile API client, token refresh/error normalization, account/settings UI, recovery, and confirmation deep links.
- Signed-URL API isolation test for private media. Storage path policy tests already pass.
- Profile onboarding, goals UI, food logging, workouts, progress uploads, device steps, or health-platform sync.
- PostgreSQL-backed feature repositories, conversations, or durable memory adapter.
- Any model provider or photo analysis.
- Android emulator/runtime verification.

## Next exact work package

### API-001 — provider-neutral authenticated mobile API client

1. Read `AGENTS.md`, `goals.md`, `plan.md`, this file, and the relevant Phase 1 requirements/ADRs (especially ADR-0002 and ADR-0004).
2. Confirm `@mizyun/config` is wired into both apps; re-run `pnpm check` if CFG-001 evidence is stale.
3. Implement a typed API client in `apps/mobile/src/composition/api-client.ts` (or a new feature module) that pulls the access token from `@mizyun/identity`'s `AuthClient`, attaches it as a bearer token, and normalizes 401/network failures into retryable UI states.
4. Add contract-level tests against `apps/api/src/app.test.ts`-style fixtures; treat `/v1/me` as the first wired-up route.
5. Run `pnpm check`, `git diff --check`, then update this handoff.

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
- `docs/BEFORE_TESTING.md` — mandatory checklist before enabling an AI provider.

## Handoff note

The repository documents are the handoff. Start with `AGENTS.md`, then follow the source-of-truth order in `docs/SESSION_GUIDE.md`. The active item is CFG-001; do not reopen P1.1 unless database verification regresses or the documented port-exposure issue is being addressed deliberately.
