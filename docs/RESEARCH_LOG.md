# Research log

> Index of primary documentation reviewed before implementation. Recheck sources when a new segment begins; platform behavior, pricing, policies, SDKs, and provider terms change over time.

## Entry format

Each entry records date, scope/version, primary sources, findings that affected implementation, and any resulting ADR. Inferences must be labeled as such.

## 2026-07-14 — Monorepo and modular API foundation

### Scope

Expo monorepo behavior, Fastify plug-in boundaries, Supabase RLS, and private Storage.

### Primary sources

- Expo monorepos: https://docs.expo.dev/guides/monorepos/
- Fastify plug-ins: https://fastify.dev/docs/latest/Reference/Plugins/
- Fastify encapsulation: https://fastify.dev/docs/latest/Reference/Encapsulation/
- Supabase Row Level Security: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase Storage buckets: https://supabase.com/docs/guides/storage/buckets/fundamentals

### Findings used

- Expo supports workspace monorepos through its Metro configuration.
- Fastify plug-ins provide a useful route/composition boundary.
- RLS must be enabled and ownership policies explicitly written for exposed tables.
- Progress/food media belongs in a private bucket with authorized access rather than public URLs.

### Result

ADR-0001: modular monolith with ports and adapters.

## 2026-07-14 — Provider-neutral Supabase authentication

### Scope

Supabase React Native/Expo auth, server token claims, profile creation, and Expo SDK 57 SecureStore.

### Primary sources

- Supabase React Native Auth quickstart: https://supabase.com/docs/guides/auth/quickstarts/react-native
- Supabase Expo quickstart: https://supabase.com/docs/guides/getting-started/quickstarts/expo-react-native
- Supabase JavaScript `getClaims`: https://supabase.com/docs/reference/javascript/auth-getclaims
- Supabase user-data/profile trigger guidance: https://supabase.com/docs/guides/auth/managing-user-data
- Expo SDK 57 SecureStore: https://docs.expo.dev/versions/v57.0.0/sdk/securestore/

### Findings used

- React Native auth sessions need persistent storage and foreground-aware refresh behavior.
- Server authorization can normalize verified token claims behind an access-token verifier.
- Application profile rows can be created from an auth-user trigger while remaining protected by RLS.
- SecureStore is appropriate for encrypted native key/value persistence; session payloads are chunked to avoid depending on a single large stored value.

### Result

ADR-0002: provider-neutral identity boundary.

## 2026-07-15 — Expo SDK 57 Metro workspace resolution

### Scope

Metro resolving TypeScript source exported directly from a pnpm workspace package.

### Primary source

- Expo SDK 57 Metro configuration and ES module resolution: https://docs.expo.dev/versions/v57.0.0/config/metro/

### Findings used

- Metro resolves workspace source files directly and supports extensionless module resolution.
- A TypeScript file importing a sibling as `./chunked-storage.js` caused Metro to search for a physical `.js` file; the extensionless source import resolves the existing `.ts` module.
- Type checking alone did not exercise Metro resolution, so the full gate now exports a real iOS bundle.

### Result

- Fixed the mobile adapter import.
- Added `@mizyun/mobile bundle:check` to `pnpm check`.

## 2026-07-15 — Local-first Supabase development and policy testing

### Scope

Supabase CLI 2.109.1, local stack configuration, migrations, environment promotion, pgTAP policy testing, mobile Auth redirects, and private Storage access.

### Primary sources

- Local development: https://supabase.com/docs/guides/local-development
- CLI getting started: https://supabase.com/docs/guides/local-development/cli/getting-started
- Local schema migrations: https://supabase.com/docs/guides/local-development/overview
- Managing environments: https://supabase.com/docs/guides/deployment/managing-environments
- Database migrations: https://supabase.com/docs/guides/deployment/database-migrations
- Database/RLS testing: https://supabase.com/docs/guides/local-development/testing/overview
- Native mobile deep linking: https://supabase.com/docs/guides/auth/native-mobile-deep-linking
- Redirect URLs: https://supabase.com/docs/guides/auth/redirect-urls
- Storage access control: https://supabase.com/docs/guides/storage/security/access-control

### Findings used

