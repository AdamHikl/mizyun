# Mizyun current status

> Fast-changing session handoff. Update this file at the end of every development session. Last updated: **2026-08-15** (Raspberry Pi 5 migration cutover).

## Executive snapshot

- **Product stage:** technical pre-alpha; the architecture, domain/API foundation, and native mobile UI are verified and polished.
- **Roadmap position:** INFRA-ENV-001 / INFRA-WIN-001 infrastructure migration to the **Raspberry Pi 5** (`rpServer`, Ubuntu 24.04 ARM64) is complete and fully operational. The Pi 5 now runs the live self-hosted Supabase Docker stack, Fastify API, and Cloudflare Named Tunnel under systemd services (`mizyun-supabase`, `mizyun-api`, `cloudflared`) with auto-start on boot. The Windows PC (`mizyun-pc`) remains an offline hot backup.
- **Latest verified operational slice:** The backend migration from the Windows PC to the Raspberry Pi 5 is complete. The full PostgreSQL data snapshot (3 profiles, 2 goals, 17 food entries, 3 body measurements) was restored and verified. The Fastify API was started and verified locally (`http://127.0.0.1:4000/v1/health` < 1 ms response). Cloudflare Tunnel was installed on ARM64 and cut over to the Pi. Public health endpoints `https://mizyun-api.phiskel.com/v1/health` (HTTP 200 OK) and `https://mizyun-supabase.phiskel.com/auth/v1/health` (HTTP 401 Unauthorized, expected without key) are actively served from the Pi. Promotion workflow via `scripts/promote-production.sh` succeeded on exact commit `d7fcf3e0756c0b65f01c7f3b34d76ea6bbe8ea2b` with backup `/srv/mizyun/backups/20260815T061745Z`. Full `pnpm check` on the Mac is green: 1,057 tests passed, 17 opt-in tests skipped, iOS and Android production exports clean.
- **Latest verified implementation slice:** The AI-ACT-006 multi-workout plan is now distribution-aware and label-friendly. The pattern matcher extracts an explicit upper/lower session count from free-text ("two upper body and one lower body day" → `["upper", "upper", "lower"]`) and forwards it to the deterministic training-prescription engine, which filters movement patterns per session (upper sessions get push/pull/vertical/core/mobility, lower sessions get knee-dominant/hip-hinge/core/mobility) and labels each session "Upper body" / "Lower body" / "Full body" instead of the generic "Session N". The plan-level focus label on the mobile proposal card is now humanized (e.g. `general_hypertrophy` → "Upper-body emphasis", `ppl` → "Push · Pull · Legs") so snake_case code values never leak to the user. The Coach chat surface now keeps the "Coach is thinking…" indicator visible for at least 500 ms after send, so the deterministic multi-workout path (which is genuinely < 200 ms) no longer flashes a spinner so briefly that it reads as a cache hit; LLM calls (1–5 s) are unaffected.
- **Branch:** `main` is at `d7fcf3e`; the production Pi checkout and `.git/mizyun-production-sha` both match.
- **AI provider:** Founder production Mistral access is enabled for the week-long dogfood test. The provider suite passes 30 tests, including structured grounded text, missing-evidence behavior, direction-aware wellness moderation, and blocked critical-safety moderation. The current SDK still uses its default global Mistral endpoint; EU regional routing remains a follow-up before real-user health data. The LLM extraction layer for free-form multi-workout intent (the user's option C from this segment) is a documented follow-up; the pattern-based detector handles the canonical English/Slovak queries.
- **Local runtime at handoff:** `pnpm check` passes with 1,008 tests and 17 opt-in tests skipped; iOS and Android production bundles compile clean. `pnpm db:verify` still passes a clean reset, database lint, and all 71 pgTAP assertions. No production schema migration is required for this segment.
- **Dev loop (current focus):** `pnpm check` green: formatting, all workspace typechecks, iOS and Android production exports, and 1,008 tests passed; 17 opt-in live/e2e tests skipped.
- **Moderation regression gate:** `pnpm check` passes with 954 tests and 17 opt-in tests skipped; the Mistral provider suite has 30 passing tests and proves input-health refusal, output-only-health allowance, and continued blocking when another unsafe output category is present.
- **Coach retry UX gate:** the mobile suite passes 155 tests (was 152, +3 for the text+photo meal composer), including stable optimistic IDs and retry-result de-duplication after restart; mobile TypeScript and both platform production bundles pass.
- **iOS:** both `Mizyun` (`com.mizyun.app`) and `Mizyun Dev` (`com.mizyun.dev`) are installed on physical iPhone `00008140-001114501A86801C`. The Production Release containing the AI-ACT-007 "Refine with AI" block was built (Build Succeeded, 0 errors), installed via `xcrun devicectl`, verified by CoreDevice as `com.mizyun.app` version `1.0.0` build `1`, and launched successfully on 2026-08-08. It uses the production API/Supabase HTTPS hosts and the Personal-Team APNs override; the Dev app remains independently installed. The first install attempt landed while the device was locked; the user unlocked and the subsequent `devicectl device process launch` returned `Launched application with com.mizyun.app bundle identifier`.
- **Android:** standalone Release APK passes complete journey on Pixel 9 API 36 emulator.

## What is genuinely delivered

### Architecture and platform foundation

- Expo SDK 57 mobile app and Fastify API in a pnpm TypeScript monorepo.
- Explicit boundaries for core rules, contracts, identity, API transport, memory, agent orchestration, model providers, and infrastructure adapters.
- Provider-neutral mobile authentication with chunked Expo SecureStore session persistence.
- Validated API/mobile configuration and a provider-neutral authenticated `HttpApiClient`.
- Fastify bearer-token verification, safe structured errors, request IDs, and sensitive-log redaction.
- Forward-only Supabase migrations for profiles, goals, food, workouts, measurements, conversations, memories, and private media.
- RLS policies, ownership indexes, private-storage path policies, and pgTAP two-user isolation coverage.
- AI and memory interfaces are replaceable; the API can compose the Mistral adapter, while the safe disabled provider and external-access kill switch remain the defaults.

### Domain and API behavior

The following behavior exists as tested pure domain logic and Fastify routes:

- profile and active-goal/history lifecycle;
- new-user onboarding submission for display name, units, and primary goal;
- manual food CRUD and daily/range calorie/macro summaries;
- custom exercise CRUD;
- workout sessions, set observations, and recent-performance summaries;
- weight and body-measurement observations;
- deterministic, versioned energy target and balance calculations;
- account data export and two-step application-data deletion orchestration;
- private-media metadata, signed upload/download abstractions, deletion, timeline, and selected-photo comparison.
- Supabase-backed media metadata plus real private Storage signing/removal, with every operation bound to the verified user's JWT and selected by configured production composition.

The calculation layer correctly treats missing data as incomplete, separates deterministic output from future AI explanation, and avoids silently turning uncertain estimates into facts.

- Persistent repositories (PERSIST-001): three per-feature ports in `@mizyun/core` (`ProfileRepository`, `GoalRepository`, `FoodEntryRepository`) accept an `accessToken` and have Supabase adapters in `@mizyun/adapter-supabase-server` (`SupabaseProfileRepository`, `SupabaseGoalRepository`, `SupabaseFoodEntryRepository`) that bind the token via `setSession` so every PostgREST query runs under the verified principal's RLS. A forward-only migration (`20260718100000_persist_001_columns.sql`) adds `activity_level` + `sex_at_birth` to `public.profiles`, `pace` + `review_date` to `public.goals`, and a partial unique index `goals_one_active_per_user` that enforces "at most one active goal per user" at the database. The API composition root wires the Supabase adapters when `supabasePersistence` is provided; in-memory remains the default so the standard `pnpm check` gate stays green without Docker. 21 mocked-client adapter unit tests + 1 opt-in real-Stack e2e file (`persistence.e2e.test.ts`, `describe.skipIf` guarded by `SUPABASE_E2E_URL`) prove cross-user RLS rejection, persistence across fresh repo instances, and partial-unique violation translation.

- Persistent training + body + account cascade (PERSIST-002): the remaining four ports (`ExerciseRepository`, `WorkoutRepository`, `WorkoutSetRepository`, `BodyMeasurementRepository`) are widened with `{ readonly accessToken: string }` and now have Supabase adapters that bind the access token via `setSession`. The SQL FK `workout_sets.workout_id → workouts(id, user_id) ON DELETE CASCADE` removes the need for an explicit cascade call — the Supabase workout-set adapter's `deleteAllForWorkout` is a documented no-op (returns 0). The `AccountRepository` cascade (DATA-001) threads `accessToken: ""` to the per-feature adapters because the in-memory composition root uses in-memory repos (PERSIST-002 follow-up: the production composition root uses the service-role key for account-deletion orchestration when the hosted adapter lands). 18 new mocked-client adapter unit tests + 3 new opt-in e2e tests for exercises / workouts+cascade / body-measurements. The standard gate remains green without Docker; in-memory is still the default.

### Mobile surfaces

The mobile app currently includes:

- configuration-required, authentication, confirmation/recovery, and session-loading states;
- an onboarding wizard connected to the profile/goal endpoints, including height, birth year, activity level, sex at birth, units, goal, and baseline weight;
- onboarding baseline weight in metric or imperial units, persisted before the profile completion marker with retry-safe discovery of partial prior writes;
- an Account tab with verified-principal display and sign-out;
- a Home dashboard that reads today's local-day calorie/macro and deterministic energy summary, latest weight, and calendar week/month review data from the API;
- an energy-input recovery route for existing accounts, with unit-aware height editing and explicit incomplete-state reasons;
- dashboard routes to create a manual meal, a minimal completed workout record, or a weight observation;
- an authenticated meal-photo draft flow that normalizes selected images to bounded JPEGs, asks the vision provider for structured calorie/macro estimates, validates the response, surfaces warnings, and requires user editing/confirmation before the normal food-entry save; the photo path can carry an optional text hint from the same composer so the user can add portion/ingredient context the photo alone cannot resolve;
- small encrypted, user-scoped logging drafts that survive app restart and are cleared only after the API confirms success;
- metric/imperial weight entry and display with canonical kilograms at the API boundary;
- body progress history with raw readings, optional waist/chest measurements, confirmed correction deletion, and a labeled time-aware smoothed trend/rate;
- a recoverable workout session with custom exercise creation, rep/load/duration/distance/RPE sets, prior performance, completion, and confirmed deletion;
- a progress-photo route with explicit per-upload consent, camera/library selection, bounded metadata-stripped JPEG preparation, direct signed upload, private timeline, two-photo comparison, interrupted Android picker recovery, and confirmed permanent deletion;
- a Coach conversation UI with disabled/unavailable, persisted thread, pending/retry, evidence, archive/delete, and visible non-medical/uncertainty states;
- an optional product-analytics choice during onboarding and in Account, with a closed event schema, 30-day/500-event local bound, voluntary JSON export, and disable/clear controls.

## Critical implementation distinction

The core manual tracking and private progress-photo lifecycles are implemented and pass together on native iOS and Android; release-grade hosted/device acceptance remains incomplete:

- food entries now have a complete manual mobile lifecycle for today's local calendar day; multi-day history remains deferred;
- workout templates/reordering and broader progression summaries remain absent; the manual active-session/set/previous-performance loop is available;
- body measurement activation, capture, raw history, and labeled trend are available; additional measurement kinds remain schema-extensible;
- the dashboard shows deterministic energy state and calendar week/month reviews; its stored meal/body/workout summaries and restart restoration pass on iOS and Android;
- progress-photo library selection/upload/timeline/compare/delete passes with synthetic non-sensitive media and real signed Storage transfer on iOS and Android; camera hardware and forced Android activity-destruction recovery remain open;
- the Coach UI and API are implemented and one direct synthetic provider call passes, but authenticated application/native AI acceptance remains gated;
- there is no HealthKit/Health Connect step synchronization;
- there is no billing, paywall, crash reporting, network analytics processor, or community functionality; product analytics is local-only and requires voluntary participant export.

With validated Supabase server configuration, the API selects Supabase-backed profile, goal, food, exercise, workout, workout-set, body-measurement, and media-asset repositories plus private Storage. The standard no-environment gate intentionally remains in-memory. Hosted Supabase deployment, physical-device/store-build acceptance, and account deletion across every external resource remain incomplete.

Do not describe NUT-_, WO-_, BODY-_, ENG-_, MEDIA-* or DATA-001 as customer-complete. Their local persistent/native integration is verified, but hosted, physical-device, and repeated-user evidence is still absent.

## Verification evidence — 2026-07-31

```text
pnpm check
  formatting: passed
  workspace TypeScript checks: passed
  iOS Expo/Metro/Hermes export: passed (1,776 modules)
  Android Expo/Metro/Hermes export: passed (1,865 modules)
  tests: 945 passed
  opt-in live/provider and Supabase e2e: 17 skipped

pnpm --filter @mizyun/config test
  51 passed, including 3 production-isolation tests

bash -n scripts/promote-production.sh scripts/backup-production.sh
node --check scripts/deploy-remote.mjs
pnpm deploy:remote --dry-run
  passed

pnpm db:verify
  local destructive reset + all migrations: passed
  database lint: passed, no schema errors
  pgTAP: stalled inside the pg_prove Docker launch before test output and was
    terminated; containers remained healthy and this segment changes no schema

git diff --check
  passed
```

No PC, public tunnel, production database, backup restore, reboot, or physical-
device production acceptance was available in this Mac session. INFRA-WIN-001
remains active until those checks pass. No real user data, production secret, or
live model request was used.

## Verification evidence — 2026-08-01

```text
PC over SSH:
  exact checkout: 89564a6
  Node: v22.22.0; pnpm: 10.33.0; Docker: 29.2.0
  mizyun-supabase.service: active (exited), all Supabase containers healthy
  mizyun-api.service: active (running), local /v1/health: HTTP 200
  cloudflared.service: active (running)

Public tunnel:
  https://mizyun-api.phiskel.com/v1/health: HTTP 200
  https://mizyun-supabase.phiskel.com/auth/v1/health: HTTP 401
    (expected without an API key)

Mac:
  pnpm check: passed after Dev/Production mobile variant and auth redirect changes
  mobile bundle checks: iOS 1,776 modules; Android 1,865 modules
  tests: 945 passed; 17 opt-in tests skipped
```

The API service is enabled for reboot recovery; reboot proof, backup/restore,
hosted Auth/RLS/Storage isolation, and physical-device production acceptance
remain open. No real user data, production secret, or live model request was
used in this verification.

## Verification evidence — 2026-08-08 (AI-ACT-007 refine)

```text
pnpm check
  formatting: passed
  workspace TypeScript checks: passed
  iOS Expo/Metro/Hermes export: passed (1,777 modules)
  Android Expo/Metro/Hermes export: passed (1,866 modules)
  tests: 1,053 passed
  opt-in live/provider and Supabase e2e: 13 skipped

PC over SSH:
  exact checkout: 37f07d41535d90b1b1e9a64282bba9ae337375ac
  promotion backup: /srv/mizyun/backups/20260808T115101Z
  no migration changes
  https://mizyun-api.phiskel.com/v1/health:
    {"status":"ok","service":"mizyun-api","timestamp":"2026-08-08T11:51:02.854Z"}
```

Focused coverage proves the contract parse/validate envelope, the
`/draft/refine` route through the deterministic provider (portion scaled
2x, prompt version `nutrition-draft-refine-v1`), the 422 short-instruction

- injection-screened paths, the 503 when `refineDraft` is missing, the
  shared rate limit with the text/photo endpoints, the Mistral provider
  refine uses the refine system policy + safety replacement, the mobile
  data layer covers 200/short-instruction/422/503/429/network/invalid
  response, and the `StubVisionProvider` scales the existing draft by
  `double`/`halve`/`triple` or a parsed "Ng instead of Mg" regex. The
  Production iPhone Release is being rebuilt; this evidence is the gate
  before the install.

## Verification evidence — 2026-08-15 (Raspberry Pi 5 migration)

```text
Raspberry Pi 5 over SSH (rpserver / mizyun-pi):
  exact checkout: d7fcf3e0756c0b65f01c7f3b34d76ea6bbe8ea2b
  Node: v22.23.2; pnpm: 10.33.0; Docker: 29.7.2; Docker Compose: v5.4.0
  OS: Ubuntu Server 24.04 LTS (ARM64)
  mizyun-supabase.service: active (exited), all 10 Supabase containers healthy
  mizyun-api.service: active (running), local /v1/health: HTTP 200 (< 1 ms latency)
  cloudflared.service: active (running), location=vie05/07

Database verification (Pi Supabase):
  3 profiles, 2 goals, 17 food_entries, 0 workouts, 0 workout_sets, 3 body_measurements
  (exact match with PC pre-migration snapshot)

Public Cloudflare Tunnel endpoints:
  https://mizyun-api.phiskel.com/v1/health:
    HTTP/2 200 OK {"status":"ok","service":"mizyun-api","timestamp":"2026-08-15T06:17:54.313Z"}
  https://mizyun-supabase.phiskel.com/auth/v1/health:
    HTTP/2 401 Unauthorized (expected without API key)

Promotion test:
  bash scripts/promote-production.sh d7fcf3e0756c0b65f01c7f3b34d76ea6bbe8ea2b:
    backup created: /srv/mizyun/backups/20260815T061745Z
    no migration changes, API restarted and healthy in 1s

Mac:
  pnpm check: passed
  formatting: passed
  workspace TypeScript checks: passed
  iOS Expo/Metro/Hermes export: passed (1,777 modules)
  Android Expo/Metro/Hermes export: passed (1,866 modules)
  tests: 1,057 passed; 17 opt-in tests skipped
```

## Verification evidence — 2026-08-10 (Android founder APK sideload build)

Out-of-band request: build a sideloadable Android APK on the Mac so Adam
can install Mizyun on his other Android phone. Mirrors the existing
founder iOS workflow (`mobile:founder-production:ios`).

New artifacts (committed in `a2bd01f`, pushed to `origin/main`):

- `scripts/mobile-founder-production-android.sh` — mirrors the iOS
  script. Sources `apps/mobile/.env.production` (and validates the
  `mizyun-api.phiskel.com` / `mizyun-supabase.phiskel.com` /
  `mizyun://auth/callback` URL triple), sets `EXPO_NO_DOTENV=1` and
  `MIZYUN_APP_VARIANT=production`, exports `ANDROID_HOME` and
  `JAVA_HOME` (prefers Temurin 17 from the Gradle auto-download cache
  because AGP 8 / RN 0.86's `JdkImageTransform` rejects Homebrew's
  JDK 26), then runs `expo prebuild --clean --platform android` for
  the `prebuild` action and `:app:assembleRelease` for the
  `assembleRelease` action.
- `package.json` — adds `mobile:founder-production:android:prebuild`
  and `mobile:founder-production:android:assembleRelease` next to
  the existing iOS scripts.

Build evidence (Mac, 2026-08-10):

```text
pnpm mobile:founder-production:android:prebuild
  Clearing android / Created native directory / Finished prebuild

pnpm mobile:founder-production:android:assembleRelease
  JAVA_HOME = ~/.gradle/jdks/eclipse_adoptium-17-aarch64-os_x.2/jdk-17.0.19+10/Contents/Home
  568 actionable tasks: 389 executed, 179 up-to-date
  BUILD SUCCESSFUL in 5m
```

APK verification:

```text
file:    apps/mobile/dist/mizyun-founder-production-v1.0.0.apk
size:    107,619,485 bytes (103 MB) — universal, all 4 ABIs
sha256:  569918841b1a56d342cd00fff9566feb3f7b0df31b18e3526eab1be268b22a29

aapt dump badging:
  package: com.mizyun.app  versionCode=1  versionName=1.0.0
  minSdk=24  targetSdk=36  compileSdk=36

apksigner verify:
  Verified using v2 scheme (APK Signature Scheme v2): true
  Signer DN: CN=Android Debug, OU=Android, O=Unknown, ...  (debug keystore)
  (Same model as the founder iOS personal-team signing.)

assets/index.android.bundle contains:
  mizyun-api.phiskel.com
  mizyun-supabase.phiskel.com
  mizyun://auth/callback
```

What this proves:

- The Android founder-production build path now exists and is
  repeatable. The script is idempotent — a fresh
  `mobile:founder-production:android:assembleRelease` after a code
  change will re-bundle the JS and produce a new APK in
  `apps/mobile/android/app/build/outputs/apk/release/app-release.apk`
  without re-running prebuild.
- The release variant bakes the production JS bundle into the APK
  and signs with the debug keystore from `apps/mobile/android/app/debug.keystore`
  (the standard Expo prebuild output). That is fine for a single
  founder sideload to Adam's own device; it is **not** a Play Store
  release and must not be distributed to anyone else.

Known limitations surfaced during this build:

- The universal APK is 103 MB because it includes all four ABIs
  (`armeabi-v7a, arm64-v8a, x86, x86_64`). For a single device,
  splitting per ABI in `android/app/build.gradle` would drop it to
  roughly 35–45 MB and make messenger transfer easier. Not changed
  in this session because the sideload is to one phone and the file
  is below most cloud-storage limits; tracked in `backlog.md`.
- JDK 26 (Homebrew `openjdk`) breaks `JdkImageTransform` in AGP and
  emits "WARNING: A restricted method in java.lang.System has been
  called" from CMake. The script pins JDK 17 (Temurin, auto-downloaded
  by Gradle). If a future AGP upgrade wants JDK 21, the script's
  fallback chain will pick Android Studio's JBR automatically.
