# Proactive Coach: less tracking, more progress

> PROACTIVE-COACH-001 · Proposed implementation plan · 2026-10-02. Planning only: no feature implementation, provider calls, deployment or device acceptance. This extends the existing philosophy; it does not change product goals, approve broader AI access, or reorder the active roadmap.

## A. Context and scope

### Product outcome

Mizyun should help a busy gym-goer decide **what to do next**, using their food, training and progress together. The Coach should notice useful opportunities without requiring a carefully written prompt, explain its reasoning, and offer an easy action the user can review. The measure of success is less effort and better understood decisions, rather than more conversations or notifications.

The experience is: **notice → explain → propose → user reviews → apply → learn from feedback**. Proactive means initiating a useful suggestion; authoritative changes still require the user. This supports O1–O4 in [goals](../goals.md), the [business alignment](BUSINESS_ALIGNMENT.md), and COACH-01–11/MEM-01–06 in [requirements](PRODUCT_REQUIREMENTS.md).

### Principles translated into behavior

| Mizyun principle                 | Coach behavior                                                                                                                                            |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Less tracking, more progress     | One prominent next action, familiar meal reuse, workout preparation and a short weekly review; avoid extra forms unless an answer changes the suggestion. |
| Confirmed facts beat guesses     | Distinguish logged intake, complete-day confirmation, estimates and missing records. A missed log does not prove a missed meal or workout.                |
| Trends beat false precision      | Use comparable sessions and sufficiently covered periods. A noisy weigh-in or one difficult session cannot establish a plateau or fatigue condition.      |
| Deterministic calculations       | Domain code owns totals, targets, progression bounds, eligibility and priority. AI explains and drafts within those boundaries.                           |
| Private by default               | Use only authorized minimal context; generic lock-screen text. Keep Community and imported device-health data outside Coach.                              |
| Visible, reversible memory       | Explain which confirmed preferences/memories mattered. Correction, expiry, deletion or opt-out invalidates affected suggestions.                          |
| Recommendations explain why      | Show the relevant goal, recorded evidence, dates, assumptions and uncertainty, with a path to inspect the source.                                         |
| Build evidence before automation | Start with foreground suggestions and synthetic evaluation, then test usefulness before expanding reminders or background processing.                     |

### Scope

1. A dashboard/Coach **Your next step** card that appears without typing a prompt.
2. Workout preparation, editable exercise alternatives, practical execution tips, post-workout reflection and conservative next-session progression proposals.
3. Food choices drawn from familiar confirmed meals and user-confirmed restrictions, plus one optional habit experiment at a time.
4. A connected weekly review that can propose a habit, routine or target adjustment with an exact preview.
5. Optional daily/weekly reminders with pause, frequency controls and privacy-safe content.
6. Evidence quality, consent, freshness, lifecycle, evaluation and cost controls supporting those flows.

Keep manual logging, history and basic progress useful in the free tier and during AI outages or budget exhaustion. Premium deeper explanations/drafting remain a packaging hypothesis; this plan introduces no billing change or new price. Explain model cost through product value and measure it before committing to packaging.

### Boundaries

No automatic meal saves, workout starts, routine overwrites, goal changes or durable inferred memories. No diagnosis, injury interpretation, prescribed medical diets, compensatory exercise, body-photo coaching or precise body-composition claims. No mandatory calorie/weight focus: strength and consistency goals receive useful training guidance too. No moral scoring of food, punitive streaks or pressure to earn meals through exercise.

The first version performs no scheduled background provider analysis and adds no remote push infrastructure. COACH-11 remains the governing reminder boundary. Background personalized analysis is a later design proposal requiring a new consent/cost/lifecycle decision and acceptance evidence.

## B. Baseline and constraints

### Source and workspace

