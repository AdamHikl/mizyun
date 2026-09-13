# Mizyun current status

## Latest handoff — Product analytics backend implemented & verified (`OBS-002`, 2026-09-13)

- Implemented the first-party product analytics backend (`OBS-002`) following [the architecture, privacy rules, and staged implementation plan](docs/PRODUCT_ANALYTICS_IMPLEMENTATION_PLAN_2026-09-13.md), incorporating the user's specific disclosure update: removed legacy copy claiming data stays on device; updated disclosures in both Onboarding and Settings to state that coarse telemetry is sent to Mizyun's servers to improve app UI/experience, linked to the user account with full export and erasure rights.
- **Database & RLS** (`supabase/migrations/20260913100000_product_analytics_backend.sql`):
  - Created `product_analytics_consents` and `product_analytics_events` with strict RLS (`user_id = auth.uid()`), `on delete cascade` referencing `auth.users(id)`, and direct client writes revoked (`GRANT SELECT ON ... TO authenticated`).
  - Implemented transactional SECURITY DEFINER RPCs: `record_product_analytics_events` (acquires `FOR UPDATE` lock on consent, verifies active epoch and consent granted), `update_product_analytics_consent` (increments revision, generates new epoch on re-grant or revoke, cascades event deletion on revoke), `clear_product_analytics_events` (deletes user events, rotates epoch, increments revision), and `cleanup_expired_product_analytics` (prunes events older than 90-day retention).
- **Contracts & Domain** (`packages/contracts`, `packages/core`):
  - Defined strict discriminated union `analyticsEventV2Schema` for version 2 events with UUIDs, session tracking, sequential numbering, and strict closed property sets. Explicitly rejects food names, nutrient values, health metrics, free-form text, and auth tokens.
  - Defined transport schemas: `analyticsConsentRequestSchema`, `analyticsConsentResponseSchema`, `analyticsBatchIngestRequestSchema` (max 50 events), `analyticsBatchIngestResponseSchema`, `analyticsClearRequestSchema`, `analyticsClearResponseSchema`, and `analyticsEventsListResponseSchema`.
  - Added `productAnalyticsEvents` to `ExportManifest.counts` and `productAnalytics` to `AccountExport`.
- **API & Adapters** (`apps/api`, `packages/adapters/supabase-server`):
  - Added `GET /v1/analytics/consent`, `PUT /v1/analytics/consent`, `POST /v1/analytics/events` (with 32KB payload limit, clock skew checks < 5m future and < 72h past), `DELETE /v1/analytics/events`, and `GET /v1/analytics/events`.
  - Wired `ProductAnalyticsRepository` into `apps/api` composition root and in-memory adapter; wired analytics data into `exportForUser` and `deleteForUser`.
  - Enforced strict 30-day read-time retention filtering across server repository queries, in-memory repository, mobile client export, and local event store reads.
- **Mobile Integration** (`apps/mobile`):
  - Implemented `NetworkAnalyticsClient` with offline queue (up to 500 events), session tracking with 30m inactivity timeouts, optimistic pending denial retries, and batch flushing.
  - Updated `AnalyticsConsentPrompt` on Onboarding and `AnalyticsCard` on Settings with truthful server disclosure copy. Enabled Export and Clear buttons based on active consent status.
  - Integrated with central `AuthProvider` (`auth-context.tsx`): resets local session and clears queue on logout, expiry, account switch, or preview mode; syncs consent on valid session.
  - Adopted a 30-minute inactivity boundary in `_layout.tsx` before emitting `app_session_started` on foreground returns.
- **Operator Tooling & Navigation**:
  - Implemented `scripts/product-analytics.mjs` and npm script `pnpm analytics` (`summary`, `features`, `navigation`, `flows`, `retention`) using secure stdin-fed `psql` transactions and `--json` support. Includes ordered 24h activation tracking and matured D1/D7 cohort retention. Added 10 unit tests in `scripts/product-analytics.test.mjs`.
  - Added `docs/adr/0026-first-party-product-analytics-backend.md` and updated `docs/RESEARCH_LOG.md`.
  - Registered all paths in `docs/feature-map.json`; `pnpm navigation:check` passes (0 errors).
- **Independent Security & Privacy Review**:
  - Non-author security subagent certified CONDITIONAL APPROVAL; all recommendations (safe local session reset on sign-out, settings UI button enablement, in-memory deletion cascade) implemented and verified.
  - Independent plan auditor completed item-by-item verification against `docs/PRODUCT_ANALYTICS_IMPLEMENTATION_PLAN_2026-09-13.md`.
- **Verification**:
  - Full `pnpm check` passed cleanly (exit 0): 44 mobile test files (403 tests), 34 API test files (498 tests), 73 contract tests, 258 core tests, 76 supabase-server tests, 10 CLI unit tests, iOS and Android Hermes bundle checks, 23 deployment safeguards, 16 build matrix checks, and 56 AI invariants.
  - Prettier formatting 100% clean (`pnpm format:check`).
- **Next exact action**: Deploy migration and API to Dev on the Raspberry Pi via `pnpm deploy:dev`, then verify consent grant, event tracking, and settings export/clear on the physical Dev iPhone build (`com.mizyun.development`).

## Prior handoff — Cross-Environment Beta Pro Pass Request Triage CLI (`BETA-PRO-001`, 2026-09-12)

- Implemented `scripts/check-beta-pro-requests.mjs` and npm scripts `pnpm beta-pro` / `pnpm beta-pro:check` to inspect pending requests for the Beta Pro Pass across both Dev (`mizyun-dev-db`) and Production (`supabase-db`) databases side-by-side on the Raspberry Pi host (`rpserver`).
- Formats requests with user email, UUIDs, submitted/relative time, plan tier, push token status, and user notes. Supports `--env <dev|prod|both>`, `--status <pending|approved|rejected|all>`, `--all`, and machine-readable `--json`.
- Supports actionable admin triage: `--approve <email|id>` and `--reject <email|id>`, which update `public.beta_pro_requests`, trigger PostgreSQL `trg_beta_pro_approval` to elevate/revert `profiles.plan_tier = 'paid'`, and dispatch Expo push notifications (`https://exp.host/--/api/v2/push/send`) when device tokens are present.
- Security & Resilience: Query execution feeds SQL via `stdin` to `docker exec -i ... psql`, eliminating remote shell expansion ($VAR, command substitution) and quote escaping risks. Configured `ConnectTimeout=10` and 30-second process timeouts. Added error isolation so queries continue even if an environment is down. Added `.agents/skills/check-beta-pro-requests/SKILL.md` and registered paths in `docs/feature-map.json`.
- Independent subagent code & security review certified CONDITIONAL APPROVE; high-severity remote shell expansion and resilience recommendations were implemented and verified.
- Live probe & execution evidence: Dev pending request for `adam.hikl@outlook.com` was successfully approved via `node scripts/check-beta-pro-requests.mjs --approve adam.hikl@outlook.com --env dev`; PostgreSQL trigger `trg_beta_pro_approval` fired and upgraded `profiles.plan_tier` to `'paid'`. Dev and Production now both show 0 pending requests.
- Resolved Profile Tier Wire Serialization Defect: Root-caused why Settings header showed "Free Plan": `toWire` in `apps/api/src/modules/profile/routes.ts` omitted `planTier: stored.planTier`, falling back to Zod `.default("free")`; added `planTier` to `toWire` with regression test in `routes.test.ts` (21/21 passing); added `refreshProfile()` on mount in `apps/mobile/src/features/settings/settings-screen.tsx`.
- Apple APNs Push Notifications Enabled: Configured `APPLE_PUSH_KEY_ID=HJX42YKP78` and `APPLE_PRIVATE_KEY_PUSH_NOTIFICATIONS` in `.env`. Verified direct HTTP/2 APNs gateway authentication live against Apple (`api.sandbox.push.apple.com:443` for `com.mizyun.development` and `api.push.apple.com:443` for `com.mizyun.app`).
- Push Enabled Across Environments: Removed unconditional Dev push disablement in `apps/mobile/app.config.js`; enabled push by default in both `scripts/mobile-founder-dev-ios.sh` and `scripts/mobile-founder-production-ios.sh` (`MIZYUN_IOS_DISABLE_PUSH="${MIZYUN_IOS_DISABLE_PUSH:-0}"`); added native APNs token fallback (`Notifications.getDevicePushTokenAsync()`) in `apps/mobile/src/features/beta-pro/beta-pro-client.ts`; added direct Apple HTTP/2 APNs dispatching to `scripts/check-beta-pro-requests.mjs`.
- Verification: Full `pnpm check` and `pnpm typecheck` passed cleanly across all 15 workspace packages (exit 0).
- **Next exact action**: Run `pnpm mobile:founder-dev:ios:prebuild` and `pnpm mobile:founder-dev:ios` to compile with the `aps-environment` entitlement and prompt for iOS push permissions on device.