- Supabase recommends local CLI development backed by a Docker-compatible runtime, followed by deployment of committed migrations to linked environments.
- `supabase db reset` recreates the local database from committed migrations and is the reproducibility gate.
- pgTAP tests run through `supabase test db` and can exercise RLS with authenticated roles and synthetic JWT subjects.
- Native confirmation/recovery flows require a registered custom application scheme and an allowed redirect URL.
- Storage denies operations by default; per-operation policies must constrain the bucket and user-owned path.
- Production wildcard redirects are discouraged; the development `mizyun://**` wildcard will be replaced by exact hosted redirect paths before release.

### Result

- ADR-0003 selected local-first Supabase development.
- Supabase CLI 2.109.1 is pinned as a development dependency.
- Local config and initial schema/RLS/Storage pgTAP suites were added.

## 2026-07-15 — Supabase Data API grants and local port exposure

### Scope

Supabase CLI 2.109.1 table privileges after the April 2026 Data API security change, plus local Docker network binding behavior on Docker Desktop for macOS.

### Primary sources

- Data API grant breaking change: https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically
- Securing the API: https://supabase.com/docs/guides/api/securing-your-api
- Secure data: https://supabase.com/docs/guides/database/secure-data
- Local development and loopback-network guidance: https://supabase.com/docs/guides/local-development

### Findings used

- New public tables are no longer automatically granted to Data API roles. Table privileges and RLS are distinct layers and both must be configured.
- Mizyun now grants authenticated CRUD only on user-facing tables; `memory_provider_refs` remains unavailable to `anon` and `authenticated` clients.
- A clean reset, lint, and 55 pgTAP assertions pass with the explicit grants.
- The official loopback Docker-network recipe was attempted. On this machine the network carried the documented `127.0.0.1` option, but Supabase containers still published API, database, Studio, and Mailpit on `0.0.0.0`/`::`. This is measured local behavior, not a claim about all Docker installations.

### Result

- Added an explicit authenticated-table-grants migration and a negative privilege test for internal memory-provider references.
- Did not retain the ineffective loopback wrapper. Until binding is resolved, run the local stack only on a trusted network and stop it when unused.

## Next required research

Before implementing authenticated mobile deep-link handling, review the exact Expo SDK 57 Linking/AuthSession guidance together with the current Supabase PKCE recovery flow.

## 2026-07-15 — Expo SDK 57 environment variables and validated composition

### Scope

How Expo SDK 57 inlines `EXPO_PUBLIC_*` variables into the mobile bundle, Metro's TypeScript module resolution against workspace source files, Zod 3 `.transform` patterns for converting parsed inputs into typed outputs, and Node-style host/port validation patterns for Fastify.

### Primary sources

- Expo SDK 57 environment variables: https://docs.expo.dev/versions/v57.0.0/workflow/environment-variables/
- Expo Metro configuration: https://docs.expo.dev/versions/v57.0.0/config/metro/
- Expo workspaces: https://docs.expo.dev/guides/monorepos/
- Zod 3 documentation: https://zod.dev/
- Fastify server configuration: https://fastify.dev/docs/latest/Reference/Server/
- TypeScript module resolution (`Bundler`): https://www.typescriptlang.org/docs/handbook/modules/reference.html#bundler

### Findings used

- Expo SDK 57 inlines only `EXPO_PUBLIC_*` variables into the bundle at build time. Other variables are not exposed to the runtime, but a dedicated allowlist at the composition root is necessary because the loader must reject mismatched snapshots at test time (where a contributor could simulate injection via a process.env object).
- Metro resolves workspace source files via `moduleResolution: "Bundler"`-style semantics: extensionless `./foo` references the existing `foo.ts` source. This is the same fix applied to `@mizyun/adapter-supabase-mobile` per the 2026-07-15 entry above; `@mizyun/config` follows the same pattern.
- TS 5's `Bundler` resolution mode permits extensionless imports and resolves `./foo` to `./foo.ts` without the runtime `--experimental-specifier-resolution=node` flag.
- Zod 3 `.transform(...)` on a schema returns a typed value with which post-parse consumer code never needs to handle the parse-input shape. Combined with `z.coerce.number().int().min(1).max(65535)`, integer and range failures emit distinct issue codes (`invalid_type` vs `too_small`/`too_big`); the loader maps both to `ConfigIssue` `kind: "out_of_range"` so the UI distinguishes "wrong shape" from "value out of bounds".
- Fastify accepts `listen({ host, port })` with a numeric port. Calling `loadServerConfig()` once at startup and forwarding the validated pair to `app.listen` replaces the previous inline parsing without changing boot semantics.