Inspected HEAD `025ae13c9bac444aef7f76210735e1ddffebe60b`, branch `codex/community-140-145`. Pre-existing dirty Community/auth/API-client/layout files, new Community cache files, `status.md`, `docs/RESEARCH_LOG.md`, `docs/feature-map.json` and Community audit/testing documents belong to concurrent work and must be preserved. Context manifests report stale review SHAs; current source was inspected instead of treating their completion summaries as acceptance. A concurrent Community session subsequently advanced HEAD to `9cfec3b`; its commit changed no Coach-owned runtime files. This planning baseline remains the inspected SHA, and concurrent source/documents are preserved.

| Existing source capability                                         | Evidence pointer                                                                                                                                  | Consequence                                                                                                                                      |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Deterministic daily plan and weekly adaptation                     | `packages/core/src/daily-action-plan.ts`, `weekly-adaptation.ts`; `apps/api/src/modules/coach/tools.ts`                                           | Extend existing engines and cards rather than rebuilding a planner. Current rules need expanded evaluation.                                      |
| Training prescription and editable workout/multi-session proposals | `packages/core/src/training-prescription.ts`; `apps/api/src/modules/coach/workout-action.ts`, `multi-workout-action.ts`, `workout-edit-action.ts` | Reuse prescription, routine and confirmed-start boundaries; preserve active workout recovery.                                                    |
| Meal drafts, detailed history and exercise history                 | `apps/api/src/modules/coach/nutrition-action.ts`, `meal-history.ts`, `exercise-history.ts`                                                        | Use bounded tools with explicit coverage; food estimates remain editable drafts.                                                                 |
| Local daily/weekly reminders                                       | `apps/mobile/src/features/coach/coach-reminders.ts`                                                                                               | Already off by default; tapping opens and auto-submits a request. Recheck consent/principal before execution; no background analysis is implied. |
| Consent, memories, limits and evidence UI                          | `ai-consent-controller.ts`, `evidence-chips.tsx`; API memory routes/limits; ADR-0024                                                              | Preserve self-service AI admission after current consent, adult eligibility, user memory controls and server limits.                             |
| Device-only imported steps                                         | [ADR-0028](adr/0028-optional-device-only-steps.md)                                                                                                | Do not add HealthKit/Health Connect steps to Coach, server, analytics or energy calculations.                                                    |

These are **source findings**, not freshly tested/deployed/device-accepted features. Current status and [BEFORE_TESTING](BEFORE_TESTING.md) retain broader AI evaluation and native acceptance gaps. Gemini is the current provider; older Mistral sections of `AI_IMPLEMENTATION_PLAN.md` describe historical work. Verify current configuration/model identity at implementation time. The founder/partner Dev exception remains intact and does not approve broader rollout.

### Prerequisites discovered during planning

- **Whole-day logging is unknown.** `tools.ts` sums logged entries, and `weekly-adaptation.ts` counts non-null calorie days. Its “complete days” wording does not establish that all meals were captured. Introduce explicit day coverage before adapting targets or asserting eating patterns. PC-01 owns domain/contracts/persistence/API and integration verification; #119 owns the meal day-confirmation UI, with no parallel implementation. Reuse the completion concept in [#119](https://github.com/AdamHikl/mizyun/issues/119); day confirmation can be delivered independently of its later evening reminder.
- **Local-day consistency needs repair.** `meal-history.ts` explicit dates currently use UTC boundaries, while daily Coach summaries use profile timezone. Align retrieval, training-day comparisons and scheduling with local-day policy; include DST and travel.
- **Restrictions need enforceable structure.** Coaching preferences have dietary preferences and training limitations, but optional memory recall cannot guarantee an allergy exclusion. Add separately confirmed ingredient exclusions and explain that unknown ingredient composition cannot be guaranteed safe. Do not infer allergies from meal history.
- **Coverage is bounded.** Coach tools use bounded windows/results. Return window, missingness and truncation; a clipped history must not establish absence or a repeated habit. Preserve comparable exercise identity, units, set types and completed-session provenance.

## C. Intended user experience

### Today: one useful decision

On foreground dashboard/Coach entry, load fresh confirmed context and offer at most one prominent card. Proposed priority: explicit safety/constraint block → incomplete setup needed for this action → user-planned session → chosen habit support → evidence-backed improvement → hold/no action. Evaluate this ranking rather than hard-coding calorie advice as everyone's priority.

