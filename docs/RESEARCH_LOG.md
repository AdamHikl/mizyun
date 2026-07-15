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

## Next required research

Before Phase 1 implementation, review and add a dated entry for:

- current Supabase CLI and local-development workflow;
- migration deployment and environment linking;
- Auth redirect/email confirmation/password recovery for Expo;
- RLS testing approaches and current Supabase test helpers;
- private Storage policy/signing behavior;
- secret/environment management for local development and CI.
