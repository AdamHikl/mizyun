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
