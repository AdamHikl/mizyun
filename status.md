# Mizyun current status

> Fast-changing session handoff. Update this file at the end of every development session. Last updated: **2026-07-18**.

## Executive snapshot

- **Product stage:** technical pre-alpha; the architecture and domain/API foundation are strong, but this is not yet a customer-usable tracking beta.
- **Roadmap position:** Phases 2–5 have substantial domain and route coverage; persistent adapters and mobile product workflows are the active integration gap.
- **Latest completed work package:** PERSIST-001 — Supabase adapters for profile, goals, and food entries (real persistence via RLS, partial-unique index enforces "one active goal per user").
- **Next exact work package:** PERSIST-002 — Supabase adapters for training, body, and account export/deletion cascade against real records.
- **Branch:** `main`, clean working tree.
- **Remote:** `https://github.com/AdamHikl/mizyun`.
- **Remote state:** local `main` is **9 commits ahead of `origin/main`**. Push these commits before relying on GitHub as the backup/source of truth.
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

### Mobile surfaces

The mobile app currently includes:

- configuration-required, authentication, confirmation/recovery, and session-loading states;
- an onboarding wizard connected to the profile/goal endpoints;
- an Account tab with verified-principal display and sign-out;
- a Home dashboard shell;
- a Coach setup screen explaining that the model provider is disabled.

## Critical implementation distinction

Most tracking functionality is **not yet usable from the mobile app**:

- the Home metrics are static placeholders;
- the quick-add meal/workout/weight/photo buttons do not navigate or submit data;
- there are no mobile food, workout, set, measurement, energy-review, photo-upload, or trend screens;
- the Coach screen is a provider-not-connected placeholder;
- there is no HealthKit/Health Connect step synchronization;
- there is no billing, paywall, product analytics, crash reporting, or community functionality.

More importantly, the production API composition root currently selects in-memory repositories for profile, goals, food, exercises, workouts, sets, measurements, media metadata, memory, and media bytes. The SQL schema is present and protected, but these features are not wired to PostgreSQL/Supabase. Tracking records therefore disappear when the API process restarts. Authentication is the principal feature currently backed by Supabase at runtime.

Do not describe NUT-_, WO-_, BODY-_, ENG-_, MEDIA-* or DATA-001 as customer-complete. They are verified domain/API slices awaiting persistent adapters and mobile integration.

## Verification evidence — 2026-07-18

The complete standard gate was run from the local repository:

```text
pnpm check
  formatting: passed
  workspace TypeScript checks: passed
  iOS Expo/Metro/Hermes export: passed (1,610 modules, 4.4 MB bundle)
  tests: 572 passed
  opt-in Supabase auth/storage e2e: 5 skipped because AUTH_E2E_* credentials were not enabled
```

The previous recorded database gate remains:

```text
pnpm db:verify
  clean migration reset: passed
  database lint: passed
  pgTAP: 55 assertions passed
```

Re-run the database and opt-in e2e gates whenever persistent adapters or hosted configuration change.

## Business-plan alignment

### Strong alignment

- The domain model covers the intended unified record: nutrition, training, weight, photos, goals, energy, conversations, and memories.
- Deterministic calculations, visible uncertainty, RLS, private media, and user-controlled memory support a trustworthy EU-first positioning.
- Provider-neutral ports make Mistral and future model/memory providers replaceable without rewriting feature logic.
- The technical foundation can support the premium AI layer after the manual product loop and safety evaluation exist.

### Gaps blocking early customers

- The core promise of low-effort tracking cannot yet be tested because users cannot complete tracking journeys in the mobile UI.
- Records do not persist through API restarts.
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

- The newest nine commits are local-only until pushed.
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

Read `AGENTS.md`, `goals.md`, `plan.md`, this file, `backlog.md`, and `docs/BUSINESS_ALIGNMENT.md` before implementation. The next development session should start with PERSIST-001, not conversations or AI. Before new work, push or otherwise back up the nine local commits after confirming the intended remote.