- The script is uncommitted. Run `pnpm check`, then commit on
  `main` and push before the next `pnpm deploy:remote`.

Next action: deliver the APK to the other Android phone (USB / cloud
storage). The Production iPhone Release from the 2026-08-08 work is
independent and unchanged.

## Verification evidence — 2026-07-26

The deterministic plan, personalization, and training-prescription levels pass the complete standard gate:

```text
pnpm check
  formatting: passed
  workspace TypeScript checks: passed
  iOS Expo/Metro/Hermes export: passed (1,693 modules, 4.8 MB bundle)
  tests: 866 passed
  opt-in live/provider and Supabase auth/persistence e2e: 15 skipped

git diff --check
  passed
```

Focused coverage proves equipment/constraint filtering, schedule and resistance-volume caps, typed missing inputs, conservative high-RPE reduction, actual repository aggregation, authenticated provider-independent access, and the shared Coach tool in addition to the prior deterministic plan and personalization coverage. All 300 API tests, 225 core tests, 20 contract tests, 15 Mistral-provider tests, and 139 mobile tests passed. The latest clean database reset, lint, and all 70 pgTAP assertions passed. No live provider request or real user/photo data was used.

## Verification evidence — 2026-07-23

The default-off Mistral Coach implementation passes the complete standard gate:

```text
pnpm check
  formatting: passed
  workspace TypeScript checks: passed
  iOS Expo/Metro/Hermes export: passed (1,679 modules, 4.7 MB bundle)
  tests: 734 passed
  opt-in Supabase persistence/auth e2e: 13 skipped because credentials were not enabled

pnpm db:verify
  clean migration reset: passed
  database lint: passed
  pgTAP: 58 assertions passed

git diff --check
  passed
```

Focused evidence includes 4 fake-boundary Mistral provider tests, 8 runtime tests including every case in the versioned 12-case English/Slovak critical-safety corpus, 4 authenticated Coach route tests, 2 mobile Coach data tests, and database assertions for message status/idempotency plus the user-scoped uniqueness index.

One explicitly authorized live development request then passed through the server-side adapter using only a fictional confirmed nutrition fixture (`1,800 kcal`, `92 g` protein, `210 g` carbohydrate, `58 g` fat, three entries). The structured answer referenced the confirmed `92 g` protein value and suggested one conservative food action. Metadata recorded `mistral-medium-latest`, `stop`, prompt version `coach-system-v1`, 294 prompt tokens, 48 completion tokens, 342 total tokens, SDK `1.15.1`, and a 1–3 second latency bucket. No real user data, account identifier, photo, or key was included in the recorded request/output.

