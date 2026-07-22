# Local Supabase and API

Mizyun uses the pinned Supabase CLI plus Docker as its canonical local persistence, Auth, RLS, and private Storage environment. [`ADR-0003`](../adr/0003-local-first-supabase-development.md) owns that decision.

## Prerequisites

- Docker Desktop is installed and its engine is running.
- Root dependencies are installed with `pnpm install`.
- `.env` exists at the repository root and is gitignored.
- AI remains disabled: `AGENT_PROVIDER=disabled`.

Check Docker without mutating project state:

```bash
docker info
```

## One-time `.env` setup

```bash
cp .env.example .env
pnpm db:start
pnpm db:status
```

Edit `.env` locally. Use the values reported by `pnpm db:status`:

```dotenv
NODE_ENV=development
API_HOST=127.0.0.1
API_PORT=4000

EXPO_PUBLIC_API_URL=http://127.0.0.1:4000
EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<local publishable key>

SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_PUBLISHABLE_KEY=<local publishable key>
SUPABASE_SECRET_KEY=<local service-role key>

AGENT_PROVIDER=disabled
```

The service-role value is server-only. Never copy it into any public variable or mobile-only env file.

## Start and verify the stack

```bash
pnpm db:start
pnpm db:status
```

Useful local endpoints:

| Service                   | URL                      |
| ------------------------- | ------------------------ |
| Supabase API/Auth/Storage | `http://127.0.0.1:54321` |
| Supabase Studio           | `http://127.0.0.1:54323` |
| Mailpit                   | `http://127.0.0.1:54324` |
| Mizyun API                | `http://127.0.0.1:4000`  |

Start the application API in another terminal:

```bash
pnpm dev:api
```

If the API exits with `[config] ...`, compare `.env` with `.env.example` and the current `pnpm db:status` output. Do not “fix” configuration by hardcoding a key in source.

## Database reproducibility gate

```bash
pnpm db:verify
```

This intentionally resets the local database, reapplies every migration, runs database lint, and executes pgTAP. It destroys local development rows. Never point this command at a hosted or production database.

The last proven result was a clean reset, no lint errors, and 55 pgTAP assertions.

## Opt-in real-Supabase API tests

Create the ignored test environment once:

```bash
cp apps/api/.env.test.example apps/api/.env.test
```

Populate it from `pnpm db:status`. It contains local keys and must remain uncommitted.

Auth e2e reads this file through `apps/api/vitest.config.ts`:

```bash
pnpm --filter @mizyun/api test src/auth.e2e.test.ts
```

The persistence suite uses `SUPABASE_E2E_*` names. Source the ignored file and map the values without printing them:

```bash
set -a
source apps/api/.env.test
set +a
SUPABASE_E2E_URL="$SUPABASE_URL" \
SUPABASE_E2E_PUBLISHABLE="$SUPABASE_PUBLISHABLE_KEY" \
SUPABASE_E2E_SERVICE="$SUPABASE_SERVICE_ROLE_KEY" \
pnpm --filter @mizyun/api test src/persistence.e2e.test.ts
```

Both suites create synthetic users and include cleanup when the local service-role key is present.

## Reset and teardown

Reset local data from migrations:

```bash
pnpm db:reset
```

Stop containers while preserving Docker volumes:

```bash
pnpm db:stop
```

The current Docker Desktop setup has previously published Supabase ports on non-loopback host interfaces even though the CLI reports localhost URLs. Treat the stack as trusted-network-only and stop it whenever it is not in active use.

## Fast diagnosis

### `pnpm db:start` cannot reach Docker

1. Run `docker info`.
2. Start Docker Desktop if the engine is unavailable.
3. Retry `pnpm db:start`.

### A migration or pgTAP test fails

Read the first failing migration/test, fix the committed source, then rerun `pnpm db:verify`. Do not patch the live local schema through Studio and treat that as the fix.

### Native app signs in but API calls fail

1. Confirm `pnpm dev:api` is listening on port 4000.
2. Confirm the mobile bundle was built with the correct platform URL.
3. iOS Simulator can use `127.0.0.1`; Android needs `10.0.2.2` or an ADB reverse tunnel. See the platform runbooks.

### Photos fail only on Android

Supabase local signed Storage URLs use `127.0.0.1`. Add the Storage reverse tunnel documented in [Android emulator](./ANDROID_EMULATOR.md).
