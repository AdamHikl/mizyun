# Research log

> Index of primary documentation reviewed before implementation. Recheck sources when a new segment begins; platform behavior, pricing, policies, SDKs, and provider terms change over time.

## Entry format

Each entry records date, scope/version, primary sources, findings that affected implementation, and any resulting ADR. Inferences must be labeled as such.

## 2026-07-26 — AI-ACT-001 conversational meal proposal handoff

### Scope

Fastify 5 authenticated route orchestration and Expo SDK 57 navigation for
moving a persisted Coach proposal into the existing editable meal workflow.

### Primary sources

- Fastify route lifecycle and `preHandler`: https://fastify.dev/docs/latest/Reference/Routes/
- Fastify validation and serialization: https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/
- Expo SDK 57 Router: https://docs.expo.dev/versions/v57.0.0/sdk/router/
- Expo Router navigation: https://docs.expo.dev/router/basics/navigation/
- Expo SecureStore: https://docs.expo.dev/versions/latest/sdk/securestore/

### Findings used

- Authentication remains a route `preHandler`; owner scope is injected from
  the verified principal before intent detection or provider work.
- The structured action proposal is parsed through the shared Zod contract
  before persistence and again before it is exposed on the wire.
- Expo Router supports imperative `router.push` navigation to the existing
  modal meal route.
- Sensitive proposal values are not placed in route/search parameters.
  The user-scoped encrypted logging-draft store carries the candidate and
  provenance into the editable form and preserves recovery across restart.

### Result

No new ADR is required. AI-ACT-001 reuses the accepted provider, conversation
metadata, confirmed food-entry, and encrypted draft boundaries without adding
a model mutation tool or a new durable data format.

### Photo attachment follow-up

- Expo SDK 57 ImagePicker: https://docs.expo.dev/versions/v57.0.0/sdk/imagepicker/
- Expo ImageManipulator: https://docs.expo.dev/versions/latest/sdk/imagemanipulator/
- Mistral Vision: https://docs.mistral.ai/studio-api/conversations/vision

The Coach attachment is launched only from a user press, handles denied media
permission and cancellation, and reuses the existing bounded JPEG
normalization. ImageManipulator preserves aspect ratio when only one resize
dimension is supplied. Mistral accepts base64 images through its vision-capable
Chat Completions path; the existing provider adapter owns that encoding.
Conversation persistence receives only the validated nutrition proposal and a
fixed user-visible attachment message. Raw image bytes remain transient and
are discarded after the provider call.

### Workout action follow-up

AI-ACT-002 introduces no new vendor or native API. It reuses the reviewed Expo
Router and SecureStore boundaries above plus Mizyun’s versioned deterministic
training prescription. The action contract stores a bounded prescription
session, not free-form model output. Review moves that proposal into encrypted
recoverable workout state; explicit start uses the existing authenticated
workout endpoint and retains the original proposal in `details.aiDraft`.
Therefore no new ADR is required and the model/provider remains outside the
authoritative workout write path.

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

## 2026-07-17 — Profile domain slice (PROF-001)

### Scope

The smallest vertical slice that lets a Mizyun mobile client read and update the verified user's profile. The pre-existing `public.profiles` migration already has the schema, RLS, and an `on_auth_user_created` trigger that creates the row, so this segment owns the wire contract, the domain rules, and the API route — the Supabase adapter and the mobile UI land in the next segment.

### Primary sources

- Existing migration: `supabase/migrations/20260714100000_foundation.sql` (the `public.profiles` table and its RLS policies).
- Trigger: `supabase/migrations/20260714104000_auth_profile_trigger.sql`.
- Existing API conventions: `apps/api/src/modules/identity/routes.ts` (parses its response through the wire Zod schema before returning, mirroring the pattern below) and `apps/api/src/plugins/authentication.ts` (the bearer-token guard and the `apiErrorSchema` envelope).

### Findings used

- The profile schema already exists in Postgres with the right shape (`display_name`, `unit_system` as a closed enum, `timezone`, `birth_year`, `height_cm`, audit timestamps). The new wire contract in `@mizyun/contracts` mirrors those constraints at the API boundary so the producer can re-parse its own response and fail closed on shape drift, the same way `/v1/me` already does.
- The schema is split across three layers on purpose. `@mizyun/contracts` owns the wire shape (Zod, ISO timestamps, nullable fields). `@mizyun/core` owns the domain types and the validation rules (`HEIGHT_CM_MIN`, `BIRTH_YEAR_MIN`, the closed `UnitSystem` union). The route in `apps/api/src/modules/profile/routes.ts` is the only place that knows how to translate a domain `ProfileValidationError` into a wire `apiErrorSchema` body. A future contributor adding a new field must touch the three layers in that order.
- `exactOptionalPropertyTypes: true` plus Zod's `.optional()` produces `T | undefined` in the inferred type, not `T | undefined` assignable to `T?`. To make the route pass the parsed Zod body directly to `applyProfilePatch` without a cast, the domain `ProfilePatch` declares every field as `T | undefined` explicitly. This keeps the boundary clean under strict TS without runtime casts.
- `ProfileRepository` is a port (`@mizyun/core`). The in-memory implementation in `apps/api/src/profile-repository.ts` is the only implementation for now. The Supabase adapter is intentionally deferred to a follow-up segment because it needs a verified RLS story for the profile row that the existing path tests already cover — the port lets the route ship before the adapter exists.
- The route reads the verified principal via `request.principal` (set by the existing `authenticationPlugin`) and uses the principal's `userId` as the only acceptable storage key. The repository defensively checks `next.userId === userId` in `update()` so a future bug that produces a mismatch fails closed with an error rather than writing to another user's row.
- The `auto-create on first read` policy absorbs the trigger-vs-client race. If a client polls `/v1/profile` before GoTrue's `on_auth_user_created` trigger fires, `getOrCreate` returns a default profile. The SQL trigger will eventually write the same default row, and the `unique (id)` constraint makes the race idempotent at the storage layer.
- For Metro / iOS bundle: `packages/core/src/index.ts` exports `./profile` (extensionless) and `packages/core/tsconfig.json` uses `moduleResolution: "Bundler"`. The other leaf packages (`memory`, `identity`, `agent-runtime`, `adapters/supabase-server`) were also flipped to `Bundler` because they import types from `@mizyun/core` and would otherwise force a `.js` extension that Metro cannot resolve. This matches the precedent set by `@mizyun/config` in CFG-001.

### Result

- `packages/contracts/src/index.ts`: new `profileSchema`, `profileResponseSchema`, `profilePatchSchema`, `unitSystemSchema`, plus the inferred types.
- `packages/core/src/profile.ts`: new `ProfileCore`, `StoredProfile`, `ProfilePatch`, `ProfileValidationError`, `ProfileRepository` port, and the `validateProfilePatch` / `applyProfilePatch` pure helpers.
- `apps/api/src/profile-repository.ts`: `InMemoryProfileRepository` (the only implementation until the Supabase adapter lands).
- `apps/api/src/modules/profile/routes.ts`: `GET /v1/profile` (auto-create) and `PUT /v1/profile` (partial update via `profilePatchSchema`, validated by `validateProfilePatch`, applied via `applyProfilePatch`).
- `apps/api/src/modules/profile/routes.test.ts`: 10 vitest cases (GET happy path, GET 401 without token, GET 401 invalid token, GET isolation, PUT single-field patch, PUT empty patch, PUT out-of-range height, PUT unknown field, PUT invalid unit system, PUT clear-nullable).
- `packages/core/src/profile.test.ts`: 14 vitest cases (validateProfilePatch across all branches, applyProfilePatch across clears and preserves).
- `apps/api/src/app.ts`: `AppDependencies.profileRepository` is now an optional dependency that falls back to the in-memory implementation; tests can inject a stub.
- `tsconfig.json` updates: `packages/core`, `packages/memory`, `packages/identity`, `packages/agent-runtime`, `packages/adapters/supabase-server` all switched to `moduleResolution: "Bundler"` so the leaf packages accept extensionless internal imports.
- `status.md`: PROF-001 marked done; GOAL-001 surfaced as next.
- `backlog.md`: PROF-001 row flipped from blocked to done.

## 2026-07-17 — Goal vertical slice (GOAL-001)

### Scope

Smallest viable goal read/write surface so a Mizyun mobile client can list, create, and update a user's fitness goal. The pre-existing `public.goals` migration already has the schema, RLS, and the `goal_id` plumbing; the segment owns the wire contract, the domain rules, and the API routes.

### Primary sources

- Existing migration: `supabase/migrations/20260714101000_user_data.sql` (the `public.goals` table with `kind text`, `status` constrained to `'draft' | 'active' | 'completed' | 'archived'`, and `target jsonb`).
- PROF-001 contract split (`packages/contracts/src/index.ts`) — the same three-layer pattern (wire / domain / route mapping) applies.
- Goal-state-machine conventions in fitness apps: a goal moves from `draft` → `active` → `completed`/`archived`; transitions the other way are not allowed.

### Findings used

- The existing SQL `kind text` and `target jsonb` are intentionally open. The wire schema in `@mizyun/contracts` adds the closed `GoalKind = "cut" | "recomp" | "maintain"` and the typed `GoalTarget = { weightKg, bodyFatPercent? }` so the API surface is closed even before a follow-up SQL migration tightens the constraint. The route layer is the only place that maps the closed union onto the open column.
- The status state-machine is enforced in the domain layer (`ALLOWED_STATUS_TRANSITIONS`), not in SQL. `completed` and `archived` are terminal; `draft → active` and `active → {completed, archived}` are the only legal transitions. Re-activating a completed goal requires creating a new goal — which preserves the chronological history that `GET /v1/goals/history` returns.
- The "at most one active goal per user" invariant is enforced by the repository today; the SQL implementation will use a partial unique index `(user_id) WHERE status = 'active'` once the Supabase adapter lands. The in-memory implementation throws when a user tries to create a second active goal; the route maps the throw to a 409 `VALIDATION_ERROR` so the contract stays the same.
- The patch body is closed under `goalPatchSchema.strict()` so a typo (`status: "complete"` instead of `"completed"`) is rejected at the wire boundary, not silently dropped. The domain `validateGoalPatch` then checks the transition table and shape constraints; the route is the only place that knows how to translate a `GoalValidationError` into a `apiErrorSchema.code`.
- Status transitions that are not in the table produce a 409 (Conflict), not a 422 (Unprocessable Entity), because the request is well-formed but conflicts with the resource state. The route layer is the only place this mapping lives.
- The repository enforces user ownership: `update()` requires `goal.userId === userId`, and `getHistory()` returns only the verified user's goals. Cross-user isolation is verified by the route test "returns 404 for a goal id that belongs to another user" — the route never discloses that the goal exists.

### Result

- `packages/contracts/src/index.ts`: new `goalKindSchema`, `goalPaceSchema`, `goalStatusSchema`, `goalTargetSchema`, `goalSchema`, `goalCreateSchema`, `goalPatchSchema`, `goalResponseSchema`, `goalHistoryResponseSchema`, plus the inferred types.
- `packages/core/src/goal.ts`: new `GoalCore`, `StoredGoal`, `GoalPatch`, `GoalValidationError`, `ALLOWED_STATUS_TRANSITIONS`, `validateGoalCreate`, `validateGoalPatch`, `applyGoalPatch`, and the `GoalRepository` port.
- `apps/api/src/goal-repository.ts`: `InMemoryGoalRepository` (the only implementation until the Supabase adapter lands).
- `apps/api/src/modules/goals/routes.ts`: `GET /v1/goals/active`, `GET /v1/goals/history`, `POST /v1/goals`, `PUT /v1/goals/:id` routes behind the existing bearer-token guard.
- `apps/api/src/modules/goals/routes.test.ts`: 14 vitest cases (active goal 404, 401, create happy-path, create rejects invalid dates, weights, body fat, unknown fields, second active returns 409, transition happy-path, invalid transition returns 409, unknown id returns 404, cross-user id returns 404, malformed id returns 404, history empty/non-empty).
- `packages/core/src/goal.test.ts`: 25 vitest cases covering the state-machine table, every validation branch, and `applyGoalPatch` for both clears and preserves.
- `apps/api/src/app.ts`: `AppDependencies.goalRepository` is now an optional dependency that falls back to the in-memory implementation; tests can inject a stub.
- `status.md`: GOAL-001 done; UX-001 surfaced as next.
- `backlog.md`: GOAL-001 row flipped from blocked to done.

Verified: pnpm check green; 44 api always-runs + 16 mobile + 41 core + ~50 package tests pass.

## 2026-07-17 — Onboarding flow (UX-001)

### Scope

Smallest viable mobile onboarding sequence so a fresh Mizyun user can set a display name, choose units, and pick a primary goal before the dashboard becomes useful. The API surface (PROF-001, GOAL-001) is already in place; the segment owns the wizard reducer, the screen, the submit step, and the SessionGate wiring.

### Primary sources

- Existing iOS surface: `apps/mobile/src/features/auth/auth-context.tsx` (the SessionGate and `useAuth()`), `apps/mobile/src/components/app-tabs.tsx` (the bottom tabs), `apps/mobile/src/features/settings/principal-state.ts` (the precedent for a pure reducer + screen pattern).
- PROF-001 + GOAL-001 contracts: `packages/contracts/src/index.ts` (`profileSchema`, `profilePatchSchema`, `goalCreateSchema`).
- React Native `TextInput` + `Pressable` patterns from the existing `AuthScreen` and `ResetPasswordScreen`.

### Findings used

- The SessionGate already had three branches (recovery / auth-required / signed-in). Adding a fourth (onboarding) only requires a stable signal that a user is fresh. The auto-create path in `/v1/profile` inserts `displayName: null` by default, so `profile.displayName === null` is the canonical signal — no new flag column on the schema.
- The wizard is split into a pure reducer (`onboarding-state.ts`) and a React screen (`onboarding-screen.tsx`). The reducer exposes `validateStep`, `nextStep`, `previousStep`, and `applyOnboardingPatch` so the screen only does React state management and rendering. The 23 vitest cases on the reducer are easy to maintain; the screen has no testable logic that needs the RN runtime.
- The submit step (`submit-onboarding.ts`) takes the `ApiClient` as a parameter rather than reading the composition root. This lets the unit test stub the client without aliasing the `@/composition/api-client` import. Production callers (the screen) pass `apiClient` explicitly.
- Error humanisation is a dedicated `humanizeError(kind, fallback)` switch. Every `ApiError.kind` the SDK currently emits maps to a short message; any future kind falls through to the per-call fallback. The screen surfaces the message as a single line under the form fields and lets the user retry without parsing SDK shapes.
- The SessionGate now does a `GET /v1/profile` on every session start. The cache lifetime is the session — when the user signs out, the profile is reset to `null`. When `refreshProfile()` is called after the onboarding wizard submits, the SessionGate re-renders and shows the regular tabs.
- The vitest config gains workspace aliases (`@mizyun/core`, `@mizyun/contracts`, `@mizyun/identity`, `@mizyun/config`, `@mizyun/api-client`) so the test runner can resolve workspace packages without a build step. The `@mizyun/core` direct dependency was added to `apps/mobile/package.json` to match the new import surface (the AuthContext now imports `profileSchema` directly).

### Result

