# Mizyun current status

> Fast-changing operational snapshot. Last updated: **2026-09-17**.
> For historical logs, audit entries, and prior session handoffs, see:
>
> - [`docs/archive/status/STATUS_HISTORY_2026-09-10_THROUGH_2026-09-12.md`](docs/archive/status/STATUS_HISTORY_2026-09-10_THROUGH_2026-09-12.md) (Handoffs from Sep 10 through Sep 12)
> - [`docs/archive/status/STATUS_HISTORY_THROUGH_2026-09-09.md`](docs/archive/status/STATUS_HISTORY_THROUGH_2026-09-09.md) (Handoffs through Sep 9)

## Active handoff — Remote promotion script stdin isolation hardened (#101, 2026-09-17)

- **Context & Requirement:** GitHub Issue [#101](https://github.com/AdamHikl/mizyun/issues/101): Production promotion previously streamed `promote-production.sh` to remote `bash -s` via stdin. An interactive child prompt consumed subsequent script lines, skipping the API restart while the outer health check passed against the old running process. Defense in depth required materializing the candidate script remotely, disconnecting standard input from `/dev/null`, ensuring automatic temporary file cleanup, and adding orchestration regressions.
- **Implemented:**
  - Added and exported `buildRemotePromotionCommand({ remoteDir, targetSha, environment })` in `scripts/deployment-manifest.mjs`. It materializes the exact candidate script into an isolated temporary file (`/tmp/mizyun-promote-<env>-XXXXXX.sh`) with permissions `0700`, installs an automated cleanup trap (`trap 'rm -f "$remote_script"' EXIT INT TERM`), and executes `bash "$remote_script" "$targetSha" < /dev/null`.
  - Updated `scripts/deploy-remote.mjs` and `scripts/deploy-dev.mjs` to use `buildRemotePromotionCommand` and added `-o ConnectTimeout=10` to SSH preflight checks.
  - Added internal fail-closed defense `exec 0</dev/null` immediately following `set -Eeuo pipefail` in `scripts/promote-production.sh` and `scripts/promote-dev.sh`, ensuring stdin is disconnected from interactive streams even if called directly.
  - Added `--yes` flag to `pnpm exec supabase db push` in `scripts/promote-dev.sh` to prevent dev migration prompts.
- **Automated Verification:**
  - Unit tests for `buildRemotePromotionCommand` validating absolute path checking, SHA format validation, and shell command structure.
  - Negative orchestration regression reproducing the vulnerability: under legacy `bash -s` streaming, a child prompt consumes subsequent release lines from stdin and skips release execution while exiting 0.
  - Positive orchestration regression proving that under the materialized runner, an unexpected child prompt receives EOF from `/dev/null`, fails closed with non-zero exit, triggers the error trap, and cleans up the temporary script immediately.
  - End-to-end regression proving that an unflagged prompt in `promote-production.sh` fails closed, triggers `rollback_code`, restores previous code, and writes a `rolled_back` journal entry without skipping steps.
  - Safeguard test suite expanded from 24 to 30 tests (all 30/30 pass).
  - Full repository `pnpm check` passed cleanly (navigation, Prettier, all 15 workspace typechecks, iOS and Android Hermes bundle exports, deployment safeguards, build matrix, and offline AI screener).
- **Independent Review:**
  - Independent deployment review by subagent approved with zero findings, validating commit immutability, two-layer stdin isolation, trap cleanup guarantees, rollback execution, and POSIX shell compatibility.
- **Next exact action:**
  - Once the Raspberry Pi server is back online, deploy candidate to Pi Dev (`pnpm deploy:dev`) and promote to Production (`pnpm deploy:production <sha>`).

## Active handoff — Group and resize saved meals (#102, 2026-09-17)

- **Context & Requirement:** GitHub Issue [#102](https://github.com/AdamHikl/mizyun/issues/102): Users wanted the ability to group individual saved meals into bigger meals while keeping each one editable, and to adjust the portion weight (grams) of a food after saving with values updating dynamically.
- **Implemented:**
  - Added pure scaling and portion extraction utilities in `apps/mobile/src/features/log-meal/meal-scale.ts` (`extractGramsFromName`, `updateGramsInName`, `scaleNutrition`, `withMealGrams`, `withMealGroup`).
  - Added `clusterDayEntries` and meal grouping/ungrouping mutation helpers in `apps/mobile/src/features/log-meal/meal-lifecycle-data.ts`. Forwarded `details` in `patchFromForm`.
  - Added portion weight (grams) input with quick adjustment steppers (`-50g`, `-10g`, `+10g`, `+50g`, `0.5x`, `1.5x`, `2x`) and live dynamic nutrition recalculation in `edit-meal-screen.tsx`. Added meal group assignment selector.
  - Added multi-select meal grouping flow in `meal-list-screen.tsx` allowing users to group 2+ individual meals into bigger meals. Grouped meals render aggregated calories/macros while keeping each item independently editable, resizable, and ungroupable.
  - Added quick interactive portion resizing modal (`AdjustPortionModal`) with real-time recalculation of calories/macros and instant server persistence.
  - Added `mealgroup` and `mealgroupname` to searchable keys in `meal-history-filter.ts`.
- **Automated Verification:**
  - Unit tests in `meal-scale.test.ts` (12/12 pass).
  - Lifecycle tests in `meal-lifecycle-data.test.ts` (16/16 pass).
  - Filter tests in `meal-history-filter.test.ts` (6/6 pass).
  - All mobile log-meal tests (74/74 pass).
  - All API food-entries tests (74/74 pass).
  - Full repository `pnpm check` passed cleanly (navigation, Prettier, all 15 workspace typechecks, iOS and Android Hermes bundle exports, deployment safeguards, build matrix, and offline AI screener).
- **Deployment & Acceptance Status:**
  - The Raspberry Pi server is temporarily down (user confirmed). Remote promotion to Dev (`pnpm deploy:dev`) and physical device acceptance on `com.mizyun.development` are held until the Pi is online.
- **Next exact action:**
  - Once the Raspberry Pi is back online, deploy commit to Pi Dev (`pnpm deploy:dev`) and perform device acceptance on the installed Dev iPhone build: verify multi-select meal grouping into a bigger meal, portion resizing with dynamic macro updates, and editing individual items within the group.

## Active handoff — Onboarding analytics and automatic Beta Pro requests (#100, 2026-09-15)

- **Confirmed failures:** Production analytics PUT committed its update but failed response serialization with `RangeError: Invalid time value` at `routes.ts:106`; subsequent attempts returned HTTP 409 because the client retained the previous revision. Automatic notification registration called the same POST endpoint as an explicit Beta Pro request and created a pending row without a button press.
- **Implemented:** Separate SQL RPC snapshot mapping now reads camelCase consent timestamps; table reads retain snake_case mapping. Mutation results no longer claim an unavailable creation timestamp. Mobile consent saves refresh and retry a conflicting revision once; pending denials stay off through failures, restart, and sync. Automatic notification registration uses authenticated `PUT /v1/beta-pro/push-token`, backed by an UPDATE-only repository method that cannot insert requests or change review state. Explicit request submission retains its existing endpoint.
- **Regression evidence:** Adapter tests reproduced two failures before the date fix and now pass 6/6. The API test sends the actual RPC JSON shape through the adapter and HTTP response serializer. Mobile recovery tests cover lost responses, repeated conflict, failed refresh, durable denial, and denial during a controlled in-flight 51-event flush without restoring the queued remainder. Beta tests cover no-request registration, authenticated ownership, unchanged review state, and zero-row updates after deletion. A fresh repository-wide `pnpm check` passed: navigation and formatting, all workspace typechecks, iOS/Android Hermes exports, 527 API tests with 15 credential-gated E2E skips, 423 mobile tests, deployment/build safeguards, IPA tooling, and offline AI invariants.
- **Independent privacy/auth review:** Approved after identifying and resolving an in-flight analytics flush race. The final implementation permits only one active flush, rechecks consent and epoch inside the serialized queue-mutation boundary, filters the current queue instead of a stale snapshot, and cannot recreate queued events after denial. The reviewer also confirmed that the Beta token route is authenticated, derives ownership only from the principal, performs UPDATE-only persistence, and cannot create a request or alter review state.
- **Production release and device evidence:** Founder confirmation that no incompatible old clients remain closed [#98](https://github.com/AdamHikl/mizyun/issues/98). Production was promoted to exact commit `43917fa4b69acff04b931c4ef927dab21466a932` after backup `/srv/mizyun/backups/20260915T084930Z` and migration `20260914134000`. TestFlight Build 4 identifies as `Mizyun/4`. Its first consent attempt exposed a stale API process; after the scoped restart at 15:59:25 CEST, the real Build 4 recovery path completed `PUT 409 -> GET 200 -> PUT 200` with no serialization error. The new Beta token route returns HTTP 401 without authentication rather than 404, confirming the deployed route is loaded and protected.
- **Deployment incident and correction:** The promotion checkout and migration advanced, but Supabase's interactive migration prompt consumed the remaining streamed shell script beginning with `migrations_applied=true`; the API restart and release-journal tail therefore never executed, while the wrapper's generic health check passed against the old process. The Production API was manually restarted and is healthy locally and publicly. `promote-production.sh` now passes the documented global `--yes` flag to both migration dry-run and apply. A regression requires exactly those two non-interactive calls and proves the subsequent API restart. The focused safeguard suite passes 24/24, the fresh repository-wide `pnpm check` passes, and an independent deployment review approved the correction. Streamed-script isolation is retained as separate defense-in-depth work.
- **Remaining acceptance:** Existing pending Beta Pro rows are retained because historic automatic and explicit submissions are indistinguishable. Verify on a fresh account or after an explicitly authorized cleanup that Build 4 does not create a request before the button is pressed. Tracking: [#100](https://github.com/AdamHikl/mizyun/issues/100).

## Active handoff — Production native Apple sign-in enabled (2026-09-15)

- **Failure reproduced at the real boundary:** The founder confirmed installation through TestFlight, and the client identified itself as `Mizyun/3`. Four Production GoTrue requests from that client reached `POST /token` with `grant_type=id_token` and were rejected with HTTP 400 `provider_disabled`: `Provider (issuer "https://appleid.apple.com") is not enabled`. The native Apple sheet therefore succeeded far enough to return an Apple identity token. Production Auth rejected the provider before token audience and nonce validation, so those later checks still require a post-fix device attempt.
- **Production correction:** Added the native-only Apple provider mapping to `/srv/mizyun/supabase/docker-compose.yml` and its source values to `/srv/mizyun/supabase/.env`: enabled, accepted client ID `com.mizyun.app`, and nonce checking explicitly enabled (`GOTRUE_EXTERNAL_APPLE_SKIP_NONCE_CHECK=false`). No Apple OAuth Services ID or rotating client secret was introduced because the iOS app uses native `signInWithIdToken`, not web `signInWithOAuth`. Recoverable pre-change copies are `/srv/mizyun/supabase/.env.before-apple-auth-20260915T081520Z` and `/srv/mizyun/supabase/docker-compose.yml.before-apple-auth-20260915T081520Z`.
- **Scoped runtime operation and verification:** `docker compose config --quiet` passed, and only `supabase-auth` was force-recreated. GoTrue `v2.189.0` returned healthy with effective `GOTRUE_EXTERNAL_APPLE_ENABLED=true`, `GOTRUE_EXTERNAL_APPLE_CLIENT_ID=com.mizyun.app`, and nonce skipping disabled. The public Auth settings endpoint reports `external.apple=true`; the Production API remained healthy. No repository code, database, migration, Production API checkout, or backend SHA changed.
- **Independent auth review:** Approved the live activation with no blocking configuration or security finding. The reviewer independently confirmed the exact audience, enabled provider, enforced nonce policy, healthy Auth/API services, clean documentation diff, and no new `provider_disabled` event after the Auth recreation. It retained device acceptance as the hard gate because no post-fix Apple attempt had occurred at review time.
- **Remaining device acceptance:** Retry **Continue with Apple** in the same TestFlight Build 3 and confirm the first native Apple session reaches the dashboard. Then sign out and repeat to exercise the returning-user path. Inspect the matching sanitized Auth log if either attempt fails; do not mark device acceptance from provider settings alone.
- **Next exact action:** Complete the two TestFlight Apple sign-in journeys above and record the account/session result without retaining the Apple identity token or relay address.

## Active handoff — Google Play reviewer account prepared (2026-09-14)

- **Production reviewer access:** Created and email-confirmed the dedicated `play-review@mizyun.phiskel.com` Production Auth account through the Supabase admin boundary using a runtime-only password supplied by the founder. The password was not written to repository files, durable evidence, or command output. Password sign-in through Production Auth succeeded and the account has one email identity with no MFA factors.
- **Synthetic fixture:** Populated the account through authenticated Production `/v1` routes using the same bounded pattern as the App Store reviewer: one adult metric profile, one active maintenance goal, three recent body measurements, three meals, one exercise, one reusable routine, one completed session, and three completed sets. All records use new account-owned identifiers; the workout-set ownership validation reported zero errors. No photos, media objects, conversations, memories, analytics events, or real user data were created.
- **Reviewer tier and consent:** The account's Beta Pro request was approved in Production with note `Google Play reviewer account`; the database trigger set `profiles.plan_tier` to `paid`, and push delivery was skipped because no push token exists. AI and analytics consent remain ungranted so review exercises the actual disclosures and consent flow; adult eligibility is already satisfied.
- **Independent audit:** A non-author read-only audit verified the existing App Store fixture shape, Production ownership boundaries, absence of MFA/media, and the required post-create checks. Final database evidence for the Play account: Auth `1` confirmed, identity `1`, MFA `0`, profile `1` paid/adult, goals `1`, measurements `3`, food entries `3`, exercises `1`, workouts `2`, sets `3`, approved Beta request `1`, AI consents `0`, analytics consents `0`, media assets `0`, ownership errors `0`.
- **Remaining acceptance:** A Play-delivered Production Android build has not yet signed in with this account. Keep the Play Console password only in its secure sign-in-details field; do not add it to Git, screenshots, reviewer notes, or general documentation.
- **Next exact action:** Complete Play Console app-access details, then build and upload the verified Production AAB to Internal testing and confirm fresh Play-installed password sign-in plus the core reviewer journey.

## Active handoff — Production legal-page support email refreshed (2026-09-14)

- **Live correction:** The Production checkout at exact commit `bf4ef1a1c29d29b5fb71b145bdff23254ded931b` already contained `support@mizyun.phiskel.com` in the privacy, terms, support, and account-deletion routes, but the API process had been running since 2026-09-12 and still served the former `support@phiskel.com` value from memory. No source, database, migration, checkout, or backend SHA change was required.
- **Scoped operation:** Restarted only `mizyun-api.service`; it returned to `active`. The public Production health endpoint returned `{"status":"ok","service":"mizyun-api"}` and the Cloudflare-obfuscated address on `https://mizyun-api.phiskel.com/legal/privacy` decoded to `support@mizyun.phiskel.com` after the restart.
- **Verification:** `pnpm --filter @mizyun/api test src/modules/legal` passed 3/3 tests. A read-only helper audit confirmed that no tracked `support@phiskel.com` occurrence remains and independently identified the stale running process as the likely boundary. The existing Production hold for the workout lifecycle migration remains unchanged; current `main` was not deployed.
- **Next exact action:** Continue Google Play setup using the corrected public privacy URL; do not promote the held workout backend until Issue #98 is resolved.

## Active handoff — Production email-confirmation redirect corrected (2026-09-14)

- **Production configured:** The Production Supabase source of truth at `/srv/mizyun/supabase/.env` now uses the exact mobile callback for both `SITE_URL` and `ADDITIONAL_REDIRECT_URLS`: `mizyun://auth/callback`. The previous dead fallback, `https://mizyun.phiskel.com`, remains recoverable in `/srv/mizyun/supabase/.env.before-site-url-20260914`. Only the `auth` container was force-recreated; the Production API checkout, database, migrations, and current backend SHA were not changed.
- **Live verification:** The recreated `supabase-auth` container is healthy and reports effective `GOTRUE_SITE_URL=mizyun://auth/callback` and `GOTRUE_URI_ALLOW_LIST=mizyun://auth/callback`. Auth health passed through the public Supabase gateway with the publishable-key header, and `https://mizyun-api.phiskel.com/v1/health` remained healthy.
- **Durable client guard implemented:** `SupabaseMobileAuthClient.signUpWithPassword` now explicitly supplies `options.emailRedirectTo` from the current app variant, matching the existing explicit recovery and OAuth redirects. The focused adapter suite passes 15/15 tests across the Production and Dev schemes, and a fresh repository-wide `pnpm check` passed (including navigation, formatting, all typechecks, iOS/Android Hermes exports, 518 API tests with 15 credential-gated E2E skips, 414 mobile tests, deployment/build safeguards, and AI invariants). This source change is not in the existing Build 3 IPA and no replacement IPA was built; the live `SITE_URL` correction covers that existing client because it previously used the fallback.
- **Independent review:** Approved the exact mobile callback and scoped Auth recreation. A custom scheme is appropriate for the immediate mobile release, but a desktop browser without Mizyun installed cannot provide a useful completion page. A future real HTTPS confirmation landing/bridge is required for cross-device UX; that work must also point signup's explicit `emailRedirectTo` to the bridge (or omit it to use the new `SITE_URL`). Do not point Auth back to the currently nonexistent `mizyun.phiskel.com` host until that page and DNS exist.
- **Remaining acceptance:** Tracked in [#99](https://github.com/AdamHikl/mizyun/issues/99). Generate a fresh one-time confirmation link and verify it opens an installed Production app from both cold and warm states. Then verify password recovery and Google OAuth once because they share the callback allow-list. Confirmation links are single-use; do not interpret a reused or prefetched link as a redirect regression.

## Active handoff — Workout App Store IPA ready; Production backend promotion held (`FIX-WORKOUT-LIFECYCLE-001`, 2026-09-14)

- **Current Build 3 IPA ready:** Exact pushed commit `d53bd2487e79552391fca2bb2bae8743a59b0761` completed the guarded Production pipeline for version `1.0.0`, build `3`: frozen dependency installation, clean native prebuild, full `pnpm check`, Xcode archive, App Store Connect export, and post-export identity/signing/entitlement/runtime checks all passed. The 24,864,005-byte IPA is `apps/mobile/ios/build/app-store/1.0.0-3-d53bd2487e79552391fca2bb2bae8743a59b0761-20260914T170705Z/Mizyun-1.0.0-3-d53bd2487e79552391fca2bb2bae8743a59b0761-20260914T170705Z.ipa`, with SHA-256 `1dcacbadf31aadd3a7ae7b1c5d43966f9df95be4a600cfaf443925c2cb2775b9`. The adjacent `manifest.json` and `DistributionSummary.plist` are present and validated. It has not been uploaded.
- **Historical App Store artifact evidence:** Exact commit `8e3853d87f8ac092af552fb3d49063d31caa63a3` was previously checked out in a clean disposable worktree, prebuilt with the Production mobile environment, archived, and exported for App Store Connect. Its verified IPA was 23,599,231 bytes with SHA-256 `65654bd9ceb79b8ac0ce44359bea97b7bc54d34c5bd47e1f4a18c946293d496a`. The ignored local output copy is no longer present after the current session's required clean Dev native regeneration; this historical evidence is not a claim that an uploadable file remains in the repository workspace.
- **Reproducible build command:** Commit `dd7eeee1391b3b3ff34a895964c58d77d1727d17` added and pushed `pnpm mobile:founder-production:ios:ipa --sha <full-40-character-origin-main-sha> --build-number <positive-integer>`. It refuses unpushed candidates or candidate-mismatched release tooling, builds in a disposable detached worktree, clears inherited mobile environment values, generates fresh native projects, runs `pnpm check`, uses unique archive/export paths, and post-verifies bundle identity, requested build number, Production endpoints, distribution signing/entitlements, and checksum. It atomically emits the IPA, required `DistributionSummary.plist`, and a JSON manifest under the ignored `apps/mobile/ios/build/app-store/` tree; it does not upload or deploy.
- **Real scripted acceptance:** The command previously completed end-to-end for exact pushed commit `dd7eeee1391b3b3ff34a895964c58d77d1727d17`, version `1.0.0`, build `2`. The full clean-worktree `pnpm check`, CocoaPods installation, Xcode archive, App Store export, payload/signing/entitlement checks, distribution-summary validation, manifest validation, and disposable-worktree cleanup passed. The resulting 23,604,978-byte IPA had SHA-256 `f6bb533e2d3f3c36ef9c7aea43595fcaac80899ed48952343306621800cf527c`. Its ignored local output copy was also removed by the clean Dev regeneration. A fresh recovery run for exact `dd7eeee` repeated the full check and successfully archived, but export stopped with Xcode exit 70 (`No Accounts`; no `iOS Distribution` signing certificate). No replacement IPA is currently claimed.
- **Identity and signing evidence:** Bundle ID `com.mizyun.app`, version `1.0.0`, build `1`, arm64, team `LQJNDVBL43`, Cloud Managed Apple Distribution certificate, `aps-environment=production`, `beta-reports-active=true`, and `get-task-allow=false`. The runtime bundle contains the Production API and Supabase endpoints. It also contains an inert Dev Supabase hostname from the shared build-matrix validation constant exported through `@mizyun/config`; the active mobile configuration was sourced from `.env.production` and passed the Production prebuild safeguards.
- **Production backend was not promoted:** Preflight found Production pristine and healthy at `bf4ef1a1c29d29b5fb71b145bdff23254ded931b`. Deployment of `8e3853d` was stopped before backup, migration, checkout change, or service restart after an independent compatibility audit found that the one-time routine-classification migration plus the new API's routine-set rejection would break old Production mobile clients, which still open a routine directly and write sets to it. Production was rechecked unchanged, pristine, active, and healthy.
- **Safe rollout sequence:** Upload and process the new IPA first while the current Production backend remains compatible with it. After the new client is available and adopted, either promote the workout backend/migration or first add a bounded old-client compatibility path. Do not run `pnpm deploy:production 8e3853d` until the gate tracked in [#98](https://github.com/AdamHikl/mizyun/issues/98) is resolved.
- **Remaining acceptance:** App Store Connect upload/processing and TestFlight installation of Build 3 are not yet evidenced. App Store Connect will reject the upload if build `3` already exists for version `1.0.0`; uniqueness was not checked by this local build. The four physical workout lifecycle journeys remain to be explicitly accepted.

## Active handoff — Reusable workout routines separated from active sessions (`FIX-WORKOUT-LIFECYCLE-001`, 2026-09-14)

- **Implemented locally:** Saving a custom or Coach workout now creates a stable reusable routine with no running timer. **Start Session** creates a fresh session snapshot with its own `startedAt`; finishing completes only that session, and discarding deletes only that session. The source routine remains available in both cases. Direct legacy routine links are redirected to a newly created session before sets can be logged.
- **Legacy compatibility:** Migration `20260914134000_backfill_workout_routine_lifecycle.sql` classifies existing rows. A legacy planned workout that already owns sets remains the active/history session while a set-free routine copy is created, preventing deployment from consuming an in-progress routine. The API now rejects set writes against explicit routine rows.
- **Automatically verified:** Exact commit `8e3853d87f8ac092af552fb3d49063d31caa63a3` passed a clean-worktree `pnpm check` (15 workspace typechecks, iOS/Android Hermes bundles, core 261 tests, mobile 414 tests, API 518 tests with 15 credential-gated E2E tests skipped, deployment/build/AI gates). The same clean commit passed `pnpm db:verify`, applying all migrations and passing 107 pgTAP assertions. A rollback-only seeded execution of the exact migration exercised the legacy planned-plus-sets branch successfully. Focused lifecycle tests passed (mobile 85; independent API review rerun 38), and `git diff --check` passed.
- **Independent review:** Approved with no blocking findings. Pre-existing unrelated dirty-tree work, including concurrent branding changes in shared screens, was preserved. Tracking: [#96](https://github.com/AdamHikl/mizyun/issues/96). Non-blocking server pagination/idempotency/reference hardening is tracked separately in [#97](https://github.com/AdamHikl/mizyun/issues/97).
- **Dev deployed:** Commit `8e3853d87f8ac092af552fb3d49063d31caa63a3` was pushed to `origin/main` and deployed to Pi Dev. Migration `20260914134000` was applied. Post-deploy evidence: `/var/lib/mizyun/dev/repo` is pristine at the exact SHA, `mizyun-api-dev.service` and `mizyun-supabase-dev.service` are active, and `https://mizyun-api-dev.phiskel.com/v1/health` returned `{"status":"ok","service":"mizyun-api"}`.
- **Dev iOS installed / remaining gate:** A clean signed Release `com.mizyun.development` build from exact SHA `8e3853d` was installed successfully on physical device `Adam's Iphone 😋` and launched via CoreDevice on 2026-09-14. Physical behavior acceptance remains: verify that Save Routine does not advance time, Start begins near `00:00`, Finish preserves the routine, and Discard Session preserves the routine.

## Active handoff — Production App Store Connect `.ipa` build completed (2026-09-14)

- **App Store Connect build & IPA exported:** Built native Release archive `Mizyun.xcarchive` (`xcodebuild archive`) and exported distribution package `Mizyun.ipa` (`xcodebuild -exportArchive`) via `scripts/ios-export-options-production.plist`.
- **Artifacts:**
  - Archive: `apps/mobile/ios/build/Mizyun.xcarchive`
  - IPA package: `apps/mobile/ios/build/export/Mizyun.ipa` (24.8 MB)
  - Distribution summary: `apps/mobile/ios/build/export/DistributionSummary.plist`
- **Signing & Identity:**
  - Bundle Identifier: `com.mizyun.app`
  - Version: `1.0.0`, Build Number: `1`
  - Team: `LQJNDVBL43` (`itinn s.r.o.`)
  - Certificate: `Cloud Managed Apple Distribution` (SHA1 `E429BA7A349C5A8EDBD11536025213A196A4E1F9`, expires 2027-09-14)
- **Tooling & Commands:** Added `mobile:founder-production:ios:archive` and `mobile:founder-production:ios:ipa` to `package.json` and `scripts/mobile-founder-production-ios.sh` for 1-command reproducible App Store Connect builds. `pnpm format:check` and `pnpm test:build-matrix` green.
- **Next exact action:** Upload `Mizyun.ipa` to App Store Connect via Xcode Organizer (`open apps/mobile/ios/build/Mizyun.xcarchive` -> Distribute App -> App Store Connect) or Transporter / `xcrun altool`.

## Active handoff — Physical iOS production installation completed (2026-09-14)

- **Physical iOS installation completed:** Clean `pnpm mobile:founder-production:ios:prebuild` executed; native Release binary (`Mizyun.app`) compiled and signed via Xcode with development team `LQJNDVBL43` without errors. Installed on physical device `Adam's Iphone 😋` (`00008140-001114501A86801C` / CoreDevice `7FBC9ACC-918A-5A9B-8D22-B9F1FF652A06`). Installed side-by-side with Dev (`com.mizyun.development`).
- **Target identity & config:** Bundle ID `com.mizyun.app` ("Mizyun", version 1.0.0, build 1). Configured against public production endpoints: API `https://mizyun-api.phiskel.com`, Supabase `https://mizyun-supabase.phiskel.com`, redirect scheme `mizyun://auth/callback`.
- **Preflight & backend health:** Full `pnpm check` passed cleanly (navigation, typechecks across all workspaces, Prettier, Hermes bundle export, unit tests, deployment safeguards, build matrix, and AI evaluation offline screener). Public production API verified healthy (`GET https://mizyun-api.phiskel.com/v1/health` -> HTTP 200 `{"status":"ok","service":"mizyun-api"}`).
- **Device launch:** Successfully launched `com.mizyun.app` on the unlocked iPhone via `xcrun devicectl device process launch`.
- **Next exact action:** Unlock iPhone and verify production journey / authentication against Pi production backend.

## Active handoff — Task tracking migrated to GitHub Issues (2026-09-14)

- **Migration executed:** Task tracking and executable inventory transitioned from `backlog.md` to GitHub Issues ([`AdamHikl/mizyun/issues`](https://github.com/AdamHikl/mizyun/issues)); the durable repository migration landed in `11c08ec`.
- **Scope & labels:**
  - Created 26 repository labels (`priority:P0`–`P3`, `status:active|ready|blocked|research|done|superseded`, `area:*`).
  - Created 54 open GitHub Issues (#1–#54) corresponding 1-to-1 with active/ready/blocked tasks from `backlog.md`.
  - Historical completed work (prior to 2026-09-14) remains in `completed-backlog.md` as an immutable local archive; completed issues are not duplicated on GitHub.
  - Updated `AGENTS.md`, `docs/SESSION_GUIDE.md`, `docs/START_HERE.md`, `README.md`, `plan.md`, `docs/BUSINESS_ALIGNMENT.md`, and agent skills to establish GitHub Issues as the canonical task system.
  - Added redirect notes and an issue number mapping table to `backlog.md`.
  - Retained the one-time migration script as evidence, but made it read-only by default and fail closed if an applied migration report already exists.
- **Next exact action:** Discover, manage, and close work items via `gh issue` commands; use GitHub Issues for active task tracking.

## Active handoff — Local Qwen agent paused by user decision (2026-09-14)

- **User decision:** The founder explicitly paused the use of the local Qwen agent because it is too slow ("pause the use of the qwen agent, it is too slow, do not use it, record this in the .MD files for future sessions").
- **Enforcement:**
  - Do NOT start the local MLX-LM server (`scripts/worker/run-mlx-server.sh`) or Ollama worker for automated development tasks.
  - Do NOT dispatch batch tasks to `batch-runner.mjs` or use the `qwen-task-dispatch` skill.
  - Background processes (`mlx_lm`) have been terminated and port 8080 cleared.
  - For substantive agent collaboration, use Antigravity built-in subagents (`invoke_subagent` with `research` or `self`) or perform work directly as coordinator.
- **Source:** The durable pause policy and GitHub Issues workflow landed together in `11c08ec`.
- **Next exact action:** Carry out all development, reviews, and backlog tasks using the primary model and built-in subagents; do not attempt local Qwen worker execution.

## Active handoff — Tonal app-opening splash background (`BRAND-SPLASH-001`, 2026-09-14)

- **Implemented and committed:** Commit `dccac84` replaces the flat dark startup handoff with `launch-blue-backdrop.png`, a generated blue-only full-screen tonal field matched to the approved ribbon-M icon. The foreground M is now the alpha-preserving `mizyun-mark.png`, not the opaque square launcher image, so it has no visible square boundary over the tonal background. Native startup uses `mizyun-native-splash-mark.png` composited on the same `#0C70ED` configured splash color, preserving a square-free centered mark before JavaScript renders.
- **Files:** `apps/mobile/app.json`, `apps/mobile/src/components/animated-icon.tsx`, and the three new `apps/mobile/assets/images/{launch-blue-backdrop,mizyun-mark,mizyun-native-splash-mark}.png` assets. The launcher icon itself remains unchanged.
- **Automatically verified:** `pnpm check` passed on 2026-09-14, including formatting, all typechecks, iOS and Android Hermes bundle exports (which include the two new opening assets), tests, deployment safeguards, build matrix, and AI invariant checks. A rendered 393×852 compositing preview was also inspected; the full-screen backdrop is fully opaque and the mark has no square edge. Expo SDK 57 uses a color-only standard native splash background, so this implementation provides a coherent flat native frame and a full tonal JavaScript handoff; it does not claim a native full-screen gradient.
- **Why it appeared to roll back:** An earlier dirty-tree Dev build temporarily contained these visuals, but the later exact-SHA `8e3853d` Dev installation replaced that app with committed source that did not yet contain them. The code was not reverted; it had never been committed until `dccac84`.
- **Dev device installation:** Current pushed `main` at `f464159` was verified with a fresh `pnpm check`, clean-prebuilt for Dev, compiled as a Release for `com.mizyun.development`, installed over the existing `Mizyun Dev` app on physical iPhone `Adam's Iphone 😋` (`00008140-001114501A86801C`), and launched successfully through CoreDevice. The existing app was not uninstalled. `OFFLINE-CACHE-001` remains absent. The Build 3 Production IPA was checksummed before backup and after restoration around the clean prebuild; its SHA-256 remained `1dcacbadf31aadd3a7ae7b1c5d43966f9df95be4a600cfaf443925c2cb2775b9`.
- **Remaining device gate:** Installation and launch are evidenced, but the tonal cold-start transition and mark/background seam have not yet been visually accepted by the founder.
- **Next exact action:** On the installed Dev app, force-close and cold-start several times, then visually accept the native-to-JavaScript transition and mark/background seam.

## Active handoff — Beta branding and dashboard copy (2026-09-14)

- **Implemented and committed:** Commit `dccac84` removes the dashboard's obsolete “Foundation mode” card. It adds the reusable `BrandWordmark` component, which renders `MIZYUN` with a compact `BETA` badge, to the primary Dashboard, Workouts, Meals, Coach, and Account headers, as well as the onboarding header, Coach thread list, and web tab rail.
- **Beta disclosure added:** The `BETA` pill is now an accessible button that opens a brief dismissible beta notice: bugs may occur, behavior may vary, some features may not yet be enabled, and feedback is highly valued. The same notice is visible in the first onboarding welcome step immediately before the Beta Pro Pass request card.
- **Automatically verified:** A fresh repository-wide `pnpm check` passed after all changes: navigation and formatting, 15 workspace typechecks, iOS/Android Hermes bundles, core 261 tests, mobile 414 tests, API 518 tests with 15 credential-gated E2E skips, deployment/build/IPA safeguards, and 56 AI invariants. The earlier focused onboarding suite also passed 36 tests.
- **Remaining device gate:** The committed candidate is installed and launches on the physical Dev iPhone. Founder visual acceptance remains for narrow headers, the clickable badge popup, first-page onboarding disclosure, Foundation-card removal, and splash cold starts.

## Active handoff — Offline cache paused (`OFFLINE-CACHE-001`, 2026-09-14)

- **State:** Deferred and tracked as `status:ready` in [GitHub Issue #14](https://github.com/AdamHikl/mizyun/issues/14). The founder rejected the partial prototype as insufficient quality on 2026-09-14; its local-only shelf branch was deleted and none of that implementation is retained in `main`, the shared worktree, or a remote branch.
- **Release boundary:** No `OFFLINE-CACHE-001` runtime integration is enabled or deployed. Existing SecureStore usage for unrelated features is unchanged.
- **Next exact action:** When the founder resumes `OFFLINE-CACHE-001`, redesign and implement it from scratch against Issue #14's owner isolation, purge, corruption, reconnect, verification, Dev deployment, and physical-device acceptance criteria.

## Active handoff — Coach workout/meal intent disambiguation (`FIX-COACH-INTENT-001`, 2026-09-14)

- **Implemented:** `apps/api/src/modules/coach/nutrition-action.ts` is now a conservative classifier with two safeguards. (1) A **workout-signal veto**: workouts/training/exercises/sessions plus common activity and exercise names, including plurals (`walk`, `run`, `jog`, `ride`, `swim`, `cycle`, `hike`, `sprint`, `lift`, `cardio`, `gym`, `hiit`, `sets`, `reps`, `squats`, `deadlifts`, `bench`, ...), and Slovak `cvičenie*`/`tréning*`. (2) A **food-context requirement**: a quantity with a unit or a common food/drink word (English plus a small Slovak set). Doubtful statements stay with the grounded text Coach. The mobile app only renders `meal_log` proposals; there is no mobile-side intent logic to keep in sync.
- **Verification:** 24/24 unit tests pass, including 8 new negative cases — 5 of them ("Add two hour walk to my completed workouts today", "Log my morning run", "Add 3 sets of squats to today's log", "I had 5 squats this morning", "Zapíš môj tréning na pondelok") were genuine false positives under the old regex. Full `pnpm check` green (navigation, formatting, typecheck, mobile bundle, all package tests, deployment safeguards, build matrix, AI-eval invariants). Source: base `765ef59` plus this commit (the classifier change and this handoff entry land together).
- **Independent review: PENDING (open gate).** AGENTS.md requires an independent agent review for AI-access/budget-adjacent changes. The local Qwen worker cannot run inside the agent sandbox (no Metal GPU: `mlx.core` fails with "No Metal device available"; the 28 GB 8-bit model is cached but unusable from sandboxed processes), and the out-of-sandbox launch was rejected because the auto-reviewer 404'd: `http://127.0.0.1:8000/v1/responses` serves Qwen models instead of a reviewer model. Work proceeded locally per the AGENTS.md exception clause; the package does not close until an independent review lands.
- **Hygiene:** generated `.agents/tasks/batch-report-*.json` files are now excluded from the Prettier gate (`.prettierignore`) and the mutable `batch-report-latest.json` pointer from git (`.gitignore`); the prior session's uncommitted batch artifacts were committed as `765ef59`.
- **Needs user input (tracked in GitHub Issues):** Google Play accounts (`PLAY-001`–`006` / #1–#6), Apple accounts (`APPLE-004` / #7, `STORE-002/003` / #8/#9), founder alpha week (`ALPHA-001` / #37), and approval to run the MLX reviewer out of sandbox (or a fix to the `:8000` reviewer endpoint).
- **Next exact action:** obtain the independent review of the `nutrition-action.ts` diff, then `pnpm deploy:dev <sha>` and accept the workout-vs-meal routing on the `com.mizyun.dev` iPhone build (e.g. "Add two hour walk to my completed workouts today" must reach the grounded Coach, not a meal draft).

## Active handoff — Native MLX Local Worker, Backlog Split & Coach Workout Intent (`LOCAL-WORKER-003`, `FIX-COACH-INTENT-001`, 2026-09-13)

- **Backlog separation & cleanup**:
  - Divided backlog into two distinct files: [`backlog.md`](backlog.md) (retained exclusively for 53 to-do/active/ready/research/blocked items) and [`completed-backlog.md`](completed-backlog.md) (dedicated archive for 114 completed/superseded work packages and implementation evidence). Formatted and verified with Prettier.
- **Coach workout vs meal intent bug (`FIX-COACH-INTENT-001`, P1, `ready`)**:
  - User demonstrated natural language workout logging ("Add two hour walk to my completed workouts today") being mistakenly intercepted as a meal draft.
  - Root cause reproduced: `isExplicitMealLoggingIntent` in `apps/api/src/modules/coach/nutrition-action.ts` matched prefix `/^(?:please\s+)?(?:log|add|record)\b/i`, but the negative lookahead `!/\b(?:workout|training|exercise|session)\b/i` failed because `\bworkout\b` does not match plural `workouts`, nor activity nouns like `walk`, `run`, `swim`, `cardio`.
  - Added `FIX-COACH-INTENT-001` to `backlog.md` and created bounded Qwen task packet [`.agents/tasks/task-coach-intent.json`](.agents/tasks/task-coach-intent.json).
  - Local MLX Qwen batch run: `task-splash-color-001` completed in 134.7s, changing only `apps/mobile/app.json` and `apps/mobile/src/components/animated-icon.tsx`; the worker verification and a fresh coordinator `pnpm --filter @mizyun/mobile typecheck` both passed. `task-coach-intent-001` then exceeded the 300-second MLX request timeout before returning edits; its precise retry/help requirement is recorded under Session engineering in `backlog.md`. No commit, push, deployment, remote-infrastructure access, credential change, or remote configuration change was attempted.
  - Overnight-worker hardening: MLX request timeout is now configurable from the batch manifest and set to 15 minutes (bounded to 1–30 minutes); the batch supervisor converts worker exceptions into concrete blockers and continues to later tasks, but halts for coordinator review after any out-of-allowlist write. The MLX-LM/Qwen runtime supports thinking enabled/disabled, not a literal `xhigh` reasoning level; the stable local configuration is `enable_thinking: true` with a 4,096-token generation budget. An attempted 8,192-token configuration did not remain available, so it was not retained.
- **Previous additions**:
  - `OFFLINE-CACHE-001` (P1, `ready`): Offline profile & daily dashboard cache using SecureStore.
  - `BRAND-SPLASH-001` (P2, `ready`): Splash background color calibration from `#208AEF` to `#0B0F12` ([`.agents/tasks/task-splash-color.json`](.agents/tasks/task-splash-color.json)).
- **Verification**: `pnpm navigation:check` passed (0 errors), `pnpm test:navigation` passed (27/27 tests), mobile typecheck passed.
- **Next exact action**: Retask `FIX-COACH-INTENT-001` only after reducing its MLX context or setting a longer bounded response timeout; retain its two-file allowlist and focused API test. The local Qwen batch monitor checks in every 30 minutes and reports only completion, failure, or a needed action.

## Active handoff — OpenCode local Qwen connection (`LOCAL-WORKER-002`, 2026-09-13)

- **Implemented:** project `opencode.json` now connects directly to MLX-LM on
  `127.0.0.1:8080/v1` using `@ai-sdk/openai-compatible`. Previous Responses
  bridges remain preserved but unused. Launcher disables thinking by default
  and raises the default output budget to 4096. Existing Ollama worker changes
  and mobile work were preserved.
- **Live local evidence:** exact `mlx-community/Qwen3.8-27B-8bit` returned
  `MLX_OK`; OpenCode 1.18.30 completed actual read/write/read tools and `DONE`
  in a disposable directory. MLX-LM 0.31.3 / MLX 0.32.2 on this Mac.
- **Source:** `1b02190b3665a813fe5875e3d33762dce34abf6b` plus uncommitted work;
  no commit, push, deployment, or device/release claim in this work package.
- **Verification:** `python3 scripts/worker/smoke-opencode.py` passed in 122.1s
  with completed read/write/read events and exact random file value. Shell/Python
  syntax, changed-file formatting, `git diff --check`, and `pnpm navigation:check`
  passed (navigation has 14 pre-existing stale-review warnings). `pnpm check`
  passed its 27 navigation tests, then stopped on pre-existing formatting in
  `scripts/worker/lib/task-runner.mjs`; subsequent full-gate stages did not run.
- **Independent review:** helper checked primary oMLX/OpenCode/model sources and
  reviewed the config, launcher, smoke test, and guide; no blocking defects.
  Keep MLX-LM for this working setup. oMLX remains an unbenchmarked alternative
  for cache/model-management or concurrent-serving needs.
- **Usage:** [local setup guide](docs/tutorials/LOCAL_QWEN_OPENCODE.md) and
  [agent delegation runbook](.agents/guides/LOCAL_QWEN_OPENCODE_AGENT_GUIDE.md).
  The server is running in this session's terminal; it must remain
  open or be restarted with `bash scripts/worker/run-mlx-server.sh`.
- **Next exact action:** start a new `opencode` session from this repository and
  use the selected local Qwen model for a bounded coding task. Large-context
  quality and sustained parallel throughput are not established by the smoke test.

## Active handoff — Regional Food Standards Decoupled from Coach Preferences (`COACH-PREF-002`, 2026-09-13)

- Decoupled Country / Regional food standards from `CoachPreferencesCard` into a dedicated first-class card and accordion under the **Profile & Goal** section of `SettingsScreen`.
- **Components & Data Layer**:
  - Authored `apps/mobile/src/features/settings/regional-food-standards-data.ts`: pure functions `getCountryStandardDisplay` and `saveCountryStandard` with normalization, ISO 3166-1 alpha-2 validation, and safe preservation of existing `profile.coachingPreferences`.
  - Authored `apps/mobile/src/features/settings/regional-food-standards-card.tsx`: displays active calibration state (`CountryFlag` + localized country name or Global standard icon), interactive `Pressable` trigger, `CountryPickerModal` integration, immediate background persistence, accessible feedback alert, and active activity spinner during saving.
  - Refactored `apps/mobile/src/features/settings/coach-preferences-card.tsx`: completely pruned country picker triggers, modals, and unused styles while guaranteeing `countryCode` is strictly preserved on coach preferences save.
  - Integrated into `apps/mobile/src/features/settings/settings-screen.tsx`: added `Regional Food Standards` CollapsibleSection under Section 1 (Profile & Physical Stats / "Profile & Goal" tab) with live country status in the section subtitle.
- **Worker Infrastructure Hardening** (`scripts/worker/lib/task-runner.mjs`):
  - Upgraded `TaskRunner.validatePath` to support monorepo package suffix matching (e.g. `src/...` resolving to `apps/mobile/src/...`) while strictly maintaining repo root containment and preventing directory traversal escapes (`!absPath.startsWith(this.repoRoot + path.sep)`).
  - Aligned context truncation threshold with skill documentation (>5,000 characters or >150 lines with `contextSnippet`) to prevent token timeouts on local Qwen execution.
- **Independent Audit & Verification**:
  - Independent review subagent verified two-way `countryCode` data preservation, accessibility roles/labels, monorepo boundaries, and security guardrails (**APPROVED - 100% PASS**).
  - Automated tests: all 9 tests in `regional-food-standards-data.test.ts` and all 48 tests in `src/features/settings/` pass.
  - Repository-wide checks: `pnpm check` passed cleanly (exit 0) with all unit tests, typechecks, bundle checks, build matrix, deployment safeguards, and AI evaluation benchmarks green.
- **Next exact action**: Commit and deploy to Pi Dev via `pnpm deploy:dev` to verify the new settings accordion and country picker on physical device.

## Active handoff — Multi-Tier Agent Orchestration (Gemini Coordinator + Qwen Local Worker + Astra Escalation) (`LOCAL-WORKER-001`, 2026-09-13)

- Implemented the local workhorse and control plane architecture connecting **Gemini 3.8 Flash** (Antigravity coordinator) to **Qwen3.8:27b-q8_0** (local Mac M1 Max Ollama worker) and **Astra** (architect & escalation reviewer).
- **Worker Engine & Transport** (`scripts/worker/`):
  - Built zero-dependency Node.js ESM client (`scripts/worker/lib/ollama-client.mjs`) communicating with Ollama REST API (`http://127.0.0.1:11434`), supporting connection health checks, tags listing, model availability checks, and structured JSON parsing.
  - Implemented `scripts/worker/lib/task-runner.mjs` enforcing the **Worker Contract**: whitelisted `allowedFiles` verification, path-traversal prevention, prohibited action rejection, automated verification command execution, and **bounded retries** (max 2 cycles; self-correction on attempt 1 failure).
  - Built standard Model Context Protocol (MCP) server (`scripts/worker/mcp-server.mjs`) over stdio, exposing `qwen_run_task` and `qwen_check_status` tools. Registered globally in `~/.gemini/config/mcp_config.json`.
  - Built CLI runner (`scripts/worker/run-task.mjs`) with `--check`, `--inline`, and file-based execution.
- **Routing Rules, Skills & Continuity**:
  - Authored `.agents/rules/model-routing.md`: Defines strict boundaries between Qwen (routine edits, tests, docs), Gemini (decomposition, integration, verification, git/deploy control), and Astra (auth/RLS, migrations, privacy, >2 retry escalation, release approval).
  - Authored `.agents/skills/qwen-task-dispatch/SKILL.md`: Operational guide for packet creation, execution evaluation, and escalation rules.
  - Created `docs/LOCAL_WORKER_BASELINE.md`: Living register to track 10–20 tasks across tokens, wall-clock time, retries, pass rates, and escalation rates.
  - Registered paths in `docs/feature-map.json` under `environment-build-deployment`.
- **Verification & Acceptance Evidence**:
  - Verified local daemon: Ollama is online with pinned `qwen3.8:27b-q8_0` (30.0 GB).
  - Verified MCP stdio protocol: `initialize` and `tools/list` respond with compliant JSON-RPC 2.0 payloads.
  - End-to-end task run (`task-smoke-001`): Qwen received bounded task, generated code, wrote `allowedFiles`, ran verification command, and returned `{ status: "success", attempts: 1 }` in 38.7s.
  - Repository checks: `pnpm navigation:check` (0 errors), `pnpm format:check` (100% clean), `pnpm typecheck` (all 15 packages passed).
- **Next exact action**: Log the first 10–20 development tasks in `docs/LOCAL_WORKER_BASELINE.md` using the MCP tool `qwen_run_task` or CLI runner for routine edits.

## Active handoff — Shared agent skills & context hygiene (`AGENT-SKILLS-001`, 2026-09-13)

- Implemented shared Codex and Antigravity skills in `.agents/skills/` pursuant to [`docs/AGENT_SKILLS_IMPLEMENTATION_GUIDE_2026-09-13.md`](docs/AGENT_SKILLS_IMPLEMENTATION_GUIDE_2026-09-13.md).
- **Stage A complete**: Compacted `status.md` by archiving 20 historical handoffs (Sep 10–12) into `docs/archive/status/STATUS_HISTORY_2026-09-10_THROUGH_2026-09-12.md`, shrinking startup status reading from ~65KB to ~11KB (~83% reduction) while preserving active items and open gates. Established living acceptance register in [`docs/AGENT_SKILLS_ACCEPTANCE.md`](docs/AGENT_SKILLS_ACCEPTANCE.md).
- **Stage B complete**: Authored three core P0 shared skills:
  - `mizyun-session-context`: Fast focused startup checklist, `pnpm context <id>`, `pnpm impact` advisory radius, bounded context packet.
  - `mizyun-verify-handoff`: Tiered verification, quality gates (`docs/QUALITY_GATES.md`), mandatory non-author review, 5 distinct evidence levels.
  - `mizyun-plan-next-session`: Structured future-session planning, platform research, zero-mutation planning boundary.
- **Stage C complete**: Hardened operational skills & scripts:
  - `check-unprocessed-feedback`: Removed blanket sandbox escape directive, enforced bounded sanitized summaries, guarded against bulk marking.
  - `scripts/check-user-feedback.mjs`: Added stdin SQL piping and 30s timeout guard matching `check-beta-pro-requests.mjs`.
  - `check-beta-pro-requests`: Separated read-only query from tier mutation actions, documented APNs/Expo push side effects, and clarified ADR-0024 policy boundary (immediate AI Coach access upon adult consent; Beta Pro is photo quota upgrade only).
- **Stage D complete**: Registered `.agents/skills` under `environment-build-deployment` in `docs/feature-map.json`; `pnpm navigation:check` passes with 0 errors.
- **Independent Audit & Review**: Research subagent independently audited the diff against all 7 guide criteria; relative link depths in P0 skills resolved to `../../../`; certified **APPROVED (100% PASS)**.
- **Verification**: `pnpm check` passed cleanly (exit 0) with all unit tests, bundle exports, deployment safeguards, build matrix, and AI invariant tests green. Prettier formatting 100% clean (`pnpm format:check`).

## Active product handoff — Product analytics backend implemented & verified (`OBS-002`, 2026-09-13)

- Implemented the first-party product analytics backend (`OBS-002`) following [the architecture, privacy rules, and staged implementation plan](docs/PRODUCT_ANALYTICS_IMPLEMENTATION_PLAN_2026-09-13.md), incorporating user disclosure update: removed legacy copy claiming data stays on device; updated disclosures in Onboarding and Settings to state coarse telemetry is sent to Mizyun servers to improve app UX, linked to user account with full export and erasure rights.
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

## Environment & deployment snapshot

| Environment       | Host & Location                | Deployed SHA             | Health & Status                                           | Notes                                                                           |
| ----------------- | ------------------------------ | ------------------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **Local Mac**     | Apple Silicon (`darwin-arm64`) | `f464159` + handoff docs | `pnpm check` passed; Dev Release built and installed      | Build 3 IPA preserved; Dev app launched on physical iPhone                      |
| **Pi Dev**        | Raspberry Pi 5 (`mizyun-pi`)   | `fe19eda`                | HTTP 200 (`https://mizyun-api-dev.phiskel.com/v1/health`) | Port 4100 API / 8100 Kong / 5433 DB; UID 999 unprivileged; worker leases active |
| **Pi Production** | Raspberry Pi 5 (`mizyun-pi`)   | `3bad20c`                | HTTP 200 (`https://mizyun-api.phiskel.com/v1/health`)     | Port 4000 API / 8000 Kong / 5432 DB; all forward migrations applied             |
| **Windows PC**    | Windows / WSL2 (`mizyun-pc`)   | `—`                      | Standby hot backup                                        | Retained as secondary backup per ADR-0020                                       |

## Implementation versus release gate status

- **Implemented & Deployed to Dev on Pi (`fe19eda`)**:
  - `PUSH-001`: Direct Apple APNs HTTP/2 gateway authentication and push token auto-registration bridge (`PushRegistrationBridge`) in `_layout.tsx`. Fixed repository push token updates for approved accounts in `SupabaseBetaProRepository` and `InMemoryBetaProRepository`. Added `scripts/send-push.mjs` CLI.
  - `LOCAL-WORKER-001`: Multi-tier agent orchestration with local Qwen3.8:27b-q8_0 worker via MCP & CLI, baseline tracking register, and workout history card overflow fix.
  - `OBS-002`: Product analytics backend migration `20260913100000_product_analytics_backend.sql` applied on Pi Dev.
  - `PROD-GATE-001`: Progress photos gated to Dev variant; Production runs lean 3-action dock and feedback-only shortcuts.
  - Sub-fixes verified: `FIX-WORKOUT-001` (comma parsing), `FIX-MEAL-001` (stale draft timestamps), `FIX-AI-PHOTO-001` (UTC photo scan quota matching UI).
  - Apple Push Notifications (APNs) direct HTTP/2 gateway authentication enabled and live verified.
- **Physical Device Installation & Push Delivery Verified (Gate R3 Part B)**:
  - Compiled and installed updated release build on physical iPhone (**Adam's Iphone 😋** / iPhone 16 Pro, UDID `7FBC9ACC-918A-5A9B-8D22-B9F1FF652A06`):
    - `Mizyun Dev` (`com.mizyun.development`, Release configuration, commit `fe19eda`, **Push Notifications enabled** via renewed Apple provisioning profile `29598fbb-4d6a-4de7-9be8-7e0281303dc5`, targeting `https://mizyun-api-dev.phiskel.com`).
    - Verified fix `AUTH-001`: `profileLoading` no longer blocks app startup on `<LoadingScreen />`; abort timeout added to `fetchProfile()`.
    - Verified `PUSH-001`: Device APNs push token (`2e1a63c2362b71ec0fd6d85c815fa14aa36ec32cf6b112744e1d29ae4d14cedf`) auto-registered on launch. Live APNs test notification successfully dispatched and accepted with HTTP 200 by Apple APNs sandbox gateway (`api.sandbox.push.apple.com`, topic `com.mizyun.development`) for `adam.hikl@outlook.com`.
- **Open Implementation Work (Remediation Checklist)**:
  - Q2: Durable unknown-outcome persistence for ambiguous retries across network drops.
  - Q7/Q8: Consent UI context preservation and live model evaluation.
  - Q9: Remote readiness probe identity and live promotion proof.
- **Explicitly Held / Blocked Release Gates**:
  - **Gate R8**: Physical device journey on iPhone (standalone without Metro, Auth redirect, meal logging, export, deletion) & off-device backup restore rehearsal.
  - **Production Promotion**: Separately gated milestone requiring explicit user authorization, clean pre-promotion backup, and accepted physical device evidence.

## Current blockers & known contradictions

1. **Release Gate R8**: Physical device journey testing and off-device recovery rehearsal remain open dependencies before promoting candidate to Production.

## Next exact action

1. Verify the app navigation and workout history card layout on the installed **Mizyun Dev** build on physical iPhone (`Adam's Iphone 😋`).
2. For **Release Gate R8**: Physical device journey testing and off-device recovery rehearsal on installed release builds.

## Evidence & archive links

- Skills Implementation Guide: [`docs/AGENT_SKILLS_IMPLEMENTATION_GUIDE_2026-09-13.md`](docs/AGENT_SKILLS_IMPLEMENTATION_GUIDE_2026-09-13.md)
- Skills Acceptance Register: [`docs/AGENT_SKILLS_ACCEPTANCE.md`](docs/AGENT_SKILLS_ACCEPTANCE.md)
- Historical status archive (Sep 10–12): [`docs/archive/status/STATUS_HISTORY_2026-09-10_THROUGH_2026-09-12.md`](docs/archive/status/STATUS_HISTORY_2026-09-10_THROUGH_2026-09-12.md)
- Historical status archive (Through Sep 9): [`docs/archive/status/STATUS_HISTORY_THROUGH_2026-09-09.md`](docs/archive/status/STATUS_HISTORY_THROUGH_2026-09-09.md)
- Product Analytics Plan: [`docs/PRODUCT_ANALYTICS_IMPLEMENTATION_PLAN_2026-09-13.md`](docs/PRODUCT_ANALYTICS_IMPLEMENTATION_PLAN_2026-09-13.md)
- Remediation evidence checklist: [`docs/REMEDIATION_EVIDENCE_CHECKLIST.md`](docs/REMEDIATION_EVIDENCE_CHECKLIST.md)
- Navigation acceptance register: [`docs/AGENT_NAVIGATION_ACCEPTANCE.md`](docs/AGENT_NAVIGATION_ACCEPTANCE.md)