## Verification evidence — 2026-07-22

ALPHA-001 readiness passes the complete standard gate: formatting and all workspace typechecks passed; the iOS Metro/Hermes production export resolved 1,677 modules; 715 tests passed and the 13 credential-gated Supabase e2e tests remained intentionally skipped. The observability package now has 9 focused tests, including exact export-envelope rejection and aggregate-only summary coverage. The `pnpm alpha:analyze -- <export>` end-to-end check passed with a temporary synthetic export after catching and fixing CommonJS top-level-await and pnpm argument-forwarding defects.

The standalone iOS Release build also resolved 1,677 modules, compiled and installed successfully on the iPhone 17 Pro / iOS 26.5 simulator, and rendered the authentication screen after a direct no-Metro launch. Expo's final GUI-focus AppleScript was denied by host automation permissions after the successful install, so launch was verified with `xcrun simctl launch` instead. This is packaging/launch evidence only: iOS consent/export interaction and the equivalent Android ALPHA journey remain pending and are not counted as a founder day.

The DOCS-WIKI-001 documentation slice was checked with Prettier, Markdown link/path inspection, and `git diff --check`. The runbooks were reconciled with the installed toolchain and the already-passing standalone iOS/Android acceptance evidence. No simulator, emulator, database, or application behavior changed.

