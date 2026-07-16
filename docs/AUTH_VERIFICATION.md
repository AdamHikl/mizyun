# AUTH verification — manual checklist

This document is the manual counterpart to `apps/api/src/auth.e2e.test.ts`. The e2e test exercises the same GoTrue → Mailpit → `/v1/me` round-trip programmatically; this checklist is the path that drives the iOS simulator's React Native UI and proves that the production code in `apps/mobile/src/features/auth/` does the same thing end-to-end.

Run this verification when:

- Changing the Supabase mobile adapter (`packages/adapters/supabase-mobile/`).
- Changing the auth context (`apps/mobile/src/features/auth/auth-context.tsx`).
- Changing the AuthScreen (`apps/mobile/src/features/auth/auth-screen.tsx`).
- Migrating the local Supabase config (`supabase/config.toml`).
- Switching to a hosted Supabase project for physical-device testing.

If you only changed `@mizyun/api-client` or `@mizyun/identity`, the e2e test (`AUTH_E2E_URL=... pnpm --filter @mizyun/api test`) is sufficient.

## Prerequisites

- Node.js 22.13+ and pnpm 10
- Docker Desktop with the engine running
- Xcode with the iPhone simulator (iOS 26+)
- The local Supabase CLI installed via `pnpm install` (already in `node_modules/.bin/supabase`)

## Step 0 — Boot the local stack

```bash
cd /Users/adam/Documents/mizyun
pnpm db:start
```

Wait for `Started supabase local development setup.` Capture the printed `API URL`, `ANON_KEY`, `PUBLISHABLE_KEY`, and `SERVICE_ROLE_KEY` from `pnpm db:status`.

> **Local network warning.** Per `status.md`, the local CLI/Docker Desktop combination publishes local ports on all host interfaces despite its localhost URLs. Run only on a trusted network, never with real user data, and stop the stack (`pnpm db:stop`) when finished.

## Step 1 — Configure `.env`

```bash
cp .env.example .env
# edit .env; for a local stack it should contain:
EXPO_PUBLIC_API_URL=http://127.0.0.1:4000
EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable key from pnpm db:status>
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_PUBLISHABLE_KEY=<publishable key from pnpm db:status>
SUPABASE_SECRET_KEY=<service role key from pnpm db:status>
AGENT_PROVIDER=disabled
```

`.env` is gitignored. Never commit it; never paste the secret role key into an `EXPO_PUBLIC_*` variable.

## Step 2 — Start the API

```bash
pnpm dev:api
```

The API should bind to `127.0.0.1:4000`. A misconfigured `.env` triggers `[config] <issue>` log lines and `process.exit(1)` — that's the CFG-001 surface at work.

## Step 3 — Start the mobile app

```bash
pnpm dev:mobile
```

Or, if running the production app build:

```bash
pnpm --filter @mizyun/mobile ios
```

The simulator should render the AuthSetupScreen until `.env` is fully populated.

## Step 4 — Sign up

1. In the iOS simulator, switch to "Create your space" mode.
2. Enter any email you can read at — for local development, the local Mailpit viewer at `http://127.0.0.1:54324` captures every message.
3. Enter a password (≥ 6 characters; Supabase enforces this).
4. Tap **Create account**.
5. The screen shows "Check your email to confirm your account."

Expected: the UI shows the confirmation hint and no error. The user row appears in `pnpm db:status` or by querying `psql` against the local DB.

## Step 5 — Confirm via Mailpit

1. Open `http://127.0.0.1:54324` in a browser.
2. Open the email titled "Confirm your email address".
3. Click the "Confirm email address" link. This redirects to `mizyun://auth/callback#access_token=...`.

Expected: GoTrue marks the user as `email_confirmed_at = NOW()`. The deep link lands in Expo Router; without AUTH-003 wired up, it will not navigate anywhere yet — that is fine for this verification step.

## Step 6 — Sign in

1. Back in the simulator, switch to "Welcome back" mode.
2. Enter the same email and password.
3. Tap **Sign in**.

Expected: the simulator lands on the dashboard tab. The `AuthContext` now holds a `session`, `SessionGate` renders children, and the disabled-state UI is gone.

If sign-in fails with "Invalid login credentials", step 5 didn't complete. Re-trigger the confirmation email by re-creating the user, or run the admin delete + sign-up again.

## Step 7 — Session persistence

1. In the simulator, swipe up to background the app (or press `Cmd+Shift+H` twice).
2. Force-quit via `xcrun simctl terminate booted host.exp.Exponent`.
3. Re-open via `pnpm dev:mobile` or by tapping the app icon.

Expected: the simulator lands directly on the dashboard — not on AuthScreen. The Supabase mobile adapter persists the session in SecureStore; `AuthProvider`'s `useEffect` re-reads it via `authClient.getSession()` on mount and `subscribe(...)` for in-session refresh.

## Step 8 — Sign out

1. In the dashboard, tap the user/settings affordance (this is the AUTH-002 work — for now, the sign-out path is wired through the AuthContext's `signOut()` callback. Verify it via a programmatic call to `authClient.signOut()` from the dev menu, or by reloading with the SecureStore value cleared).

When AUTH-002 lands, this step is replaced by tapping the sign-out button on the account screen.

Expected: the simulator returns to AuthScreen. The next `GET /v1/me` returns 401 because the Supabase session is gone.

## Step 9 — Bundle purity (defensive)

```bash
pnpm --filter @mizyun/mobile bundle:check
pnpm --filter @mizyun/config test -- mobile-public
```

Expected: the bundle exports; the bundle-purity vitest asserts the generated `.hbc` does not contain `SUPABASE_SECRET_KEY`, `sbp_`, or `eyJ...` JWT literals.

## Step 10 — Tear down

```bash
pnpm db:stop
```

This stops the local Docker containers. Do not leave the stack running when not actively testing — per `status.md`, the published ports are not loopback-only on this Docker Desktop setup.

## What this verifies

- `apps/mobile/src/features/auth/auth-screen.tsx` produces the right GoTrue signup/signin requests with the right shape.
- `apps/mobile/src/features/auth/auth-context.tsx` correctly subscribes to session changes and gates `SessionGate`.
- `@mizyun/adapter-supabase-mobile` stores and restores the session through Expo SecureStore's chunked storage.
- `@mizyun/api-client`'s `HttpApiClient` attaches the bearer token and normalizes 401 into `kind: "session_expired"`.
- `apps/api/src/modules/identity/routes.ts` validates the response through `meResponseSchema`.
- `@mizyun/adapter-supabase-server`'s `SupabaseAccessTokenVerifier` accepts the Supabase-issued JWT and returns the verified principal.

## What this does NOT verify (yet)

- Real email delivery (local Supabase routes everything to Mailpit).
- Hosted Supabase project integration (no project linked; this is the next segment after AUTH-002 / AUTH-003).
- Password recovery or email change flows (AUTH-003).
- Android emulator behaviour (AND-001).