Example: “You planned an upper-body session today and have 35 minutes. Review a shorter version using your available equipment.” Show the plan source and last comparable session. Actions: **Review**, **Ask Coach**, **Dismiss**. A goal/setup question should request only information needed for that decision.

For partial nutrition: “Your logged meals contain 70 g protein. Is anything missing from today's log?” The number is an illustrative fixture, not a dietary prescription. Do not say the user ate too little. No useful evidence is an honest state, with manual logging and an optional clarification available.

### Workouts: prepare, execute, reflect

- **Before:** use current goal, planned routine, available time/equipment, confirmed limitations and comparable completed performance. Ask about readiness only when relevant; it is an optional current-session answer, not an inferred diagnosis or automatic memory.
- **What to exercise:** offer an editable session or an equipment-compatible alternative from the supported catalog. Explain movement coverage and why an alternative fits. Preserve routine versions and workout drafts.
- **How to exercise:** show short, expert-reviewed catalog cues, setup/rest guidance and an optional explanation. Retrieve these from an approved content library rather than allowing the model to invent form instructions. No camera-based form assessment in this package.
- **During:** keep logging/rest controls primary. Offer help when requested or at a natural exercise transition, with no unsolicited stream of messages or mid-set load changes.
- **After:** one progress observation and one optional suggestion. Compare matching exercises/set types/units; separate incomplete/custom histories from established progress. Pain, concerning symptoms or contradictory limitations suppress progression advice and follow the existing safety boundary.
- **Next session:** propose a bounded rep/load/volume change from deterministic rules; review before saving. Starting a session and recording what actually happened remain explicit user actions.

### Food and habits: achievable options

Offer two or three familiar meal options using confirmed meal records, dietary choices, structured exclusions, preparation time and optional budget preferences. Show portion changes and estimated nutrition as a draft; review/save through the existing meal form. Avoid requiring detailed pantry tracking or inventing what the user has at home.

For repeated patterns, say “On the days you marked complete…” and show the observed period and coverage. Ask whether the pattern is representative. A **habit experiment** has one user-chosen action, a convenient cue, optional reminder and review date. Examples: prepare a familiar lunch for a busy training day, or make a usual breakfast easier to log. Fiber/micronutrient-specific claims wait for reliable nutrient coverage; the current macro record cannot support every food-quality inference.

No suggestion creates a memory automatically. “Less like this” changes a bounded suggestion preference; “Remember this” requires the existing inspectable memory confirmation flow. Do not interpret dismissals as lack of motivation or diagnose behavior.

### Weekly: understand, then adjust

Show a short review: **what went well → evidence coverage → what is uncertain → one proposed next step**. Combine completed training, confirmed whole-day nutrition where available, optional weight trends and the user's goal. Weight logging is not required for strength/consistency guidance; insufficient weight data holds calorie adaptation.

Reuse weekly adaptation but review its existing minimum-day/trend/adherence thresholds and goal-pace escalation rules with qualified domain review and evaluation. Deterministic does not mean clinically validated. Missing, noisy or contradictory evidence results in **hold**, rather than repeated restriction or escalating pace. Any proposed change shows exact before/after, effective date, reason and affected sessions/targets. Users may edit, reject or confirm. Historical records remain unchanged.

### Reminders: user chooses the rhythm

Offer separate daily and weekly opt-ins after the user has seen a useful card. Configure time, quiet period, pause/snooze and topic preference. Proposed initial cap: at most one Coach notification per local day and one weekly review per week, with the weekly review replacing the daily notification that day. Treat this as a pilot setting, not a proven optimal cadence.