### Result

- ADR-0004 selected a single `@mizyun/config` package with Zod schemas and a closed-world public allowlist.
- Added `@mizyun/config` and switched `apps/api/tsconfig.json` to `moduleResolution: "Bundler"` so it can import extensionless `@mizyun/config` source exports without breaking Metro.
- Bundle-purity invariant now runs as a focused vitest suite in `@mizyun/config/src/mobile-public.test.ts`.

## 2026-07-15 — Expo SDK 57 mobile fetch and authenticated transport

### Scope

React Native `fetch` polyfills in Expo SDK 57, Vitest configuration for Expo projects (RN module stubbing), Zod `safeParse` error shape, and WHATWG Fetch `AbortController` semantics.

### Primary sources

- Expo unit testing guide: https://docs.expo.dev/guides/testing-unit-tests/
- React Native network docs (fetch, AbortController): https://reactnative.dev/docs/network
- Zod 3 `safeParse` / `ZodIssue`: https://zod.dev/
- WHATWG Fetch spec: https://fetch.spec.whatwg.org/
- MDN `AbortController`: https://developer.mozilla.org/en-US/docs/Web/API/AbortController

### Findings used

- React Native 0.86 provides `URL`, `URLSearchParams`, `Promise`, and `fetch` via `@react-native/js-polyfills`. The polyfill chain is loaded automatically by Expo; no manual `import` is needed in app code. `react-native-url-polyfill/auto` is also pulled in transitively via `@supabase/supabase-js` and handles remaining URL/URLSearchParams differences.
- `globalThis.fetch` is the correct entry point in both iOS and Android builds; there is no per-platform fork. Native `AbortController` is available through React Native's polyfills, so `AbortSignal` can be passed through to `fetch` without manual plumbing.
- Vitest cannot load `react-native`, `expo-secure-store`, or `react-native-url-polyfill/auto` directly because those modules ship native or runtime-specific code. A `vitest.config.ts` that aliases those names to no-op stubs under `apps/mobile/vitest/` lets composition-root tests exercise selection logic without pulling the native runtime into the test bundle.
- Zod 3 `safeParse` returns `{ success, data } | { success: false, error: { issues } }`. Each `issue` has a `path`, `code`, `message`, and (for some codes) `expected` / `received`. The API client surfaces validation failures as `kind: "validation_error"` carrying the full `issues` array so feature code can render field-level messages without re-parsing.
- WHATWG Fetch rejects with an `AbortError` (DOMException) when the caller's `AbortSignal` fires. The API client maps every fetch rejection (including `AbortError`, `TypeError` for network failures, and unexpected throws) to `kind: "network_error"` with the cause preserved unchanged; callers branch on `cause` if they need to distinguish.

### Result

- ADR-0005 selected a single `@mizyun/api-client` package with a `Result<T, ApiError>` return type and a discriminated-union envelope mirroring `AuthConfigurationStatus` / `AgentProviderStatus`.
- Added `apps/mobile/vitest.config.ts` and three stub modules under `apps/mobile/vitest/` so mobile tests can run without the native runtime.
- Added `authPrincipalSchema` and `meResponseSchema` to `@mizyun/contracts`; updated `apps/api/src/modules/identity/routes.ts` to validate the `/v1/me` response server-side.

## 2026-07-15 — Local Supabase GoTrue + Mailpit programmatic auth flow

### Scope

Direct GoTrue 2.192 REST API, Mailpit HTTP API for inbox inspection, and the lifecycle of an authenticated request against `HttpApiClient` → Fastify → `/v1/me`. Required to build the AUTH-001 opt-in end-to-end test that exercises the same code path the iOS simulator drives.

### Primary sources

- GoTrue REST API: https://supabase.com/docs/reference/api/auth
- Supabase GoTrue sign-up: https://supabase.com/docs/guides/auth/server-side/nextjs
- Mailpit HTTP API: https://github.com/axllent/mailpit/blob/develop/docs/API.md
- Supabase admin API (for test-user cleanup): https://supabase.com/docs/reference/api/admin

