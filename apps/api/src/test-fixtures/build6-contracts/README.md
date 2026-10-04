# Pinned original build6 contract fixtures

These first-party Mizyun schemas come from the actual Android build6 source commit `3c20835953737604bdb03567e519b13c0823df5b`. Each original source module was also compared byte-for-byte with iOS build6 commit `9d50538471447880b6088be03f64db90db7a07fb` during extraction; all eight matched.

The fixtures retain the original selected response/request schema declarations and their transitive schema dependencies. They do not import the current contract schemas or their reconstructed legacy aliases. `provenance.json` records original complete-module SHA-256 checksums, original declaration names/line ranges/checksums, and checksums of the executable snapshots. The compatibility test pins the manifest checksum and checks every executable snapshot plus the Zod resolver.

Extraction used the TypeScript syntax tree to select schema declarations and follow local identifiers and relative schema imports. TypeScript `transpileModule` with target ES2022 and module ESNext removed type-only declarations. Relative runtime imports gained `.mjs` extensions; the original Zod import was redirected to `zod-runtime.mjs`; Prettier formatted the generated result. Schema expressions, refinements, enum catalogs, and defaults are the original implementation. Declaration files describe only the test-facing parser interface; executable schema validation remains the original Zod code.

`zod-runtime.mjs` resolves Zod from the installed `@mizyun/contracts` package dependency without importing current schemas. This avoids adding a new API runtime dependency. The tests run in a fresh checkout and do not require historical Git objects or network access.

Keep these fixtures frozen. A newer supported client requires a separate pinned fixture, rather than editing the build6 snapshots to make a regression pass. To independently audit a declaration, read its historical source path at either recorded commit and compare the recorded line range and SHA-256 before applying the documented transpilation/import/formatting steps.

Run `pnpm --filter @mizyun/api test apps/api/src/release-compatibility.test.ts` from the repository root. Fastify injection exercises the current real handlers with synthetic data, in-memory repositories and a fake Coach provider. This establishes API wire/schema compatibility; it does not establish Supabase/RLS behavior, physical-device behavior, Store acceptance, or installed build6 acceptance against Production.