## Prior handoff — Launcher-matched startup screen (`BRAND-ICON-001`, 2026-09-12)

- Replaced both sources of the brief legacy blue/A startup screen: the native `expo-splash-screen` plugin and the React Native animated handoff overlay now use the approved `mizyun-icon.png` launcher artwork. The overlay renders it at 128 x 128 with app-icon-style rounded corners; the native plugin uses the same 128-point contained asset on the existing blue background.
- Current Expo SDK 57 guidance confirms the config-plugin image may be the app icon or logo and that native splash changes require a rebuilt binary. Dev and Production config evaluation both resolve the launcher and splash to the same asset. An independent read-only audit confirmed both legacy launch surfaces are replaced and found no blocking issue.
- Verification: full `pnpm check` passed on the combined worktree, including 43 mobile test files / 398 tests, 486 API tests with 15 credential-gated E2E tests skipped, iOS and Android Hermes bundles, 23 deployment safeguards, the build matrix, and 56 AI invariants. `git diff --check` passed; the 12 existing navigation review-age warnings remain non-blocking.
- Implementation is complete in source. Native regeneration/rebuild, physical-device cold-start acceptance, deployment, and Production release have not been performed.
- **Next exact action**: run the Dev native prebuild, rebuild/install `com.mizyun.development`, force-quit it, and verify repeated iPhone cold starts show the ribbon-M app icon continuously until Home appears; repeat on an Android release build before closing `BRAND-ICON-001`.

## Latest handoff — Mizyun email subdomain namespace (`AUTH-SMTP-001`, 2026-09-12)

- Moved every tracked company email address into the `@mizyun.phiskel.com` namespace, including public support/privacy/legal/deletion links, the default SES and GoTrue sender, transactional Reply-To examples, the planned App Store reviewer login, tests, and operational documentation.
- Kept API/Supabase hostnames, the verified SES identity `phiskel.com`, and the custom MAIL FROM domain `mail.phiskel.com` unchanged. Current AWS documentation confirms a verified domain identity authorizes subdomain senders; any narrower IAM `ses:FromAddress` condition still requires explicit verification or update.
- Recorded the separate Cloudflare requirement: inbound delivery for `support@mizyun.phiskel.com` requires onboarding the `mizyun.phiskel.com` Email Routing subdomain and creating a route to a verified destination. The SES `mail.phiskel.com` MX handles bounces and does not create a support mailbox.
- Source implementation and documentation are updated. Focused legal/config/core/SES tests passed (61 tests), and full `pnpm check` passed with 12 existing navigation review-age warnings; 15 credential-gated API E2E tests remained skipped. Independent read-only review approved the integrated diff with no findings. External Cloudflare/AWS/GoTrue configuration, live delivery acceptance, deployment, and device acceptance have not been performed.
- **Next exact action**: Enable Cloudflare Email Routing for `mizyun.phiskel.com`, route `support` (and optionally `appstore-review`) to a verified monitored inbox, verify the SES IAM sender condition, then configure GoTrue SMTP and run confirmation/recovery plus Reply-To delivery tests.

## Latest handoff — Search Meal History in the Meals Tab (`MEAL-UX-004`, 2026-09-12)

- Added an accessible, controlled search field to `MealListScreen`; results update immediately from the existing bounded local meal-history cache without a network request per keystroke.
- Search matches meal names and user-facing saved detail strings (including notes, descriptions, brands, ingredients, warnings, and assumptions) case-insensitively while excluding hidden AI provider/model/proposal metadata.
- Search preserves day-group and entry order, removes empty day groups, and recalculates each visible day's calorie and macro totals from its matched meals.
- Added match/day counts with polite screen-reader announcements, an accessible clear action, keyboard dismissal behavior, and a distinct no-results state. Existing edit, copy-to-today, and delete actions remain available on matched meals.
- Added `meal-history-filter.ts` with 6 regression tests covering blank queries, case-insensitive matching, nested saved details, hidden-metadata exclusion, filtered summaries/order, and immutability.
- A helper agent implemented the pure filter and tests; its integration review identified accessibility announcements and over-broad metadata matching, both resolved before closure.
- Verification: focused meal suite passed 57/57 tests; mobile typecheck passed; full `pnpm check` passed on the current combined worktree (43 mobile test files / 398 mobile tests, 486 API tests with 15 credential-gated E2E tests skipped, iOS and Android Hermes bundle checks, 23 deployment safeguards, 16 build-matrix checks, and 56 AI invariants); `git diff --check` passed.
- Implementation and automated verification are complete. Dev deployment and physical-device acceptance have not been performed for this change.
- **Next exact action**: Deploy the eventual committed candidate to Dev, open Meals on the physical `com.mizyun.development` iPhone build, and verify name/detail search, clear/no-result states, filtered totals, and Copy to Today from a matched meal.

## Prior handoff — Cross-Platform Country & Region Picker in Coach Preferences (`COACH-PREF-001`, 2026-09-12)

- **Country & Region Picker in Coach Preferences (`COACH-PREF-001`)**:
  - Replaced the legacy 7-chip section in Coach Preferences Settings (`apps/mobile/src/features/settings/coach-preferences-card.tsx`) with a native, cross-platform Country & Region selection experience adhering to Apple HIG and Android Material guidelines.
  - Added full ISO 3166-1 alpha-2 territory dataset (249 countries with code, name, and dial codes) in `apps/mobile/src/lib/country-data.ts`.
  - Implemented zero-bundle-overhead localized names via cached Hermes `Intl.DisplayNames`.
  - Added smart search relevance ranking in `searchCountries`: prioritizes exact 2-letter ISO code matches, prefix matches, and localized names over arbitrary substrings (e.g. searching "US" prioritizes United States over Australia/Austria).
  - Implemented `<CountryFlag />` component in `apps/mobile/src/components/ui/country-flag.tsx`: renders native vector emoji flags on iOS/web (0 network, 100% offline) and cached FlagCDN images with graceful emoji fallback on Android (resolving the missing flag glyph bug in standard Android Roboto/Noto fonts). Guarded against non-alphabetic inputs.
  - Implemented `<CountryPickerModal />` in `apps/mobile/src/components/ui/country-picker-modal.tsx`: `pageSheet` presentation with visual drag-handle affordance, fast type-ahead search with accessible clear action, instant "Global Standard (None)" reset option, "Suggested & Popular" section, and virtualized 52pt rows with deterministic keys and `accessibilityState={{ selected }}`.
  - 9 unit tests added in `country-data.test.ts` (all 9 passing). Full mobile test suite passes (43/43 files, 397/397 tests).
  - Platform bundle checks passed cleanly on both iOS (`dist/bundle-check-ios`) and Android (`dist/bundle-check-android`).
  - Independent code review completed with APPROVE rating; polish recommendations (caching `Intl.DisplayNames`, relevance ranking, accessibility states, deterministic keys) implemented and verified.
  - Prettier formatting 100% clean and repository-wide `pnpm check` passed (exit 0).
- **Next exact action**: Test the new Country/Region Picker in Coach Preferences in the mobile app, verifying opening the sheet, searching by country/code, selecting a country, and saving preferences.

## Prior handoff — Progress Photos Gated to Dev, Pi Production Deployed & iPhone Installed (`PROD-GATE-001`, 2026-09-12)