The complete standard gate was run from the local repository:

```text
pnpm check
  formatting: passed
  workspace TypeScript checks: passed
  iOS Expo/Metro/Hermes export: passed (1,677 modules, 4.7 MB bundle)
  tests: 715 passed
  opt-in Supabase persistence/auth e2e: 13 skipped because local e2e credentials were not enabled for the standard gate
```

The current database gate is:

```text
pnpm db:verify
  clean migration reset: passed
  database lint: passed
  pgTAP: 55 assertions passed
```

PERSIST-003 passed `pnpm db:verify` on a clean reset: every migration applied, database lint reported no errors, and all 55 pgTAP assertions passed. The opt-in real-Supabase persistence suite passed all 8 tests, including fresh-repository media metadata visibility, two-user table/Storage isolation, direct signed PUT/download compatibility, and physical object deletion. MEDIA-MOB-001 passes 106 mobile tests (4 photo-specific), mobile typecheck, an iOS production export, and the authenticated standalone iOS and Android lifecycles described below. Forced Android activity-destruction recovery and camera hardware remain outside this evidence.

The first native MEDIA-MOB Release launch exposed a binary mismatch: ImagePicker/ImageManipulator `57.0.5` had resolved under their package ranges while ExpoModulesCore remained `57.0.3`, and dyld rejected ImageManipulator's missing `AnyModule._decorateModule` symbol. Exact `57.0.2` pins, a regenerated CocoaPods graph, and a fresh Release build corrected it. The corrected app installed and launched successfully in an iPhone 17 Pro simulator and rendered the sign-in screen without a crash. This proves native startup, not the authenticated camera/library and persisted-data journeys.