### Findings used

- GoTrue 2.192's `POST /auth/v1/signup` returns the user object **flat** at the top level (`{ id, email, role, ... }`) when email confirmation is required, _not_ wrapped in `{ user, session }`. There is no `session` field until the user confirms and re-authenticates. This shape is the same one the supabase-js mobile SDK expects from `auth.signUp`, so the programmatic e2e test mirrors it directly.
- The confirmation email lands in Mailpit at `http://127.0.0.1:54324/api/v1/messages` (note: not `:8025`; Mailpit v1.30 listens on the Supabase-injected port). The body is the rendered Text/HTML; the confirmation URL is wrapped in a parens-prefixed bracket in Text, e.g. `Confirm email address ( http://127.0.0.1:54321/auth/v1/verify?token=... )`.
- `GET /auth/v1/verify?token=...&type=signup` returns a `302` redirect to the configured `redirect_to` deep link (`mizyun://auth/callback#access_token=...`). Fetching the URL confirms the email; following the redirect is not required.
- `POST /auth/v1/token?grant_type=password` returns `{ access_token, refresh_token, expires_in, user }` with `user.email_confirmed_at` set. The access token is a JWE encrypted with the local JWT secret; the supabase-js SDK's `auth.getClaims` decrypts it transparently on the server-side adapter, and `/auth/v1/user` accepts the same token to verify identity.
- The simplest end-to-end test boundary uses `/auth/v1/user` as a stand-in for `getClaims` (it returns the verified user for a valid token, 401 for an invalid one). This keeps the e2e test agnostic of the JWE-format details that `SupabaseAccessTokenVerifier` handles in production.
- `DELETE /auth/v1/admin/users/{id}` requires the `service_role` JWT and runs against the local GoTrue admin endpoint. Test users are cleaned up in `afterAll` (best-effort) so a failing test does not leak rows into the local DB.
- The Mailpit message body contains the verification token as a query string on the link. There is no need to parse JWE; the e2e test only needs the link URL itself to confirm.

### Result

- `apps/api/src/auth.e2e.test.ts` is now guarded by `describe.skipIf(!process.env.AUTH_E2E_URL)` and runs only when the local stack is up.
- 3 e2e tests pass against the running stack: full sign-up → confirm → sign-in → `/v1/me` round-trip via `HttpApiClient`; 401 surface as `kind: "session_expired"`; 404 surface as `kind: "parse_error"`.
- `docs/AUTH_VERIFICATION.md` documents the manual iOS simulator checklist for the same flow.
- The mobile and API packages remain agnostic of the e2e harness; the test uses Node 22's built-in `fetch` to drive GoTrue/Mailpit directly.

### Followup notes

- For future e2e runs, write `apps/api/.env.test` (gitignored) holding the local keys and have vitest load it via `dotenv-cli` or a setup file. Avoid pasting live credentials into the command line, which leaks them into shell transcripts.
- `AUTH_E2E_MAILPIT` defaults to `http://127.0.0.1:54324` so the test works without explicit Mailpit configuration when running on the standard local stack.

## 2026-07-16 — Account/settings surface and SDK 57 third-tab integration

### Scope

How Expo SDK 57's `expo-router/unstable-native-tabs` adds a third tab without breaking the file-based `app/<name>.tsx` schema; how `expo-symbols` exposes SF Symbols on iOS and Material Symbols on Android; how the verified principal flows from `/v1/me` through `@mizyun/api-client` into a settings UI that mirrors the disabled-auth and disabled-api states.

### Primary sources

- expo-router `NativeTabs` SDK 57 reference: https://docs.expo.dev/versions/v57.0.0/sdk/router/native-tabs.md
- expo-router overview and `app/` file-based routing: https://docs.expo.dev/versions/v57.0.0/sdk/router/
- expo-symbols SDK 57 reference: https://docs.expo.dev/versions/v57.0.0/sdk/symbols/
- React Native testing guidance for the iOS simulator (manual `apps/mobile/src/features/settings/settings-screen.tsx`): https://docs.expo.dev/guides/testing-unit-tests/

### Findings used