- **Progress Photos Gated to Dev (`PROD-GATE-001`)**:
  - Gated the incomplete progress photos feature cleanly to the Dev version (`com.mizyun.development`) while removing it from Production (`com.mizyun.app`).
  - `apps/mobile/app.config.js`: Added `enableProgressPhotos: variantName === "dev"` in `expo.extra`.
  - `apps/mobile/src/composition/app-variant.ts`: Implemented `getAppVariant()` and `isProgressPhotosEnabled()` with fail-closed production defaults. Added 11 unit tests in `app-variant.test.ts` (all 11 passing) and configured minimal `expo-constants` Vitest stub.
  - `apps/mobile/src/features/dashboard/dashboard-screen.tsx`: Gated Quick Log dock to render 3 actions on Production (Meal, Workout, Weight) vs 4 on Dev (including Progress photo).
  - `apps/mobile/src/features/settings/settings-screen.tsx`: Gated Shortcuts to hide Photos on Production, allowing Feedback to span the full row.
  - `apps/mobile/src/app/progress-photos.tsx`: Guarded route with `<Redirect href="/" />` on Production, preserving typed routes and route tree parity.
  - Registered `apps/mobile/src/composition` in `docs/feature-map.json` under `composition-roots`.
  - Independent subagent code review certified APPROVE. Committed as `b49959f`.
- **Deploy Script Robustness Fix**:
  - `scripts/promote-production.sh`: Aligned health check retries with `promote-dev.sh` (`MIZYUN_HEALTH_RETRIES:-40`), preventing premature rollbacks on Raspberry Pi ARM64 startup spikes. Committed as `3bad20c`.
- **Raspberry Pi Production Deployment**:
  - Promoted commit `3bad20c` to Production on the Pi via `pnpm deploy:production 3bad20c`.
  - Production database backup taken on the Pi at `/srv/mizyun/backups/20260912T133712Z`.
  - Production migrations verified up to date (no schema diff).
  - Production systemd service `mizyun-api.service` restarted and verified healthy:
    - Pi local health: `http://127.0.0.1:4000/v1/health` -> HTTP 200 OK.
    - Pi public health: `https://mizyun-api.phiskel.com/v1/health` -> HTTP 200 `{"status":"ok","service":"mizyun-api","timestamp":"2026-09-12T13:37:32.437Z"}`.
    - Dev public health also verified intact: `https://mizyun-api-dev.phiskel.com/v1/health` -> HTTP 200 OK.
- **iPhone Production Build & Installation**:
  - Generated native iOS prebuild for `com.mizyun.app` ("Mizyun") with Apple Developer Team `LQJNDVBL43`.
  - Compiled native Release configuration in Xcode (`Mizyun.app`).
  - Uninstalled legacy Personal Team build and installed the new production app on physical iPhone 16 Pro (`Adam's Iphone 😋`, CoreDevice identifier `7FBC9ACC-918A-5A9B-8D22-B9F1FF652A06`).
  - Successfully launched `com.mizyun.app` on device.
- **Next exact action**: Launch the production app on iPhone 16 Pro and verify Quick Log dock has 3 items (Meal, Workout, Weight) and Settings Shortcuts has Feedback only.

- **Beta Pro Pass Request in Onboarding (`BETA-PRO-001`)**:
  - Integrated "Request Beta Pro Pass" button & dynamic badges into the Onboarding Welcome card (`apps/mobile/src/features/onboarding/onboarding-screen.tsx`).
  - Extracted shared client functions `fetchBetaProStatus` and `requestBetaProPass` in vertical feature module `apps/mobile/src/features/beta-pro/beta-pro-client.ts`, with 4 comprehensive unit tests in `beta-pro-client.test.ts`.
  - Added push token permission check (`Notifications.getPermissionsAsync` / `requestPermissionsAsync`) before capturing Expo push tokens, ensuring tokens can be captured cleanly on fresh onboarding installs.
  - Refactored `apps/mobile/src/features/settings/ai-usage-card.tsx` to reuse the shared `beta-pro-client` logic, adding unmount guards (`mountedRef`), error catch handling, and `accessibilityState={{ disabled, busy }}` attributes.
  - Added `apps/mobile/src/features/beta-pro` to `ownedPaths` under `coach-consent-budgets` in `docs/feature-map.json`.
- **Workout Decimal Comma Parsing (`FIX-WORKOUT-001`)**:
  - Root cause: European keyboard numeric keypads input comma `,`. Standard `Number("12,5")` returned `NaN`, and `parseRawTargetLoad` regex stripped commas (`12,5` -> `125`).
  - Fixed `optionalNumber` in `apps/mobile/src/features/log-workout/log-workout-data.ts`, `parseRawTargetLoad` and `parseDisplayWeightToKilograms` in `apps/mobile/src/lib/weight-units.ts` to normalize `,` to `.`.
  - Added unit test coverage in `log-workout-data.test.ts` and `weight-units.test.ts`.
- **Stale Meal Draft Timestamp Freshness & Recovery (`FIX-MEAL-001`)**:
  - Root cause: Draft auto-saving persisted `consumedAt` from the previous evening's abandoned draft (8:07 PM). Submitting today at 11:20 AM used that stale timestamp because `consumedAt !== null`.
  - Added `isStaleMealTimestamp` (4h freshness threshold) in `apps/mobile/src/features/log-meal/meal-form.ts`.
  - Updated `upgradeLegacyMealDraft` to automatically refresh stale draft timestamps and generate clean `clientOperationId`.
  - In `apps/mobile/src/features/log-meal/log-meal-screen.tsx`: refreshed `consumedAt` on AI draft generation, preserved `prev.consumedAt` during submission retries (preventing cross-midnight lockouts), and immediately reloaded `loadAiUsage()` on text/photo draft generation.
- **Photo Scan Limit Discrepancy & In-Flight Slot Protection (`FIX-AI-PHOTO-001`)**:
  - Root cause: `FoodDraftRateLimiter` used a rolling 24-hour sliding window (`now - DAY_MS`), rejecting with "Resets in ~6h" when yesterday afternoon's calls plus this morning's reached 5, while Supabase DB ledger and UI reset at midnight UTC (3 remaining).
  - Aligned `FoodDraftRateLimiter` daily budget to UTC calendar day (`startOfUtcDay = new Date(now).setUTCHours(0, 0, 0, 0)`), matching `CoachLimitService` and mobile countdown.
  - Wrapped `POST /v1/food-entries/draft`, `/draft/text`, and `/draft/refine` in `try...finally` with boolean commit flags, guaranteeing that in-flight slots and daily reservations are always safely released on all 422 validation errors and provider failures.
  - Added `release(userId, draftKind)` to `FoodDraftRateLimiter` to roll back in-memory daily count on failures.
  - In `apps/api/src/modules/coach/limits.ts`: updated `releaseDraftSlot` to accept `draftKind` and skip `ai_release_draft_reservation` when `draftKind === "refine"`, preventing refine completions from stealing photo reservations.
- **Verification & Deployment Evidence**:
  - Independent reviewer subagents audited the full diff; critical findings (422 in-flight slot leak, refine reservation stealing, midnight retry lockout, and `parseDisplayWeightToKilograms` comma parsing) addressed and verified.
  - `pnpm check` passed cleanly (exit 0) across all 15 TypeScript projects, 23 deployment safeguards, 16 build matrix invariants, and 56 AI invariants.
  - Full API unit tests passed (33/33 files, 485/485 passed). Full mobile unit tests passed (40/40 files, 372/372 passed). Prettier formatting 100% clean.
  - Native iOS Release build (`com.mizyun.development`) compiled and installed directly onto physical iPhone 16 Pro (`Adam's Iphone 😋`, CoreDevice identifier `7FBC9ACC-918A-5A9B-8D22-B9F1FF652A06`).
  - Dev Deployment: Commit `055627d` deployed to Dev on the Raspberry Pi via `pnpm deploy:dev 055627d`. Dev database migrations verified up to date, systemd service reloaded, and public API health confirmed: `https://mizyun-api-dev.phiskel.com/v1/health` -> HTTP 200 `{"status":"ok","service":"mizyun-api","timestamp":"2026-09-12T12:53:31.635Z"}`.
- **Next exact action**: Test all 4 items on the installed Dev app on the physical iPhone 16 Pro: (1) Onboarding "Request Beta Pro Pass" button, (2) Workout logging with `12,5 kg`, (3) Meal logging at current time, (4) Photo scan limit matching UI quota without premature 429 lockouts.

## Prior handoff — Google Play publishing plan (2026-09-12)

