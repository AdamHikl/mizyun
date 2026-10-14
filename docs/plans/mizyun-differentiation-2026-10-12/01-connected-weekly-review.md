# Connected weekly review implementation plan

Give a busy lifter a clear account of their week across food, training and body trends, followed by one practical priority. A useful descriptive review must remain available when data cannot support changing a target.

Package DIFF-01; planned 2026-10-12. Execution owner: PC-04/#174, with PC-02/#172 presentation. Read the [shared baseline and gates](../../DIFFERENTIATION_IMPLEMENTATION_PLANS_2026-10-12.md) and [existing proactive Coach plan](../../PROACTIVE_COACH_PLAN_2026-10-02.md) first.

## A Context and scope

The current Coach can produce a weekly adaptation proposal, but it is primarily a numeric target/pace recommendation inside a conversation. The new experience should answer what changed, what is uncertain and what deserves attention, without requiring a prompt.

In scope: a review of seven completed local days, comparison with the preceding seven when available, drill-down to source records, one ranked priority, and optional on-demand Coach explanation. Include completed strength workouts, comparable working-set performance, explicit nutrition coverage, weight trend and active goal. Existing non-weight measurements may be descriptive only when their comparison semantics are defined. Do not infer body composition or use body-photo AI.

Non-goals: new training/calorie formulas, autonomous goal changes, automatic background inference, watch/Health imports, medical advice, coach access delegation or a new top-level navigation tab. Target-changing adaptation remains a separate confirmed action under Plan 02.

## B Baseline and constraints

Observed HEAD is `0135228778059dc25c1a4925738f0b6934ed4f0c` plus concurrent changes described in the shared index. Reuse:

- `packages/core/src/weekly-adaptation.ts` / `buildWeeklyAdaptation` and `body-measurement.ts` / `summariseWeightTrend`.
- `apps/api/src/modules/coach/tools.ts` / `buildWeeklyAdaptationForUser`, which already assembles goal, meals, training and weights.
- `packages/contracts/src/coach.ts` weekly proposal and `apps/api/src/modules/coach/routes.ts` acceptance flow.
- Existing Coach weekly presentation and dashboard; use public exports from workout/progress features rather than their internal helpers.

Prerequisite: Plan 05 stages 1–3 must provide explicit coverage and bounded retrieval. Current weekly core counts non-null calorie totals as complete days; this must not feed a confident new adaptation. Existing meal/workout list limits of 500/50 cannot be assumed exhaustive.

## C Staged implementation steps

### Stage 1 Define the review evidence contract

[NEW] `packages/contracts/src/weekly-review.ts` and tests; [NEW] `packages/core/src/weekly-review.ts` and tests; [MODIFY] both public indexes. Define `WeeklyReviewV1` with local period start/end, IANA timezone, generation timestamp, evidence revision, goal revision, source-domain availability, retrieval completeness, nutrition coverage counts, observations, omissions, source references and one optional priority.

Keep source evidence separate from explanatory prose. Observation fields contain canonical quantities, comparison windows and reason codes. The review state is `available`, `partial`, `insufficient_data` or `unavailable`; each domain can have its own state. A source reference resolves only to a currently authorized record. Truncated queries are visible omissions, not a complete record count.

Acceptance: strict schema rejects missing provenance, non-finite quantities, invalid interval ordering and a priority requiring unavailable evidence. A partial review remains valid and useful.

### Stage 2 Assemble deterministic observations and priority

[MODIFY] core weekly adaptation only to consume the settled completeness contract; [NEW] weekly-review core policy. Summarize confirmed recorded intake separately from complete-day intake averages. Compare like exercises, measurement types, units and working-set semantics; exclude warmups from working progression as current rules require. A changed exercise variant or insufficient comparable sessions produces an explicit limitation.

Use the existing weight-trend engine and expose its coverage. Do not treat a single measurement or an unlogged period as a trend. Rank a small reviewed catalog of actions: complete a missing input, continue an effective plan, prepare a feasible session, or review a specific logged pattern. Abstention is a legitimate output. Preserve existing numeric safety limits and avoid attributing stalled performance to diet from correlation alone.

Acceptance: identical evidence gives identical calculations/priority; empty history, missing goal, inconsistent units, partial meals and incomparable lifts produce explainable results without fabricated claims. No nutrition decrease is suggested from partial intake.