- A new top-level tab is added by writing `apps/mobile/src/app/<name>.tsx` that re-exports the screen component. expo-router picks it up automatically; the type-safe `router.d.ts` under `.expo/types/` is regenerated on the next `expo start` (or `npx expo customize`) so a `TabTrigger href="/<name>"` typechecks. Until the regeneration runs, TypeScript fails with TS2322 because `/<name>` is not yet in the literal union — running `pnpm exec expo customize tsconfig.json` (which invokes the same generator) is sufficient for the gate.
- `NativeTabs.Trigger.Icon` accepts both an SF Symbol string via `sf="person.crop.circle"` and an image source via `src={require(...)}`. The existing tab icons are 24×24 PNGs with `renderingMode: "template"`, so generating a gear silhouette by hand (`scripts/render-settings-icon.ts`) keeps the asset pipeline dependency-free. `expo-symbols` is installed but not yet used at the tab level — left for a follow-up that swaps the PNG for `sf="person.crop.circle"`.
- The settings screen uses the production `HttpApiClient` (`apiClient.request({ path: "/v1/me", schema: meResponseSchema })`) instead of a one-off fetch so the rendered UI exercises the same bearer-token-attachment path that `apps/api/src/auth.e2e.test.ts` exercises. The screen's render branches are driven by a pure reducer (`reducePrincipalState` in `principal-state.ts`) which maps every `ApiError` variant to a render state — this is what the 12 new vitest cases assert. The reducer is the only test surface for the screen; rendering it through React Native testing-library was deliberately out of scope per the AUTH-002 plan.
- The disabled-auth and disabled-api states both short-circuit before any network call so the screen renders the same safe placeholder as `AuthSetupScreen` when `.env` is incomplete. This preserves the existing `useAuth()` contract: the disabled surface is uniform across the app, not screen-specific.

### Result

- `apps/mobile/src/app/settings.tsx` is a one-liner route that re-exports the screen.
- `apps/mobile/src/features/settings/settings-screen.tsx` is the screen, `apps/mobile/src/features/settings/principal-state.ts` is the pure reducer, `apps/mobile/src/features/settings/principal-state.test.ts` is the 12-case vitest suite.
- `apps/mobile/src/components/app-tabs.tsx` (iOS/Android) and `apps/mobile/src/components/app-tabs.web.tsx` (web) each grew a third tab trigger with the `Account` label and the new `settings.png` icon.
- `scripts/render-settings-icon.ts` writes `apps/mobile/assets/images/tabIcons/settings{,@2x,@3x}.png` deterministically with no external image tool. Re-run only when the icon changes.
- `docs/AUTH_VERIFICATION.md` step 8 now points to the real sign-out button instead of the AuthContext workaround.

## 2026-07-16 — Password recovery, email confirmation, and deep-link consumption

### Scope

GoTrue 2.192 implicit-flow deep-link shape for signup confirmation and password recovery; React Native `Linking` API and cold/warm-start handling; Supabase JS SDK methods (`setSession`, `updateUser`, `resetPasswordForEmail`) for the recovery round-trip; the boundary between `@mizyun/identity` (provider-neutral) and `@mizyun/adapter-supabase-mobile` (provider-specific).

### Primary sources

- Supabase recovery / update-password flow: https://supabase.com/docs/guides/auth/auth-password-reset
- Supabase redirect URLs and native deep links: https://supabase.com/docs/guides/auth/native-mobile-deep-linking
- Supabase JS `resetPasswordForEmail` reference: https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail
- Supabase JS `updateUser` reference: https://supabase.com/docs/reference/javascript/auth-updateuser
- Supabase implicit flow documentation: https://supabase.com/docs/guides/auth/sessions/implicit-flow
- React Native `Linking` API: https://reactnative.dev/docs/linking

### Findings used