- `apps/mobile/src/features/onboarding/` — new feature directory containing `onboarding-state.ts`, `onboarding-screen.tsx`, `submit-onboarding.ts`, plus the two vitest files.
- `apps/mobile/src/app/onboarding.tsx` — route file.
- `apps/mobile/src/features/auth/auth-context.tsx` — `profile` and `refreshProfile()` added; SessionGate routes fresh users into the wizard.
- `apps/mobile/vitest.config.ts` — workspace alias block.
- `apps/mobile/package.json` — `@mizyun/core` direct dependency.
- `status.md` / `backlog.md` — UX-001 done; NUT-001 surfaced as next.

Verified: pnpm check green; 47 mobile + 44 api always-runs + ~70 package tests pass.

## 2026-07-17 — DATA-001 export + deletion lifecycle

### Question

How should Mizyun expose the AUTH-04 export and full account-deletion lifecycle, given that every Phase 2 feature now owns user data and the production storage layer is SQL with FK cascades?

### Decisions

- **Two-step deletion (POST then DELETE).** A POST `/v1/account/delete/request` issues a short-lived (5 min) opaque confirmation token; a DELETE `/v1/account` confirms. A misclick without a valid token returns 409 with the typed `AccountDeletionError` (`confirmation_token_missing` / `_expired` / `_mismatch`). The two-step shape is the documented safety mechanism; a single DELETE button is too easy to misclick.
- **Single export envelope.** `GET /v1/account/export` returns one JSON document: `{ userId, generatedAt, profile, goals, foodEntries, exercises, workouts, workoutSets, bodyMeasurements, conversations, privateMedia }`. Every Phase 2 feature is represented; `conversations` and `privateMedia` carry empty arrays until the CONV-* / MEDIA-* segments land so the envelope shape is stable.
- **`AccountRepository` port in `@mizyun/core`.** It owns `exportForUser`, `issueDeletionChallenge`, and `deleteUser`. The port is pure (no SDK, no transport). Adapters implement it; the in-memory adapter orchestrates the per-feature repositories.
- **Children-before-parents deletion order.** workout_sets → workouts → exercises → food_entries → body_measurements → goals → profile. SQL cascades through the migration's `ON DELETE CASCADE` clauses; the Supabase adapter (future) deletes `auth.users` last. The in-memory adapter walks each partition and deletes every row.
- **GoalRepository `delete` + ProfileRepository `deleteForTest`.** Goal deletion was previously not exposed; the in-memory adapter now supports it for the cascade path. Profile cleanup uses a test-only `deleteForTest`; a future segment promotes both to the public port.
- **Token is consumed before deletion.** A retry of the same DELETE returns `confirmation_token_missing`, so a transient network error cannot accidentally trigger two cascades.
- **Auto-create profile is preserved.** The export endpoint auto-creates a default profile on read (existing behaviour). After deletion, the next export creates a fresh default profile — the partition entry is gone. Test asserts `displayName === null` rather than row absence.

### Files

- `packages/core/src/account.ts`, `packages/core/src/account.test.ts` (read-side + port tests).
- `packages/contracts/src/account.ts` — `accountExportSchema`, `accountDeleteSchema`, `accountDeleteResponseSchema`, `accountDeleteChallengeResponseSchema`.
- `apps/api/src/account-repository.ts` — `InMemoryAccountRepository`.
- `apps/api/src/modules/account/routes.ts` — `GET /account/export`, `POST /account/delete/request`, `DELETE /account`.
- `apps/api/src/goal-repository.ts` — `delete` method added.
- `apps/api/src/profile-repository.ts` — `deleteForTest` helper added.
- `apps/api/src/app.ts` — per-feature repositories resolved once, then passed into a default `InMemoryAccountRepository`.
- `apps/api/src/modules/account/routes.test.ts` — 10 vitest cases.

### What's deliberately not in DATA-001

- **Wiping `auth.users`.** The Supabase admin call to delete the user identity lives behind the hosted Supabase integration (not yet wired). When that lands, the SQL cascades take over; the in-memory adapter orchestrates the same logical order.
- **GDPR export of conversations + memories + private-media bytes.** The envelope reserves slots (`conversations`, `privateMedia`) but the per-feature list endpoints are not yet public. A dedicated CONV-* / MEM-* / MEDIA-* segment fills them.
- **Audit log of the deletion event.** A future segment writes a one-way hash of the deletion request to a tamper-evident log so a user can prove "yes I asked for this on date X" without retaining identifiable content.

### Verified

pnpm check green: 47 mobile + 173 api + 153 core + ~110 package tests. Backlog row DATA-001 flipped to `done` with the open follow-ups above.

## 2026-07-17 — ENG-001 formula selection + ENG-002 summary

### Question

What energy formula and target computation should Mizyun ship in v1, and how should the wire surface expose the audit trail so ENG-01..06 all hold?

### Decisions

- **Mifflin-St Jeor (1990) BMR.** Standard clinical formula, deterministic, well-cited. Both sexes supported.
- **Penman-style activity multipliers.** 1.40 sedentary / 1.50 lightly_active / 1.60 moderately_active / 1.75 very_active / 2.00 extra_active. A static table owned by the formula version.
- **Goal-adjustment table** keyed by `(kind, pace)`. Steady cut = −500, gradual cut = −300, aggressive cut = −750, steady recomp = −250, gradual recomp = 0, aggressive recomp = −500, maintain = 0 across all paces.
- **Sex-at-floor safety gate.** Below 1200 kcal/day for women or 1500 for men the engine refuses to fabricate a number and surfaces `below_safety_floor` as the incompleteReason (ENG-06).
- **`ENERGY_FORMULA_VERSION = "v1-mifflin-st-jeor-2026-07"`.** Bumping this string is the formal contract change; bug fixes inside the same version are transparent. The wire envelope echoes the version so the UI can render it (ENG-02) and a future v2 (Katch-McArdle, etc.) can ship without breaking v1 callers.
- **`EnergyFormula` port in `@mizyun/core`.** `computeEnergy(inputs, userId)` returns `EnergyComputeResult` with a typed `EnergyBreakdown`. Pure, deterministic, no I/O.
- **`exerciseKcal` filled at the route layer.** The engine cannot see per-workout set counts (the set repository is a separate port); the route resolves them via `listForWorkout` and hands the pure estimator a callback. The engine surfaces the field as `null` until then — the breakdown shape makes "exercise kcal not yet evaluated" an honest signal, never a fabricated number.
- **Activity multiplier vs exercise kcal — ENG-04.** The activity multiplier is applied to _non-exercise_ TDEE (NEAT + daily movement), and exercise kcal is a separate field. The math never adds them; the UI renders the de-overlap explicitly.
- **ENG-05 trend guard.** `balanceUncertaintyKcal` is `null` until at least 3 distinct days of recent workouts exist; we don't present a "false precision" confidence band before the data warrants it.
- **ENG-06 propagation.** Every numeric field on the breakdown is nullable; the engine tracks a `Set<EnergyIncompleteReason>` and surfaces the highest-priority first. The route never invents numbers.
- **Sex + activity level live in the query string for v1.** The profile doesn't carry them yet. The route accepts `?activityLevel=&sexAtBirth=` so the UI can persist them client-side and pass them at request time; a future segment promotes them to profile fields.

### Files

- `packages/core/src/energy.ts`, `packages/core/src/energy.test.ts` (23 cases).
- `packages/contracts/src/energy.ts` — `energySummarySchema`, `energySummaryResponseSchema`, `energySummaryQuerySchema`.
- `apps/api/src/modules/energy/routes.ts`, `apps/api/src/modules/energy/routes.test.ts` (11 cases).
- `apps/api/src/app.ts` — energy routes registered.

### Verified

pnpm check green: 47 mobile + 184 api + 176 core + ~110 package tests. Formula version echoed in the route response, the math is deterministic across multiple invocations (test asserts `a.bmrKcal === b.bmrKcal` for the same inputs).

### Open follow-ups

- Promote `activityLevel` and `sexAtBirth` to profile fields (PROF-001 follow-up).
- Wire a MET-keyed lookup to replace the kcal-per-set heuristic for `exerciseKcal` once the segment that surfaces per-set MET (cardio vs strength) lands.
- Real activity data via HealthKit / Health Connect (IOS-HEALTH-001, AND-HEALTH-001): the engine already exposes an `exerciseKcal` slot; step-derived kcal would join it under a `stepKcal` field with the same de-overlap discipline.

## 2026-07-17 — MEDIA-001 private media upload/sign/delete + PROF-001 follow-up

### MEDIA-001 decisions

- **Two-stage upload via signed URL.** `POST /v1/media/upload-url` returns `{ assetId, uploadUrl, objectPath, expiresAt }`. The client PUTs the bytes to `uploadUrl`. The route server-generates the object path as `<userId>/<uuid>.<ext>` so the SQL `storage.foldername(name)[1] = auth.uid()::text` policy scopes every upload to the user's own folder.
- **Asset row recorded at upload-url time, not after upload completes.** The row carries the metadata (purpose, mime, byte size, dimensions). The signed-download endpoint refuses to sign a soft-deleted asset (returns 410). A separate `complete-upload` hook is a follow-up segment — for v1 the client treats upload-url-issued as "asset exists", which matches how iOS Photos upload flows work.
- **Closed `purpose` enum** mirrors the SQL check constraint: `food` | `progress` | `workout` | `profile`.
- **Closed mime allowlist** of `image/jpeg` | `image/png` | `image/webp` mirrors the SQL bucket `allowed_mime_types`.
- **Byte cap 15 MiB** mirrors the SQL `file_size_limit`. Width/height bounded to `[16, 8192]` so a pathological input never lands.
- **Storage abstraction.** The route talks to a `MediaStorage` interface, not Supabase Storage directly. `InMemoryMediaStorage` backs the local dev environment with `mem://upload/<ticket>` / `mem://download/<ticket>` URLs that tests can exchange for raw bytes. Production swaps it for a Supabase adapter (one-line composition-root change).
- **Soft-delete + storage removal.** `DELETE /v1/media/:id` sets `deletedAt = now` AND removes the underlying bytes (storage adapter deletes). A subsequent `GET /v1/media` omits the row; a subsequent `POST /v1/media/sign` returns 410. List endpoint filters out soft-deleted assets.

### PROF-001 follow-up decisions

- **`activityLevel` and `sexAtBirth` promoted to profile fields.** Both nullable so existing users don't lose data on migration. Closed enums match the energy engine vocabulary.
- **Energy route prefers profile values over query string.** Profile value wins; query string stays useful as a preview override ("what if I picked extra_active?"). When the profile value is null, the query string is consumed.
- **Validator additions.** `ProfileValidationError` gains `invalid_activity_level` and `invalid_sex_at_birth` variants; the route maps them to 422 with explicit messages.
- **No schema migration required.** The profile domain is in-memory in v1; a future segment that lands the SQL adapter adds nullable `activity_level` + `sex_at_birth` columns + check constraints to the existing profiles migration. The contract is stable now; the adapter change is mechanical.

### Files

- `packages/core/src/media-asset.ts` + test (14 cases).
- `packages/contracts/src/media-asset.ts` — wire schemas.
- `apps/api/src/media-storage.ts` — `MediaStorage` interface + `InMemoryMediaStorage`.
- `apps/api/src/media-asset-repository.ts` — `InMemoryMediaAssetRepository`.
- `apps/api/src/modules/media/routes.ts` — POST/GET list/sign/delete.
- `packages/core/src/profile.ts` — added `ProfileActivityLevel`, `ProfileSexAtBirth`, validator variants, applier fields.
- `packages/contracts/src/index.ts` — `profileSchema` + `profilePatchSchema` extended.
- `apps/api/src/profile-repository.ts` — fresh profile default sets the two new fields to null.
- `apps/api/src/modules/profile/routes.ts` — `toWire` includes the new fields; `validationErrorToApi` handles the new variants.
- `apps/api/src/modules/energy/routes.ts` — profile values win; query string is the override.
- Tests updated for the new shape (energy + profile + account fixtures include `activityLevel: null, sexAtBirth: null`).

### Verified

pnpm check green: 47 mobile + 209 api + ~190 core + ~110 package tests. 15 new media route tests + 6 new energy route tests + 6 new profile route tests + 4 new core profile tests + 14 new media-asset core tests.

### Open follow-ups

- **Media complete-upload hook.** Today the asset row is recorded when the upload URL is issued; the eventual landing of bytes is implicit (the client trusts the storage). A `POST /v1/media/:id/complete` hook that confirms the byte presence + dimensions will land with the Supabase storage adapter.
- **Profile migration.** When the SQL adapter lands, add `activity_level text check (activity_level in (...))` and `sex_at_birth text check (sex_at_birth in ('male','female'))` to the profiles table. Backfill existing rows to `NULL`.
- **Storage RLS test against local Supabase.** The pgTAP test for `storage.objects` policies was added in SEC-002. A more thorough test that walks a real PUT-through-the-storage-SDK flow lands with the Supabase media adapter.

## 2026-07-17 — MEDIA-002 progress photo timeline + compare

### Question

How should Mizyun expose the BODY-04 timeline view and the BODY-05 two-photo compare without re-introducing storage-layer concerns or breaking the asset-ownership boundary?

### Decisions