- Added [Google Play implementation plan](docs/GOOGLE_PLAY_IMPLEMENTATION_PLAN_2026-09-12.md), PLAY-001–006: account/organization eligibility, local AAB/upload signing, versionCode and API36/16KB compatibility, Android acceptance, health/AI/privacy disclosures, internal/closed testing, review and intentional release.
- User reports Apple side should be completed; this session leaves Apple implementation outside scope and preserves all existing uncommitted work. Planning snapshot is `6304400` plus the current working tree, not a clean candidate. No application changes, fresh builds, portal actions or deployments occurred.
- Independent helper audited signing/disclosures and reviewed the plan; no blocking plan findings, health disclaimer clarification incorporated. Fresh official Google/Expo research recorded in the plan and research log.
- Next exact action: execute PLAY-001, verifying publisher/account type, organization eligibility for Mizyun's health features, existing app record/signing state and actual Console testing requirements; then PLAY-002 store AAB safeguards. Account access and founder legal/entity decisions remain external inputs. No new Apple task is started by this handoff.
- Verification: changed-document Prettier check and diff whitespace checks passed; navigation check passed with 0 errors and 12 existing stale-review warnings. Full application tests are not rerun for this documentation-only plan; previous implementation evidence remains historical. Plan/continuity changes remain uncommitted.

## Latest handoff — Sign In with Apple & Token Revocation Implementation (`APPLE-001`, `APPLE-002`, `APPLE-003`, `STORE-001`, 2026-09-12)

- Implemented end-to-end native Sign in with Apple integration and App Store Guideline 5.1.1(v) token revocation pipeline:
  - **Native Setup & Bundle ID Isolation (`APPLE-001`)**: Configured Apple Developer Team ID `LQJNDVBL43`, set Dev bundle identifier to `com.mizyun.development` (separating from production `com.mizyun.app`), enabled `usesAppleSignIn` and `com.apple.developer.applesignin` entitlements across `app.config.js` and build matrices. Verified clean native iOS prebuild (`MizyunDev.xcworkspace`).
  - **Apple Auth Adapter (`APPLE-002`)**: Created `@mizyun/adapter-apple-auth` with `node:crypto` ES256 client secret generation (IEEE P1363 DSA encoding, 64-byte `(R, S)` concatenation conforming to RFC 7518 / Apple specifications), authorization code token exchange, and token revocation at `https://appleid.apple.com/auth/revoke`. 21/21 unit tests passing.
  - **Account Deletion Token Revocation (`APPLE-003`, Option A)**:
    - Extended `accountDeleteSchema` to accept optional `appleAuthorizationCode`.
    - In `apps/mobile`: when a user with Apple identity requests account deletion, mobile app prompts for native Apple re-authentication via `AppleAuthentication.signInAsync({ requestedScopes: [] })` to acquire an ephemeral authorization code, passing it to `DELETE /v1/account`. If the user cancels the prompt (`ERR_REQUEST_CANCELED` / `ERR_CANCELED`), deletion cleanly aborts without deleting remote or local data.
    - In `apps/api`: `DELETE /v1/account` generates an ephemeral client secret (300s TTL), exchanges the authorization code for a refresh token, and revokes it with Apple REST API. Data erasure proceeds safely regardless of third-party network outcomes (GDPR Art. 17 compliant).
  - **App Store Preparation (`STORE-001`)**: Dynamic `buildNumber` support, updated camera permissions string for meal photos, removed insecure Tailscale ATS exemption.
  - **Independent Security Review**: An independent reviewer subagent audited the entire auth diff, verifying Guideline 5.1.1(v) compliance, secret isolation (kept on server only, gitignored `.p8`), fault tolerance, and mobile cancellation UX. Suggestions incorporated (300s TTL, revocation telemetry logging, multi-identity provider detection).
- Verification:
  - `pnpm check` passed cleanly (exit 0) across all 15 TypeScript projects, 23 deployment safeguards, 16 build matrix invariants, and 56 AI invariants.
  - Prettier formatting passed 100% clean.
  - Dual Hermes bytecode export (`bundle:check:ios` and `bundle:check:android`) passed cleanly.
  - Build matrix tests (`pnpm test:build-matrix`) passed 100%.
  - Dev Deployment: Commit `05f1c79` deployed cleanly to Dev on the Raspberry Pi (`pnpm deploy:dev`). Dev GoTrue updated with `GOTRUE_EXTERNAL_APPLE_ENABLED=true`, `GOTRUE_EXTERNAL_APPLE_CLIENT_ID=com.mizyun.development`, and valid secret; `/etc/mizyun/dev.env` and `/etc/mizyun/certs/AuthKey_D8TB43DBS5.p8` configured. Public health check verified (`https://mizyun-api-dev.phiskel.com/v1/health` -> 200 OK).
  - Native iOS app `com.mizyun.development` successfully built with provisioning profile `iOS Team Provisioning Profile: com.mizyun.development` and installed onto physical iPhone 16 Pro (`Adam's Iphone 😋`).
- Next exact action: Perform on-device test journey (login with Apple, test repeat login, test account deletion with FaceID and token revocation) (`APPLE-004`).

## Prior handoff — Shared iOS/Android icon (`BRAND-ICON-001`, 2026-09-12)

- Applied the user-approved blue ribbon-M image at `apps/mobile/assets/images/mizyun-icon.png` to root/iOS/Android icon configuration. Removed the previous iOS `.icon` and Android adaptive/monochrome overrides from app configuration. Original assets remain available; the previous App Store planning edits are preserved.
- Verified both Dev and Production effective icon paths. Ran installed Expo native icon generators in an isolated temporary directory: 1024×1024 opaque iOS PNG and all five Android launcher density assets generated successfully. Independent read-only helper confirmed SDK57 support and rebuild requirements.
- Verification: `pnpm check` passed (exit 0), including TypeScript, both Hermes exports, unit tests, deployment/build safeguards and 56/56 offline AI invariants. Credential-gated E2E/live provider suites remain skipped by their existing gates. `git diff --check` passed. No native application build, device install, deployment, commit or push performed. Source base remains `6304400`; changes are uncommitted.
- Next exact action: after repository checks, regenerate the selected native variant and build/install it on iPhone and Android to accept actual launcher appearance. Standard Android icon uses launcher-specific masking/insets; a custom themed icon is not supplied. App Store implementation remains deferred per user instruction.

## Latest handoff — Apple sign-in and App Store plan (2026-09-11)

- User requested an implementation plan only, to execute in a later session. Added [the phased plan](docs/APPLE_SIGN_IN_APP_STORE_IMPLEMENTATION_PLAN_2026-09-11.md) covering paid-team setup, native/provider configuration, Apple revocation during deletion, Dev acceptance, local archives, disclosures, TestFlight and App Review.
- Inspected source `6304400` with a clean initial working tree. Existing native nonce/ID-token flow is implemented but capability-gated; Dev Compose lacks Apple client-ID wiring. No Apple token revocation was found in the inspected account-deletion implementation. Actual Apple account membership/capabilities and remote provider configuration remain unverified.
- Read-only helper audited distribution setup and official Apple requirements. No application code, native/signing configuration, remote services or Apple account settings were changed; no build/upload/deployment occurred. Planning documents are uncommitted.
- Next exact action: execute APPLE-001 in the linked plan, verifying the paid team, existing App IDs and capability status, then inspect effective environment-specific GoTrue configuration before APPLE-002. Founder account access/2FA and legal/contact declarations may be required. Existing release gates remain open.
- Verification: independent plan review complete with suggestions incorporated; changed-document Prettier check, navigation checks (0 errors; 12 stale-review warnings) and diff whitespace check passed. Full `pnpm check` was not run for this documentation-only plan; no commit was made. Prior implementation test results are historical.

## Latest handoff — Cross-Tab Modal Navigation Preservation & Architecture (`NAV-TAB-001`) (2026-09-11)

