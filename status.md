# Mizyun current status

> Fast-changing session handoff. Update this file at the end of every development session. Last updated: **2026-07-19**.

## Executive snapshot

- **Product stage:** technical pre-alpha; the architecture and domain/API foundation are strong, but this is not yet a customer-usable tracking beta.
- **Roadmap position:** MOB-DAILY-001 is active. MOB-NUT-001, MOB-ONB-001, MOB-WO-001, and MOB-BODY-001 are complete; energy state and persistent-device acceptance remain.
- **Latest verified implementation slice:** MOB-BODY-001 — optional body measurements, raw history/chart, confirmed correction deletion, and an explicitly labeled deterministic weight trend.
- **Next exact action:** MOB-DASH-001 — add deterministic energy state, assumptions, and a weekly progress summary to the dashboard.
- **Branch:** `main`; the coherent documentation, persistence, and mobile productization changes are included in the MOB-NUT-001 handoff commit.
- **Remote:** `https://github.com/AdamHikl/mizyun`.
- **Remote state:** local `main` is one commit ahead at `de3b197`; pushing this and future MOB slices requires explicit user approval.
- **AI provider:** intentionally disabled. No Mistral or other model API is configured.
- **Hosted Supabase:** not created or linked.
- **iOS:** bundle quality gate passes; prior simulator authentication work is documented.
- **Android:** emulator/device runtime has not been configured or verified.

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

The calculation layer correctly treats missing data as incomplete, separates deterministic output from future AI explanation, and avoids silently turning uncertain estimates into facts.

- Persistent repositories (PERSIST-001): three per-feature ports in `@mizyun/core` (`ProfileRepository`, `GoalRepository`, `FoodEntryRepository`) accept an `accessToken` and have Supabase adapters in `@mizyun/adapter-supabase-server` (`SupabaseProfileRepository`, `SupabaseGoalRepository`, `SupabaseFoodEntryRepository`) that bind the token via `setSession` so every PostgREST query runs under the verified principal's RLS. A forward-only migration (`20260718100000_persist_001_columns.sql`) adds `activity_level` + `sex_at_birth` to `public.profiles`, `pace` + `review_date` to `public.goals`, and a partial unique index `goals_one_active_per_user` that enforces "at most one active goal per user" at the database. The API composition root wires the Supabase adapters when `supabasePersistence` is provided; in-memory remains the default so the standard `pnpm check` gate stays green without Docker. 21 mocked-client adapter unit tests + 1 opt-in real-Stack e2e file (`persistence.e2e.test.ts`, `describe.skipIf` guarded by `SUPABASE_E2E_URL`) prove cross-user RLS rejection, persistence across fresh repo instances, and partial-unique violation translation.

- Persistent training + body + account cascade (PERSIST-002): the remaining four ports (`ExerciseRepository`, `WorkoutRepository`, `WorkoutSetRepository`, `BodyMeasurementRepository`) are widened with `{ readonly accessToken: string }` and now have Supabase adapters that bind the access token via `setSession`. The SQL FK `workout_sets.workout_id → workouts(id, user_id) ON DELETE CASCADE` removes the need for an explicit cascade call — the Supabase workout-set adapter's `deleteAllForWorkout` is a documented no-op (returns 0). The `AccountRepository` cascade (DATA-001) threads `accessToken: ""` to the per-feature adapters because the in-memory composition root uses in-memory repos (PERSIST-002 follow-up: the production composition root uses the service-role key for account-deletion orchestration when the hosted adapter lands). 18 new mocked-client adapter unit tests + 3 new opt-in e2e tests for exercises / workouts+cascade / body-measurements. The standard gate remains green without Docker; in-memory is still the default.

### Mobile surfaces

The mobile app currently includes:

- configuration-required, authentication, confirmation/recovery, and session-loading states;
- an onboarding wizard connected to the profile/goal endpoints;
- onboarding baseline weight in metric or imperial units, persisted before the profile completion marker with retry-safe discovery of partial prior writes;
- an Account tab with verified-principal display and sign-out;
- a Home dashboard that reads today's confirmed calorie/macro summary, latest weight, and the current local calendar week's workout count from the API;
- dashboard routes to create a manual meal, a minimal completed workout record, or a weight observation;
- small encrypted, user-scoped logging drafts that survive app restart and are cleared only after the API confirms success;
- metric/imperial weight entry and display with canonical kilograms at the API boundary;
- body progress history with raw readings, optional waist/chest measurements, confirmed correction deletion, and a labeled time-aware smoothed trend/rate;
- a recoverable workout session with custom exercise creation, rep/load/duration/distance/RPE sets, prior performance, completion, and confirmed deletion;
- a Coach setup screen explaining that the model provider is disabled.

## Critical implementation distinction

The first create paths are usable, but most tracking lifecycle behavior is **not yet available from the mobile app**:

- food entries now have a complete manual mobile lifecycle for today's local calendar day; multi-day history remains deferred;
- workout templates/reordering and broader progression summaries remain absent; the manual active-session/set/previous-performance loop is available;
- body measurement activation, capture, raw history, and labeled trend are available; additional measurement kinds remain schema-extensible;
- the dashboard does not yet show deterministic energy state or a weekly review;
- progress-photo capture/upload/timeline/compare remains absent;
- the Coach screen is a provider-not-connected placeholder;
- there is no HealthKit/Health Connect step synchronization;
- there is no billing, paywall, product analytics, crash reporting, or community functionality.

The API can select Supabase-backed profile, goal, food, exercise, workout, workout-set, and body-measurement repositories through its persistence composition option, while the standard no-environment gate intentionally remains in-memory. Real private-media storage, hosted Supabase composition, authenticated simulator acceptance, and account deletion across every external resource remain incomplete.

Do not describe NUT-_, WO-_, BODY-_, ENG-_, MEDIA-* or DATA-001 as customer-complete. They are verified domain/API slices awaiting persistent adapters and mobile integration.

## Verification evidence — 2026-07-19

The complete standard gate was run from the local repository:

```text
pnpm check
  formatting: passed
  workspace TypeScript checks: passed
  iOS Expo/Metro/Hermes export: passed (1,634 modules, 4.6 MB bundle)
  tests: 663 passed
  opt-in Supabase persistence/auth e2e: 12 skipped because local e2e credentials were not enabled
```

The previous recorded database gate remains:

```text
pnpm db:verify
  clean migration reset: passed
  database lint: passed
  pgTAP: 55 assertions passed
```

The full `pnpm check` gate passed after MOB-BODY-001: formatting, all workspace TypeScript checks, the iOS bundle (1,634 modules, 4.6 MB), and 663 tests. Twelve opt-in Supabase persistence/auth e2e tests were skipped because local e2e credentials were not enabled. No simulator/device acceptance was run in this session. Re-run the database and opt-in e2e gates whenever persistent adapters or hosted configuration change.

## Business-plan alignment

### Strong alignment

- The domain model covers the intended unified record: nutrition, training, weight, photos, goals, energy, conversations, and memories.
- Deterministic calculations, visible uncertainty, RLS, private media, and user-controlled memory support a trustworthy EU-first positioning.
- Provider-neutral ports make Mistral and future model/memory providers replaceable without rewriting feature logic.
- The technical foundation can support the premium AI layer after the manual product loop and safety evaluation exist.

### Gaps blocking early customers

- The first low-effort create paths exist, but full meal/workout/weight lifecycles and authenticated simulator acceptance are incomplete.
- Supabase repository adapters exist, but hosted composition and restart evidence are not yet part of the default runtime gate.
- There is no usable progress dashboard or weekly review.
- Photo capture/upload and AI-assisted calorie drafts do not exist end to end.
- The memory-aware coach is only an interface and disabled implementation.
- Android has not been verified.
- There is no activation/retention instrumentation or subscription system, so the freemium/premium hypothesis cannot yet be measured.

## Productization sequence

Do not start Mistral/chatbot implementation merely because the provider boundary exists. Follow this sequence unless `plan.md` is deliberately changed:

1. **PERSIST-001:** implement Supabase-backed profile, goal, and food repositories; prove persistence and RLS end to end.
2. **PERSIST-002 / PERSIST-003:** persist training/body/account records and replace in-memory media storage; prove real export and deletion.
3. **MOB-DAILY-001:** build the smallest persistent mobile daily loop: baseline weight, manual meal, workout/set, and real dashboard totals.
4. **AND-001:** verify the same loop in an Android emulator, not just an iOS bundle.
5. **OBS-001:** add consent-respecting product analytics for activation, logging time/taps, retention, failures, and AI cost readiness.
6. **MEDIA-MOB-001:** add real progress-photo selection/capture, upload, timeline, comparison, and deletion UI.
7. **ALPHA-001:** run founder dogfooding and a 10–30-person design-partner beta; fix friction and data-loss issues.
8. **AI-001 / MEM-001:** complete `docs/BEFORE_TESTING.md`, then add one evaluated Mistral text/vision adapter and user-visible memory controls.
9. **BILL-001:** test premium packaging and subscription billing only after the paid value and provider unit economics are measurable.
10. Community sharing remains post-MVP and must not delay the private self-service loop.

## Known operational risks

- Hosted Supabase composition and authenticated device acceptance are still outstanding; passing the in-memory gate alone does not prove the hosted journey.
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

Read `AGENTS.md`, `goals.md`, `docs/BUSINESS_ALIGNMENT.md`, `plan.md`, this file, and `backlog.md` before implementation. Continue MOB-DAILY-001 with MOB-DASH-001: add deterministic energy state, assumptions, and a weekly progress summary. Do not start AI.