- GoTrue 2.192's recovery and signup emails both surface a verification URL of the shape `http://<host>/auth/v1/verify?token=<token>&type=<signup|recovery>&redirect_to=<scheme>://<path>`. The `/verify` endpoint replies with a `303 See Other` whose `Location` header is `<redirect_to>#access_token=<jwt>&refresh_token=<token>&expires_in=3600&expires_at=<unix>&token_type=bearer&type=<...>`. Confirmed by a direct Node fetch against the local GoTrue instance (Mailpit captured both the signup and recovery messages; the redirect was inspected with `redirect: "manual"`).
- The GoTrue implicit flow puts the access/refresh tokens in the URL fragment, not the query string. React Native's `Linking.getInitialURL` and `Linking.addEventListener("url", ...)` preserve the fragment, so a provider-agnostic `parseDeepLinkFragment(rawUrl)` parser can recover both tokens plus the `type` discriminator. The fragment is required to be non-empty AND must contain both `access_token` and `refresh_token`; missing either returns `null` so the deep-link consumer does not misfire on unrelated URLs.
- `supabase.auth.setSession({ access_token, refresh_token })` is the canonical way to consume the implicit-flow callback. It persists the session to SecureStore, fires `SIGNED_IN`, and (when the `type=recovery`) also fires `PASSWORD_RECOVERY`. The mobile adapter subscribes to `onAuthStateChange` so it knows when to flip its recovery flag — this is reliable even on cold start because the SDK replays its internal state after `setSession`.
- `supabase.auth.updateUser({ password })` succeeds without re-authentication only when the SDK is in the `PASSWORD_RECOVERY` state. Calling it outside that state throws a `user_from_another_tenant` / `auth` error that surfaces as `IdentityError` `AUTH_NOT_IN_RECOVERY` in the boundary. The adapter tracks a `#inRecovery` boolean so feature code can branch without re-parsing SDK events.
- `supabase.auth.resetPasswordForEmail(email, { redirectTo: "mizyun://auth/callback" })` posts to `/auth/v1/recover` with the explicit redirect. The local `additional_redirect_urls = ["mizyun://**"]` in `supabase/config.toml` (already set in CFG-001) covers the wildcard for the local stack.
- For the boundary itself, `@mizyun/identity` exposes a discriminated `DeepLinkPayload` union (recovery, signup, magiclink, email_change, unknown), a `parseDeepLinkFragment` helper, and three new `AuthClient` methods (`consumeDeepLink`, `updatePassword`, `requestPasswordRecovery`). The provider-specific Supabase mobile adapter implements them; the `DisabledAuthClient` rejects each with `AUTH_NOT_CONFIGURED`. This keeps the boundary provider-neutral — a future Auth0 / Clerk adapter would only need to implement the same shape.
- The mobile `DeepLinkBridge` (mounted inside `AuthProvider`) handles both cold-start and warm-start URLs. The `Linking` subscription is torn down in the `useEffect` cleanup, and the `consumeDeepLink` call routes the parsed payload through the AuthContext so the SessionGate renders the `ResetPasswordScreen` when `recoveryState === true`.
- Vitest stubs needed updating across `apps/api/src/auth.e2e.test.ts`, `packages/api-client/src/{api-client,http-api-client}.test.ts`, and `apps/mobile/src/composition/api-client.test.ts` to add the three new `AuthClient` methods so the typed stubs still satisfy the interface.

### Result

- `packages/identity/src/index.ts` exports `DeepLinkPayload`, `parseDeepLinkFragment`, and the three new methods on `AuthClient`. The `DisabledAuthClient` rejects each with `AUTH_NOT_CONFIGURED`.
- `packages/adapters/supabase-mobile/src/index.ts` implements `consumeDeepLink` via `client.auth.setSession`, `updatePassword` via `client.auth.updateUser` (guarded by the `#inRecovery` flag), and `requestPasswordRecovery` via `client.auth.resetPasswordForEmail`. The `PASSWORD_RECOVERY` event listener auto-sets `#inRecovery` so cold-start deep links work.
- `apps/mobile/src/app/_layout.tsx` mounts a `DeepLinkBridge` component that subscribes to `Linking.getInitialURL` and `Linking.addEventListener("url", ...)` and forwards parsed payloads to `useAuth().consumeDeepLink`.
- `apps/mobile/src/features/auth/auth-context.tsx` exposes `recoveryState`, `consumeDeepLink`, and `clearRecoveryState`. The `SessionGate` renders `ResetPasswordScreen` when `recoveryState === true`.
- `apps/mobile/src/features/auth/reset-password-screen.tsx` is the new screen that drives `authClient.updatePassword({ password })`.
- `apps/mobile/src/features/auth/auth-screen.tsx` gained a "Forgot password?" link and a `mode: "forgot"` flow that calls `authClient.requestPasswordRecovery`.
- `apps/api/vitest.config.ts` (new) loads `apps/api/.env.test` (gitignored) and exposes the keys to the e2e suite via `process.env.AUTH_E2E_*` so the test no longer requires shell-pasted credentials.
- `apps/api/src/auth.e2e.test.ts` grew a recovery-flow test: signup → confirm → recover → Mailpit capture → `/auth/v1/verify` redirect → fragment parse → `/v1/me` via `HttpApiClient` → password rotation → old-password rejection. 4/4 e2e tests pass against the running local Supabase.
- `docs/AUTH_VERIFICATION.md` step 5 now describes the wired path; new steps 9 and 10 document the forgot-password and reset-password flows.