Use generic text such as “Open Coach to review your next step,” with no health/food/weight content or identity in the lock-screen payload. Suppress duplicates, completed check-ins and paused categories where local state permits; do not promise cross-device suppression. Coordinate with meal reminders [#118–120](https://github.com/AdamHikl/mizyun/issues/118) to avoid competing prompts. Tapping rechecks identity, consent, age eligibility, topic settings, source freshness and budget before reading/generating personalized content. OS permission denial leaves in-app guidance usable.

## D. Staged implementation work packages

The order below is proposed within this feature; it does not supersede the roadmap's existing reliability/release dependencies. File paths are ownership candidates to confirm through `pnpm context` at startup. New schema/migration/authorization/budget work requires independent non-author review. Each package delivers a reachable mobile journey with failure states, not only an endpoint.

### PC-01 — Evidence coverage and controllable context

**Files:** [MODIFY] `packages/core/src/food-entry.ts`, `profile.ts`, `daily-action-plan.ts`, `weekly-adaptation.ts`; matching contracts; Coach `tools.ts`/`meal-history.ts`; existing meal/account controls. [NEW] nutrition-day coverage domain/contract/adapter/route, structured suggestion-constraint support, forward migrations and focused tests.

Implement domain/contracts/persistence/API in PC-01 and the existing day-confirmation UI in #119. Both consume the same boundary; PC-01 source tests can use synthetic confirmations, while user-facing acceptance depends on #119. Define coverage independently from nutrient confirmation: `unknown`, `partial`, `user_confirmed_complete`, with local date/timezone, confirmation timestamp and source revision. A relevant meal create/edit/delete/backdate invalidates affected confirmations and downstream proposals; re-confirmation is explicit. Do not backfill completeness. Model reports cannot mark a day complete. Sparse or truncated data cannot trigger intake reduction.

Add an inspectable constraints context and bounded provenance snapshot. User-owned persistence requires `user_id`, index, RLS, cross-owner relationship checks, export/deletion and restore/erasure handling. API identity is always derived from the verified principal. Align date retrieval and local-day comparisons without replacing canonical timestamps.

**Exit:** sparse-day false-adherence scenario reproduced before repair; confirmation/invalidation survives restart; timezone/DST fixtures agree across views; exclusions applied before suggestions; no cross-user or deleted-source retrieval.

### PC-02 — Foreground next-action card

**Files:** [NEW] `packages/core/src/coach-suggestion.ts`, `packages/contracts/src/coach-suggestion.ts`, a Coach suggestion service and mobile card/controller. [MODIFY] public module exports, API Coach composition/routes, `apps/mobile/src/features/dashboard/dashboard-screen.tsx`, existing Coach presentation and data client.

Eligibility and ranking run in core; service assembles authorized context. Reuse daily plan/proposal structures. Proposed envelope: version, kind, local date, source revisions, coverage, typed reason codes, source references, constraints version, created/expiry times, proposal reference and allowed actions. Keep confidence/uncertainty categorical and explained, rather than invented percentages.

Generation is read-only. Deterministic cards need no new automatic third-party transmission. Automatic foreground model explanations are separately off by default with a visible “Explain my next step automatically” preference showing data sharing and budget use. When off, generation happens only through Ask Coach. Enabling this preference still requires current AI consent and does not change self-service admission. Reuse a current card on unchanged context; invalidate on relevant saves, goal/preferences changes, consent/memory/source deletion and identity change. Bound model explanation generation to one automatic attempt per unchanged eligible context, with a proposed daily cap; retries/fallbacks share server accounting. Cached content remains principal-scoped and clears on sign-out/revocation. Provider failure returns a deterministic card or honest unavailable state without losing drafts.

**Exit:** card appears without a prompt; one action with inspectable evidence; dismiss/pause persists; no authoritative writes; no repeated calls from rerenders; manual core works offline and after budget exhaustion; stale/private cached data does not reappear.

### PC-03 — Workout preparation and practical tips

**Files:** [MODIFY] `training-prescription.ts`, training contracts, Coach workout/multi-workout/edit actions and mobile training-plan/workout surfaces. [NEW] reviewed exercise-cue content/lookup and session-readiness draft support.

Preserve public module boundaries and existing lifecycle/idempotency. Validate equipment, restrictions, session time, exercise identity, units and set types before forming a proposal. Use curated execution cues; generated explanations cannot change prescribed numeric bounds. Proposed routine edits include expected source version and exact diff; a started/changed session invalidates an incompatible edit. No active workout is overwritten by a new suggestion.

**Exit:** exercise alternative fits supported constraints; unknown/custom history is labeled; readiness/pain cases safely hold; preview/edit/start and post-save summary survive app restart; lost acceptance response creates no duplicate routine/workout; real iOS/Android flow accepted on exact artifacts.

### PC-04 — Food options, one habit and weekly review

**Files:** [MODIFY] Coach nutrition/history/weekly actions, core weekly adaptation and corresponding contracts/mobile cards. [NEW] bounded habit proposal/lifecycle module and user-owned persistence only where required.

Prefer familiar confirmed food options. Ingredient exclusions are enforced outside the prompt; unknown ingredients cannot be asserted safe. AI drafts use strict schemas and post-output validation, editable portions/ranges and explicit user confirmation. Habit states: offered, accepted, paused, completed or abandoned; a history entry is not an automatic health inference. Offer at most one active habit experiment unless the user explicitly chooses otherwise.

Weekly target/routine acceptance is authenticated, version-checked and idempotent. A lost response can be reconciled after restart; changed goals/records/constraints force refresh. Feedback adapts bounded topic/cadence choices and preserves medical/safety rules. Maintain export/deletion, retention and memory separation for habits/feedback.

**Exit:** partial-day and limited-nutrient cases produce qualified advice/hold; incompatible food choices blocked; no logging from suggested meals until save; exact before/after preview; stale concurrent acceptance cannot overwrite goals; users can stop/delete habits and still use core tracking.

### PC-05 — Quiet, optional local proactivity

**Files:** [MODIFY] `coach-reminders.ts`/tests, reminder controls, notification routing and local cleanup. Root layout/auth files currently have concurrent edits: coordinate ownership before changing them. [NEW] local cadence/deduplication state only if existing storage cannot support it.

Reuse device-local notifications and foreground evaluation. Reconcile cancellable schedules after use, preference changes, travel, sign-out/deletion and permission changes. Repeated/cold-start notification responses must not duplicate messages, consume repeated provider budget or execute under a new account. Failed cleanup must remain retryable and testable; do not describe best-effort cancellation as proof that notifications are removed. Do not add exact-alarm privileges merely to promise minute-perfect wellness reminders.

**Exit:** denial/revocation, quiet hours, pause, reboot, foreground/cold-start, duplicate taps, DST, logout/deletion and account-switch races accepted on physical iOS/Android. No background provider calls. No sensitive notification payloads. Existing workout/meal notification flows still behave correctly.

### PC-06 — Evaluation, pilot and release decision

**Files:** [MODIFY] synthetic AI evaluation corpus/harness and relevant quality/privacy/store disclosure documents; [NEW] feature-specific evidence register and pilot protocol. Coordinator owns status, issue states and shared evidence documents.

Create adversarial fixtures before expanding access: food restriction conflicts, incomplete logs, misleading memories, injection, dangerous restriction, exercise-as-punishment, pain/medical requests, stale goals, custom exercises, excluded device data, provider timeout, restarts, deletion and cross-user attempts. A qualified fitness/nutrition reviewer assesses the advice and exercise-cue library. Pin/record actual provider model, prompts, schemas, formula versions and retry costs for evaluated candidates.

Predeclare gates: zero critical safety/privacy/authority violations in the release corpus; 100% numerical calculations/provenance references match fixtures; missing-data/stale/constraint fixtures hold as expected; normal eligible scenarios meet a proposed ≥90% grounded/useful reviewer rating. Finite tests do not prove absence of harm. Any critical live/pilot failure disables the affected suggestion category pending review.

After existing provider/privacy/native gates pass, use an explicitly opted-in 10–30 adult design-partner cohort for four weeks. Compare the existing prompt-driven loop with foreground suggestions; add reminders only after evidence of value. Prefer a randomized reminder opt-in comparison when feasible; otherwise describe observations without causal claims. No recruitment or messaging is performed by this plan.

**Exit:** source/automated/Dev/device/pilot/Production evidence kept separate; usefulness, annoyance, effort and actual costs meet predeclared pilot criteria; privacy/disclosure and operational rollback accepted. Broader release remains a separate decision under existing gates.

## E. Verification, measurement and operations

### Required implementation verification

Run focused core/contracts/API/mobile suites for each changed boundary, then `pnpm navigation:check`, formatting on owned files, and `pnpm check` after writes settle. Include `pnpm test:ai-eval` for the expanded offline corpus. Real two-user Auth/PostgREST/RLS and account lifecycle checks are required for new stored data. Database reset/verification runs only on the disposable local Mac environment and only by the coordinator. Provider integration remains gated by every applicable `BEFORE_TESTING.md` item; no live call is justified by this document.

Physical acceptance covers iOS and Android, small screens, large text/VoiceOver/TalkBack, light/dark, metric/imperial, keyboard, consent decline/revoke, device permission denial, offline/outage/budget failure, stale cards, deletion, and restart/notification/account-switch races. Record exact source/backend SHA, migration versions, build/device IDs, provider identity, commands/results and skipped checks. Installation or a healthy endpoint alone is insufficient.

### Measurement

Primary outcome: users understand and voluntarily act on a useful next step with less work. Measure reviewed helpfulness, accepted/edited/dismissed proposals, time/taps saved, voluntary weekly return and qualitative feedback. Proposed pilot goal: at least 70% of rated suggestions marked useful and no increase in logging effort; validate this target before cohort admission. Collect annoyance/pause/disable and dropout interviews alongside uptake. Report the denominator, cohort and missing ratings; acceptance does not establish health improvement.

Guardrails: critical safety/privacy events, stale proposal rejects, source completeness, duplicate provider attempts, suggestion failure rate, latency and actual AI/infrastructure cost per active user. Proposed explanation latency target is p95 ≤5 seconds, with the deterministic card usable first; measure on accepted devices/network rather than claiming a guarantee. Existing free manual flows must remain available at every failure boundary.

Analytics requires its own existing consent. Use category, result, coarse time/latency and bounded version metadata; no food names, health values, messages, ingredient exclusions, memory content or media. Private operational provenance is distinct from analytics. Expensive explanations/drafts share existing server quotas; no model call on every log, timer tick, background event or UI rerender. Add measured aggregate environment spend controls before expanding automatic explanations; the current shared Dev project exception remains disclosed.

Kill switches should separately disable suggestion generation, explanations, habit drafts and reminders while preserving manual records. A rollback stops new generation/queued work and clears or invalidates incompatible cached suggestions; never deletes confirmed user records. Define retention/export/deletion and restore reconciliation for each new artifact before migration. Schedule/background extensions require an ADR; this planning proposal itself accepts no new architecture.

## F. Primary sources and implementation consequences

Accessed 2026-10-02; detailed entry in [research log](RESEARCH_LOG.md).

- [Expo SDK 57 Notifications](https://docs.expo.dev/versions/v57.0.0/sdk/notifications/): use scheduling, cancellation and response handling; validate release-build navigation and platform permission states.
- [Apple local notifications](https://developer.apple.com/documentation/usernotifications/scheduling-a-notification-locally-from-your-app) and [Android notification permission](https://developer.android.com/develop/ui/compose/notifications/notification-permission): optional OS delivery is a separate control from AI consent; denial must retain in-app usability.
- [Expo BackgroundTask](https://docs.expo.dev/versions/latest/sdk/background-task/): background timing is OS-controlled. Foreground analysis plus local reminders is the proposed first design; no timely-background-execution promise.
- [Gemini structured outputs](https://ai.google.dev/gemini-api/docs/structured-output): strict output structure still needs application value/safety validation. The model does not authorize writes.
- [Gemini terms](https://ai.google.dev/gemini-api/terms): actual project billing/data handling must be verified; paid-service non-training terms do not imply zero retention or EU-only processing. No new search grounding or provider-hosted memory in this scope.
- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security): principal-bound reads/writes plus policy/privilege checks and real isolation tests for every new user-owned artifact.
- [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) and [Google Play Health Content and Services](https://support.google.com/googleplay/android-developer/answer/16679511?hl=en): expanded guidance/data use must match health/privacy/sharing disclosures and the applicable health-app declaration. Existing legal/Store exits remain dependencies.

## G. Executable inventory and next-session prompt

Track execution in [#170](https://github.com/AdamHikl/mizyun/issues/170):

| Package                         | GitHub issue                                          | Planning status                                    |
| ------------------------------- | ----------------------------------------------------- | -------------------------------------------------- |
| PC-01 Evidence coverage/context | [#171](https://github.com/AdamHikl/mizyun/issues/171) | Ready scope; implementation not started            |
| PC-02 Foreground next action    | [#172](https://github.com/AdamHikl/mizyun/issues/172) | Depends on PC-01                                   |
| PC-03 Workout preparation/tips  | [#173](https://github.com/AdamHikl/mizyun/issues/173) | Depends on PC-01/02 and current routine acceptance |
| PC-04 Food/habit/weekly review  | [#174](https://github.com/AdamHikl/mizyun/issues/174) | Depends on PC-01/02 and domain review              |
| PC-05 Local reminders           | [#175](https://github.com/AdamHikl/mizyun/issues/175) | Depends on useful accepted guidance/lifecycle      |
| PC-06 Evaluation/pilot          | [#176](https://github.com/AdamHikl/mizyun/issues/176) | Research; offline design can start early           |

Related open acceptance dependencies: [#29](https://github.com/AdamHikl/mizyun/issues/29) provider governance/live evaluation, [#36](https://github.com/AdamHikl/mizyun/issues/36) native Coach, [#25–26](https://github.com/AdamHikl/mizyun/issues/25) account lifecycle, [#31](https://github.com/AdamHikl/mizyun/issues/31) durable mutation recovery, [#96](https://github.com/AdamHikl/mizyun/issues/96) routine device acceptance, [#118–120](https://github.com/AdamHikl/mizyun/issues/118) meal reminders/completion/pilot, [#37](https://github.com/AdamHikl/mizyun/issues/37) founder/design-partner validation. Reuse those scopes; do not close them based on this plan.

**First implementation action after authorization:** inspect the current tree and run `pnpm context coach-consent-budgets`; reproduce PC-01's false whole-day-adherence scenario using sparse confirmed meal fixtures. No implementation is started by saving this plan.

```text
Implement PC-01 of PROACTIVE-COACH-001 using docs/PROACTIVE_COACH_PLAN_2026-10-02.md and its linked issue. First inspect git status, AGENTS.md, latest status and START_HERE; run focused Coach/meal/profile contexts. Preserve concurrent changes, especially Community/layout/auth/continuity files. Delegate a bounded read-only regression investigation while the coordinator owns contracts/domain/integration planning; require a non-author review of authorization/migration/lifecycle changes. Reproduce sparse logged meals incorrectly satisfying whole-day evidence, then implement explicit local-day coverage and invalidation, timezone-consistent retrieval and structured suggestion constraints. Coordinate the day-confirmation scope with #119 without bundling its evening reminder. Preserve ADR-0024 self-service consent, ADR-0028 device-health exclusion, existing free logging and authoritative confirmation boundaries. Use synthetic fixtures; no provider calls, deployment, Production or device install unless separately authorized. Apply current official research, real isolated data/lifecycle checks, scoped formatting and pnpm check; record exact evidence and next action. Do not begin PC-02 until PC-01 exits are evidenced.
```

## Planning verification

Source inspection and independent helper review informed this document. Documentation checks and issue links are recorded in the session status. Runtime tests, database/provider evaluation, native builds and device journeys were not run for this planning session. All capability/rollout stages above remain proposed.
