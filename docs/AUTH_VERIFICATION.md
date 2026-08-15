# AUTH verification — manual checklist

This document is the manual counterpart to `apps/api/src/auth.e2e.test.ts`. The e2e test exercises the same GoTrue → Mailpit → `/v1/me` round-trip programmatically; this checklist is the path that drives the iOS simulator's React Native UI and proves that the production code in `apps/mobile/src/features/auth/` does the same thing end-to-end.

For host setup, Release builds, simulator commands, and recurring failures, use the [`docs/tutorials` memory wiki](./tutorials/README.md). This page owns the Auth behavior checklist only.

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
3. Click the "Confirm email address" link. This redirects GoTrue's `/auth/v1/verify?type=signup&token=...` endpoint, which then 303-redirects to `mizyun://auth/callback#access_token=...&type=signup`.

Expected: GoTrue marks the user as `email_confirmed_at = NOW()`. The deep link reaches the mobile app via the top-level `DeepLinkBridge` in `_layout.tsx`, the `parseDeepLinkFragment` helper in `@mizyun/identity` parses the URL fragment, and `authClient.consumeDeepLink` calls `supabase.auth.setSession`. The AuthContext subscription fires `SIGNED_IN`; the SessionGate swaps the AuthScreen for the regular tabs.

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

1. In the simulator, switch to the new **Account** tab (the third tab in the bottom bar; the gear icon).
2. The card at the top shows the verified principal loaded from `/v1/me` through the real `HttpApiClient` (proves the bearer-token round-trip in the rendered UI, not just in the e2e test).
3. Tap **Sign out** in the second card.

Expected: the simulator returns to AuthScreen. The next `GET /v1/me` returns 401 because the Supabase session is gone. The card on the Account tab surfaces `SESSION EXPIRED` if you navigate back after sign-out (or any protected call from feature code).

## Step 9 — Password recovery

1. From the AuthScreen, tap **Forgot password?**.
2. Enter the email of an existing account.
3. Tap **Send reset link**.

Expected: the screen shows "If an account exists for this email, a reset link is on its way." (no enumeration). GoTrue queues a recovery email to Mailpit.

## Step 10 — Reset the password

1. Open `http://127.0.0.1:54324` in a browser.
2. Open the email titled "Reset your password".
3. Click the "Reset password" link. GoTrue 303-redirects to `mizyun://auth/callback#access_token=...&type=recovery`.
4. The mobile app receives the link. `parseDeepLinkFragment` returns `kind: "recovery"`. The AuthContext sets `recoveryState = true` and the SessionGate shows the ResetPasswordScreen.
5. Enter a new password (≥ 8 characters), confirm, and tap **Save new password**.

Expected: `authClient.updatePassword({ password })` succeeds. The SessionGate falls back to rendering the regular tabs. Sign out and sign back in with the new password to prove rotation landed.

## Step 11 — Google OAuth sign-in / sign-up

### 1. Google Cloud Console setup

1. Open [Google Cloud Console](https://console.cloud.google.com/) -> APIs & Services -> Credentials.
2. Configure the OAuth Consent Screen (User Type: External / Internal, Scopes: `.../auth/userinfo.email`, `.../auth/userinfo.profile`, `openid`).
3. Create an **OAuth 2.0 Client ID** (Application type: **Web application**).
4. Add **Authorized JavaScript origins**:
   - Production: `https://mizyun-supabase.phiskel.com`
   - Local Dev: `http://127.0.0.1:54321`
5. Add **Authorized redirect URIs**:
   - Production: `https://mizyun-supabase.phiskel.com/auth/v1/callback`
   - Local Dev: `http://127.0.0.1:54321/auth/v1/callback`
6. Copy the **Client ID** and **Client Secret**.

### 2. Environment configuration

- **Local Dev**: In `.env` or shell:
  ```dotenv
  SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=<google-client-id>
  SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET=<google-client-secret>
  ```
- **Self-Hosted Production (Raspberry Pi / Windows PC)**: In `/srv/mizyun/supabase/.env` or `/etc/mizyun/production.env`:
  ```dotenv
  GOTRUE_EXTERNAL_GOOGLE_ENABLED=true
  GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID=<google-client-id>
  GOTRUE_EXTERNAL_GOOGLE_SECRET=<google-client-secret>
  GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI=https://mizyun-supabase.phiskel.com/auth/v1/callback
  ```
  Restart Supabase (`sudo systemctl restart mizyun-supabase` or `cd /srv/mizyun/supabase && sh run.sh restart`).

### 3. Verification

1. Launch the mobile app.
2. On `AuthScreen`, tap **Continue with Google**.
3. The in-app browser (`expo-web-browser`) opens the Google consent screen.
4. Sign in with your Google account.
5. Google redirects to Supabase `/auth/v1/callback` -> Supabase redirects to `mizyun://auth/callback#access_token=...&refresh_token=...`.
6. Expected: The browser closes automatically, the session is consumed, and the user lands on the app dashboard.

## Step 12 — Bundle purity (defensive)

```bash
pnpm --filter @mizyun/mobile bundle:check
pnpm --filter @mizyun/config test -- mobile-public
```

Expected: the bundle exports; the bundle-purity vitest asserts the generated `.hbc` does not contain `SUPABASE_SECRET_KEY`, `sbp_`, or `eyJ...` JWT literals.

## Step 13 — Tear down

```bash
pnpm db:stop
```

This stops the local Docker containers. Do not leave the stack running when not actively testing — per `status.md`, the published ports are not loopback-only on this Docker Desktop setup.

## What this verifies

- `apps/mobile/src/features/auth/auth-screen.tsx` produces the right GoTrue signup/signin/OAuth requests with the right shape.
- `apps/mobile/src/features/auth/auth-context.tsx` correctly subscribes to session changes and gates `SessionGate`.
- `@mizyun/adapter-supabase-mobile` stores and restores the session through Expo SecureStore's chunked storage.
- `@mizyun/api-client`'s `HttpApiClient` attaches the bearer token and normalizes 401 into `kind: "session_expired"`.
- `apps/api/src/modules/identity/routes.ts` validates the response through `meResponseSchema`.
- `@mizyun/adapter-supabase-server`'s `SupabaseAccessTokenVerifier` accepts the Supabase-issued JWT and returns the verified principal.

## What this does NOT verify (yet)

- Real email delivery (local Supabase routes everything to Mailpit).
- Hosted Supabase project integration (no project linked; this is the next segment after AUTH-002 / AUTH-003).
- Email-change behavior against a real provider.
- Android UI behavior; AND-001 has separate standalone Android sign-in/session evidence in [`status.md`](../status.md) and the [Android runbook](./tutorials/ANDROID_EMULATOR.md).