- **Per-day bucketing, oldest-first.** `buildMediaTimeline(entries, { from, to })` is a pure function that groups entries by UTC calendar day, drops soft-deleted assets, and orders days ascending. Days with zero entries are omitted so the wire shape stays sparse.
- **Per-entry signed download URL.** Each timeline entry carries a short-lived signed URL so the UI can render thumbnails in a single round-trip. The `signedUrlTtlSeconds` is echoed in the response envelope so the client can use it for its own cache-control without re-fetching.
- **`compareMediaAssets` snaps to UTC midnight** before computing the day distance. Two photos taken at 23:30 UTC on day N and 00:30 UTC on day N+1 are reported as 1 day apart (one calendar day), not 0 — the calendar framing is what the user expects from a "before/after" photo compare. The `direction` (`a_before_b` / `a_after_b`) tells the UI which side is older.
- **Ownership enforcement at the route layer.** `POST /v1/media/compare` returns 404 indistinguishably for cross-user ids, missing ids, and soft-deleted ids — the client can't enumerate.
- **Date-range filter via repo pagination, not a new query.** The repository's `list()` doesn't expose `from`/`to` predicates today (the SQL query has no such filter; the index on `(user_id, created_at desc)` doesn't serve it directly). The route pulls a generous page (cap `MAX_LIMIT = 200`) and buckets client-side. A future segment that lands the SQL adapter adds the predicate and the index already covers it cheaply.
- **`toWireAsset` helper.** A single pure conversion of `StoredMediaAsset` → wire shape (`MediaAsset`). Zod's `mediaAssetSchema.parse` requires ISO strings; the in-memory repository uses `Date` instances. The helper centralises the conversion so every endpoint that embeds an asset uses the same shape and Zod never sees a Date.
- **No new endpoints for media processing / annotation.** BODY-06 (no body-fat claims from photos) is a product-side guardrail, not a code one. The endpoint surface here deliberately stays read-only.

### Files

- `packages/contracts/src/media-asset.ts` — `mediaTimelineEntrySchema`, `mediaTimelineBucketSchema`, `mediaTimelineResponseSchema`, `mediaTimelineQuerySchema`, `mediaCompareRequestSchema`, `mediaCompareResponseSchema`, `mediaCompareSideSchema`.
- `packages/core/src/media-asset.ts` — `buildMediaTimeline`, `compareMediaAssets`, `MediaTimelineDayBucket` type.
- `apps/api/src/modules/media/routes.ts` — `GET /v1/media/timeline`, `POST /v1/media/compare`; `toWireAsset` helper.
- 7 new core tests (timeline grouping, soft-delete filter, range filter, day-ordering; compare zero-day / absolute / direction / sub-day) + 7 new API tests (timeline per-day bucketing, default purpose, soft-delete omission, cross-user isolation, from>to rejection, signedUrlTtl echo; compare before/after direction, cross-user 404, soft-deleted 404, same-id 422 rejection, unknown field 422, 401).

### Verified

pnpm check green: 47 mobile + 223 api + 207 core + ~110 package tests. Backlog row MEDIA-002 flipped from blocked to done.

### Open follow-ups

- **SQL repository date-range filter.** When the Supabase adapter lands, add `from`/`to` to `MediaAssetRepository.list` and a SQL query that uses the existing `(user_id, created_at desc)` index.
- **Reverse-chronological default.** Today the route returns oldest-first days; a UI setting could flip it to newest-first. The current shape is calendar-coherent (which BODY-04 asks for).
- **Image dimensions in timeline entries.** A future segment adds width/height to the timeline entry for the layout-reserving UI; today the asset already carries them in the embedded `asset` object.

## 2026-07-18 — PERSIST-001 Supabase persistence for profile + goals + food

### Question

The 2026-07-18 markdown sweep named PERSIST-001 — Supabase adapters for profile, goals, and food — as the next exact work package. The status doc explicitly states that "Records do not persist through API restarts." What is the minimum durable change that proves persistence end-to-end while keeping the standard `pnpm check` green without Docker?

### Decisions

- **Migration first, then adapters, then e2e.** A forward-only migration (`20260718100000_persist_001_columns.sql`) aligns the SQL columns with the in-memory domain (PROF-001+ added `activity_level`/`sex_at_birth`; GOAL-001 added `pace` and optional `review_date`). The migration is purely additive — every new column is nullable so existing rows backfill to `NULL` and pgTAP coverage stays green.
- **Partial unique index for goals.** The in-memory `GoalRepository` enforces "at most one active goal per user" by application logic. The migration adds `goals_one_active_per_user` on `(user_id) WHERE status = 'active'`, so the database is the source of truth even when a future background job inserts goals on the user's behalf. The Supabase adapter translates the resulting `23505 duplicate key value violates unique constraint` error into the typed `"user already has an active goal"` string the route already maps to 409.
- **Per-request client, not shared client.** Each request gets a fresh `SupabaseClient` bound via `setSession({ access_token })`. The adapter factory is injected at the composition root; the route layer reads the verified access token from `request.principal.accessToken` (a new field on `AuthPrincipal`) and threads it through every repo call.
- **Access-token threading is minimal.** `ProfileRepository.getOrCreate`, `GoalRepository.{getActive,getHistory,create,update}`, and `FoodEntryRepository.{create,list,getById,update,delete}` all accept `options: { readonly accessToken: string }`. The in-memory adapter `void options.accessToken` — production stays unchanged. Tests add `accessToken: "test-token"` to mocks. This pattern extends to PERSIST-002 (workouts, exercises, body measurements, account cascade) without further port changes.
- **In-memory remains default.** `AppDependencies.supabasePersistence` is opt-in. The standard `pnpm check` gate still runs in-memory repos for every domain; the `persistence.e2e.test.ts` skips when `SUPABASE_E2E_URL` is unset.
- **No refresh-token rotation.** An expired access token returns 401 from the API; the mobile app re-authenticates. Refresh-token handling is a follow-up so we don't take on cookie-rotation complexity in the persistence segment.

### Files

- `supabase/migrations/20260718100000_persist_001_columns.sql` (new, ~25 lines, forward-only).
- `packages/core/src/index.ts` — exports `ProfileActivityLevel` + `ProfileSexAtBirth` (previously unexported).
- `packages/core/src/profile.ts`, `goal.ts`, `food-entry.ts` — port methods widened with `{ readonly accessToken: string }` option.
- `packages/identity/src/index.ts` — `AuthPrincipal` carries `accessToken` (the bearer token the route layer forwards to the per-feature adapters).
- `packages/adapters/supabase-server/src/index.ts` — `createSupabaseRepositoryClient(url, key, token)` factory + a narrow `RepositorySupabaseClient` interface (so adapters don't accidentally pull storage / RPC surface area before those segments land).
- `packages/adapters/supabase-server/src/{profile,goal,food-entry}-repository.ts` — three new adapters.
- `packages/adapters/supabase-server/src/repository-error.ts` — single shared `RepositoryError` class.
- `apps/api/src/app.ts` — `SupabasePersistenceOptions` plumbed through `AppDependencies`; in-memory remains the default.
- All API route callers (`profile`, `goal`, `food-entries`, `energy`, `account`) now thread `principal.accessToken` through repo calls.
- `apps/api/src/persistence.e2e.test.ts` (new opt-in e2e) — proves cross-user RLS rejection, persistence across fresh repo instances, and partial-unique violation translation.

### Verified

`pnpm check` (no env): 47 mobile + 223 api + 153 core + ~110 package tests pass (no new tests for opt-in persistence — the unit tests + in-memory default keep the gate green). The 21 new Supabase adapter unit tests pass against a mocked client. The opt-in e2e file is the proof point for the running stack; it requires `pnpm db:start` and is documented at the top of the file.

### Open follow-ups (per the matrix)

- **PERSIST-002** — Supabase adapters for `exerciseRepository`, `workoutRepository`, `workoutSetRepository`, `bodyMeasurementRepository`. The `accessToken` port-widening is done; the adapter implementations are the only remaining work. Account-deletion cascade (DATA-001's in-memory orchestration) needs to swap to a real-record cascade.
- **PERSIST-003** — Real Supabase Storage adapter behind `MediaStorage`. The in-memory `InMemoryMediaStorage` is the dev stub.
- **MOB-DAILY-001** — Mobile food / workout / weight / dashboard integration once the persistent adapters are wired up.

## 2026-07-18 — PERSIST-002 Supabase adapters for training, body, account

### Question

PERSIST-001 closed the persistence gap for profile, goals, and food. What's the minimum change to close the same gap for exercises, workouts, workout sets, body measurements, and the account-export/deletion cascade?

### Decisions

- **Port widening, then adapter per feature.** The same `accessToken` pattern from PERSIST-001 propagates through four more ports: `ExerciseRepository`, `WorkoutRepository`, `WorkoutSetRepository`, `BodyMeasurementRepository`. Each port method now accepts `{ readonly accessToken: string }` (or no extra args for delete/getById). The in-memory adapters `void options.accessToken` so production semantics stay unchanged.
- **SQL FK cascade replaces in-memory cascade.** `public.workout_sets.workout_id` references `public.workouts(id, user_id) ON DELETE CASCADE`, so when the user deletes a workout, the database drops its sets atomically. The Supabase workout-set adapter's `deleteAllForWorkout` is a documented no-op (returns 0); the in-memory adapter continues to walk the sets explicitly because the dev environment has no SQL.
- **No partial unique index for sets.** The SQL schema already has `unique (workout_id, sequence)`, which the adapter translates to a typed 409 via `INSERT 23505 → "workout set sequence collision: workout=X sequence=Y"`. The route already maps that message to 409 with `kind: "validation_error"`.
- **Body measurements are append-only in the API.** The migration gave us `created_at` + `measured_at`. The adapter sorts by `measured_at` descending; the in-memory adapter does the same. No new invariants.
- **Account cascade uses `accessToken: ""`.** Today's `InMemoryAccountRepository.exportForUser` and `deleteUser` run from inside the API composition root, which doesn't carry an end-user token. The Supabase-adapter-based cascade (PERSIST-002 follow-up) will need the service-role key at the composition root; the in-memory cascade continues to work as before.
- **No schema migration for PERSIST-002.** The migration in PERSIST-001 covered `activity_level` + `sex_at_birth` (profile) and `pace` + `review_date` (goal); the four new tables (exercises, workouts, workout_sets, body_measurements) already match the domain shape from day one. The `workout_sets` row's `source` column is `manual` only — the SQL CHECK constraint matches the domain enum.

### Files

- `packages/core/src/{exercise,workout,workout-set,body-measurement}.ts` — four ports widened with `{ readonly accessToken: string }` in their options bag.
- `apps/api/src/{exercise,workout,workout-set,body-measurement}-repository.ts` — in-memory adapters `void options.accessToken`; production semantics unchanged.
- All API route callers (`/v1/exercises`, `/v1/workouts`, `/v1/workouts/:id/sets`, `/v1/body-measurements`, `/v1/energy/summary`, `/v1/account/export`, `/v1/account/delete`) thread `principal.accessToken` through repo calls. Test mocks now include `accessToken: "test-token"`.
- `apps/api/src/account-repository.ts` — export + deletion cascade now passes `accessToken: ""` to every per-feature adapter (the in-memory adapters ignore it).
- `packages/adapters/supabase-server/src/{exercise,workout,workout-set,body-measurement}-repository.ts` — four new Supabase adapters; re-exported from `packages/adapters/supabase-server/src/index.ts`.
- `packages/adapters/supabase-server/src/{exercise,workout,workout-set,body-measurement}-repository.test.ts` — 18 new mocked-client unit tests (3-7 each).
- `apps/api/src/persistence.e2e.test.ts` — 3 new opt-in e2e tests (exercises persistence + RLS, workouts+sets cascade via FK, body-measurements isolation).

### Verified

`pnpm check` (no env): 47 mobile + 223 api + 190 core + ~110 package tests pass. The opt-in e2e file is the proof point for the running stack.

### Open follow-ups

- **Hosted Supabase adapter swap.** When the production composition root picks Supabase adapters for real, the `AppDependencies.supabasePersistence` option flips the seven per-feature adapters + the in-memory account cascade. The service-role key handling lands when DATA-002 ships.
- **PERSIST-003** — Real Supabase Storage adapter behind `MediaStorage` (replacing `InMemoryMediaStorage`).
- **Mobile daily loop.** The data layer is now durable; MOB-DAILY-001 becomes the next exact work package (manual food / workout / weight / dashboard on the iOS simulator against real persisted records).

## 2026-07-19 — MOB-DAILY-001 mobile routes and recoverable capture drafts

### Primary sources

- Expo Router, **Typed routes** (accessed 2026-07-19): https://docs.expo.dev/router/reference/typed-routes/
- Expo SDK 57, **SDK reference** (accessed 2026-07-19): https://docs.expo.dev/versions/v57.0.0/
- Expo SDK 57, **SecureStore** (accessed 2026-07-19): https://docs.expo.dev/versions/v57.0.0/sdk/securestore/

### Verified findings and implementation consequences

- Expo Router derives routes from files under the app directory and generates the typed route declaration when the development server starts. The three logging screens therefore remain route files under `apps/mobile/src/app/`; the dashboard uses absolute paths. A narrow `Href` assertion bridges a stale, ignored local `.expo/types/router.d.ts` until Expo regenerates it; no route registry or navigation framework is added.
- The versioned SDK 57 reference matches the installed Expo 57 / React Native 0.86 / React 19.2 line. Its SecureStore reference recommends the 57.x package line and documents encrypted key/value storage intended to persist across app restarts and updates, but warns that large values may be rejected and it must not be the sole authority for irreplaceable data. Mizyun stores only small JSON form drafts, scopes keys by verified user ID and draft kind, catches native read/write/delete errors, and deletes a draft after the server confirms the authoritative record.
- Android SecureStore data does not survive uninstall, while iOS Keychain data may survive reinstall with the same bundle ID. Drafts are therefore convenience recovery only, never authoritative records; malformed or unavailable draft storage fails open and does not block logging.
- No ADR is required: this segment applies the existing Expo Router and encrypted native-session storage choices without changing module boundaries, provider strategy, or data authority.

## 2026-07-19 — MOB-NUT-001 food lifecycle and empty-success transport

### Primary sources

- Expo SDK 57, **Router API** (accessed 2026-07-19): https://docs.expo.dev/versions/v57.0.0/sdk/router/
- Expo SDK 57, **Router Stack API** (accessed 2026-07-19): https://docs.expo.dev/versions/v57.0.0/sdk/router/stack/
- Expo SDK 57, **Router Native Tabs API** (accessed 2026-07-19): https://docs.expo.dev/versions/v57.0.0/sdk/router/native-tabs/
- IETF, **RFC 9110 — HTTP Semantics** (accessed 2026-07-19): https://datatracker.ietf.org/doc/rfc9110/
- React Native, **0.86 release** (accessed 2026-07-19): https://reactnative.dev/blog/2026/06/11/react-native-0.86
- MDN Web Docs, **Date.prototype.getTimezoneOffset()** (accessed 2026-07-19): https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/getTimezoneOffset

### Verified findings and implementation consequences

- The versioned Expo Router API supports typed `Href` objects, imperative navigation, local search parameters, focus effects, and per-screen Stack configuration. MOB-NUT-001 therefore uses file routes for the daily list and edit form, passes only the entry ID as a route parameter, and re-fetches authoritative API data when a screen regains focus.
- Expo Native Tabs uses declared triggers to define top-level tabs, and hidden triggers cannot be navigated to. Home-owned capture and detail routes therefore live in a nested `(home)` Stack rather than as undeclared Native Tabs siblings; ADR-0006 records this durable navigation hierarchy.
- RFC 9110 defines 204 as a successful response with no response content. The shared HTTP client must return a successful `undefined` result for 204 before attempting JSON parsing; delete callers must not invent an empty JSON body solely to satisfy the client.
- Expo SDK 57 is paired with React Native 0.86. The 0.86 release reports no breaking application-code changes from 0.85; the nutrition screen uses the stable cross-platform `Alert` API for an explicit destructive-delete confirmation and keeps the destructive operation behind a second user action.
- MDN documents that `getTimezoneOffset()` returns UTC-minus-local minutes and varies with the date in DST regions. The mobile client therefore negates the value and sends an explicit positive-east `utcOffsetMinutes`; contracts bound it to the civil range, repositories query the corresponding UTC instants, and core groups those instants into the requested local date. ADR-0007 records the API semantics and the historical/DST limitation of a single offset snapshot.
- ADR-0006 records the durable navigation hierarchy; ADR-0007 records local-day query semantics. The remaining lifecycle behavior fits the existing NUT-01/NUT-02 architecture.

## 2026-07-19 — MOB-ONB-001 baseline-weight activation

### Primary sources

- Expo SDK 57, **SDK reference** (accessed 2026-07-19): https://docs.expo.dev/versions/v57.0.0/
- React Native 0.86, **TextInput** (accessed 2026-07-19): https://reactnative.dev/docs/0.86/textinput
- React Native 0.86, **Accessibility** (accessed 2026-07-19): https://reactnative.dev/docs/0.86/accessibility

### Verified findings and implementation consequences

- The installed Expo 57 line uses React Native 0.86. The onboarding weight fields stay on the existing React Native `TextInput` surface, use `decimal-pad`, expose explicit accessibility labels, and present validation errors with the alert role; no new native dependency or permission is required.
- Display units are presentation state. Metric and imperial strings are converted once at the mobile/API boundary and rounded to the body-measurement contract's three-decimal canonical kilogram precision. Changing units after entering weights clears both display strings so the same digits cannot silently acquire a different physical meaning.
- Onboarding spans three independent authorities (active goal, baseline measurement, and profile). ADR-0008 records the retry-safe commit protocol: ensure goal, ensure a confirmed weight, and write the profile display name last as the existing SessionGate completion marker.

## 2026-07-19 — MOB-WO-001 recoverable workout and set logging

### Primary sources

- Expo SDK 57, **SecureStore** (accessed 2026-07-19): https://docs.expo.dev/versions/v57.0.0/sdk/securestore/
- Expo SDK 57, **Router API** (accessed 2026-07-19): https://docs.expo.dev/versions/v57.0.0/sdk/router/
- React Native 0.86, **Alert** (accessed 2026-07-19): https://reactnative.dev/docs/0.86/alert
- React Native 0.86, **TextInput** (accessed 2026-07-19): https://reactnative.dev/docs/0.86/textinput

### Verified findings and implementation consequences

- SecureStore is appropriate for small encrypted recovery values but is not authoritative application storage. The workout screen therefore keeps only unsaved names and set-field strings in the user-scoped encrypted draft; an incomplete API workout and its saved sets are discovered again after restart.
- React Native's cross-platform Alert API supports explicit cancel and destructive actions. Set deletion and workout abandonment require a second destructive confirmation; ordinary completion remains a direct, reversible-by-history action.
- Workout load input uses the profile's display unit and converts once to contract-validated kilograms. Repetitions, duration, distance, and RPE retain their own measurement semantics and validation bounds.
- Previous performance must not include the active workout. The recent-sets query now accepts a validated `excludeWorkoutId`, filters that session before calculating best load and last-session volume, and preserves the existing behavior for callers that omit it.
- Supabase-backed ownership checks require the verified bearer token. Workout-set route helpers now thread `principal.accessToken` rather than a test literal through every repository read; in-memory tests continue to pass, while production RLS receives the real authenticated session.
- ADR-0009 records the durable authority and recovery split for the active workout workflow.

## 2026-07-19 — MOB-BODY-001 raw history and labeled weight trend

### Primary sources

- NIST/SEMATECH, **Single Exponential Smoothing** (accessed 2026-07-19): https://www.itl.nist.gov/div898/handbook/pmc/section4/pmc431.htm
- NIST/SEMATECH, **Least Squares** (accessed 2026-07-19): https://www.itl.nist.gov/div898/handbook/pmd/section1/pmd141.htm
- Expo SDK 57, **Router API** (accessed 2026-07-19): https://docs.expo.dev/versions/v57.0.0/sdk/router/
- React Native 0.86, **Alert** (accessed 2026-07-19): https://reactnative.dev/docs/0.86/alert

### Verified findings and implementation consequences

- Exponential smoothing recursively combines prior smooth state and the current observation. Mizyun makes its weighting time-aware: elapsed days determine the alpha for a documented seven-day half-life, so irregular weigh-ins are not treated as equally spaced daily samples.
- Least-squares regression provides a deterministic slope. Mizyun reports the slope as kilograms (or converted pounds) per week over the newest 28 days, and withholds it until at least three confirmed weights span seven days. The UI labels both the window and smoother instead of presenting the interpretation as a raw fact.
- Raw measurements remain visible beside a small raw-reading chart. Deletion is reserved for corrections and uses an explicit destructive Alert; the trend recalculates only after the API confirms removal.
- Weight, waist, and chest entry accepts the selected display units, rejects any invalid nonblank field rather than silently dropping it, and converts to canonical kilograms/centimeters only at the API boundary.
- ADR-0010 records the trend formula, evidence threshold, and presentation boundary.

## 2026-07-21 — MOB-DASH-001 energy state and progress reviews

### Primary sources

- Expo SDK 57, **Router API** (accessed 2026-07-21): https://docs.expo.dev/versions/v57.0.0/sdk/router/
- Expo, **Environment variables in Expo** (accessed 2026-07-21): https://docs.expo.dev/guides/environment-variables/
- React Native, **Accessibility** (accessed 2026-07-21): https://reactnative.dev/docs/accessibility
- React Native, **TextInput** (accessed 2026-07-21): https://reactnative.dev/docs/textinput
- Supabase, **Use Supabase Auth with React Native** (accessed 2026-07-21): https://supabase.com/docs/guides/auth/quickstarts/react-native

### Verified findings and implementation consequences

- Expo Router's `useFocusEffect` is the supported focus-driven refresh primitive and its callback should be memoized. The dashboard keeps authoritative data refreshes behind a memoized callback and re-runs them whenever Home regains focus; the energy-input editor is a declared file route in the existing Home stack.
- Expo only inlines `EXPO_PUBLIC_*` values when application code references them statically with `process.env.NAME` dot notation. The mobile composition root now takes one explicit three-key snapshot and passes it to the closed-world shared validator; dynamically cloning `process.env` no longer prevents configured native bundles from seeing their public URL/key values. Public variables remain bundle-visible and may never contain service-role or model secrets.
- Supabase's React Native quickstart uses platform-specific persistent storage on native, browser storage on web, `processLock`, and foreground-controlled refresh outside web. Mizyun retains encrypted chunked SecureStore on native and validates the browser storage surface before use; SSR or partial shims fall back to per-process memory rather than throwing during route rendering.
- React Native accessibility guidance recommends explicit labels for controls and state for selectable elements. Energy inputs expose labeled numeric fields, radio roles with selected state, alert-role validation, and a disabled/busy save action.
- ADR-0011 records the durable temporal and completeness semantics: local energy-day bounds, per-date review offsets, completed-workout-only counts, and null propagation for incomplete calorie days.

## 2026-07-21 — PERSIST-003 private media persistence

### Primary sources

- Supabase, **Storage access control** (accessed 2026-07-21): https://supabase.com/docs/guides/storage/security/access-control
- Supabase, **Storage ownership** (accessed 2026-07-21): https://supabase.com/docs/guides/storage/security/ownership
- Supabase JavaScript, **createSignedUploadUrl** (accessed 2026-07-21): https://supabase.com/docs/reference/javascript/file-buckets-createsigneduploadurl
- Supabase JavaScript, **createSignedUrl** (accessed 2026-07-21): https://supabase.com/docs/reference/javascript/file-buckets-createsignedurl
- Supabase, **Delete objects** (accessed 2026-07-21): https://supabase.com/docs/guides/storage/management/delete-objects

### Verified findings and implementation consequences

- Private Storage operations are governed by RLS on `storage.objects`; the service key bypasses those policies and objects created under it have no user owner. Normal media metadata, signing, and deletion therefore use the already-verified user's JWT, never service-role authority. The JWT is installed synchronously as the Supabase client's Authorization header so the first request cannot race an asynchronous session mutation.
- `createSignedUploadUrl` requires `INSERT` permission and returns a one-time upload URL whose lifetime is fixed by Supabase at two hours. The adapter reports that actual expiry instead of echoing the API's five-minute download default. It disables upsert because object paths are server-generated UUIDs.
- Signed downloads accept an explicit expiry and require `SELECT` permission. Mizyun continues to use short-lived download URLs and returns the calculated expiry beside each URL.
- Supabase requires object deletion through the Storage API; deleting `storage.objects` metadata directly can orphan billable bytes. The adapter calls `remove`, and the route removes sensitive bytes before soft-deleting application metadata so a partial failure stays retryable without hiding retained photo bytes.
- A clean-stack verification exposed two earlier persistence defects: authenticated repository clients could issue their first request as `anon` because `setSession` was not awaited, and the workout adapter's `source`/`details` fields had no SQL migration. PERSIST-003 fixes the synchronous Authorization binding and adds a forward-only workout-column migration before enabling production Supabase composition.
- ADR-0012 records the user-JWT authority, upload expiry, deletion ordering, and production composition decisions.

## 2026-07-21 — MEDIA-MOB-001 private progress-photo lifecycle

### Primary sources

- Expo SDK 57, **ImagePicker** (accessed 2026-07-21): https://docs.expo.dev/versions/v57.0.0/sdk/imagepicker/
- Expo SDK 57, **ImageManipulator** (accessed 2026-07-21): https://docs.expo.dev/versions/v57.0.0/sdk/imagemanipulator/

### Verified findings and implementation consequences

- The current Expo SDK 57 references recommend the `~57.0.2` package line for both ImagePicker and ImageManipulator. A native Release build proved that the newer `57.0.5` binaries can resolve under a compatible range yet fail at launch against ExpoModulesCore `57.0.3` with a missing `AnyModule._decorateModule` symbol. Mizyun therefore pins both modules to exactly `57.0.2`; a regenerated CocoaPods graph, Release simulator build, install, and launch then succeeded.
- ImagePicker provides system camera and library launchers, camera permission requests, and `getPendingResultAsync()` for Android activity destruction. The progress-photo screen exposes camera and library actions, requests camera access only at the moment of use, disables microphone permission in the config plugin, and recovers or reports pending picker results without updating an unmounted screen.
- Picker results expose file dimensions and optional metadata. Mizyun requests no EXIF, then uses ImageManipulator's contextual API to render a new JPEG with a 2,048-pixel longest-edge ceiling and 0.85 compression. Validation applies to the rendered artifact, and only that derivative is uploaded.
- The mobile client performs a direct `PUT` to the API-issued one-time signed URL. A failed transfer triggers best-effort deletion of the already-created metadata entry; source files remain on the device and are never treated as authoritative measurements.
- ADR-0013 records consent, normalization, metadata removal, direct upload, Android recovery, and destructive-delete boundaries.

## 2026-07-21 — Native iOS MOB acceptance harness and defects

### Primary sources

- Maestro, **React Native support** (accessed 2026-07-21): https://docs.maestro.dev/get-started/supported-platform/react-native
- Maestro, **iOS support** (accessed 2026-07-21): https://docs.maestro.dev/get-started/supported-platform/ios
- Maestro, **CLI installation** (accessed 2026-07-21): https://docs.maestro.dev/maestro-cli/how-to-install-maestro-cli

### Verified findings and implementation consequences

- Maestro 2.7.0 can drive Mizyun's standalone Release build through the iOS accessibility layer without adding an SDK to application code. Synthetic credentials remain runtime-only, and each local acceptance account is permanently deleted after its run.
- A real password sign-in proved that the auth subscription updated the session without refreshing the profile. Fresh accounts therefore bypassed onboarding and rendered protected dashboard children. `AuthProvider` now resolves the profile on every session transition, holds a loading boundary during the request, invalidates stale requests, and routes unresolved/new profiles to onboarding.
- Accessibility screenshots and hierarchy bounds proved that centered safe-area containers allowed `maxWidth: 800` scroll content to become 800 points wide on a 402-point iPhone. The affected mobile screens now stretch their safe area to the viewport and center only the bounded content container, preserving narrow-screen reachability and wide-screen limits.
- The corrected Release build passed a disposable-account Maestro journey through sign-in, all onboarding inputs, the persisted 80 kg baseline, and the real dashboard. No ADR is required: the changes repair existing session-gating and responsive-layout intent without changing module boundaries, data formats, or provider strategy.

## 2026-07-22 — Native keyboard-safe numeric forms

### Primary sources

- React Native, **ScrollView** (accessed 2026-07-22): https://reactnative.dev/docs/scrollview

### Verified findings and implementation consequences

- React Native documents that `automaticallyAdjustKeyboardInsets` updates a scroll view's content and indicator insets as the iOS keyboard changes size; its default is `false`. Native acceptance proved that Mizyun's macro inputs could remain geometrically behind the numeric keyboard, causing an attempted field tap to keep focus in calories and concatenate every later value there.
- Input-heavy scroll forms now opt into the supported iOS inset adjustment while retaining `keyboardShouldPersistTaps="handled"`, so covered fields gain reachable scroll extent and taps handled by form controls still reach those controls. They use the cross-platform `keyboardDismissMode="on-drag"` option so an intentional form drag dismisses the numeric keyboard before submission. The inset prop is also safe on Android, where keyboard layout behavior remains controlled by the platform window mode.
- The change applies consistently to onboarding, energy inputs, meal create/edit, body measurements, and workouts. It repairs reachability without changing validation, canonical-unit conversion, or persistence semantics, so no ADR is required.

## 2026-07-22 — Native progress-photo file transport

### Primary sources

- Expo SDK 57, **FileSystem** (accessed 2026-07-22): https://docs.expo.dev/versions/latest/sdk/filesystem/

### Verified findings and implementation consequences

- Expo FileSystem's `File` represents a native file, reports its size directly, implements the Blob contract, and is the documented request body for file uploads through `expo/fetch`.
- Standalone iOS acceptance proved that calling `Response.blob()` on a fetched local `file://` URI attempts an unsupported ArrayBuffer-to-Blob conversion. Mizyun now validates the normalized derivative with `File.exists` and `File.size`, then sends that same native `File` directly with `expo/fetch`; no JavaScript byte copy or base64 expansion is introduced.
- Upload orchestration still receives an injectable transport in unit tests, preserves the one-time signed-URL headers, and deletes pending sensitive metadata if the native transfer throws or returns a non-success status. This is a platform transport correction within ADR-0013's existing direct-upload boundary, so no new ADR is required.

## 2026-07-22 — AND-001 Android standalone acceptance

### Primary sources

- Android Developers, **Install Android Studio** (accessed 2026-07-22): https://developer.android.com/studio/install
- Android Developers, **Start the emulator from the command line** (accessed 2026-07-22): https://developer.android.com/studio/run/emulator-commandline
- Android Developers, **Create and manage virtual devices** (accessed 2026-07-22): https://developer.android.com/studio/run/managing-avds
- Android Developers, **Set up Android Emulator networking** (accessed 2026-07-22): https://developer.android.com/studio/run/emulator-networking
- Android Developers, **Android Debug Bridge — port forwarding** (accessed 2026-07-22): https://developer.android.com/tools/adb#forwardports

### Verified findings and implementation consequences

- Android Studio's bundled JBR and the SDK command-line tools provide the supported build/runtime path. Mizyun's local acceptance environment uses SDK Platform 36, Build Tools 36, an arm64 Google APIs system image, and a Pixel 9 API 36 AVD. A generated, ignored native project produced a standalone Release APK; the repository remains Expo-prebuild managed.
- The Android emulator reserves `10.0.2.2` as an alias to the host loopback interface. The Release bundle therefore used `10.0.2.2` for the local API and Supabase entry URLs instead of treating emulator `127.0.0.1` as the development host.
- Supabase's local Storage service returns signed URLs containing its configured `127.0.0.1` origin. Android's documented ADB reverse-port facility bridges those signed URLs back to the trusted host-only test service. This is acceptance-harness plumbing, not an application fallback or production networking design.
- Maestro 2.7.0 drove the installed Release APK through real password sign-in, exact persisted meal/body/workout/dashboard assertions, process stop/relaunch restoration, and previous performance. A separate system Photo Picker flow proved two native `File` uploads, comparison, permanent deletion, and empty-state restoration. Android numeric keyboards require an explicit automation `hideKeyboard`; swipe gestures over the numeric keyboard can type digits and are not reliable dismissal evidence.
- No durable architecture decision changed: the app uses the same provider-neutral API, persistence, native file transport, and private-media boundary on both platforms. No ADR is required.

## 2026-07-22 — Reusable local development memory wiki

### Primary sources

- Expo, **Develop an app with Expo** (accessed 2026-07-22): https://docs.expo.dev/workflow/overview/
- Expo, **Build locally: Overview** (accessed 2026-07-22): https://docs.expo.dev/guides/local-app-overview/
- Expo, **iOS Simulator** (accessed 2026-07-22): https://docs.expo.dev/workflow/ios-simulator/
- Expo, **Android Studio Emulator** (accessed 2026-07-22): https://docs.expo.dev/workflow/android-studio-emulator/
- Android Developers, **Start the emulator from the command line** (accessed 2026-07-22): https://developer.android.com/studio/run/emulator-commandline
- Android Developers, **Set up Android Emulator networking** (accessed 2026-07-22): https://developer.android.com/studio/run/emulator-networking
- Supabase, **Local development workflow** (accessed 2026-07-22): https://supabase.com/docs/guides/local-development/cli-workflows
- Maestro, **React Native support** (accessed 2026-07-22): https://docs.maestro.dev/platform-support/react-native
- Maestro, **Installing Maestro** (accessed 2026-07-22): https://docs.maestro.dev/getting-started/installing-maestro

### Verified findings and documentation consequences

- Expo's Continuous Native Generation workflow treats `ios/` and `android/` as regenerable output and recommends clean regeneration after native dependency or app-config changes. The installed SDK 57 CLI cleans by default and offers `--no-clean` as the opt-out, so the wiki uses the locally verified `expo prebuild --platform ...` syntax and routes durable native settings back to `app.json` or config plugins.
- Fast Expo development, native smoke, and standalone Release acceptance prove different things. The wiki separates them so a Metro export or Expo Go launch is never recorded as native Release evidence.
- Android emulator host networking uses `10.0.2.2`; Mizyun's local signed Storage URLs additionally require the already-proven ADB reverse tunnel. Both constraints are now copy-pastable in the Android runbook instead of living only in session history.
- Supabase documents its local stack as development-only and not hardened for external traffic. The backend runbook retains the measured Docker Desktop port warning, synthetic-data rule, clean-reset gate, and teardown requirement.
- Maestro supports React Native through the accessibility UI layer without application instrumentation. The testing runbook records stable-selector order, secret-free disposable-user wrappers, Android keyboard behavior, and authoritative post-save assertions learned during native acceptance.
- This change centralizes operational memory without altering module boundaries, security authority, data formats, or provider strategy. No ADR is required.

## 2026-07-22 — OBS-001 consent-first product analytics

### Primary sources

- Apple Developer, **App privacy details on the App Store** (accessed 2026-07-22): https://developer.apple.com/app-store/app-privacy-details/
- Apple Developer, **Describing data use in privacy manifests** (accessed 2026-07-22): https://developer.apple.com/documentation/bundleresources/describing-data-use-in-privacy-manifests
- Google Play Console Help, **Provide information for Google Play's Data safety section** (accessed 2026-07-22): https://support.google.com/googleplay/android-developer/answer/10787469
- Google Play Console Help, **User Data** (accessed 2026-07-22): https://support.google.com/googleplay/android-developer/answer/10144311
- European Data Protection Board, **Process personal data lawfully** (accessed 2026-07-22): https://www.edpb.europa.eu/sme-be-compliant/process-personal-data-lawfully_en
- Expo SDK 57, **FileSystem** (accessed 2026-07-22): https://docs.expo.dev/versions/latest/sdk/filesystem/
- React Native 0.86, **Share** (accessed 2026-07-22): https://reactnative.dev/docs/0.86/share

### Verified findings and implementation consequences

- Apple classifies launches, taps, clicks, and similar interaction data as Product Interaction used for Analytics. Apple defines collection as off-device transmission accessible beyond real-time servicing and says solely on-device data is not collected for its disclosure answers; it also distinguishes analytics from tracking, which requires linking with third-party data for advertising/measurement or sharing with a broker. Mizyun version 1 stays on device, uses no identifier or advertising purpose, and does not add App Tracking Transparency. Store answers still require a fresh shipped-binary review.
- Google Play classifies app interactions as App activity and feature/performance measurement as Analytics, requires declarations to include third-party SDK behavior, and says solely on-device data that is never transmitted need not be declared as collection. Mizyun adds no analytics SDK or automatic transmission. A user-initiated share can send an export elsewhere, so consent copy and release disclosures must accurately explain that explicit action.
- The EDPB states that consent used as a legal basis must be freely given, informed, specific, unambiguous, and as easy to withdraw as to grant, without negative consequences. Mizyun therefore keeps analytics optional, leaves unknown/denied states as no-op, makes onboarding continuation independent of the choice, and exposes disable-and-clear beside enable/export. This is a conservative engineering application, not legal advice or a final lawful-basis determination.
- Expo FileSystem SDK 57 supports app-local `File` instances under `Paths.document` with read, write, existence, and deletion operations. The consent choice and bounded event array use separate private document files. This also makes app uninstall reset the preference instead of placing non-secret consent state in iOS Keychain storage that can outlive an installation.
- React Native's cross-platform `Share.share` opens the native share dialog for text. Mizyun serializes the validated export only after the user presses Export; no background uploader or processor endpoint exists.
- ADR-0014 records the local-only, identifier-free, closed-schema, bounded-retention and fail-open boundary. `docs/OBSERVABILITY.md` is the mandatory event/property review catalog.

## 2026-07-22 — ALPHA-001 validation and beta-distribution workflow

### Primary sources

- Expo, **Build locally: Overview** (accessed 2026-07-22): https://docs.expo.dev/guides/local-app-overview/
- Apple Developer, **TestFlight Overview** (accessed 2026-07-22): https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/
- Google Play Console Help, **Set up an open, closed, or internal test** (accessed 2026-07-22): https://support.google.com/googleplay/android-developer/answer/9845334
- Maestro, **React Native support** (accessed 2026-07-22): https://docs.maestro.dev/platform-support/react-native

### Verified findings and implementation consequences

- Expo distinguishes local Debug and Release builds and documents Xcode/Android Studio as the native local build path. Mizyun's first ALPHA-001 checkpoint therefore reuses the documented standalone Release acceptance path; a Metro bundle alone is not recorded as alpha readiness.
- TestFlight supports internal and external tester groups, requires beta test information and a feedback address, and may require review for the first external build. Google recommends starting with an internal test and then expanding to a small closed group, with an explicit feedback channel and opt-in link. Mizyun records these as distribution prerequisites rather than pretending simulator installation can recruit 10–30 design partners.
- Both store systems collect their own tester/build feedback and engagement metadata. Mizyun's participant guide must disclose the actual distribution channel as well as the optional in-app analytics export; the local OBS-001 export does not replace platform disclosures.
- Maestro remains an accessibility-layer acceptance tool and requires no analytics/testing SDK in the app. Native automation may prove the consent controls, customer flow, restart, and system share-sheet boundary, but elapsed founder days and participant feedback must remain dated human evidence.
- No ADR is required: ALPHA-001 applies the existing native, privacy, analytics, and product-validation boundaries without changing a data format or provider decision.

## 2026-07-23 — Mistral text-coach planning before controlled alpha

### Primary sources

- Mistral AI, **Mistral Medium 3.5 model card** (accessed 2026-07-23): https://docs.mistral.ai/models/model-cards/mistral-medium-3-5-26-04
- Mistral AI, **Build an agent with tools** (accessed 2026-07-23): https://docs.mistral.ai/getting-started/quickstarts/developer/build-an-agent
- Mistral AI, **SDK clients** (accessed 2026-07-23): https://docs.mistral.ai/resources/sdks
- Mistral AI, **Chat API reference** (accessed 2026-07-23): https://docs.mistral.ai/api
- Mistral AI, **Structured outputs** (accessed 2026-07-23): https://docs.mistral.ai/studio-api/conversations/structured-output
- Mistral AI, **Moderation and guardrailing** (accessed 2026-07-23): https://docs.mistral.ai/studio-api/conversations/moderation
- Mistral AI, **Known limitations** (accessed 2026-07-23): https://docs.mistral.ai/resources/known-limitations
- Mistral AI, **Usage and limits** (accessed 2026-07-23): https://docs.mistral.ai/admin/billing-usage/usage-limits
- Mistral AI, **Privacy Policy** (accessed 2026-07-23): https://legal.mistral.ai/terms/privacy-policy
- Mistral AI, **Data Processing Addendum** (effective 2026-03-12; accessed 2026-07-23): https://legal.mistral.ai/terms/data-processing-addendum
- Mistral AI, **Commercial Terms of Service** (accessed 2026-07-23): https://legal.mistral.ai/terms/commercial-terms-of-service
- Mistral AI, **Usage Policy** (effective 2026-06-11; accessed 2026-07-23): https://legal.mistral.ai/terms/usage-policy

### Verified findings and implementation consequences

- Mistral documents `mistral-medium-latest` for Chat Completions and tool calls, while the current Mistral Medium 3.5 card advertises structured outputs, function calling, a 256k context window, and current list prices of USD 1.50/M input tokens and USD 7.50/M output tokens. These details are time-sensitive and must be rechecked at implementation and release.
- `mistral-medium-latest` is a moving alias. Mizyun will record the resolved response model and evaluation/prompt/tool versions, prefer a stable dated identifier for release when available, and rerun promotion evaluations when resolution changes.
- Mistral recommends its official SDKs and provides a TypeScript package. Vendor SDK usage will be isolated to `packages/providers/mistral`; provider-neutral runtime and feature modules will not depend on it.
- Mistral supports model-generated function arguments, but Mizyun—not the model—must validate schemas, enforce the read-only allowlist, inject verified-user authorization, execute tools, and bound tool rounds/deadlines.
- Custom structured outputs are documented as more reliable than generic JSON mode. Every provider response and tool call will still pass Mizyun-owned runtime schemas before use.
- The current moderation model includes self-harm, health, PII, and jailbreaking categories, and Mistral notes that thresholds can require recalibration. It may supplement but cannot replace Mizyun's fixed safety policy and evaluation set.
- The API returns 429 when organization/model limits are exceeded; rate limits vary by tier/model and Mistral exposes organization/workspace spending controls. Mizyun needs server-side per-user budgets, bounded retries, a provider kill switch, and account-level spend caps.
- Mistral's Privacy Policy says most API inputs/outputs are kept for generation plus 30 rolling days for abuse monitoring unless Zero Data Retention is activated; the Agents API retains input/output until account termination. Mizyun v1 will use stateless Chat Completions and store conversations itself. Real-user traffic requires confirming ZDR on the actual account and reflecting provider processing in privacy/deletion disclosures.
- The DPA describes Mistral as processor for customer personal data, permits listed subprocessors and certain transfers with safeguards, and distinguishes feedback/training and abuse-monitoring uses. Mizyun must review/accept the actual DPA, subprocessor list, training settings, and feedback behavior before real-user processing.
- The current cloud Usage Policy prohibits unqualified professional advice and explicitly includes health-related guidance. Because a fitness coach can overlap this category, private synthetic implementation may proceed, but real-user coaching requires written provider clarification or qualified legal review plus a narrowly tested wellness/non-medical scope. This is an external-release blocker, not a coding assumption.
- `docs/AI_IMPLEMENTATION_PLAN.md` records the revised sequence and gates. No ADR is accepted yet; implementation should create one when the stateless Mistral adapter, model-version policy, conversation authority, and memory retrieval strategy are finalized.

## 2026-07-23 — Mistral coach implementation refresh

### Primary sources

- Mistral AI, **SDK clients** (accessed 2026-07-23): https://docs.mistral.ai/resources/sdks
- Mistral AI, **Function calling** (accessed 2026-07-23): https://docs.mistral.ai/studio-api/conversations/function-calling
- Mistral AI, **Structured outputs** (accessed 2026-07-23): https://docs.mistral.ai/studio-api/conversations/structured-output
- Mistral AI, **Moderation and guardrailing** (accessed 2026-07-23): https://docs.mistral.ai/studio-api/conversations/moderation
- Mistral AI, **Mistral Moderation 2 model card** (accessed 2026-07-23): https://docs.mistral.ai/models/model-cards/mistral-moderation-26-03

### Verified findings and implementation consequences

- The installed official TypeScript SDK resolved to `@mistralai/mistralai` 1.15.1. Its Chat `parse` surface accepts a Zod schema, request timeout, abort/retry options, and returns resolved-model, finish-reason, request-ID, and usage metadata. The adapter disables SDK retries and owns one bounded transient retry so behavior remains contract-testable.
- Current Mistral documentation recommends custom structured outputs over generic JSON mode. The provider requires `{ answer }` through the SDK parse surface and then validates the normalized response again before exposing it to the runtime.
- Mistral Moderation 2 (`mistral-moderation-2603`) is the current documented moderation model and adds jailbreaking classification. Live moderation/guardrail calibration remains part of the synthetic-provider gate; critical medical, emergency, eating-disorder, self-harm, extreme-target, and prompt-injection cases have a deterministic provider-independent first line now.
- ADR-0015 accepts stateless Chat Completions, Mizyun-owned RLS conversation state, server-built confirmed-data grounding, resolved-model recording, and default-off external access.

## 2026-07-23 — Managed-first infrastructure with a self-hosting exit path

### Primary sources

- Supabase, **Available regions** (accessed 2026-07-23): https://supabase.com/docs/guides/platform/regions
- Supabase, **Database backups** (accessed 2026-07-23): https://supabase.com/docs/guides/platform/backups
- Supabase, **Self-Hosting** (accessed 2026-07-23): https://supabase.com/docs/guides/self-hosting
- Supabase, **Self-Hosting with Docker** (accessed 2026-07-23): https://supabase.com/docs/guides/self-hosting/docker
- Supabase, **Restore a Platform Project to Self-Hosted** (accessed 2026-07-23): https://supabase.com/docs/guides/self-hosting/restore-from-platform
- Supabase, **Migrating Auth Users Between Supabase Projects** (accessed 2026-07-23): https://supabase.com/docs/guides/troubleshooting/migrating-auth-users-between-projects
- Supabase, **Storage schema design** (accessed 2026-07-23): https://supabase.com/docs/guides/storage/schema/design
- European Commission, **Special categories of personal data** (accessed 2026-07-23): https://commission.europa.eu/law/law-topic/data-protection/information-individuals_en

### Verified findings and implementation consequences

- Managed Supabase supports specific EU AWS regions including Frankfurt, Ireland, Paris, Stockholm, and Zurich. Mizyun will initially prefer a specific EU region rather than a broad automatic region, subject to customer geography and legal review.
- Managed database backups do not contain private Storage object bytes. Hosted production therefore needs a separate object-backup, restore, and checksum procedure.
- Supabase states that self-hosting transfers server maintenance, hardening, service configuration, Postgres operations, high availability, scalability, backups, disaster recovery, monitoring, and uptime to the operator. A low-cost single VPS is not equivalent to the managed production service.
- Self-hosted Supabase is community-supported and lacks managed-platform capabilities including managed backups/PITR and some advanced metrics. Mizyun must supply equivalent recovery and observability before production cutover.
- Supabase provides an official managed-platform-to-self-hosted restore workflow, but component and Postgres version differences can break restoration. Every target version and extension must be pinned and rehearsed against an isolated staging restore.
- Auth users and password hashes can be migrated. JWT signing-key choice determines whether existing sessions remain valid or every user must authenticate again; Mizyun must make and rehearse that decision before cutover.
- Storage metadata and object bytes have different authorities. A future cutover must copy object bytes through supported Storage/S3 interfaces and verify manifests, not only restore PostgreSQL rows.
- EU guidance treats health-related data as sensitive personal data requiring stronger risk-proportionate safeguards. Infrastructure ownership does not remove GDPR duties; the self-hosting decision needs a reviewed DPIA, access controls, incident response, retention, and recovery evidence.
- ADR-0016 accepts managed Supabase through initial production while preserving a gated migration to redundant Mizyun-operated EU infrastructure. `docs/INFRASTRUCTURE_EVOLUTION_PLAN.md` defines the stages and exit criteria.

## 2026-07-23 — AI request controls and physical-iPhone preparation

### Primary sources

- Mistral AI, **Usage and limits** (accessed 2026-07-23): https://docs.mistral.ai/admin/billing-usage/usage-limits
- Mistral AI, **Known limitations** (accessed 2026-07-23): https://docs.mistral.ai/resources/known-limitations
- Expo, **Expo CLI** (accessed 2026-07-23): https://docs.expo.dev/more/expo-cli/
- Apple Developer, **Enabling Developer Mode on a device** (accessed 2026-07-23): https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device
- Apple Developer, **Building and running an app** (accessed 2026-07-23): https://developer.apple.com/documentation/xcode/building-and-running-an-app
- Installed `@mistralai/mistralai` 1.15.1 source: `src/models/errors/mistralerror.ts` and `src/lib/retries.ts`

### Verified findings and implementation consequences

- Mistral documents per-organization/model request and token-throughput limits, 429 responses when limits are exceeded, and organization/workspace spending controls. Numeric limits vary by account and model, so Mizyun adds its own conservative per-user request, concurrency, and daily-token controls rather than assuming the provider account limit protects one user.
- The installed SDK's HTTP error exposes status and `Headers`; its retry helper recognizes both delta-seconds and HTTP-date `Retry-After` values. Mizyun continues to disable SDK retries and owns exactly one bounded 429 retry with `Retry-After` or full jitter. Timeout, 5xx, and unknown transport failures are not automatically retried because Chat Completions has no provider idempotency key and an accepted-but-timed-out request could otherwise be billed twice.
- Expo documents `expo run:ios --device` as the local physical-device compile/sign/install/launch path. Release configuration embeds the production bundle, so the trusted-LAN `EXPO_PUBLIC_*` URLs must be present at build time and only publishable client values may be used.
- Apple requires Developer Mode for locally installed development builds. Pairing/trust, Developer Mode restart confirmation, signing-team selection when automatic signing cannot resolve it, and local-network permission are explicit user-interaction checkpoints for AI-MOB-001.
- No ADR is required: these controls and the device workflow complete ADR-0015's existing default-off stateless-provider decision without changing conversation authority, module boundaries, or data formats.

## 2026-07-24 — AI-OPS-001 durable limiter (replica-safe, plan-tier aware)

### Scope

Replace the single-process `Map`-based Coach limiter with a service-role
Postgres implementation so the API can horizontally scale. Lock down the
free vs paid per-user caps per ADR-0017. Make the provider-call ledger
durable so retries after a hard failure use a fresh idempotency key.

### Primary sources

- Postgres, **Advisory locks** (accessed 2026-07-24): https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS
- Postgres, **`SECURITY DEFINER` functions** (accessed 2026-07-24): https://www.postgresql.org/docs/current/sql-createfunction.html
- Supabase, **Row Level Security** (accessed 2026-07-24): https://supabase.com/docs/guides/database/postgres/row-level-security
- PostgREST, **Calling functions with `rpc`** (accessed 2026-07-24): https://postgrest.org/en/stable/references/api/functions.html
- Supabase JS, **SupabaseClient.rpc** (accessed 2026-07-24): https://supabase.com/docs/reference/javascript/rpc
- pgTAP, **`results_eq` / `is` / `lives_ok`** (accessed 2026-07-24): https://pgtap.org/documentation.html

### Verified findings and implementation consequences

- `pg_try_advisory_xact_lock(bigint)` returns `false` immediately when another transaction holds the same bigint. Each `ai_*` RPC takes an advisory lock on a stable hash of `(kind, userId, conversationId, key)` so concurrent same-user requests serialize without `SELECT … FOR UPDATE` deadlock risk.
- `SECURITY DEFINER` with `set search_path = ''` is the supported escape hatch for limiter RPCs that must bypass RLS. The `service_role` is the only grantee; `authenticated` is `select`-only on the limiter tables.
- PostgREST returns table-returning RPCs as an array of rows. A scalar-returning function (`returns boolean`) is wrapped as `{ "<funcname>": value }`, which the TS client surfaces as a non-array object. We shape `ai_acquire_in_flight` as `returns table(allowed boolean)` for consistency.
- `return query` in PL/pgSQL queues rows; multiple statements queue multiple rows. Every `if found then … end if;` branch must include a trailing `return;` so the function returns exactly one row even when `return query` enqueues a row.
- pgTAP's `results_eq` consumes the SET entirely; calling a set-returning RPC twice in two `results_eq` blocks re-runs the RPC, so the second call must be wrapped in a CTE / single-row `is` to avoid coupling the assertions.
- ADR-0017 is cross-linked from the AI implementation plan; no new ADR is needed because the limiter is the implementation of an already-locked decision.

## 2026-07-25 — AI-002 read-only Coach tools + tool loop

### Scope

Promote the Coach from "static grounding + one Mistral call" to
"model picks which read-only tools to call, runtime executes
them under the principal-bound userId, model sees the result".

### Primary sources

- Mistral AI, **Tool calling / function-calling** (accessed 2026-07-25): https://docs.mistral.ai/capabilities/function_calling
- OpenAI, **Function-calling loop pattern** (accessed 2026-07-25): https://platform.openai.com/docs/guides/function-calling
- PostgREST, **`tools` array in chat completion requests** (accessed 2026-07-25): https://docs.mistral.ai/api/chat/chat_completion

### Verified findings and implementation consequences

- Mistral Chat Completions accepts a `tools: [{type: "function", function: {name, description, parameters}}]` array alongside `messages`. The model can return either a final assistant message or a `tool_calls` array; both shapes are surfaced by `chat.parse` (the same ZDR-compatible call path Mizyun already uses). No migration to `chat.complete` is required.
- The runtime — not the model — owns the `userId`. The orchestrator injects `principalUserId` into every tool execute call and the tool's `parameters` schema omits `userId` entirely, so the model cannot switch users (defence in depth).
- `days_back` is clamped to 1..28 inside the tool; the model cannot widen the window past the static grounding's 28-day budget. Out-of-range values fall back to the default (7) so the answer still includes the data the model asked for.
- Tool budget defaults to 1 round-trip. The orchestrator throws `AgentToolBudgetExceededError` when the model exceeds it; the route maps this to `AI_UNAVAILABLE`. Tests assert both the budget-exceeded path and the tool-error envelope (unknown tool name → `providerMetadata.toolCallError` + `finishReason: "tool_error"`).
- ZDR is unaffected: the provider still uses `chat.parse` with the structured `coachOutputSchema`. Tool calls happen _between_ Mistral calls inside the orchestrator, never as user-controlled inputs.

## 2026-07-25 — VISION-001 read-only photo-to-draft Coach surface

### Scope

Adds `POST /v1/food-entries/draft` so the mobile app can submit a
photo (multipart `image` + optional `textHint`) and get back a
structured candidate the user can edit and confirm. Photo bytes
are transient: in-memory → provider → discarded. No server-side
photo persistence; no photo URLs in the text-coach prompt;
no log lines carrying photo bytes.

### Primary sources

- Mistral AI, **Vision (image inputs) on Chat Completions** (accessed 2026-07-25): https://docs.mistral.ai/capabilities/vision
- Mistral AI, **Structured outputs (response_format)** (accessed 2026-07-25): https://docs.mistral.ai/capabilities/structured-outputs
- @fastify/multipart (accessed 2026-07-25): https://github.com/fastify/fastify-multipart
- RFC 7578 — Returning Values from Forms: multipart/form-data (accessed 2026-07-25): https://www.rfc-editor.org/rfc/rfc7578

### Verified findings and implementation consequences

- Mistral's `chat.complete` accepts content blocks (`type: "image_url"`) alongside text. With `response_format: { type: "json_schema", ... }` (or Zod-parsed structured output) the model returns a validated candidate in one round-trip — no need for chat.parse which doesn't support content blocks.
- The dedicated `mizyun-vision-draft` Mistral workspace keeps the vision key separate from the text-coach key (per ADR-0017). ZDR + training/feedback off are required at workspace creation; the adapter refuses to construct if the SDK doesn't surface those flags.
- @fastify/multipart reads parts in declared order; ordering the `textHint` field BEFORE the file in the test body was the only reliable way for the field to be picked up. Production clients send the file first because the standard libraries do so; the route reads all parts regardless of order.
- File-size limit is 15 MiB to match the `private-media` bucket policy. The route enforces it from the multipart stream (counting chunk lengths) before the buffer is fully assembled, so a malicious client can't OOM the API.
- The rate limit (`FoodDraftRateLimiter`) is a per-user sliding window: free 1/min, paid 3/min. It is checked before the multipart body is read, so a 429 response never touches photo bytes. This protects the vision provider's cost and never starves the Coach flow's daily budget.
- The smoke harness (`scripts/vision-001-smoke.sh`) uses a separate `VISION_PROVIDER=stub` env knob to wire the deterministic `StubVisionProvider` so the dev path doesn't need a Mistral key. Production reads `MISTRAL_VISION_API_KEY` and wires the real `MistralVisionProvider`. The two paths are mutually exclusive.

### Defence in depth

- Photo bytes are accepted as `image/jpeg`, `image/png`, `image/webp` only. Other mime types → 422.
- The model output is post-screened for medical claims and unsafe daily-target language. Ordinary single-meal estimates below 800 kcal remain editable candidates; a meal estimate is not a daily calorie target.
- The route never logs the photo bytes, the textHint, or the model output. The request id (random UUID) is the only correlation token returned to the user.

## 2026-07-26 — Mobile meal-photo transport stabilization

### Primary sources

- Expo SDK 57, **ImagePicker** (accessed 2026-07-26): https://docs.expo.dev/versions/v57.0.0/sdk/imagepicker/
- Expo SDK 57, **SecureStore** (accessed 2026-07-26): https://docs.expo.dev/versions/v57.0.0/sdk/securestore/
- Installed Expo FileSystem 57 type declarations, `File.bytes()` and `File.size` (inspected 2026-07-26)
- Mistral AI, **Vision** (accessed 2026-07-26): https://docs.mistral.ai/capabilities/vision/
- Mistral AI, **Structured outputs** (accessed 2026-07-26): https://docs.mistral.ai/capabilities/structured-outputs

### Verified findings and implementation consequences

- ImagePicker assets expose a local URI and may expose a MIME type, but the chosen iOS asset is not guaranteed to already be one of the API's accepted JPEG/PNG/WebP encodings. The meal flow now normalizes every selected asset to a bounded JPEG, verifies its native file metadata, and reads it with Expo FileSystem before upload.
- The mobile client uses platform `FormData`/`Blob` and leaves the multipart `Content-Type` unset so the fetch implementation supplies the correct boundary. Successful responses are parsed through `foodDraftResponseSchema`; malformed provider/API output cannot prefill the form.
- Mistral vision accepts base64 data URLs in image content blocks and supports schema-constrained structured output. The server remains the only component that calls Mistral; photo bytes are transient and estimates require user confirmation before the normal food-entry write.
- SecureStore's SDK 57 synchronous getter is `getItem`, while `getItemAsync` is the asynchronous API. Authentication/session changes retain the installed SDK surface and do not introduce a nonexistent `getItemSync` call.
- No new ADR is required: the changes harden ADR-0017's existing server-owned safety, transient-photo, and user-confirmation decisions without changing authority or persistence.

## 2026-07-26 — Deterministic calorie, protein, and training plan

### Primary sources

- ACSM, **Resistance Training Guidelines Update (2026)** (accessed 2026-07-26): https://acsm.org/resistance-training-guidelines-update-2026/
- ACSM, **Resistance Training Position Stand infographic** (accessed 2026-07-26): https://www.acsm.org/wp-content/uploads/2026/03/Resistance-Training-Position-Stand-infographic.pdf
- WHO, **Recommended amount of physical activity for adults** (accessed 2026-07-26): https://www.emro.who.int/health-education/physical-activity/promoting-physical-activity/What-is-the-recommended-amount-of-exerci.html
- International Society of Sports Nutrition, **Position stand: protein and exercise** (accessed 2026-07-26): https://pubmed.ncbi.nlm.nih.gov/28642676/

### Verified findings and implementation consequences

- The AI must explain a deterministic plan, not calculate targets itself. `buildCoachingPlan` now combines the existing versioned energy result with explicit protein and training rules, and the Coach tool reads confirmed repositories before invoking it.
- The ISSN position stand supports a general range of 1.4–2.0 g protein/kg/day for exercising adults. Mizyun uses 1.4–1.8 for maintenance and 1.6–2.0 for cut, bulk, or recomp, with a visible current-weight basis and no target when weight or goal is missing.
- WHO's adult baseline is at least 150 minutes of moderate aerobic activity weekly and muscle strengthening on two or more days. ACSM's 2026 update emphasizes training all major muscle groups at least twice weekly and individualizing around goals. Mizyun therefore returns a conservative base frequency and exercise-type framework, not injury-specific or person-specific exercise selection.
- The calorie range is explicitly an adherence/planning band of plus or minus 100 kcal, not physiological measurement uncertainty. The underlying target and its formula version remain visible.
- Experience, available equipment, preferences, and limitations are not yet profile inputs. The output discloses that limitation; the next implementation level will add those inputs before exercise selection becomes personalized.
- Level 2 now stores those inputs as an explicit, closed, non-medical preference object: experience, weekly schedule, session duration, training focus, equipment, dietary preferences, and movement constraints. There is no free-text diagnosis field and no silent inference. Shared schemas, domain validation, database checks, export, mobile controls, and Coach grounding use the same vocabulary.
- Level 3 applies the ACSM/WHO baseline through a versioned deterministic prescription: no more than four resistance days, at least 150 moderate aerobic minutes, bounded sets/reps/rest, equipment and movement-constraint filtering, and a conservative `build`/`hold`/`reduce` decision from confirmed seven-day sessions, set count, and average RPE. The mobile Coach can show the plan even when external AI is disabled; the model receives the exact same result through a read-only tool.
- Level 4 makes durable memory explicitly user-controlled and
  candidate-first. The same verified access token now reaches
  orchestrator recall, grounding recall, and every Supabase operation;
  a user UUID is never reused as a bearer token. Only active,
  non-expired memories meeting the confidence/importance threshold are
  recalled, and PostgreSQL enforces the activation threshold.
- Creation and correction pass the existing Coach prompt-injection
  screen. Corrections keep bounded prior-content provenance. Mobile
  controls expose confirmation, correction, deactivation, reactivation,
  expiry, and permanent deletion; account export includes superseded
  history and account deletion removes memory with the rest of the
  user's records. No model-facing write tool or automatic promotion was
  introduced.
- Level 5 uses one strict editable nutrition candidate for both photo
  and typed-description inputs. Point estimates are accompanied by
  plausible low/high ranges, portion/ingredient assumptions,
  confidence, warnings, and server-owned provider/model/prompt
  provenance. The provider's resolved model identifier is preferred
  over its configured alias when returned.
- Typed descriptions are bounded, strict-schema inputs and pass the
  Coach safety screen before provider access. Photo bytes retain the
  existing transient-only boundary. Both paths only prefill the manual
  meal form; the normal confirmed food-entry endpoint remains the sole
  persistence authority.
- Level 6 adds one reproducible offline evaluation command and a
  threshold-by-threshold evidence report. The fixed critical-safety
  corpus is now `coach-safety-v2` with 16 English/Slovak cases,
  including medication and dangerous training-volume requests.
  Retrieved memories and tool results are explicitly serialized as
  untrusted data, with a regression test containing adversarial text.
- The evidence report separates offline passes from provider-dependent
  promotion measurements. Grounded-answer accuracy at scale and
  p50/p95 latency/cost remain pending rather than being inferred from
  the two existing live synthetic cases.

## 2026-07-26 — External text and multimodal development enablement

### Primary sources

- Mistral AI, **Vision** (accessed 2026-07-26):
  https://docs.mistral.ai/studio-api/conversations/vision
- Mistral AI, **Models** (accessed 2026-07-26):
  https://docs.mistral.ai/models

### Verified findings and implementation consequences

- Current Mistral documentation lists the Medium family as
  multimodal, so the capped development credential now uses
  `mistral-medium-latest` for both Coach text and nutrition
  photo/text drafting. The ignored local environment enables both;
  the committed default remains off for fresh installations.
- API `dev` and `start` scripts now load the ignored root `.env`
  explicitly. Previously the file could be silently ignored unless
  variables were exported by the caller's shell.
- Live SDK verification exposed two response-shape defects that fake
  clients had hidden. Vision now uses `chat.parse` and accepts
  `message.parsed`; the Coach accepts the SDK's `toolCalls: null`
  final-answer shape.
- After those fixes, a synthetic blank-image request returned a valid
  `nutrition-draft-v2` structured candidate. Both live fictional Coach
  cases also passed with `mistral-medium-latest`, `stop` finish
  reasons, 201/179 total tokens, and under-one-second latency buckets.
  No real-user content, photo, identifier, or credential was used.

## 2026-07-26 — Deterministic daily Coach plan

### Primary sources

- Fastify, **Reference / Validation and Serialization** (accessed
  2026-07-26): https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/
- React Native, **Accessibility** (accessed 2026-07-26):
  https://reactnative.dev/docs/accessibility

### Verified findings and implementation consequences

- Fastify continues to recommend schema-validated request/response
  boundaries. The daily plan therefore crosses the API and persistence
  boundary as a strict discriminated-union proposal rather than an
  untyped model payload.
- React Native documents that touchables are accessible by default and
  that text descendants form their screen-reader label. The daily plan
  is a read-only semantic text card; it adds no misleading button or
  adjustment role.
- The plan is a versioned pure-core decision. Confirmed food/workout
  repositories supply observations; existing energy/coaching rules own
  targets; a model is not called and cannot alter the priority. Missing
  nutrition logs remain `null`, never inferred as zero intake.
- No new platform service, native permission, database migration, or
  architectural boundary was introduced, so no ADR is required.

## 2026-07-26 — Evidence-gated weekly Coach adaptation

### Primary sources

- Helms et al., **Evidence-based recommendations for natural
  bodybuilding contest preparation** (JISSN, accessed 2026-07-26):
  https://pubmed.ncbi.nlm.nih.gov/24864135/
- Iraki et al., **Nutrition Recommendations for Bodybuilders in the
  Off-Season** (Sports, accessed 2026-07-26):
  https://pubmed.ncbi.nlm.nih.gov/31247944/

### Verified findings and implementation consequences

- The contest-preparation review recommends approximately 0.5–1% body
  weight loss per week to support lean-mass retention. The weekly
  engine uses that as the cut band and steps goal pace by only one
  existing deterministic tier.
- The off-season review recommends approximately 0.25–0.5% body weight
  gain per week for novice/intermediate bodybuilders, with more
  conservative gains for advanced athletes. The engine uses that
  bounded bulk band and never invents a custom calorie number.
- A trend alone is not enough to adapt. At least four complete
  nutrition days, calorie adherence within 80–120%, and the existing
  three-observation/seven-day trend gate must all pass. Otherwise the
  proposal is hold-only and explains what evidence is missing.
- Acceptance verifies conversation ownership, proposal provenance,
  active-goal identity, and unchanged current pace before applying the
  proposed pace. The normal deterministic energy engine recalculates
  future targets; the model is never called and cannot write the goal.
- No new provider, platform service, native permission, or
  architectural boundary was introduced, so no ADR is required.

## 2026-07-26 — Opt-in proactive Coach reminders

### Primary sources

- Expo SDK 57, **Notifications** (accessed 2026-07-26):
  https://docs.expo.dev/versions/v57.0.0/sdk/notifications/

### Verified findings and implementation consequences

- Expo SDK 57 recommends `expo-notifications ~57.0.7` and supports
  repeating daily and weekly local triggers on both mobile platforms.
  Weekdays use `1` for Sunday through `7` for Saturday.
- Android 13 requires a notification channel before its permission
  prompt can appear. Mizyun creates one low-intrusion
  `coach-reminders` channel before requesting permission.
- The official Expo Router pattern listens for initial and warm
  notification responses and validates the embedded URL before
  navigation. Mizyun accepts only `/coach` and passes a bounded fixed
  daily/weekly prompt into the composer.
- Reminders are local, device-timezone schedules and require no push
  token, remote notification service, background task, or health-data
  processing. OS permission is requested only after explicit opt-in.
- Settings and native schedule IDs are stored per authenticated user
  in SecureStore. Rescheduling cancels old IDs; persistence failure
  rolls back new schedules; opt-out and sign-out cancel every stored
  schedule. No ADR is required because the feature uses the existing
  device-local notification boundary without a new remote processor.

## 2026-07-25 — AI-MOB-002 Coach UX polish

### Scope

Polish the Coach flow on the iPhone simulator. No new features;
no API changes. The segment closes the gap between "Coach works"
(AIM-001) and "Coach is usable for a non-engineer."

### Primary sources

- Expo SDK 57, **Pressable / accessibility** (accessed 2026-07-25): https://docs.expo.dev/versions/v57.0.0/sdk/pressable/
- React Native 0.86, **View accessibilityLiveRegion** (accessed 2026-07-25): https://reactnative.dev/docs/accessibility#livescreenreaderannouncements
- WCAG 2.1, **1.4.11 Non-text Contrast** (accessed 2026-07-25): https://www.w3.org/WAI/WCAG21/Understanding/non-text-contrast.html
- iOS HIG, **Touch targets ≥ 44pt** (accessed 2026-07-25): https://developer.apple.com/design/human-interface-guidelines/inputs/touch-targets

### Verified findings and implementation consequences

- Reuse existing `Collapsible` rather than introduce a new collapse primitive. Extended `Collapsible` to accept a controlled `open` + `onOpenChange` so the evidence-chips list can keep only one chip open at a time without a state-mutation prop drilling issue.
- The `activityIndicator` colour must be one of the existing `Colors.dark.*` keys; `tint` does not exist. `text` is the correct foreground colour and has ≥ 4.5:1 contrast against `backgroundElement`.
- `Pressable.accessibilityRole="button"` + `accessibilityState={{ busy, disabled }}` is the supported a11y surface in RN 0.86. `accessibilityRole="listitem"` on a plain `View` is not in the union; dropped in favour of an `accessibilityRole="list"` wrapper.
- The status dot alone is not sufficient for screen readers or colour-blind users. Pair it with a text label ("Coach ready · mistral · mistral-medium-latest" / "Coach off · AI access disabled"). The dot is `accessibilityElementsHidden` so SR doesn't read it twice.
- `minHeight: 44` on every pressable is enforced via the existing tokens (the primary button uses 48, secondary 44). The plan called this out as a non-negotiable.
- An `accessibilityLiveRegion="polite"` View on the screen announces the latest assistant message; the `liveRegionTick` advances on success so the announcement fires once per round-trip, not on every keystroke.
- The optimistic user bubble stays on the screen through the request and is replaced (not appended) when the server response returns, so the same id doesn't appear twice.
- Focus is restored to the composer after every send (success or failure) via `inputRef.current?.focus()` in the `finally` block.

### Smoke path

`pnpm db:start` + `pnpm dev:api` + `pnpm dev:mobile` (iOS simulator):

1. Empty thread list → "Start a private check-in".
2. Tap "New conversation" → header reads `<title> · just now · tap to switch`.
3. Tap header → thread-list sheet opens.
4. Send "How am I doing?" → optimistic user bubble stays; assistant bubble appends; chips appear under assistant.
5. Tap a chip → expands deterministic human summary.
6. Force a 429 (raise `userRequestsPerMinute=1` then send twice) → alert border yellow with "Coach is busy…" copy.

## 2026-07-26 — External Mistral moderation API (AI-SAFETY-001)

### Primary sources

- Mistral AI, **Moderation API** (accessed 2026-07-26):
  https://docs.mistral.ai/studio-api/conversations/moderation

### Verified findings and implementation consequences

- Mistral provides the `mistral-moderation-2603` model via the `@mistralai/mistralai` 1.15.1 `client.classifiers.moderate({ model, inputs })` method.
- The returned payload is `{ id, model, results: [{ categories: Record<string, boolean>, categoryScores: Record<string, number> }] }`.
- Documented categories include `sexual`, `hate/discrimination`, `violence/threats`, `dangerous`, `criminal`, `self-harm` (including eating disorders), `health`, `financial`, `law`, `PII`, and `jailbreaking`.
- `MistralContentModerator` in `packages/providers/mistral` parses the response strictly against a Zod schema. It relies on the provider's boolean `categories` flags, selecting the highest-scoring category among true categories.
- Malformed responses, provider failures, or disabled `AI_EXTERNAL_ACCESS` throw an exception so the runtime fails closed with a fixed reviewed safety envelope (`mizyun-safety`).
- Prompts, responses, scores, and raw input/output texts are never logged.
- The moderator is wired in `apps/api` composition root only when Mistral provider is configured (`AGENT_PROVIDER=mistral`), using `MISTRAL_MODERATION_MODEL` (defaulting to `mistral-moderation-2603`).
- Opt-in live synthetic e2e calibration tests verify moderation connectivity without leaking sensitive text or secrets into logs.

## 2026-07-31 — Isolated Mac development and Windows founder production

### Primary sources

- Supabase, **Local development workflow** (accessed 2026-07-31):
  https://supabase.com/docs/guides/local-development/cli-workflows
- Supabase, **Self-Hosting** (accessed 2026-07-31):
  https://supabase.com/docs/guides/self-hosting
- Supabase, **Self-Hosting with Docker** (accessed 2026-07-31):
  https://supabase.com/docs/guides/self-hosting/docker
- Microsoft, **Use systemd to manage Linux services with WSL** (accessed
  2026-07-31): https://learn.microsoft.com/en-us/windows/wsl/systemd
- Microsoft, **Accessing network applications with WSL** (accessed 2026-07-31):
  https://learn.microsoft.com/en-us/windows/wsl/networking
- Tailscale, **Install Tailscale on Windows with WSL 2** (accessed 2026-07-31):
  https://tailscale.com/docs/install/windows/wsl2
- Cloudflare, **Run as a service** (accessed 2026-07-31):
  https://developers.cloudflare.com/tunnel/advanced/local-management/as-a-service/

### Verified findings and implementation consequences

- Supabase explicitly describes the CLI local stack as development-only, without
  production hardening, and says it must never be exposed externally. The Mac
  retains that stack; the PC runbook now uses the official self-hosted Docker
  Compose distribution.
- Supabase documents `db push` as applying only migrations absent from the remote
  migration history, while reset commands erase data. The former is the PC
  promotion primitive; `db:verify`/`db:reset` are forbidden on the PC.
- Official self-hosting makes Mizyun responsible for server maintenance,
  security, PostgreSQL operations, backups, recovery, monitoring, and uptime.
  The PC is therefore labeled founder production and does not satisfy the
  eventual paying-user gate.
- Current Ubuntu under WSL supports systemd, which allows the Supabase and API
  services to be enabled and supervised. A Windows startup task must launch the
  WSL distribution, and a real reboot proof is required.
- WSL mirrored networking can improve VPN/LAN behavior, but Mizyun does not
  depend on LAN exposure: Tailscale inside WSL carries private SSH, while a
  named Cloudflare Tunnel carries only HTTPS API/Supabase gateway traffic.
- Production configuration is external to Git and now fails closed unless
  durable Supabase settings are present. API production startup no longer loads
  the Mac development `.env`.
- The previous deploy script ran `pnpm db:verify` on the PC even though that
  command includes a destructive local reset. The replacement verifies only on
  Mac, promotes an exact commit, backs up the PC, previews/applies pending
  migrations, restarts, and smoke-tests.

## 2026-08-01 — Separate iOS Dev identity under an Apple Personal Team

### Primary sources

- Expo, **App config reference** (accessed 2026-08-01):
  https://docs.expo.dev/versions/latest/config/app/
- Expo, **Send notifications with FCM and APNs** (accessed 2026-08-01):
  https://docs.expo.dev/push-notifications/sending-notifications-custom/
- Expo, **iOS capabilities** (accessed 2026-08-01):
  https://docs.expo.dev/build-reference/ios-capabilities/

### Verified findings and implementation consequences

- `ios.bundleIdentifier`, `scheme`, and native entitlements are app-config
  concerns, but an existing generated iOS project must be regenerated when the
  selected variant changes.
- Expo's notifications integration adds the APNs `aps-environment` entitlement.
  Apple Personal Teams cannot provision that capability, so a final config
  plugin removes it after Expo's automatic plugin pass for Dev and for an
  explicitly opted-in local Production device build. Normal
  Production/distribution configuration continues to request APNs.
- The physical-device build then compiled, signed, and installed both independent
  identities. iOS still requires the user to enable Developer Mode and trust the
  Personal Team profile before either development-signed app can launch.

## 2026-08-01 — Founder-production Auth signup timeout

### Primary sources

- Supabase, **Self-Hosting with Docker** (accessed 2026-08-01):
  https://supabase.com/docs/guides/self-hosting/docker
- Supabase, **Auth Self-hosting Config** (accessed 2026-08-01):
  https://supabase.com/docs/guides/self-hosting/auth/config
- Supabase, **JavaScript signUp** (accessed 2026-08-01):
  https://supabase.com/docs/reference/javascript/auth-signup
- Supabase, **Use Supabase Auth with React Native** (accessed 2026-08-01):
  https://supabase.com/docs/guides/auth/quickstarts/react-native

### Verified findings and implementation consequences

- A physical iPhone signup reached the self-hosted GoTrue service, but GoTrue
  timed out after ten seconds while attempting to send confirmation mail. The
  production Compose environment still used the template
  `SMTP_HOST=supabase-mail` / `SMTP_PORT=2500`, and no such service or hostname
  exists in the running stack. The transaction rolled back; `auth.users`
  remained empty.
- Supabase requires a production-ready SMTP service for self-hosted confirmation
  and recovery email. The user explicitly selected automatic confirmation as a
  temporary single-founder exception rather than sending from a personal Gmail
  account. `ENABLE_EMAIL_AUTOCONFIRM=true` is active on the PC; a disposable
  synthetic signup returned HTTP 200, an immediately confirmed user, and a valid
  session through both the internal gateway and the public Cloudflare route,
  after which the admin API deleted each test identity successfully.
- Automatic confirmation means the public Auth endpoint does not verify mailbox
  ownership, and password recovery remains unavailable. AUTH-SMTP-001 therefore
  blocks design-partner beta until a dedicated provider sends domain-authenticated
  confirmation and recovery mail from `no-reply@phiskel.com`, and autoconfirm is
  disabled again.
- Supabase client exceptions can contain serialized gateway response details.
  The mobile Auth screen now maps every provider failure to action-specific,
  stable copy and announces it as an accessibility alert; a focused test proves
  a serialized 504 body and endpoint URL cannot reach rendered message text.
- AUTH-PROD-001 is complete for founder account creation. AUTH-SMTP-001 owns the
  intentionally deferred production email-confirmation and recovery gate.

## 2026-08-01 — Mobile Auth keyboard accessibility

### Primary sources

- Expo, **Keyboard handling** (accessed 2026-08-01):
  https://docs.expo.dev/guides/keyboard-handling/
- React Native 0.86, **ScrollView** (accessed 2026-08-01):
  https://reactnative.dev/docs/scrollview

### Verified findings and implementation consequences

- The Auth and password-reset screens vertically centered their forms in fixed
  `View` containers. On a physical iPhone, the software keyboard covered the
  primary and secondary actions because the content had no scrolling or keyboard
  inset behavior.
- Both forms now use the repository's established input-flow pattern:
  `ScrollView` with `automaticallyAdjustKeyboardInsets`, drag-to-dismiss, handled
  child taps, and a `flexGrow` content container. Actions remain reachable by
  scrolling while the keyboard is open, and tapping them is not consumed only to
  dismiss the keyboard.
- Email return advances to the password field; the final keyboard action submits
  only when the same validation conditions as the visible button are satisfied.
  The reset-password form follows the same focus and guarded-submit behavior.
- This is a presentation-only change inside `apps/mobile`; the identity boundary,
  Auth requests, validation thresholds, and production autoconfirm exception do
  not change.

## 2026-08-01 — Founder-production migration repair

### Primary sources

- Supabase, **CLI `db push` reference** (accessed 2026-08-01):
  https://supabase.com/docs/reference/cli/supabase-db-push
- Supabase, **Self-hosting Docker deployment** (accessed 2026-08-01):
  https://supabase.com/docs/guides/self-hosting/docker

### Verified findings and implementation consequences

- The production API returned HTTP 500 for onboarding because the self-hosted
  database had no application tables; `public.goals`, `public.profiles`, and
  `public.body_measurements` were absent. The mobile generic retry message was
  therefore a symptom of missing production schema, not a goal-form validation
  defect.
- A production backup was created before mutation. Supabase CLI `db push
--dry-run` then listed all 13 pending forward migrations; the real push applied
  those migrations once, without reset or destructive rollback. The resulting
  tables were verified inside `supabase-db`, and `mizyun-api` restarted with a
  healthy `/v1/health` response.
- The published `127.0.0.1:5432` endpoint is Supavisor and requires tenant
  routing in this stack. Migration promotion used the database container's
  internal address with `PGSSLMODE=disable`; the deployment runbook must retain
  this direct-container procedure until the pooler's tenant configuration is
  corrected.

## 2026-08-05 — EU AI provider recommendation for Mizyun

### Primary sources

- Mistral AI, **Regional inference** (accessed 2026-08-05):
  https://docs.mistral.ai/studio-api/regional-inference
- Mistral AI, **Privacy and data controls** (accessed 2026-08-05):
  https://docs.mistral.ai/admin/monitor-comply/privacy-data-controls
- Mistral AI, **Organization data location** (accessed 2026-08-05):
  https://help.mistral.ai/en/articles/347629-where-do-you-store-my-data-or-my-organization-s-data
- Microsoft, **Data privacy for Azure-hosted models** (accessed 2026-08-05):
  https://learn.microsoft.com/en-us/azure/foundry/responsible-ai/openai/data-privacy
- Mistral AI, **Usage Policy** (effective 2026-06-11; accessed 2026-08-05):
  https://legal.mistral.ai/terms/usage-policy

### Verified findings and implementation consequences

- Mistral is the best near-term fit for Mizyun: the existing provider adapter,
  moderation path, structured outputs, and vision flow already target Mistral,
  while Mistral exposes an EU regional endpoint (`api.eu.mistral.ai`) whose
  inference stays within EU/EFTA data centers. Regional inference currently
  carries a documented 10% price premium and does not support all stateful
  features, which is acceptable because Mizyun owns conversation persistence.
- Mistral's API data is not used for model training by default, and its API
  privacy controls include training opt-out and zero-data-retention settings.
  Before real-user health data, the actual organization must have those controls
  enabled, the DPA/subprocessor list reviewed, and the wellness-only policy
  boundary accepted.
- Azure-hosted models are a credible enterprise fallback: regional/DataZone
  deployments can keep processing within the EU geography and Azure states that
  prompts/completions are not used to train foundation models. This would add
  Azure tenancy, procurement, and deployment complexity without improving the
  founder-alpha path enough to justify switching now.
- The provider boundary remains vendor-neutral. The implementation follow-up
  is to make the Mistral SDK clients use `server: "eu"` (or an equivalent
  server-only configuration value) for text, moderation, and vision; no mobile
  code or domain rules should depend on Mistral.
- Mistral's hosted-platform policy prohibits medical diagnoses, treatment
  suggestions, and health-related guidance, and prohibits circumventing safety
  filters. Mizyun must keep the wellness/non-medical boundary, deterministic
  safety envelope, and provider-policy gate even during founder testing.

## 2026-08-05 — Founder testing mode and Mistral vision model

- **Primary sources:** [Mistral vision documentation](https://docs.mistral.ai/studio-api/conversations/vision), [Mistral models](https://docs.mistral.ai/models), accessed 2026-08-05.
- Mistral's current vision guidance lists `mistral-medium-2508` (Mistral Medium 3.1) as a recommended vision-capable model; the previous `mistral-medium-latest` alias is retained for the text Coach until a separate text-model evaluation changes it.
- Implementation consequence: founder development and founder-production templates now enable the implemented Mistral text and nutrition/photo draft paths by default, with `MISTRAL_VISION_MODEL=mistral-medium-2508`. Keys remain server-only, and the production composition root still rejects the deterministic vision stub.
- Operational consequence: the production promotion smoke test now uses the API's existing `/v1/health` route; the former `/v1/system/status` check did not exist and could falsely roll back a healthy deployment.
- Deployment consequence: promotion compares `supabase/migrations` between the previously running and target commits. It still performs the mandatory dry-run and push for migration-bearing releases, but skips the database connection for code/documentation-only releases. This prevents a healthy code promotion from depending on an unrelated WSL-to-container bridge path when no schema work exists.
- Startup consequence: systemd can report a successful API restart before Fastify has bound port 4000. Promotion now polls the local health route for up to 15 seconds before deciding whether to roll back, instead of treating the first connection refusal as a failed release.
- Scope consequence: this is a personal founder-testing policy, not an external-release or provider-governance completion. Unimplemented integrations, consent-controlled analytics, and the remaining `docs/BEFORE_TESTING.md` gates stay explicitly out of scope.

## 2026-08-06 — Mistral function-calling message sequence

- **Primary source:** [Mistral function-calling documentation](https://docs.mistral.ai/studio-api/conversations/function-calling), accessed 2026-08-06.
- Mistral's documented tool round-trip appends the model's assistant message containing `tool_calls` before appending the matching `tool` message with `tool_call_id`; the complete ordered history is then sent for the follow-up answer.
- Production diagnostics reproduced the defect without personal data: the initial request and tool selection succeeded, while a follow-up containing only Mizyun's tool-result message was rejected as an invalid request.
- Implementation consequence: the provider-neutral request now carries the tool calls that produced each result, and the Mistral adapter replays `user -> assistant tool call -> tool result` using the SDK's camel-case input fields (`toolCalls` and `toolCallId`).
- A second synthetic production diagnostic found that SDK 1.15.1's structured `chat.parse` helper can throw a `SyntaxError` when a tool-call response also contains non-JSON assistant text, and skips array-based content chunks. The adapter now uses the official SDK's normal `chat.complete` operation with the same strict JSON-schema response format, ignores assistant content when tool calls are present, joins explicit text chunks, and validates JSON only for final answers.
- The live synthetic flow showed that leaving tools enabled after valid evidence causes `mistral-medium-latest` to place answer text in malformed follow-up function names and repeat until the tool budget is exhausted. A production-equivalent synthetic call passed when the runtime exposed tools only for initial selection, replayed the chosen call and evidence, then omitted tools from the final-answer request. The runtime now enforces that one-tool/final-answer sequence and retains its original one-round safety budget.
- Identical synthetic calls also showed occasional malformed structured completions followed by a valid response on retry. The Mistral adapter's existing one-retry allowance now covers a structurally invalid response as well as rate limiting; a second malformed response still fails closed.

## 2026-08-06 — Direction-aware Mistral health moderation

- **Primary sources:** [Mistral moderation and guardrailing](https://docs.mistral.ai/studio-api/safety-moderation), [Mistral Moderation 2 model card](https://docs.mistral.ai/models/model-cards/mistral-moderation-26-03), accessed 2026-08-06.
- Mistral defines `health` as content containing or eliciting detailed or tailored medical advice. Its documentation says verticals require different guardrailing levels and supports category-specific thresholds/selection.
- Production response metadata for the founder's 17:31 request showed that input moderation passed, confirmed grounding and generation completed, and only output moderation rejected the answer as `external_moderation_health`. No message content was read during diagnosis.
- Implementation consequence: `health` remains blocking for input, while output ignores `health` alone because personalized general fitness/nutrition wellness can overlap that broad category. The provider adapter's deterministic unsafe-output screen remains mandatory, and any other positive moderation category still blocks the response.

## 2026-08-06 — Coach failed-message retry UX

- **Primary sources:** [React Native Pressable](https://reactnative.dev/docs/pressable), [React Native accessibility](https://reactnative.dev/docs/accessibility), [Expo SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/), accessed 2026-08-06.
- React Native exposes explicit disabled and busy accessibility states for pressable controls. Expo SecureStore supports asynchronous encrypted key-value persistence suitable for Mizyun's small user-scoped retry payload.
- Implementation consequence: a failed Coach request keeps its retry-stable idempotency payload in the existing encrypted local draft store but no longer restores sent text into the controlled composer. The failed optimistic bubble owns an accessible 44-point Retry action; after app restart, a recovery alert exposes the same action if the optimistic bubble is no longer in memory.

## 2026-08-06 — Production mobile dotenv isolation incident

- **Primary sources:** [Expo environment variables](https://docs.expo.dev/guides/environment-variables/), [Expo environment variables without EAS](https://docs.expo.dev/eas/environment-variables/without-eas/), [Expo Metro configuration](https://docs.expo.dev/versions/latest/config/metro/), accessed 2026-08-06.
- Expo loads local files using standard dotenv priority and documents `EXPO_NO_DOTENV` as the switch that disables automatic loading. `EXPO_PUBLIC_*` values are inlined into the client bundle at build time.
- The first 18:33 founder Production rebuild loaded `.env.local` after the Production variant was selected. Binary inspection found only the Mac development API and Supabase endpoints in the signed Release bundle. The Production account token was therefore presented to development Auth, causing session loss and invalid-credential login behavior.
- The app was rebuilt with `.env.production` exported and `EXPO_NO_DOTENV=1`; both the preflight Hermes artifact and the signed Release bundle contained only the two production HTTPS hosts before the corrected app was relaunched.
- Implementation consequence: founder Production iOS builds now go through `scripts/mobile-founder-production-ios.sh`, which exports the reviewed Production file, disables automatic dotenv loading, validates exact public hosts/redirect URI, and refuses unexpected endpoints before invoking Expo.

## 2026-08-15 — Google OAuth authentication for mobile and Supabase

- **Primary sources:** [Supabase Auth Google OAuth](https://supabase.com/docs/guides/auth/social-login/auth-google), [Expo WebBrowser documentation](https://docs.expo.dev/versions/latest/sdk/webbrowser/), [Supabase Auth React Native Deep Linking](https://supabase.com/docs/guides/auth/native-mobile-deep-linking), accessed 2026-08-15.
- Supabase GoTrue supports Google OAuth by directing user authentication to `https://<supabase-url>/auth/v1/authorize?provider=google` and redirecting back to `options.redirectTo` (e.g. `mizyun://auth/callback` or `mizyun-dev://auth/callback`).
- With `skipBrowserRedirect: true`, `signInWithOAuth` returns the authorization URL without modifying browser location, allowing `expo-web-browser` (`WebBrowser.openAuthSessionAsync`) to manage the in-app browser session and intercept the redirect scheme cleanly on iOS (ASWebAuthenticationSession) and Android (Custom Tabs).
- Implementation consequence: `@mizyun/identity` exports `OAuthProvider`, `OAuthSignInOptions`, `OAuthSignInResult`, and supports `kind: "oauth"` in `DeepLinkPayload`; `@mizyun/adapter-supabase-mobile` implements `signInWithOAuth` on `SupabaseMobileAuthClient`; `AuthScreen` renders a clean "Continue with Google" action with proper accessibility and loading states; `supabase/config.toml` configures `[auth.external.google]`.

## 2026-08-23 — Google Identity Services Sign-In button branding compliance

- **Primary sources:** [Google Identity Branding Guidelines](https://developers.google.com/identity/branding-guidelines), [Google Sign-In Web/Mobile Button Specs](https://developers.google.com/identity/gsi/web/guides/features), accessed 2026-08-23.
- Google requires third-party sign-in buttons to strictly adhere to visual standards for the official multi-colored "G" logo (Blue `#4285F4`, Green `#34A853`, Yellow `#FBBC05`, Red `#EA4335`), standard CTA copy ("Sign in with Google", "Sign up with Google", or "Continue with Google"), appropriate typography (`#1F1F1F` dark neutral text, 14-16px, medium weight), standard light container outline (`#747775` / `#DADCE0`), and proportional icon spacing/padding.
- Implementation consequence: updated `apps/mobile/src/components/google-icon.tsx` to render the crisp official multi-color vector Google "G" logo via `expo-image`; updated `AuthScreen`'s Google Sign-In button styling (`#ffffff` background, `#747775` border, `#1f1f1f` medium text, 12px icon-to-label gap, and active pressed feedback) in strict compliance with Google branding guidelines.
