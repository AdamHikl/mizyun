# Mizyun implementation plan

> Ordered roadmap and exit criteria. `status.md` identifies the active work package; GitHub Issues holds executable items and task tracking. Completed architectural decisions live in `docs/adr/`.

## Status legend

- ✅ Complete and verified
- 🚧 Active or next work package
- ◐ Partially implemented; domain/API work exists but exit criteria are not met
- ⏳ Planned
- ⛔ Blocked by an explicit dependency
- 🔬 Requires research or evaluation before implementation

## Current focus

**Round-3 update (2026-09-09):** [current review](docs/IMPLEMENTATION_REVIEW_2026-09-09_ROUND_3.md) requires fixing Q2 duplicate retries and Q9 effective-target/rollback defects before candidate promotion, then explicitly installing/verifying Q1 containment and completing residual lifecycle, AI and build work. The latest implementation handoff is not final acceptance; the existing sequence and full exit criteria remain in force.

**Round-2 sequencing:** [the new review](docs/IMPLEMENTATION_REVIEW_2026-09-08_ROUND_2.md) found residual runtime/deployment defects, a persistent export regression, and unsupported AI acceptance. Complete Q1/Q8-A containment and locally fault-tested Q9 guards first; Q4/Q5 data repairs, Q2/Q7 mobile reliability and Q3 actual build guards follow. Preserve Q6 source repair and verify deployed/upgrade behavior. Finish Q8-B accounting and Q8-C measured evaluation before R3/R8 final release acceptance. Session J did not close these requirements.

🚧 **2026-09-08 review: Dev/Production separation and release patches are partially implemented.** [The implementation review](docs/IMPLEMENTATION_REVIEW_2026-09-08.md) supersedes the previous blanket completion claim. Preserve the existing two stacks; repair Dev runtime privilege isolation and founder/AI access controls first (INFRA-DUAL-002, REL-AUD-005), then account lifecycle/export, mobile retries, tier INSERT protection and consent continuation. Finish guarded build/deployment tooling and R3/R8 signed-device/recovery acceptance before production promotion or invitations. No further feature expansion is needed for this checkpoint.

The executable follow-up is [the Q1–Q9 session plan](docs/REMEDIATION_IMPLEMENTATION_PLAN_2026-09-08.md). After initial access/runtime containment, repair and fault-test deployment tooling locally before using it to accept later patches on Dev. Track closure in [the evidence checklist](docs/REMEDIATION_EVIDENCE_CHECKLIST.md), then independently review the final candidate before promotion.

## Dependency sequence

```text
Foundation
  → backend + authentication
    → persistent Supabase feature repositories
      → onboarding + baseline weight
        → mobile manual nutrition + deterministic energy
        → mobile workout + previous performance
        → mobile progress + private media
          → real dashboard + weekly review
            → Android verification + product analytics
              → private Mistral implementation + synthetic evaluation
                → isolated Windows founder production
                  → founder alpha + 10–30 design partners
                  → durable memory + text-assisted nutrition
                    → vision-assisted drafts
                    → subscription validation + beta hardening
```

Nutrition, training, and progress can advance in parallel only after the production composition root persists them. The text coach may now be implemented because confirmed manual workflows, deterministic calculations, and product instrumentation exist. External AI access and photo interpretation still depend on provider/privacy approval, safety and quality evaluation, deletion/isolation, budgets, and native acceptance. Community sharing remains post-MVP.

## Cross-cutting infrastructure evolution

ADR-0016, ADR-0020 (superseding ADR-0018), and `docs/INFRASTRUCTURE_EVOLUTION_PLAN.md` establish a portable path with an explicit founder-production exception:

1. keep disposable local development on the Mac, and host isolated Dev (port 4100/8100) and Production (port 4000/8000) side-by-side on the Raspberry Pi 5 (`mizyun-pi`), with the Windows PC (`mizyun-pc`) kept as a hot backup;
2. promote exact verified commits without ever resetting or seeding remote authorities;
3. keep business rules, identity, memory, media, and model providers behind replaceable ports (Gemini active via ADR-0019);
4. enforce deployment safeguards (port checks, mutex locks, rollback) and off-device backups before paying users rely on the service;
5. return to the managed/redundant production gate before paying-user cutover, including 90 days of production-shaped staging and two rehearsals.

The current infrastructure topology is operational on the Raspberry Pi 5 under `INFRA-DUAL-001–005` / ADR-0020, with physical-device journey acceptance (R8) and store distribution signing (R3 Part B) remaining open release gates. “Production” during this phase means Adam's founder environment, not release-grade paying-user production.

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

## Phase 1 — Backend environment and authenticated data boundary ◐

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

## Phase 2 — Onboarding, profile, and goals ◐

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

## Phase 3 — Manual nutrition and deterministic energy model ◐

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

## Phase 4 — Exercise library and workout tracking ◐

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

## Phase 5 — Body progress and private media ◐

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

## Productization checkpoint — Persistent manual alpha 🚧

### Objective

Prove the business-plan launch wedge before adding AI: a busy intermediate gym-goer can capture a meal, workout, weight, or progress photo quickly; the data survives restarts; and the dashboard turns it into a useful daily and weekly record.

### Work packages