Maestro 2.7.0 then drove disposable confirmed accounts through the standalone iOS Release app and found four P1 native defects. Session transitions now resolve `/v1/profile` before protected content; bounded screens stay within a 402-point viewport; input-heavy scroll forms gain keyboard insets and drag dismissal; and normalized photo derivatives use Expo's native `File` size/upload path instead of an unsupported ArrayBuffer-to-Blob conversion. After correction, an iPhone 17 Pro simulator passed onboarding with an `80.0 kg` baseline and a combined stored journey with `650 kcal`, `40P / 70C / 20F`, `81 kg`, separate `chest 101 cm · waist 82 cm`, a completed `Back squat · 5 reps · 100 kg` set, dashboard workout count, app-restart session/data restoration, and previous-performance recovery (`100 kg` best, `500 kg` prior volume). A separate synthetic-media journey passed two private signed uploads, same-day comparison, permanent deletion of both objects, and return to the empty timeline. Every disposable auth identity was deleted after its run.

The Android SDK 36 toolchain then produced a standalone Release APK and installed it on a Pixel 9 API 36 arm64 AVD. Maestro repeated the stored daily journey with the same exact meal, body, workout, dashboard, restart, and previous-performance assertions. A separate system Photo Picker journey passed two normalized private signed uploads, same-day comparison, permanent deletion of both objects, and return to the empty timeline. Supabase's local signed URLs identify `127.0.0.1`; `adb reverse tcp:54321 tcp:54321` was therefore used strictly as local test plumbing so the emulator could reach the host Storage service. Every disposable Android auth identity was deleted after its run.

