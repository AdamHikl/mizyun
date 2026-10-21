# Pinned build-9 Store contract fixtures

These schemas come from `dd5b435385b379d8c0df1b69813f8d8fdd3d985a`, the source of the installed Store build 1.0.9 (9). That build sends no `x-mizyun-api-compat` header, so the API treats its requests as legacy.

Extraction used the TypeScript syntax tree to select the named root schemas (account export, AI consent, account deletion, goals, Community feed and owner cards) plus their transitive local declarations and relative runtime imports. TypeScript `transpileModule` (ES2022, ESNext) removed types, relative imports gained `.mjs`, Zod resolves through `zod-runtime.mjs` (identical to the build6 fixture), and Prettier formatted the result. Goal declarations from `packages/contracts/src/index.ts` are written to `goal.mjs`. `provenance.json` records each source module checksum, the selected declaration line ranges and checksums, and each snapshot checksum; the compatibility test pins the manifest.

Keep these fixtures frozen. Run `pnpm --filter @mizyun/api test src/release-compatibility.test.ts`. The tests prove API wire/schema compatibility with in-memory repositories and a fake Supabase client for the account export; they do not prove Supabase/RLS behaviour, device behaviour or installed-build acceptance against Production.