- Resolved issue where opening capture workflows or modals (`log-meal`, `log-workout`, `log-weight`, `edit-meal`, `feedback`, `body`, `energy-setup`, `progress-photos`) from non-home tabs (`workouts`, `meals`, `coach`, `settings`) threw the user onto the Home dashboard when leaving or dismissing, instead of returning them to the tab they were on previously.
- Root cause & architectural solution (ADR-0025, superseding ADR-0006):
  - Previously, capture workflows were nested inside `(home)/_layout.tsx` (a stack owned by the `(home)` tab), causing Expo Router to switch the active tab to `(home)` on navigation. Popping the stack returned to `(home)/index`.
  - Restructured to canonical Expo Router Root Stack over `(tabs)`:
    - Created `apps/mobile/src/app/(tabs)/_layout.tsx` rendering `<AppTabs />` and `(tabs)/index.tsx` (re-exporting `DashboardScreen`).
    - Relocated tab screens (`workouts`, `meals`, `coach`, `settings`) to `(tabs)/<tab>.tsx`.
    - Elevated modals/screens to root stack level (`apps/mobile/src/app/`) with `presentation: "modal"`.
    - Updated `apps/mobile/src/components/app-tabs.tsx` home trigger to `name="index"`.
    - Removed legacy `(home)` directory.
  - Zero UI, layout, styling, or color changes were made to screen components or tab bars.
- Verification:
  - Mobile TypeScript: `pnpm --filter @mizyun/mobile typecheck` passed (0 errors).
  - Mobile Unit Tests: `pnpm --filter @mizyun/mobile test` passed (39/39 test files, 364/364 tests passed).
  - Navigation & Boundary Tests: `pnpm navigation:check && pnpm test:navigation` passed (27/27 tests passed).
  - Formatting: `pnpm format:check` passed cleanly (100% matched Prettier style).
  - Hermes Dual Bytecode Export: `bundle:check:ios` (1831 modules) & `bundle:check:android` (1923 modules) both passed.
  - Full Quality Gate: `pnpm check` passed cleanly (exit 0) across all 15 TypeScript projects, 23 deployment safeguards, 16 build matrix invariants, and 56 AI invariants.
  - Independent Review: Subagent review performed and certified APPROVED.
- Next exact action: Push commit to remote, deploy to Dev on the Raspberry Pi (`pnpm deploy:dev`), and verify on physical iPhone build (`com.mizyun.dev`).

## Prior handoff — Live Active Workout Notification on Lock Screen & Notification Tray (`WO-NOTIF-001`) (2026-09-11)

- Implemented an "always on" persistent live notification that activates during an active workout session in `apps/mobile`:
  - Surfaces current exercise, target load/reps, completed sets progress, and rest timer countdown.
  - Dynamically updates between:
    - Resting state: `⏱️ Resting · <Exercise>` / `Rest until <HH:MM> · <X> completed` / `Next: <weight> × <reps>`.
    - Lifting state: `🏋️ Workout: <Workout Name>` / `Set <N> · <X>/<Y> completed` / `Current: <Exercise> (<weight> × <reps>)`.
  - Configured with fixed identifier `active-workout-session` so updates modify the existing notification in-place on the lock screen and notification tray.
  - Configured Android channel `active-workout-session` with `LOW` importance, `sticky: true`, and `autoDismiss: false`.
  - Suppressed in-app foreground banner alerts and alert sounds (`shouldShowBanner: false`, `shouldPlaySound: false`) in `apps/mobile/src/app/_layout.tsx`, while keeping tray/lock-screen visibility (`shouldShowList: true`). High-priority rest timer expiration alerts (`Rest Over!`) remain unimpeded.
  - Tapping the notification deep-links directly to `/log-workout` with the `workoutId` payload.
  - Added user toggle in `apps/mobile/src/features/settings/workout-settings-card.tsx` ("Live workout notification", defaulting to enabled `true`), backed by `expo-secure-store` in `workout-preferences.ts`.
  - Notification immediately dismisses when the workout session is finished or abandoned.
- Verification:
  - Unit tests: Added 20 unit tests in `workout-notification.test.ts` (all passed). Updated `workout-preferences.test.ts` (17 passed). Total mobile suite: 39 test files, 364 tests passing (`pnpm --filter @mizyun/mobile test`).
  - Full repository quality gate: `pnpm check` passed cleanly (exit 0) — Prettier check, all 15 TypeScript projects, dual iOS & Android Hermes bundling, 23 deployment safeguards, 16 build matrix invariants, and 56 AI invariants.
- Next exact action: Push commit to remote, deploy to Dev on the Raspberry Pi (`pnpm deploy:dev`), and test live lock-screen notification display and updates during an active workout session on the physical `com.mizyun.dev` iPhone build.

## Prior handoff — Resilient Workout Rest Timer (Wall-Clock & Lock Screen Notifications) and Global Settings (`WO-REST-001`) (2026-09-11)

- Resolved issues where:
  1. The rest timer froze or stopped when the user navigated away from the app or locked/closed their iPhone.
  2. The default rest timer duration was 90s instead of 3 minutes.
  3. The rest timer was not globally configurable across the app.
- Architecture & Resilient Wall-Clock Pattern:
  - Transitioned `RestTimerState` from relative decrementing countdown state to absolute wall-clock timestamps: `{ endsAt: number; total: number; exerciseName: string; notificationId?: string | null; }`.
  - Added ticker running against `Date.now() >= endsAt`, coupled with an `AppState` change listener (`"active"`) that instantly reconciles or expires elapsed rest time when returning to the foreground or unlocking the phone.
  - Implemented local push notification service via `expo-notifications` (`apps/mobile/src/features/workouts/rest-timer-notifications.ts`): schedules a high-priority sound notification upon logging a set (`scheduleRestNotification`), cancels previous or active notifications on skip, finish, abandon, or expiration (`cancelRestNotification`), and configures Android notification channels. Unit tested in `rest-timer-notifications.test.ts` (8/8 passed).
- Global Workout Preferences & Settings:
  - Created `apps/mobile/src/features/workouts/workout-preferences.ts` backed by `expo-secure-store` with default duration set to 180s (3 minutes), min/max clamping (15s–600s), presets (60, 90, 120, 150, 180, 240, 300s), ±15s steppers, and duration formatters. Unit tested in `workout-preferences.test.ts` (16/16 passed).
  - Created `WorkoutSettingsCard` in `apps/mobile/src/features/settings/workout-settings-card.tsx` and integrated it into `SettingsScreen` under the new `"workout"` category with filter pill and collapsible section.
  - Updated `WorkoutEditorModal` (`apps/mobile/src/features/workouts/workout-editor-modal.tsx`) to load preferences on mount and default new exercise rest durations to `defaultRestSeconds` (180s).
  - Updated `LogWorkoutScreen` (`apps/mobile/src/features/log-workout/log-workout-screen.tsx`) to load preferences on mount, default fallback rest durations to `globalRestSeconds`, manage dynamic notifications, and adapt `FloatingRestTimer` with wall-clock time math.
- Verification:
  - Mobile test suites: all 38 test files and 343 tests passed cleanly (`pnpm --filter @mizyun/mobile test`).
  - Full repository quality gate: `pnpm check` passed cleanly (exit 0) across all 15 TypeScript projects, formatting, boundary checks, Hermes bundling, deployment safeguards, build matrix invariants, and AI eval invariants.
- Next exact action: Push commit to remote, deploy to Dev on the Raspberry Pi (`pnpm deploy:dev`), and test locking the phone during an active workout rest interval on the physical `com.mizyun.dev` iPhone build.

## Prior handoff — Surface Planned Routine Weights (Target Load) in Active Workout Session (`WO-LOAD-001`) (2026-09-11)

- Resolved issue where weights entered during routine creation (`WorkoutEditorModal`) did not appear when starting a session (`LogWorkoutScreen`).
- Weight Units Utility:
  - Added `parseTargetLoadToDisplay` and `parseTargetLoadToKilograms` in `apps/mobile/src/lib/weight-units.ts`, handling plain numbers and strings with optional `kg` and `lb`/`lbs` unit indicators with automatic conversion to the user's active unit system.
  - Added 14 unit tests in `apps/mobile/src/lib/weight-units.test.ts` (all passed).