## Business-plan alignment

### Strong alignment

- The domain model covers the intended unified record: nutrition, training, weight, photos, goals, energy, conversations, and memories.
- Deterministic calculations, visible uncertainty, RLS, private media, and user-controlled memory support a trustworthy EU-first positioning.
- Provider-neutral ports make Mistral and future model/memory providers replaceable without rewriting feature logic.
- The technical foundation can support the premium AI layer after the manual product loop and safety evaluation exist.

### Gaps blocking early customers

- The manual meal/workout/weight lifecycles and dashboard review pass on authenticated native iOS and Android.
- Supabase repository and private Storage adapters have local restart/isolation evidence, but a hosted project is not yet deployed or accepted on native devices.
- The progress dashboard, calendar review, and private photo lifecycle pass against local persistence on native iOS and Android; hosted acceptance remains open.
- Library-based private photo capture/upload exists; camera-hardware proof remains open. AI-assisted calorie drafts now pass local mobile/API/provider tests, but authenticated physical-device acceptance with the configured provider remains open.
- The memory-aware Coach has persistent candidate/active/correct/deactivate/expire/delete controls and active-only authorized recall; physical-device review acceptance remains open.
- Consent-respecting local activation/retention instrumentation and privacy-safe aggregation now exist, but no participant export or repeated-user dataset exists yet; there is still no subscription system.

