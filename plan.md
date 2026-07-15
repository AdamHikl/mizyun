# Mizyun implementation plan

> Ordered roadmap and exit criteria. `status.md` identifies the active work package; `backlog.md` holds executable items and ideas. Completed architectural decisions live in `docs/adr/`.

## Status legend

- ✅ Complete and verified
- 🚧 Active or next work package
- ⏳ Planned
- ⛔ Blocked by an explicit dependency
- 🔬 Requires research or evaluation before implementation

## Current focus

🚧 **Phase 1 — Provision the private backend and prove authenticated user isolation end to end.**

The application foundation and provider-neutral authentication code exist. The local Supabase stack now resets cleanly and passes its schema/RLS test suite. The next work package is validated mobile/API environment composition; AI remains deliberately disabled.

## Dependency sequence

```text
Foundation
  → backend + authentication
    → onboarding + goals
      → manual nutrition + deterministic energy
      → training tracking
      → progress + media
        → device activity
          → evaluated AI + durable memory
            → vision-assisted drafts
              → beta hardening
```

Nutrition, training, and progress can advance in parallel once identity and repositories are proven. AI and photo interpretation depend on confirmed manual workflows, privacy controls, and evaluation data.

## Phase 0 — Modular foundation ✅

### Delivered

- pnpm TypeScript monorepo with Expo mobile and Fastify API applications;
- domain, contracts, identity, memory, agent-runtime, provider, and adapter boundaries;
- initial PostgreSQL schema for profiles, goals, food, training, conversations, memories, and private media;
- Row Level Security policies and private media path ownership;
- provider-neutral authentication ports and Supabase mobile/server adapters;
- encrypted chunked native session persistence through Expo SecureStore;
- protected API identity route and safe disabled-provider states;
- iOS simulator startup and a real Metro/Hermes iOS bundle smoke test;
- architecture decisions ADR-0001 and ADR-0002;
- AI provider deferred by `docs/BEFORE_TESTING.md`.

### Exit evidence

- `pnpm check` passes.
- iOS bundle exports successfully.
- Simulator renders the setup state without credentials.
- Foundation commits are pushed to `main`.

## Phase 1 — Backend environment and authenticated data boundary 🚧

### Objective

Create the first development Supabase environment and prove that a real user can authenticate and access only their own records and media.

### Work packages

1. **P1.1 Supabase development project**
   - Research the current Supabase CLI, local-development, migration, Auth, RLS-testing, and private-storage guidance.
   - Decide local-first versus hosted-development workflow and record it in an ADR.
   - Link the project, apply migrations, configure allowed redirect URLs, and document secret handling.
   - Local development, migrations, linting, and policy tests are verified; hosted linking is deferred until reachable-device or real-email testing requires it.
2. **P1.2 Mobile/API environment composition**
   - Add validated configuration loaders instead of reading environment variables ad hoc.
   - Add a provider-neutral authenticated API client that supplies and refreshes the bearer token.
   - Provide simulator-safe API host configuration.
3. **P1.3 Complete account lifecycle**
   - Exercise sign-up, email confirmation, sign-in, session restoration, sign-out, password recovery, and failure states.
   - Add an authenticated account/settings surface and visible sign-out action.
4. **P1.4 Isolation tests**
   - Add migration/RLS tests for every user-owned table and storage path.
   - Prove user A cannot select, mutate, or sign URLs for user B's data.
   - Test expired, malformed, and absent access tokens at the API.
5. **P1.5 Operational baseline**
   - Add structured error codes, request correlation, safe logging, and local setup documentation.

### Exit criteria

- Two test users can independently sign in on a development environment.
- Each user can call `/v1/me` and cannot access the other user's rows or objects.
- Sign-out removes the native session and protected requests fail afterward.
- Migrations can be applied reproducibly from a clean environment.
- No privileged key exists in Expo environment variables or a generated bundle.

## Phase 2 — Onboarding, profile, and goals ⏳

### Objective

Collect the minimum confirmed context required for useful calculations and guidance.

### Scope

- profile repository port and Supabase adapter;
- onboarding flow for display name, units, timezone, height, baseline weight, experience, and limitations;
- one primary active goal with start date, optional target, pace preference, and review date;
- edit profile and goal screens;
- API contracts/routes with validation and ownership enforcement;
- goal history without destructive overwrites;
- unit conversion at boundaries while canonical storage remains metric.

### Exit criteria

- A new account reaches a useful dashboard through onboarding.
- Profile and goal changes persist across app restarts.
- Invalid or unsafe target ranges receive clear validation.
- User A cannot read or mutate user B's profile or goals.

## Phase 3 — Manual nutrition and deterministic energy model ⏳

### Objective

Deliver a trustworthy daily intake and target experience before enabling food AI.

### Scope

- manual food entries and reusable foods/meals;
- calories, protein, carbohydrate, fat, serving information, notes, and timestamps;
- daily/weekly summaries and edit/delete flows;
- deterministic BMR/TDEE estimate with versioned formulas and explicit assumptions;
- configurable activity multiplier and goal adjustment;
- intake versus target range and estimated surplus/deficit;
- trend-based recalibration from weight history, only when sufficient data exists;
- tests for units, dates/timezones, missing data, and safe target bounds.

### Exit criteria