- Live Workout Screen & Data Pipeline:
  - Added `targetLoad` to `PlannedExercise` and `extractPlannedExercises` in `apps/mobile/src/features/log-workout/log-workout-data.ts`, extracting target loads from `coachPlan`, `aiDraft`, and `workoutProposal` details. Added 4 test cases in `log-workout-data.test.ts` (19 tests passed).
  - Updated `ExerciseEntry` and `exerciseEntries` in `apps/mobile/src/features/log-workout/log-workout-screen.tsx` to retain `targetLoad`.
  - In `LiveExerciseCard`: updated `smartPlaceholderLoad` to use `targetLoadDisplay` for the initial set placeholder instead of falling back to `"0"`; updated the exercise header subtitle to display target weight (e.g. `Target: 3 sets · 4-5 reps · 140 kg · 90s rest`); updated `activeSetRow` `colPrev` to show `Target: 140 kg`; and updated `handleLogSet` to default `loadVal` to `targetLoadDisplay` when logging a set without manual typing.
- Workouts Hub:
  - Updated `extractPlannedExercisesFromWorkout` in `workouts-hub-data.ts` to parse numeric `targetLoad` and `targetLoadKg`.
  - Updated exercise chips in `PlannedWorkoutCard` (`workouts-hub-screen.tsx`) to display the planned weight alongside sets (e.g. `Barbell Deadlift (3 sets · 140 kg)`).
- Verification: Full repository quality gate `pnpm check` passed cleanly (exit 0) — Prettier, all 15 TypeScript projects, dual iOS/Android Hermes bundles, 23 deployment safeguards, 16 build matrix invariants, and 56 AI invariants.
- Next exact action: Push commit to remote, deploy to Dev (`pnpm deploy:dev`) on the Pi, and verify on physical iPhone build.

## Prior handoff — Decoupled AI Budgets & Beta Pro Pass Flow (`AI-BUDGET-001` & `BETA-PRO-001`) (2026-09-11)

- Decoupled AI Budgets: Separated Coach Chat token budget from Photo Meal Draft limits. Photo drafts are now tracked via count-based quota (5 free / 100 paid per day), while Coach Chat retains token-based tracking (10k free / 100k paid tokens per day). Configured in `packages/config/src/ai-tier.ts`.
- Database Migration: Created `supabase/migrations/20260910220000_separate_ai_draft_budget_and_beta_requests.sql` with `ai_daily_draft_ledger`, RPCs (`ai_reserve_draft`, `ai_commit_draft`), `beta_pro_requests` table with RLS, and admin approval trigger `trg_beta_pro_approval` promoting `profiles.plan_tier` to `paid`.
- API & Limiter:
  - Updated `apps/api/src/modules/coach/limits.ts` with `getAiUsage` and count-based draft slot reservations for both Supabase and InMemory services.
  - Updated `apps/api/src/modules/food-entries/draft-route.ts` and `apps/api/src/modules/coach/routes.ts` with rich 429 response bodies providing `reason` (`minute_rate_limit`, `daily_budget_exhausted`, `concurrent_in_flight`), `retryAfterSeconds`, and `resetAt`.
  - Added `GET /v1/ai/usage` in `apps/api/src/modules/coach/ai-usage-routes.ts`.
  - Added `GET /v1/beta-pro/status` and `POST /v1/beta-pro/request` in `apps/api/src/modules/account/beta-pro-routes.ts`.
- Mobile App & Client:
  - Extended `@mizyun/api-client` error parser with `reason`, `retryAfterSeconds`, and `resetAt`.
  - Updated `apps/mobile/src/features/log-meal/log-meal-data.ts` and `coach-data.ts` to show humanized recovery messages with hours until midnight reset or seconds until rate limit window clears.
  - Added `AiUsageCard` in `apps/mobile/src/features/settings/ai-usage-card.tsx` displaying Coach chat and photo scan progress bars, dynamic tier badge ("✨ Beta Pro Pass" / "🌱 Free Plan"), and Beta Pro request button with push token capture.
  - Added photo quota badge in `apps/mobile/src/features/log-meal/log-meal-screen.tsx`.
- Admin CLI: Created `scripts/manage-beta-pro.mjs` for `--list`, `--approve <id|email>`, and `--reject <id|email>` with Expo push notification dispatch.
- Verification: Full repository quality gate `pnpm check` passed cleanly (exit 0) — all unit/integration tests, Hermes mobile bundling, build matrix, and AI evaluation invariants green.
- Next exact action: Push commit to remote, deploy to Dev (`pnpm deploy:dev`) and Production (`pnpm deploy:production`), and install updated iOS apps on user's iPhone.

## Prior handoff — Body Circumferences & Completed Workout History (`AI-BODY-001` & `AI-WORKOUT-001`) (2026-09-10)

- Implemented `AI-BODY-001`: In `apps/api/src/modules/coach/grounding.ts`, extracted and surfaced `latestCircumferences` (waist, chest, hips in cm) under static `kind: "body"` grounding, enabling Turn-1 answers to questions like "what is my waist measurement?". Enhanced `get_recent_measurements` in `apps/api/src/modules/coach/tools.ts` to return circumferences for each observation and `latestCircumferences` across the requested window (`1..28` days), empowering the Coach to assess body recomposition (fat loss with stable weight). Added unit tests in `grounding.test.ts` (8 passed) and `tools.test.ts` (26 passed).
- Implemented `AI-WORKOUT-001`: In `apps/api/src/modules/coach/tools.ts`, enhanced `get_recent_workouts` to return `recentCompletedWorkouts` with session names, start/completion timestamps, and duration in minutes (capped at 20 entries), empowering the Coach to answer "what workouts did I do this week?", "when was my last leg day?", and session duration lookups. Added unit tests in `tools.test.ts`.
- Updated `COACH_SYSTEM_POLICY` in `packages/agent-runtime/src/index.ts` instructing the model on body recomposition via tape measurements and completed workout history lookups. Added invariant tests in `packages/agent-runtime/src/index.test.ts` (47 passed).
- Verification: Full repository quality gate `pnpm check` passed cleanly (exit 0).
- Next exact action: Push commit to remote, deploy to Dev on Pi via `pnpm deploy:dev`, and verify Coach tape measurement and workout history replies on device.

## Prior handoff — Itemized Meal History & Exercise Performance Tools (`AI-FOOD-001` & `AI-LIFT-001`) (2026-09-10)

- Implemented `AI-FOOD-001`: In `apps/api/src/modules/coach/grounding.ts`, added itemized today's meal summaries (`loggedMealsToday` and `today.loggedMeals`) with dish name, timestamp, calories, and macros, capped at 20 entries. Created dedicated vertical module `apps/api/src/modules/coach/meal-history.ts` exporting `buildGetMealHistoryTool` supporting date filtering (`YYYY-MM-DD`), `days_back` (clamped 1..7), keyword search, and limit (clamped 1..50, default 20) with strict `principalUserId` isolation. Added unit tests in `apps/api/src/modules/coach/meal-history.test.ts` (5 tests passing).
- Implemented `AI-LIFT-001`: Created dedicated vertical module `apps/api/src/modules/coach/exercise-history.ts` exporting `buildGetExerciseHistoryTool`. Leverages `@mizyun/core` functions (`findCatalogExercise`, `getExerciseFromCatalog`, `recentForExercise`, and `summariseExerciseSets`) to provide exact or alias-resolved exercise details, deterministic PR metrics (best load kg, last session volume kg, total logged sets), and chronological set progression. Added unit tests in `apps/api/src/modules/coach/exercise-history.test.ts` (4 tests passing).
- Tool Registry & Agent Policy: Registered both tools in `buildCoachToolRegistry` in `apps/api/src/modules/coach/tools.ts` (expanding registry to 12 tools). Updated `COACH_SYSTEM_POLICY` in `packages/agent-runtime/src/index.ts` instructing the model to use `get_meal_history` when answering specific meal queries and `get_exercise_history` for exercise PRs and set history. Updated unit tests in `tools.test.ts` and `index.test.ts` (45 passed).
- Verification: Full repository quality gate `pnpm check` passed cleanly (exit 0): Prettier format check, TypeScript across all 15 packages, dual iOS/Android mobile bundles, 23 deployment safeguards, 16 build matrix invariants, 467 passing API tests, and 56 AI invariants.
- Next exact action: Push commit to remote, deploy to Dev on Pi via `pnpm deploy:dev`, and verify Coach meal history and exercise performance replies on device.