## Productization sequence

The user deliberately changed the sequence on 2026-07-23 so private Mistral implementation and synthetic evaluation occur before controlled alpha. Follow this sequence:

1. **PERSIST-001:** implement Supabase-backed profile, goal, and food repositories; prove persistence and RLS end to end.
2. **PERSIST-002 / PERSIST-003:** persist training/body/account records and replace in-memory media storage; prove real export and deletion.
3. **MOB-DAILY-001:** build the smallest persistent mobile daily loop: baseline weight, manual meal, workout/set, and real dashboard totals. (Complete.)
4. **AND-001:** verify the same loop in an Android emulator, not just an iOS bundle. (Complete.)
5. **OBS-001:** add consent-respecting product analytics for activation, logging time/taps, retention, failures, and AI cost readiness. (Implementation gate complete.)
6. **MEDIA-MOB-001:** add real progress-photo selection/capture, upload, timeline, comparison, and deletion UI. (Implementation gate complete.)
7. **AI-GOV-001 / AI-001 / AI-002:** resolve provider/privacy/usage-policy gates, then build and synthetically evaluate a default-off Mistral text coach with read-only confirmed-data tools.
8. **ALPHA-001:** run founder dogfooding and a 10–30-person design-partner beta; AI remains disabled in those builds unless its separate external-release gate passes.
9. **MEM-001 / VISION-001:** add user-visible memory controls, then evaluated editable text/photo nutrition drafts.
10. **BILL-001:** test premium packaging and subscription billing only after the paid value and provider unit economics are measurable.
11. Community sharing remains post-MVP and must not delay the private self-service loop.

## Known operational risks

- Hosted Supabase deployment and physical-device/store-build acceptance are still outstanding; passing local simulator journeys do not prove hosted networking, email delivery, or store distribution.
- Supabase CLI 2.109.1 reports localhost URLs while Docker Desktop publishes local services on `0.0.0.0` and IPv6 `::`. Use the stack only on a trusted network, never with real user data, and stop it when unused.
- Account deletion currently orchestrates application repositories; release-grade deletion must also remove the real auth identity, storage bytes, conversations, memories, provider references, and any processor-held data.
- The documentation previously contained contradictory phase/next-action statements. This file and `docs/BUSINESS_ALIGNMENT.md` now describe the audited state; keep them synchronized with executable changes.

## Commands

```bash
cd /Users/adam/Documents/mizyun
pnpm check
pnpm db:start
pnpm db:verify
pnpm db:stop
pnpm dev:api
pnpm dev:mobile
```

Never put a service-role or model secret in an `EXPO_PUBLIC_` variable. The
founder-only enablement policy and external-release gate are documented in
[`docs/FOUNDER_TESTING_MODE.md`](docs/FOUNDER_TESTING_MODE.md) and
`docs/BEFORE_TESTING.md`.

## Handoff note

Read `AGENTS.md`, `goals.md`, `docs/BUSINESS_ALIGNMENT.md`, `plan.md`, this file, and `backlog.md` before implementation. Read `docs/AI_IMPLEMENTATION_PLAN.md`, then execute AI-GOV-001 and the opt-in live-synthetic evaluation. Do not send real-user data to Mistral until the provider, safety, privacy, deletion, cost, and native gates pass.
