# ADR 0005: Provider-neutral authenticated transport

- Status: accepted
- Date: 2026-07-15

## Context

The Mizyun backend (`apps/api`, Fastify) and mobile app (`apps/mobile`, Expo SDK 57) have an authenticated identity boundary (ADR-0002) and a validated environment composition (ADR-0004), but no shared transport seam. The mobile app currently has zero `fetch` calls; feature code cannot reach the API without a per-screen hand-rolled client that re-implements token attachment, 401 handling, and response validation.

The intended outcome of API-001 is *Tokens attach/refresh; 401 and network errors normalize.* Beyond that, the architecture rules in `AGENTS.md` and `ARCHITECTURE.md` require the seam to be replaceable: a future web client (or different auth source) must swap in without changing feature code.

## Decision

Introduce a small `@mizyun/api-client` package that owns the typed `ApiClient` interface and a `fetch`-backed `HttpApiClient`. The mobile composition root selects the right concrete implementation based on `loadMobileConfig().apiUrl`.

### 1. New `@mizyun/api-client` package, not an app-local file

`@mizyun/api-client` depends on `@mizyun/core` (for `Result`), `@mizyun/identity` (for `AuthClient`), `@mizyun/contracts` (for response schemas), and `zod` (already an explicit dep of `@mizyun/contracts`). It does not import React, Supabase, or `process.env`. The package boundary mirrors `@mizyun/identity`, `@mizyun/contracts`, and `@mizyun/config`: apps depend on the package, the package depends only on the leaf libraries.

Inlining the client in `apps/mobile/src/composition/api-client.ts` would duplicate the typed error envelope across the eventual web client and would push the discriminator logic into a file that is not part of any test surface. Putting the loader in `@mizyun/config` would conflate transport with env composition (ADR-0004).

### 2. `Result<T, ApiError>` return type with discriminated-union envelope

`request()` returns `Promise<Result<T, ApiError>>` instead of throwing. The `ApiError` union has seven variants: `not_configured`, `no_session`, `session_expired`, `http_error`, `validation_error`, `parse_error`, `network_error`. Throwing (the pattern in `IdentityError`) is wrong for RPC calls because feature code wants to `switch (error.kind)` instead of guarding every call with try/catch.

The discriminated union mirrors `AuthConfigurationStatus` and `AgentProviderStatus` so feature code can switch on `kind` without reading human-readable strings. The same shape carries the disabled-client state (`kind: "not_configured"`), the unauthenticated state (`kind: "no_session"`), and the server-rejected state (`kind: "session_expired"`), so a feature render path uses one switch statement for all three failure modes.

### 3. `authClient.getSession()` per request — no client-side token cache

The bearer token is read on every request via `await authClient.getSession()`. The Supabase mobile adapter handles `autoRefreshToken: true` internally and persists the refreshed token in SecureStore, so `getSession()` returns the freshest token without a network round-trip. The client does not mirror `authClient.subscribe` because that would create a second source of truth that drifts the moment Supabase refreshes out-of-band.

### 4. Auto-signOut on 401; no auto-retry

A 401 response fires `void authClient.signOut()` (fire-and-forget) and surfaces `kind: "session_expired"`. The sign-out is intentional: a server-rejected token must not be reused, and the existing `AuthContext` flips the UI to the sign-in screen via its `subscribe(...)` path. No retry is attempted — `QUALITY_GATES.md` forbids silent duplicates and partial authority.

The client never sets a default timeout. Callers control cancellation by passing `AbortController.signal` via `RequestOptions.signal`. `AbortError` is mapped to `kind: "network_error"` with the cause preserved.

### 5. Two schemas, one transform — composition roots never see raw env

`MobileConfig.apiUrl` arrives via `loadMobileConfig()` (CFG-001). The composition root reads `apiUrl` and either constructs `HttpApiClient` (when `apiUrl` is non-null) or `DisabledApiClient` (when it is null). The disabled client returns `{ kind: "not_configured", reason }` from every `request()` call; it never invokes `fetch` or `authClient`. This mirrors `DisabledAuthClient` so feature code has one render path for both disabled states.

### 6. Server-side contract enforcement for `/v1/me`

`apps/api/src/modules/identity/routes.ts` parses its response through `meResponseSchema` (a new Zod schema in `@mizyun/contracts`) so the wire shape is enforced at the producer. The schema is decoupled from `@mizyun/identity`'s runtime `AuthPrincipal` interface, so future drift in either side is caught by the parser rather than surfacing as a silent shape change for a downstream mobile consumer.

## Sources consulted

- Expo SDK 57 testing and bundling guidance: https://docs.expo.dev/guides/testing-unit-tests/
- WHATWG Fetch + AbortController: https://developer.mozilla.org/en-US/docs/Web/API/AbortController
- Zod 3 `safeParse` and `ZodIssue` shape: https://zod.dev/
- React Native `fetch` polyfills (`@react-native/js-polyfills` 0.86.0, `react-native-url-polyfill` 2.0.0): https://reactnative.dev/docs/network

## Consequences

- One typed transport seam is shared by mobile (today) and web (later). Adding a route is a one-line `request()` call with an optional schema.
- The mobile composition root has a single switch over `apiConfiguration.configured` to render the disabled state, matching the pattern already used for auth.
- Bundle-purity invariant from ADR-0004 still holds: the new package does not introduce any new `EXPO_PUBLIC_*` keys, so the Hermes bundle scan continues to assert no server secret literals.
- Mobile tests now run via vitest with stub modules for `react-native`, `expo-secure-store`, and `react-native-url-polyfill/auto`. The vitest config lives at `apps/mobile/vitest.config.ts`; the stubs live under `apps/mobile/vitest/`.
- Total tests across the workspace grew from 56 to 93 (37 new): 26 in `@mizyun/api-client`, 7 in `@mizyun/contracts`, 4 in `apps/mobile/src/composition/`.