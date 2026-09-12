# Mizyun current status

## Latest handoff — Google Play publishing plan (2026-09-12)

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
