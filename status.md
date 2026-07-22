# Mizyun current status

> Fast-changing session handoff. Update this file at the end of every development session. Last updated: **2026-07-22**.

## Executive snapshot

- **Product stage:** technical pre-alpha; the architecture and domain/API foundation are strong, but this is not yet a customer-usable tracking beta.
- **Roadmap position:** Every scoped MOB item, AND-001, and OBS-001 is complete at its implementation gate. ALPHA-001 is active; elapsed founder/design-partner evidence is still 0 of 7 days and 0 of 10 minimum participants.
- **Latest verified implementation slice:** ALPHA-001 now has privacy-safe founder/design-partner/native evidence ledgers plus an exact-schema analyzer that converts voluntary local OBS exports into aggregate counts and coarse buckets without participant rows or filenames.
- **Latest operational slice:** `docs/alpha/` is the validation hub, while `docs/tutorials/` retains reusable setup, local backend, iOS, Android, testing, teardown, and known-failure runbooks.
- **Next exact action:** complete the synthetic consent → measured meal/workout/body flow → restart → export → disable/clear checklist on the installed iOS Release app and Android Release APK, then start founder day 1 only when seven consecutive real-use days are possible.
- **Branch:** `main`; each completed mobile/persistence slice is kept in a coherent local commit.
- **Remote:** `https://github.com/AdamHikl/mizyun`.
- **Remote state:** all tracked work through this ALPHA-001 readiness handoff is committed locally. `main` is eleven commits ahead of `origin/main` (ten previously queued commits plus this handoff), so publishing the accumulated history requires explicit confirmation.
- **AI provider:** intentionally disabled. No Mistral or other model API is configured.
- **Hosted Supabase:** not created or linked.
- **iOS:** native Release build/install/launch and the complete disposable-account onboarding/daily/restart/private-photo journey pass on an iPhone 17 Pro simulator.
- **Android:** a standalone Release APK passes the complete disposable-account daily/restart/private-photo journey on a Pixel 9 API 36 emulator.

## What is genuinely delivered

### Architecture and platform foundation

- Expo SDK 57 mobile app and Fastify API in a pnpm TypeScript monorepo.
- Explicit boundaries for core rules, contracts, identity, API transport, memory, agent orchestration, model providers, and infrastructure adapters.
- Provider-neutral mobile authentication with chunked Expo SecureStore session persistence.
- Validated API/mobile configuration and a provider-neutral authenticated `HttpApiClient`.
- Fastify bearer-token verification, safe structured errors, request IDs, and sensitive-log redaction.
- Forward-only Supabase migrations for profiles, goals, food, workouts, measurements, conversations, memories, and private media.
- RLS policies, ownership indexes, private-storage path policies, and pgTAP two-user isolation coverage.
- AI and memory interfaces are replaceable; the only runtime provider is the safe disabled provider.

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
- small encrypted, user-scoped logging drafts that survive app restart and are cleared only after the API confirms success;
- metric/imperial weight entry and display with canonical kilograms at the API boundary;
- body progress history with raw readings, optional waist/chest measurements, confirmed correction deletion, and a labeled time-aware smoothed trend/rate;
- a recoverable workout session with custom exercise creation, rep/load/duration/distance/RPE sets, prior performance, completion, and confirmed deletion;
- a progress-photo route with explicit per-upload consent, camera/library selection, bounded metadata-stripped JPEG preparation, direct signed upload, private timeline, two-photo comparison, interrupted Android picker recovery, and confirmed permanent deletion;
- a Coach setup screen explaining that the model provider is disabled.
- an optional product-analytics choice during onboarding and in Account, with a closed event schema, 30-day/500-event local bound, voluntary JSON export, and disable/clear controls.

## Critical implementation distinction

The core manual tracking and private progress-photo lifecycles are implemented and pass together on native iOS and Android; release-grade hosted/device acceptance remains incomplete:

- food entries now have a complete manual mobile lifecycle for today's local calendar day; multi-day history remains deferred;
- workout templates/reordering and broader progression summaries remain absent; the manual active-session/set/previous-performance loop is available;
- body measurement activation, capture, raw history, and labeled trend are available; additional measurement kinds remain schema-extensible;
- the dashboard shows deterministic energy state and calendar week/month reviews; its stored meal/body/workout summaries and restart restoration pass on iOS and Android;
- progress-photo library selection/upload/timeline/compare/delete passes with synthetic non-sensitive media and real signed Storage transfer on iOS and Android; camera hardware and forced Android activity-destruction recovery remain open;
- the Coach screen is a provider-not-connected placeholder;
- there is no HealthKit/Health Connect step synchronization;
- there is no billing, paywall, crash reporting, network analytics processor, or community functionality; product analytics is local-only and requires voluntary participant export.

With validated Supabase server configuration, the API selects Supabase-backed profile, goal, food, exercise, workout, workout-set, body-measurement, and media-asset repositories plus private Storage. The standard no-environment gate intentionally remains in-memory. Hosted Supabase deployment, physical-device/store-build acceptance, and account deletion across every external resource remain incomplete.

Do not describe NUT-_, WO-_, BODY-_, ENG-_, MEDIA-* or DATA-001 as customer-complete. Their local persistent/native integration is verified, but hosted, physical-device, and repeated-user evidence is still absent.

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
- Library-based private photo capture/upload exists; camera-hardware proof and AI-assisted calorie drafts do not exist end to end.
- The memory-aware coach is only an interface and disabled implementation.
- Consent-respecting local activation/retention instrumentation and privacy-safe aggregation now exist, but no participant export or repeated-user dataset exists yet; there is still no subscription system.

## Productization sequence

Do not start Mistral/chatbot implementation merely because the provider boundary exists. Follow this sequence unless `plan.md` is deliberately changed:

1. **PERSIST-001:** implement Supabase-backed profile, goal, and food repositories; prove persistence and RLS end to end.
2. **PERSIST-002 / PERSIST-003:** persist training/body/account records and replace in-memory media storage; prove real export and deletion.
3. **MOB-DAILY-001:** build the smallest persistent mobile daily loop: baseline weight, manual meal, workout/set, and real dashboard totals. (Complete.)
4. **AND-001:** verify the same loop in an Android emulator, not just an iOS bundle. (Complete.)
5. **OBS-001:** add consent-respecting product analytics for activation, logging time/taps, retention, failures, and AI cost readiness. (Implementation gate complete.)
6. **MEDIA-MOB-001:** add real progress-photo selection/capture, upload, timeline, comparison, and deletion UI. (Implementation gate complete.)
7. **ALPHA-001:** run founder dogfooding and a 10–30-person design-partner beta; fix friction and data-loss issues.
8. **AI-001 / MEM-001:** complete `docs/BEFORE_TESTING.md`, then add one evaluated Mistral text/vision adapter and user-visible memory controls.
9. **BILL-001:** test premium packaging and subscription billing only after the paid value and provider unit economics are measurable.
10. Community sharing remains post-MVP and must not delay the private self-service loop.

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

Never put a service-role or model secret in an `EXPO_PUBLIC_` variable. AI remains gated by `docs/BEFORE_TESTING.md`.

## Handoff note

Read `AGENTS.md`, `goals.md`, `docs/BUSINESS_ALIGNMENT.md`, `plan.md`, this file, and `backlog.md` before implementation. Continue `docs/alpha/NATIVE_ACCEPTANCE.md` from the installed iOS Release build, then verify Android and begin the founder log; do not count setup as elapsed use or select an analytics/AI provider merely because the local boundary exists.