## Prior handoff — In-App Feature Guide & Deterministic Remaining Macros (`AI-APP-001` & `AI-ENERGY-001`) (2026-09-10)

- Implemented `AI-APP-001`: Expanded `COACH_SYSTEM_POLICY` in `packages/agent-runtime/src/index.ts` with canonical navigation knowledge for all 5 primary native tabs (`Home`, `Workouts`, `Meals`, `Coach`, `Account`). Coach can accurately answer questions about where to find features, how features work, and how to navigate without declining or hallucinating non-existent UI (e.g. hamburger menus, external settings gears). Added unit tests in `packages/agent-runtime/src/index.test.ts` (43 passed).
- Implemented `AI-ENERGY-001`: In `apps/api/src/modules/coach/grounding.ts`, computed daily energy breakdown and coaching plan deterministically via `@mizyun/core` (`computeEnergy` & `buildCoachingPlan`). Attached `targetCaloriesKcal`, `remainingCaloriesKcal`, `targetProteinG`, `remainingProteinG`, and `today` breakdown directly to static `kind: "nutrition"` and added `kind: "energy"` grounding item. Floors remaining calories/protein at 0 when consumed exceeds target and handles 0-meal days and missing inputs gracefully. Added comprehensive test suite in `apps/api/src/modules/coach/grounding.test.ts` (5 tests passing; 463 tests passing across 31 API test files).
- Independent code review completed: Helper subagent reviewed diff across safety boundaries, tab navigation guide accuracy, deterministic core calculations, and module boundaries; certified **APPROVED** with zero blocking issues.
- Verification: Full repository quality gate `pnpm check` passed cleanly (exit 0): 0 navigation errors, 27 navigation tests, Prettier format check, TypeScript across all 15 packages, dual iOS/Android mobile bundle check, 23 deployment safeguards, 16 build matrix invariants, and 56 AI invariants.
- Next exact action: Push commit to remote, deploy to Dev on Pi via `pnpm deploy:dev`, and verify Coach navigation guidance and remaining calorie replies on device.

## Prior handoff — Expose Saved Workout Routines to Coach AI (`AI-ROUTINE-001`) (2026-09-10)

- Triaged production user feedback bug report #3a8bd3dc ("It can't see my workout routine" with attached chat screenshots where Coach stated it had no access to "available routines" for "Push 1").
- Implemented `apps/api/src/modules/coach/routines.ts` and `apps/api/src/modules/coach/routines.test.ts` (19 unit tests) with helper subagent, extracting planned exercises, target sets, reps (strings, ranges, durations), and loads from `public.workouts(details)` (`coachPlan`, `aiDraft`, `workoutProposal`).
- Exposed available routines in `kind: "training"` static grounding in `apps/api/src/modules/coach/grounding.ts` (unbounded date fetch for uncompleted workouts).
- Implemented `get_available_routines` Coach tool in `apps/api/src/modules/coach/tools.ts` with optional name filter and comprehensive unit tests (22 tests passing in `tools.test.ts`).
- Updated `COACH_SYSTEM_POLICY` in `packages/agent-runtime/src/index.ts` instructing the AI model to reference saved routines and deliver expert strength/hypertrophy reviews.
- Added route integration test in `apps/api/src/modules/coach/routes.test.ts` verifying routine grounding delivery (31 tests passing in file, 458 in api). Marked feedback item as processed in feedback ledger.

## Prior handoff — native Sign in with Apple & Guideline 4.8 compliance (2026-09-10)

- Implemented native Sign in with Apple (`expo-apple-authentication`, `expo-crypto`, `@mizyun/identity`, `@mizyun/adapter-supabase-mobile`, `apps/mobile`) and re-enabled Google Sign-In on iOS alongside Apple Sign-In pursuant to App Store Review Guideline 4.8.
- Cryptographic replay protection: `expo-crypto` generates random UUID nonce, SHA-256 digest is supplied to Apple, and the raw UUID is forwarded to Supabase GoTrue `signInWithIdToken` where backend verification aligns the nonce claim. Silent cancellation handling catches `ERR_REQUEST_CANCELED` without disruptive banners.
- Capability gating: `apps/mobile/app.config.js` gates `ios.usesAppleSignIn` and the `expo-apple-authentication` plugin behind `MIZYUN_ENABLE_APPLE_AUTH === "1"` so local Personal Team builds (`PP89XZBW4U`) do not fail code signing while awaiting paid Apple Developer license confirmation.
- Independent security & auth review: Subagent verified nonce handling, cancellation handling, capability gating, guideline compliance, provider session isolation, and error message sanitization; certified approved with zero blocking issues.
- Verification: Full `pnpm check` passed clean (exit 0): navigation checks/tests, Prettier format, TypeScript across all 15 packages, dual-platform iOS/Android Hermes bundles, 436 API tests, 303 mobile tests, 78 config tests, deployment safeguards, build matrix, and 56 offline AI invariants.
- Next exact action: Upon Apple Developer license confirmation, configure Apple Service ID & Private Key in Supabase Auth Dashboard, enable `MIZYUN_ENABLE_APPLE_AUTH=1` in `scripts/mobile-founder-dev-ios.sh`, and verify native Apple Sign-In on physical device.

> Current operational snapshot. Last updated: **2026-09-10**.
> For historical logs, audit entries, and prior session handoffs, see [`docs/archive/status/STATUS_HISTORY_THROUGH_2026-09-09.md`](docs/archive/status/STATUS_HISTORY_THROUGH_2026-09-09.md).

## Active work package — Agent navigation & memory (`DOCS-NAV-001`–`004`) [PARTIAL]

- **Latest independent review:** [N1–N8](docs/AGENT_NAVIGATION_REVIEW_2026-09-09.md) supersede blanket completion below. Fresh `pnpm check` and 15 navigation tests pass, but targeted fixtures expose boundary and manifest validation gaps. Impact lacks source-derived dependencies; archive/pattern references, focused context, current guidance, fixture tests, and CI integration remain incomplete. No implementation fixes or remote actions were performed during this review.

- **Delivered**:
  - Compact operational `status.md` (51 lines) and comprehensive history archive in `docs/archive/status/`.
  - Routing index [`docs/START_HERE.md`](docs/START_HERE.md), decision index [`docs/adr/README.md`](docs/adr/README.md), and pattern catalog [`docs/patterns/README.md`](docs/patterns/README.md).
  - Streamlined startup reading protocol in `AGENTS.md` and `docs/SESSION_GUIDE.md` reducing startup lines to 233 lines (-86.4%).
  - Machine-readable manifest [`docs/feature-map.json`](docs/feature-map.json) covering 100% of API modules (15/15) and mobile features (14/14).
  - Context CLI (`pnpm context`), advisory impact analysis (`pnpm impact`), and automated boundary validator (`pnpm navigation:check`, `pnpm test:navigation`).
  - Independent cold-start navigation exercises across 5 scenarios passed without coordinator hints.
- **Verification Evidence**: Complete living evidence recorded in [`docs/AGENT_NAVIGATION_ACCEPTANCE.md`](docs/AGENT_NAVIGATION_ACCEPTANCE.md); full repository gate (`pnpm check`) passes with zero errors.

## Environment & deployment snapshot

| Environment       | Host & Location                | Deployed SHA      | Health & Status                                           | Notes                                                                           |
| ----------------- | ------------------------------ | ----------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **Local Mac**     | Apple Silicon (`darwin-arm64`) | `a9ed15e` (clean) | `pnpm check`: 100% clean                                  | Primary feature development & local verification                                |
| **Pi Dev**        | Raspberry Pi 5 (`mizyun-pi`)   | `a9ed15e`         | HTTP 200 (`https://mizyun-api-dev.phiskel.com/v1/health`) | Port 4100 API / 8100 Kong / 5433 DB; UID 999 unprivileged; worker leases active |
| **Pi Production** | Raspberry Pi 5 (`mizyun-pi`)   | `a9ed15e`         | HTTP 200 (`https://mizyun-api.phiskel.com/v1/health`)     | Port 4000 API / 8000 Kong / 5432 DB; all forward migrations applied             |
| **Windows PC**    | Windows / WSL2 (`mizyun-pc`)   | `—`               | Standby hot backup                                        | Retained as secondary backup per ADR-0020                                       |

## Implementation versus release gate status