- A user can complete an entire week of manual food logging.
- Totals and target calculations are reproducible from stored inputs.
- Estimates are labeled and their assumptions are inspectable.
- Editing or deleting an entry updates summaries correctly.

## Phase 4 — Exercise library and workout tracking ⏳

### Objective

Make workout creation and progressive-overload tracking useful without AI.

### Scope

- custom exercises with movement/equipment metadata;
- workout templates and ordered exercise lists;
- active workout session, set logging, rest support, notes, and completion;
- repetitions, load, duration, distance, and perceived exertion;
- personal records, estimated volume, frequency, and progression views;
- routine suggestions from deterministic rules and curated data before AI generation;
- offline-tolerant draft behavior for an active workout.

### Exit criteria

- A user can build a routine, complete it, and review previous performance.
- Set ordering and edits remain consistent after synchronization.
- Progress summaries correctly handle different exercise measurement types.

## Phase 5 — Body progress and private media ⏳

### Objective

Show meaningful longitudinal progress while treating photos and measurements as sensitive data.

### Scope

- weight and optional body measurements;
- smoothed weight trend and rate-of-change views;
- private progress-photo capture/upload with metadata and signed retrieval;
- comparison views that require explicit user selection;
- retention, export, and deletion controls;
- upload validation, resizing strategy, and orphan cleanup;
- no automatic body-composition diagnosis.

### Exit criteria

- Photos are private, signed access expires, and cross-user access tests fail closed.
- Deleting a photo removes both metadata and storage object.
- Weight trends handle irregular measurements and explain smoothing.

## Phase 6 — Steps, movement, and health-platform adapters 🔬

### Objective

Incorporate activity signals without double-counting exercise or overstating expenditure precision.

### Scope

- research exact iOS HealthKit and Android Health Connect requirements and policies;
- provider-neutral activity contracts and permission states;
- read steps and selected workout/activity summaries with explicit consent;
- deduplication, source provenance, timezone handling, and sync cursor strategy;
- manual fallback when permissions are denied;
- conservative integration into energy estimates.

### Exit criteria

- Both platforms handle granted, denied, limited, and revoked permissions.
- Synced records are idempotent and retain their source.
- Energy views explain how activity was incorporated and avoid known double counting.

## Phase 7 — AI coach and user-controlled durable memory 🔬

### Entry gate

Every applicable item in `docs/BEFORE_TESTING.md` is complete. Manual product workflows, evaluation datasets, privacy controls, and deterministic calculations already exist.

### Objective

Add one evaluated text-capable provider without leaking vendor concerns into features.

### Scope

- select one provider/model using current privacy, cost, latency, and quality evidence;
- implement a provider adapter behind `AgentProvider`;
- persistent conversations and a PostgreSQL-backed `MemoryStore` adapter;
- memory candidate, confirmation, provenance, confidence, expiry, correction, and deletion flows;
- tool interfaces for reading confirmed profile, goal, nutrition, training, and trend data;
- structured outputs, timeouts, budgets, rate limits, refusal behavior, and audit metadata;
- prompt-injection and cross-user retrieval evaluations;
- advice presentation that distinguishes facts, calculations, inference, and uncertainty.

### Exit criteria

- The coach works only through normalized ports and tools.
- Users can inspect and delete memories and conversations.
- No retrieved record belongs to a different user.
- Safety/quality evaluations meet documented thresholds before external access.

## Phase 8 — Photo/text-assisted nutrition and progress guidance 🔬

### Objective

Reduce logging friction with vision-assisted drafts while preserving confirmation and uncertainty.

### Scope

- direct text parsing into editable food drafts;
- private food-photo upload and server-side analysis;
- portion/calorie/macronutrient ranges with confidence and assumptions;
- explicit confirmation before creating authoritative entries;
- body-photo guidance limited to observable progress/context, never diagnosis or exact body-fat claims;
- evaluation against consent-based weighed meals and adversarial image/text inputs.

### Exit criteria

- No AI estimate becomes confirmed data without user action.
- Evaluation results and known limitations are documented in-product and in the repository.
- Images follow retention/deletion rules and are not sent to unapproved providers.

## Phase 9 — Beta hardening and release ⏳

### Scope

- accessibility, localization readiness, and complete metric/imperial behavior;
- offline/error recovery for critical logging paths;
- performance, battery, upload, and low-connectivity testing;
- observability without sensitive payload logging;
- privacy policy, terms, consent, retention, export, and account deletion;
- Android emulator/device and iOS simulator/device test matrix;
- store metadata, permission disclosures, signing, staged rollout, and rollback plan.

### Exit criteria

- All MVP requirements are accepted and all P0/P1 defects are closed.
- `docs/QUALITY_GATES.md` and `docs/BEFORE_TESTING.md` release gates pass.
- A restore/recovery exercise and account-deletion test have succeeded.
- TestFlight and internal Android builds complete the defined device matrix.

## Plan maintenance rules

- Update the current-focus paragraph and phase status when a work package starts or finishes.
- Move executable tasks between sections in `backlog.md`; do not turn this roadmap into a daily log.
- Add or amend an ADR when a durable architecture choice changes.
- Update `status.md` at the end of every development session.
- Do not mark a phase complete until its exit evidence is reproducible.