1. **PERSIST-001 — Profile, goal, and food adapters**
   - implement PostgreSQL/Supabase repositories behind the existing profile, goal, and food ports;
   - select them only in the API composition root;
   - prove two-user isolation and persistence across API restarts.
2. **PERSIST-002 — Training, body, and account adapters**
   - persist exercises, workouts, sets, and body measurements behind existing ports;
   - prove cross-owner relationships cannot be created;
   - make export and deletion operate on real persistent records.
3. **PERSIST-003 — Private-media storage adapter**
   - implement real Supabase signed upload/download/delete storage behind `MediaStorage`;
   - persist media metadata and prove restart, isolation, expiry, and deletion behavior.
4. **MOB-DAILY-001 — Core mobile capture loop**
   - baseline weight during or immediately after onboarding;
   - manual food create/edit/delete and daily totals;
   - exercise selection, workout/set logging, and previous performance;
   - weight entry and real dashboard totals;
   - recoverable drafts for network interruption on critical logging actions.
5. **MEDIA-MOB-001 — Progress-photo mobile loop**
   - select/capture, validate, upload, timeline, compare, and delete;
   - explicit consent and private-by-default messaging.
6. **AND-001 — Android proof**
   - run the same activation and daily loop in an Android emulator/device;
   - record platform-specific defects instead of treating the iOS bundle as Android evidence.
7. **OBS-001 — Product validation instrumentation**
   - consent-respecting activation, time/taps-to-log, completion, retry/failure, retention, and feature-use events;
   - no food text, health values, photo content, tokens, or message bodies in analytics;
   - a founder dashboard or export sufficient to evaluate 10–30 design partners.
8. **AI-GOV-001 / AI-001 / AI-002 — Private Mistral text-coach implementation**
   - resolve Mistral commercial, DPA, Zero Data Retention, and fitness/wellness Usage Policy questions;
   - server-only configuration, the official-SDK adapter, structured output, bounded retry/failure normalization, and default-off external access are implemented;
   - RLS conversation persistence, message idempotency, export/deletion, and bounded confirmed-data grounding are implemented;
   - fixed critical-safety paths and the mobile Coach experience are implemented and unit/route tested;
   - next pass the versioned offline and opt-in live synthetic safety, grounding, prompt-injection, cost, and failure evaluations plus standalone native acceptance;
   - keep external AI access disabled until `docs/AI_IMPLEMENTATION_PLAN.md` release gates pass.
9. **ALPHA-001 — Founder and design-partner validation**
   - founder completes at least one continuous week without data loss;
   - 10–30 target users test the loop before paid acquisition;
   - prioritize repeated friction and retention failures over additional feature breadth.

### Exit criteria

- Records persist across API/mobile restarts and remain isolated by verified user ID.
- A user can complete the activation, nutrition, workout, and progress journeys from mobile without direct API or database access.
- Dashboard values come from stored records rather than constants.
- The complete loop passes on both iOS and Android.
- Logging efficiency, activation, and early retention can be measured without collecting sensitive payloads.
- Known P0/P1 data-loss, privacy, and core-workflow failures are closed before external AI access or paid acquisition.

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

Private implementation may proceed under `docs/AI_IMPLEMENTATION_PLAN.md` with AI disabled externally and synthetic data only. Every applicable item in `docs/BEFORE_TESTING.md` plus the plan's external AI release gate must be complete before real-user access. Manual product workflows, privacy controls, and deterministic calculations already exist; provider and product evaluations are the active evidence gap.

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

## Phase 9 — Beta hardening, monetization, and release ⏳

### Scope

- accessibility, localization readiness, and complete metric/imperial behavior;
- offline/error recovery for critical logging paths;
- performance, battery, upload, and low-connectivity testing;
- observability without sensitive payload logging;
- consent-respecting product analytics for activation, logging efficiency, retention, conversion, churn, and feature use;
- subscription/paywall implementation only after premium value, provider cost, and willingness to pay have been tested;
- unit-economics reporting for AI cost per active/paying user and subscription gross margin;
- privacy policy, terms, consent, retention, export, and account deletion;
- domain-authenticated transactional Auth email from `no-reply@mizyun.phiskel.com`, with confirmation and password-recovery acceptance;
- Android emulator/device and iOS simulator/device test matrix;
- store metadata, permission disclosures, signing, staged rollout, and rollback plan.

### Exit criteria

- All MVP requirements are accepted and all P0/P1 defects are closed.
- `docs/QUALITY_GATES.md` and `docs/BEFORE_TESTING.md` release gates pass.
- A restore/recovery exercise and account-deletion test have succeeded.
- Email confirmation and password recovery succeed through the production transactional-mail provider; automatic confirmation is disabled.
- TestFlight and internal Android builds complete the defined device matrix.
- Free and premium entitlements fail safely and can be restored across supported platforms.
- The team can measure the 30–100-customer validation funnel without logging sensitive content.

## Plan maintenance rules

- Update the current-focus paragraph and phase status when a work package starts or finishes.
- Track and update executable tasks using GitHub Issues; do not turn this roadmap into a daily log.
- Add or amend an ADR when a durable architecture choice changes.
- Update `status.md` at the end of every development session.
- Do not mark a phase complete until its exit evidence is reproducible.