### Stage 3 Add authenticated read assembly and freshness

[NEW] `apps/api/src/modules/coach/weekly-review-service.ts`, `weekly-review-routes.ts` and matching tests; [MODIFY] Coach route composition and public schemas. Proposed `GET /v1/coach/weekly-review?weekStart=YYYY-MM-DD` returns a read-only deterministic review; validate dates against the principal's profile timezone. Bound supported historical windows and query sizes.

Retrieve all records needed for the bounded interval through pagination or a trustworthy aggregate; if a resource cap is reached, return `truncated` and disable affected recommendations. Include goal, source, coverage and constraint revisions. Cache only under principal + interval + algorithm version + revisions. Delete/edit/backdate/goal change invalidates derived reviews; never silently serve prior-goal advice as current. Re-fetch after sign-in; offline snapshots must be marked as saved/stale and contain no enabled target-changing action.

First slice can derive reviews on read without a new durable review table. Before persisting history, specify retention, export and deletion in a separate bounded extension. Requesting an explanation is an explicit budgeted provider operation; read-only deterministic retrieval makes zero provider calls.

Acceptance: A cannot request B's review; source deletion cannot leave an actionable stale reference; timezone/DST windows agree with Meals. Old clients and unsupported versions receive a safe disabled response.

### Stage 4 Present one useful weekly decision

[NEW] `apps/mobile/src/features/coach/weekly-review-card.tsx`, `weekly-review-data.ts` and tests; [MODIFY] Coach screen and a compact entry on the existing dashboard, coordinating ownership of concurrently edited files.

Render a short change summary, the one priority, and a visible coverage qualifier. A details view separates food, training and weight and offers source drill-down. Avoid one combined score implying health quality. The priority opens Plan 02's existing review flow. Add dismissal and opt-out without hiding ordinary progress screens. No notification or automatic explanation in the first slice.

Acceptance: users can identify the period, why the priority appeared and missing inputs; loading/error/offline states retain core tracking. Compact layout, accessibility and both platforms pass without a dashboard redesign.

### Stage 5 Evaluate usefulness

Prepare synthetic examples covering an improving lift with flat weight, inconsistent logging, a changed routine, no previous period and a changed goal. Compare the new review against existing charts in the eligible pilot. Measure voluntary weekly returns, comprehension, accepted actions and time spent; no health-outcome claim follows from these measures.

## D Verification plan

Focused commands after implementation:

```sh
pnpm --filter @mizyun/core test src/weekly-review.test.ts src/weekly-adaptation.test.ts src/body-measurement.test.ts
pnpm --filter @mizyun/contracts test src/weekly-review.test.ts src/coach.test.ts
pnpm --filter @mizyun/api test src/modules/coach/weekly-review src/modules/coach/tools.test.ts
pnpm --filter @mizyun/mobile test src/features/coach/weekly-review
```

New file commands become runnable only after those files exist. Include regressions for sparse-day false adherence, DST/travel, more than current repository caps, stale goal/source revisions, deleted records, unknown versus zero, warmup exclusions and denied principal. Add real two-user request evidence and lifecycle checks if persisted artifacts are introduced. Run shared navigation/format/full gates on the settled candidate; broaden AI evaluation only if explanations change.

Native: navigate Home → review → source record → priority preview; restart, account switch, offline and late-response cases; small screens, large fonts, VoiceOver/TalkBack and both unit systems. Record exact artifacts. A review that is meaningful without changing a target is required acceptance.

## E Next session prompt

```text
Implement only DIFF-01 stage 1 from docs/plans/mizyun-differentiation-2026-10-12/01-connected-weekly-review.md under PC-04/#174. First inspect git status and refresh AGENTS/status/START_HERE plus focused Coach/body/training contexts; verify Plan 05 evidence coverage dependencies and stop target-adaptation work if they are absent. Own the new core/contracts weekly-review files and their public exports; coordinate shared file ownership before editing. Delegate a bounded synthetic-evidence investigation, preserve all concurrent work, and reuse current formulas. No provider calls, build/install, deployment or Production changes are authorized by this plan. Prove partial/truncated data cannot imply full adherence and show deterministic evidence with at most one priority. Finish focused tests, any required non-author High review, owned formatting and stable-candidate pnpm check; record exact evidence and the next bounded stage.
```