## 2026-07-16 — Safe API logging baseline and structured error envelope (OPS-001)

### Scope

Fastify 5 + pino redaction paths, the right serializer shape for the request and response envelope, how to strip `error.cause` chains so a downstream SDK error cannot smuggle the original request body into a log line, and the contract shape for every 4xx/5xx response across the API.

### Primary sources

- Fastify Logging reference: https://fastify.dev/docs/latest/Reference/Logging/
- Pino redaction reference: https://getpino.io/#/docs/redaction
- Pino serializers reference: https://getpino.io/#/docs/api?id=opt-serializers
- Pino error serialization (`cause` handling): https://github.com/pinojs/pino/blob/main/docs/api.md#errrorobject--object
- `@pinojs/redact` path syntax (the implementation behind pino's redact): https://github.com/davidmarkclements/fast-redact

### Findings used

- Fastify's pino integration forwards the `redact` option directly to pino's `@pinojs/redact`, which uses `fast-redact`'s path syntax (`a.b.c` and `a.b['x-y']`). Path wildcards (`req.*.password`) are supported by `@pinojs/redact` but not used here because the redact list is small and explicit; wildcards risk over-redacting, which would erase the diagnostic value of the surrounding line. The list is data so the structural test in `apps/api/src/logging.test.ts` asserts the set rather than re-deriving it.
- Fastify's default pino request serializer omits `headers` (the rationale is documented in `fastify/docs/Reference/Logging.md`). Without explicit headers in the request log line, the `req.headers.authorization` redact path has nothing to act on and the redaction is untestable. The new `requestSerializer` in `apps/api/src/logging.ts` includes headers so the redaction is observable in test output AND in production logs (where header values matter for cross-service correlation when a token has been redacted).
- Pino's default error serializer includes `error.cause` since pino v9 — and a thrown `@supabase/supabase-js` or `fetch` error can carry a `cause` chain that includes the original request body or a sensitive URL. The new `safeErrorSerializer` strips `cause` and `errors` and only carries the safe top-level fields (`type`, `message`, `stack`, optional `code` and `statusCode`). The full chain is preserved on the original error so test diagnostics still see it; only the log line is sanitised.
- The pre-OPS-001 inline `redact: ["req.headers.authorization", "req.headers.cookie"]` lived inside `buildApp` and was easy to forget when a new sensitive body field was added. The new `apps/api/src/logging.ts` exports a single `REDACT_PATHS` array, a `loggerConfig(env)` builder, and a `redactPaths` constant the tests assert against.
- The pre-OPS-001 inline `setErrorHandler` constructed the envelope inline. The new `apps/api/src/errors.ts` exports `sendApiError(reply, request, status, code, message)` and `internalErrorBody(request)` helpers plus a typed `ApiErrorCode` union. Both the global error handler and the authentication plugin now route through `sendApiError`. A future contract change (e.g. adding `retryAfter` to `RATE_LIMITED`) is a single-file edit.
- The vitest config now auto-loads `apps/api/.env.test`, so the e2e suite sees `AUTH_E2E_URL` always set. To avoid CI failing when the local stack is down, the e2e suite's `describe.skipIf` guard now also probes `/auth/v1/health` with a 2-second timeout before declaring `runE2E === true`. When the stack is unreachable the suite skips cleanly; when the stack is up it runs.

### Result

- `apps/api/src/logging.ts` centralises the redact list, the request/response/error serializers, and the env-driven log level.
- `apps/api/src/errors.ts` owns the `apiErrorSchema` envelope and the typed `ApiErrorCode` union.
- `apps/api/src/app.ts` wires `loggerConfig(env)` into `Fastify({ ... })` and routes through `internalErrorBody(request)`.
- `apps/api/src/plugins/authentication.ts` now uses `sendApiError` instead of inline envelopes.
- `apps/api/src/logging.test.ts` adds 10 tests: 7 structural assertions on `loggerConfig`/`redactPaths`/`safeErrorSerializer` and 3 runtime assertions that a captured pino stream never carries a Bearer token, a throw-token, or a downstream `cause` secret.
- `apps/api/src/errors.test.ts` adds 5 envelope-shape assertions including the `x-request-id` propagation case.
- `docs/LOGGING_POLICY.md` documents what is and isn't logged, the `apiErrorSchema` envelope, the error code list, and the rules for adding new codes.

## 2026-07-16 — Private-media signed-URL isolation (SEC-002)

### Scope

Supabase Storage signed-URL contract, the local CLI's signed-URL endpoint shape, and the right boundary at which Mizyun should assert cross-user isolation. Confirms the path-policy pgTAP tests already cover the underlying ownership predicate, so the SEC-002 gap is purely the _signed-URL surface_.

### Primary sources

- Supabase Storage signed-URL endpoint reference: https://supabase.com/docs/reference/javascript/storage-from-createsignedurl
- Supabase Storage access control: https://supabase.com/docs/guides/storage/security/access-control
- Postgres `storage.objects` RLS policies in this repo: `supabase/migrations/20260714103000_private_media.sql`

### Findings used

- GoTrue/Storage on the local CLI does not expose a `storage.create_signed_url(...)` SQL function — the 17 functions in the `storage` schema are admin/listing helpers, not signing primitives. Signed URLs are generated by the Storage service via the REST endpoint `POST /storage/v1/object/sign/{bucket}/{path}` and the Go implementation verifies the caller's principal against `storage.objects` RLS at request time. The right isolation-test boundary is therefore the REST endpoint, not a pgTAP SQL function.
- The local CLI publishes the API at `http://127.0.0.1:54321` via Kong. The signed-URL response returns a relative path (`/object/sign/private-media/...`) carrying a JWS in the `token=` query parameter. Hitting that path via the public Kong URL exercises the production code path; the local Kong re-signing configuration is out of Mizyun's control and out of scope for this test.
- The pre-SEC-002 pgTAP suite (`supabase/tests/database/0002_user_isolation.test.sql`) already proves that user A cannot select, update, or insert storage objects under user B's folder. The signed-URL path runs the same ownership predicate — Storage re-checks `auth.uid()` against the path prefix before signing. The new test exercises that predicate through the actual signed-URL endpoint rather than relying on the policy row's existence, which closes the last gap from `backlog.md` (the "signed-URL API test remains" note).
- A cross-user signed-URL attempt returns a 4xx with a non-JSON body (Go Storage surfaces a `signature mismatch` or `not found`). The test asserts no `signedURL` field appears in any cross-user response, which is the SECURITY-relevant invariant; the specific HTTP code is a Storage implementation detail that should not be coupled to a test.
- The `SEC-002` test extends the existing `apps/api/src/auth.e2e.test.ts` opt-in suite (rather than a separate `pgTAP` file) because the signed-URL surface is REST, not SQL. The pgTAP path-policy tests already live in `0002_user_isolation.test.sql` and exercise the same predicate at the SQL layer; the new e2e case is the REST-level companion.

### Result

- `apps/api/src/auth.e2e.test.ts` gained `signUpConfirmedUser(email)` helper that returns `{ id, accessToken }` after a real signup → Mailpit confirm → password sign-in.
- New `SEC-002: signed URLs are scoped to the verified owner and reject other users` test in the same file: A signs up + confirms + uploads `/private-media/<userA>/a-photo.jpg`, B signs up + confirms. The test asserts A can sign, B cannot sign A's path, B cannot enumerate a guessed path under A's folder, and a non-existent bucket is rejected with no `signedURL` returned.
- Verified locally: 5/5 e2e tests pass against the running local Supabase (the new SEC-002 case included).
- `status.md` and `backlog.md` updated.