- **Implemented & Deployed to Dev on Pi (`26ad4cd`)**:
  - **Feedback & Media Upload URL Resolution (`MEDIA-URL-001`)**: Resolved photo upload network error (`fetch failed: Could not connect to the server`) on physical devices. Configured `SupabaseMediaStorage` and server config with `publicUrl` resolution (with port-based 8100/8000 defaults) for signed upload and download tickets, and added client-side `resolveUploadUrl` loopback translation in mobile. All test suites pass; independent security & architectural review certified.
  - **Block 1 (Pi Runtime Isolation / Q1 Resolution)**: Live unprivileged execution verified on Pi Dev (`mizyun-dev-api` UID 999, GID 987). Permission probes fail closed: reading `/etc/mizyun/production.env` denied (EACCES), reading `/srv/mizyun/backups` denied (EACCES), reading `/var/lib/mizyun/repo` denied (EACCES), writing `/var/run/docker.sock` denied. Systemd unit in `/etc/systemd/system/mizyun-api-dev.service` verified identical to template.
  - **Block 2 (Local Native Release Builds & Device Acceptance / Gate R3)**: ADR-0023 accepted retiring EAS in favor of 100% local Xcode and Android Gradle builds; `with-android-release-signing` plugin enforcing fail-closed keystore configuration; `scripts/mobile-founder-dev-android.sh` with variant isolation; build matrix verification passing.
  - **Block 3 (Account Deletion Durability / Finding Q4 Closure)**: Migration `20260909150000_account_deletion_worker_leases.sql` applied cleanly on Dev DB (`mizyun-dev-db`), adding `worker_id` and `lease_expires_at` with composite index; atomic worker lease CAS preventing concurrent execution of destructive steps; resumable stage state machine (`storage` -> `memory` -> `auth` -> `done`) preventing regression to `'none'`; pre-auth orphaned media reconciliation sweep; mobile automatic session cleanup and signout upon detecting completed deletion; pgTAP tests passing.
  - **Block 4 (Account Export Completeness / Finding Q5 Closure — Pragmatic Scope)**: Raised memory store list ceiling to 10,000 for bounded exports; account export route fetches complete stored memories up to 10,000; manifest counts verified truthful; mobile settings copy updated to explicitly explain that records are exported as JSON and private photos are provided as temporary 24-hour signed download links rather than embedded files. Heavyweight streaming/checksums deferred per user directive.
  - **Block 5 (AI Access & Cost Safeguards / Finding Q8 Verification)**: Verified `authorizeAiAccess` strictly enforces verified adult status (18+), explicit unrevoked consent version matching, and email allowlist admission. Daily token limits and conservative free-tier rate limits (5k tokens/day, 3 req/min, 1 in-flight) guard against runaway usage.
  - **Hybrid Grounded Meal Drafting & Regional Calibration (`AI-EST-002`)**: Fixed inaccurate calorie estimations for branded meals (e.g. McDonald's Slovakia "Single Big Tasty Bacon"). Introduced dedicated `textNutritionSystemPolicy` in `@mizyun/provider-gemini` with explicit fast-food single/double patty size distinctions and EU vs. US portion standards; implemented resilient two-step Gemini Google Search Grounding (`tools: [{ googleSearch: {} }]`) for branded queries with graceful fallback; plumbed user profile/request `countryCode` through API draft routes; added Country / Regional food standards settings card in mobile. Full test suites pass 100%.
  - Navigation & boundary suite: manifest coverage, realpath link resolution, pure core isolation, mobile adapter boundary, and synthetic fixture tests.
  - All standard gates pass: format check, typecheck (14 packages), dual-platform bundle checks (iOS & Android Hermes), 23 deployment safeguards, 16 build matrix invariants, 56 AI invariants, 748+ unit tests.
- **Physical Device Installation Verified (Gate R3 Part B)**:
  - Both native release variants successfully compiled, signed, and installed side-by-side on physical iPhone (**Adam's Iphone 😋** / iPhone 16 Pro, UDID `7FBC9ACC-918A-5A9B-8D22-B9F1FF652A06`):
    - `Mizyun Dev` (`com.mizyun.dev`, Version 1.0.0, Build 1) pointing to Dev API (`https://mizyun-api-dev.phiskel.com`).
    - `Mizyun` (`com.mizyun.app`, Version 1.0.0, Build 1) pointing to Production API (`https://mizyun-api.phiskel.com`).
  - Native variant separation verified via `xcrun devicectl device info apps`.
- **Open Implementation Work (Remediation Checklist)**:
  - Q2: Durable unknown-outcome persistence for ambiguous retries.
  - Q7/Q8: Consent UI context preservation and live model evaluation.
  - Q9: Remote readiness probe identity and live promotion proof.
- **Explicitly Held / Blocked Release Gates**:
  - **Gate R8**: Physical device journey on iPhone (standalone without Metro, Auth redirect, meal logging, export, deletion) & off-device backup restore rehearsal.
  - **Production Promotion**: Separately gated milestone requiring explicit user authorization, clean pre-promotion backup, and accepted physical device evidence.

## Current blockers & known contradictions

1. **Release Gate R8**: Physical device journey testing and off-device recovery rehearsal remain open dependencies before promoting candidate to Production.

## Next exact action

Execute Physical Device End-to-End Acceptance (Gate R8):

1. On **Adam's Iphone 😋**, open **Mizyun Dev** (`com.mizyun.dev`):
   - Verify standalone launch without Mac/Metro.
   - Verify authentication flow and redirect (`mizyun-dev://auth/callback`).
   - Log a meal (test camera upload, regional calibration, and retry).
   - Test bounded account export and download JSON.
   - Test account deletion: verify worker lease cascade, local session wipe, and signout.
2. Open **Mizyun** (`com.mizyun.app`):
   - Verify launch into production baseline and variant isolation.

## Evidence & archive links

- Acceptance register: [`docs/AGENT_NAVIGATION_ACCEPTANCE.md`](docs/AGENT_NAVIGATION_ACCEPTANCE.md)
- Historical status archive: [`docs/archive/status/STATUS_HISTORY_THROUGH_2026-09-09.md`](docs/archive/status/STATUS_HISTORY_THROUGH_2026-09-09.md)
- Remediation evidence checklist: [`docs/REMEDIATION_EVIDENCE_CHECKLIST.md`](docs/REMEDIATION_EVIDENCE_CHECKLIST.md)
- Navigation implementation plan: [`docs/AGENT_NAVIGATION_IMPLEMENTATION_PLAN.md`](docs/AGENT_NAVIGATION_IMPLEMENTATION_PLAN.md)
- Review Round 3: [`docs/IMPLEMENTATION_REVIEW_2026-09-09_ROUND_3.md`](docs/IMPLEMENTATION_REVIEW_2026-09-09_ROUND_3.md)

## Skills planning handoff — AGENT-SKILLS-001 (2026-09-13)

- Prepared [the shared Codex/Antigravity skills implementation guide](docs/AGENT_SKILLS_IMPLEMENTATION_GUIDE_2026-09-13.md) from six sampled Codex histories, selected Antigravity artifacts, current repository tooling and dated official documentation. Read-only helper researched Antigravity; coordinator checked key excerpts and current code. Antigravity raw chats were not decoded, and token savings are proposed, not measured.
- Documentation only: no skills installed, application changes, remote actions or release acceptance. Baseline HEAD `16a1e86132f649ca4718c1699f2bfe2474e102f7`; extensive pre-existing dirty work preserved. The active product handoff above remains unchanged.
- Verification: fresh `pnpm check` passed (exit 0) on the combined dirty worktree: navigation, formatting, typechecks, iOS/Android bundle checks, unit tests, deployment/build safeguards and 56 offline AI invariants. API reported 498 passed / 15 credential-gated E2E tests skipped; mobile reported 403 passed. No live-provider, remote or physical-device checks. Full local log: `/tmp/mizyun-agent-skills-check-20260913.log`. Final prose changes were separately checked for formatting, navigation and whitespace. Independent guide review returned no findings.
- Next exact action for this work package: implement Stage A context baseline/hygiene, then the three P0 shared skills. Cross-client discovery/behavior tests remain required before claiming compatibility. No implementation blocker identified; client acceptance is pending future implementation.
