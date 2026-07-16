# Mizyun current status

> Fast-changing session handoff. Update this file at the end of every development session. Last updated: **2026-07-15**.

## Snapshot

- **Roadmap phase:** Phase 1 — backend environment and authenticated data boundary
- **Completed work package:** OPS-001 establish safe structured API logging/error baseline
- **Next active work package:** AND-001 configure and verify Android emulator
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

### AND-001 — Android emulator configuration and verification

1. Read `AGENTS.md`, `goals.md`, `plan.md`, this file, and `docs/QUALITY_GATES.md`.
2. Verify the Android emulator (or a physical Android device) can boot the Expo SDK 57 app at parity with the iOS simulator.
3. Run the AUTH-001 / AUTH-002 / AUTH-003 manual paths on Android and capture any platform-specific deltas (permission dialogs, deep-link handler registration, SecureStore availability, deep-link intent filters).
4. Update `docs/AUTH_VERIFICATION.md` (or a new `docs/ANDROID_VERIFICATION.md`) with the Android-specific steps and any Android-only configuration changes (e.g. `intentFilters` in `app.json`).
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
- ADR-0005 — provider-neutral authenticated transport (`@mizyun/api-client`, `Result<T, ApiError>` envelope).
- `docs/BEFORE_TESTING.md` — mandatory checklist before enabling an AI provider.

## Handoff note

The repository documents are the handoff. Start with `AGENTS.md`, then follow the source-of-truth order in `docs/SESSION_GUIDE.md`. The active item is CFG-001; do not reopen P1.1 unless database verification regresses or the documented port-exposure issue is being addressed deliberately.
