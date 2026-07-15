# ADR 0004: Validated environment composition

- Status: accepted
- Date: 2026-07-15

## Context

The Mizyun backend (`apps/api`, Fastify) and mobile app (`apps/mobile`, Expo SDK 57) composition roots read environment variables directly with ad-hoc parsing and no shared validation:

- `API_HOST` / `API_PORT` parsed inline at server startup
- `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` read in `app.ts` to choose between Supabase and rejecting token verifiers
- `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` read in `apps/mobile/src/composition/auth-client.ts` to choose between Supabase and disabled auth

This produced three problems: (1) no automatic classification of public vs. server-only environment variables — the rule that no server secret appears in an `EXPO_PUBLIC_*` value was enforced only by hand-written policy text in `docs/QUALITY_GATES.md` and `docs/BEFORE_TESTING.md`; (2) bad input (e.g. an out-of-range `API_PORT`) silently fell back to defaults, hiding operator errors; (3) composition-root code knew the literal env-var names, which would need to change in lock-step with every future environment schema change.

## Decision

Introduce a small `@mizyun/config` package that owns environment-variable validation for both apps, and replace every `process.env.*` read at the API and mobile composition roots with calls into the new loaders.

### 1. One loader package, not two app-local files

The mobile public-only allowlist is a safety rule. It must live in one place. `@mizyun/config` depends only on `@mizyun/core` (for `Result<T, E>`) and `zod` 3 (already used by `@mizyun/contracts`). Dependency direction stays inward: `apps/{api,mobile}` → `config` → `core`. No package reaches into another's internals.

`@mizyun/contracts` was rejected because it would force `process.env` into a pure-schema package imported by both apps. Inlining loaders in each app was rejected because it would duplicate the public-only enforcement.

### 2. Closed-world allowlist for mobile `EXPO_PUBLIC_*` keys

`ALLOWED_MOBILE_PUBLIC_KEYS = ["EXPO_PUBLIC_SUPABASE_URL", "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "EXPO_PUBLIC_API_URL"] as const`. The mobile loader reads only these three keys; any other key present in the snapshot is reported as `ConfigIssue { kind: "unexpected" }`. Two failure modes are caught:

- An `EXPO_PUBLIC_*` key the loader does not know (defense against an operator pasting a new public var they expect the bundle to ignore).
- A non-`EXPO_PUBLIC_*` key, including `SUPABASE_SECRET_KEY` (defense against a contributor mistakenly passing the wrong env snapshot to a test or build).

The closed-world rule is exercised at multiple layers: the typed `const` tuple, a vitest invariant asserting every entry starts with `EXPO_PUBLIC_`, a vitest test that surfaces unknown keys as `unexpected`, and an opt-in bundle scan that asserts the generated Hermes bytecode does not contain server-secret prefixes.

### 3. `Result<Config, readonly ConfigIssue[]>` from `@mizyun/core`'s `Result`

`loadServerConfig()` and `loadMobileConfig()` return `Result<ServerConfig, readonly ConfigIssue[]>` (or the mobile equivalent). The list is `readonly` so consumers cannot accidentally mutate it; one shape (`ConfigIssue` with `kind: "missing" | "malformed" | "unexpected" | "out_of_range"`) covers every failure mode. Throwing is rejected because a single malformed value should not preempt reporting other issues and because UI surfaces need the per-key list to render actionable copy.

The error envelope is composed with the existing `@mizyun/identity` `AuthConfigurationStatus` discriminated union: `Config.supabase: AuthConfigurationStatus` carries `configured: false | true` plus `provider` and (when relevant) `reason`. The same data shape is reused unchanged by `AuthSetupScreen`, so the documented safe disabled state renders identically.

### 4. Two schemas, one transform — composition roots never see raw env

The server loader uses `baseServerSchema.transform(...)` to compute the final `ServerConfig` from raw env, including the asymmetry check on the Supabase URL/key pair. The composition root receives `{ env, host, port, supabase, supabaseConfig, agentProvider }`; it does not read `process.env` after `loadServerConfig()` returns `ok`. The same rule applies for the mobile loader: `MobileConfig.supabaseConfig` carries the typed `{ url, publishableKey }` pair when configured.

Three server-key categories are modelled:

| Category                        | Examples                                                                                                     | Missing                                       | Malformed             |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------- | --------------------- |
| Required-with-default           | `API_HOST` (`127.0.0.1`), `API_PORT` (`4000`), `NODE_ENV` (`"development"`), `AGENT_PROVIDER` (`"disabled"`) | Schema default fills it                       | `err([out_of_range])` |
| Required-or-absent pair         | `SUPABASE_URL` + `SUPABASE_PUBLISHABLE_KEY`                                                                  | `ok({ supabase: configured: false, reason })` | `err([malformed])`    |
| Future required-when-feature-on | `SUPABASE_SECRET_KEY` iff `AGENT_PROVIDER !== "disabled"`                                                    | Deferred to Phase 7                           | —                     |

The loader is pure: it reads `process.env` only when no `env` argument is passed, and never calls `process.exit`. The composition root owns process lifecycle.

### 5. Phase 7 placeholder

`SUPABASE_SECRET_KEY` and the `AGENT_PROVIDER !== "disabled"` runtime path are explicitly out of CFG-001. The loader must not pre-shape that branch; introducing a stub now would be speculative.

### 6. No new secret-detection code paths in app composition roots

The API and mobile composition roots call the loader, then read typed fields. No string-prefix checks for `sbp_`, `eyJ`, etc. exist in app code. The bundle-purity invariant is asserted by a focused test in `@mizyun/config` that reads the generated Hermes bytecode after `pnpm --filter @mizyun/mobile bundle:check`.

## Sources consulted

- Expo SDK 57 environment variables & Metro: https://docs.expo.dev/versions/v57.0.0/config/metro/
- Zod 3 `.transform`, `.superRefine`, `safeParse`: https://zod.dev/
- Fastify host / port conventions: https://fastify.dev/docs/latest/Reference/Server/
- Node.js process.env semantics: https://nodejs.org/api/process.html#processenv

## Consequences

- One validated configuration entrypoint is shared by API and mobile; adding an env var is a one-file change with type-checked ripple effects.
- The mobile `EXPO_PUBLIC_*` allowlist is closed-world; new public vars require an explicit tuple append.
- The server can fail fast at startup with a typed list of bad values instead of silently substituting defaults.
- Tests for missing / malformed / public / server-only classification are colocated in `packages/config/src/` and run as part of the standard gate.
- The bundle-purity invariant runs automatically after `pnpm --filter @mizyun/mobile bundle:check` produces the artifact; cold checkouts skip with a clear warning.
- `apps/api` now uses `moduleResolution: "Bundler"` for its typecheck (matching `@mizyun/config` and `@mizyun/adapter-supabase-mobile`); `tsx` continues to run the API because it understands both resolution modes.
