# Actionable Coach suggestions implementation plan

Shorten the path from a useful suggestion to a confirmed meal or reviewed future workout change. Reuse Mizyun's existing typed proposals and draft screens, and make stale proposals and ambiguous save outcomes safe.

Package DIFF-02; planned 2026-10-12. Execution owners: PC-02/#172, workout extensions PC-03/#173, durable retry dependency #31. Read the [shared baseline and gates](../../DIFFERENTIATION_IMPLEMENTATION_PLANS_2026-10-12.md).

## A Context and scope

Existing Coach suggestions already open meal/workout drafts. The work is a common evidence, preview and acceptance lifecycle that can also serve the weekly review. The first vertical slice is one suggested meal reviewed through the existing form; subsequent slices cover workout start/edit and weekly adaptation.

In scope: typed source/revision/expiry envelope; compact action cards; exact preview; editable account-owned draft handoff; retry/restart reconciliation; a confirmed outcome reference. Non-goals: automatic consumption logging, autonomous goal/routine changes, a second action engine, multi-workout atomicity in the first slice, payments, trainer delegated writes or blanket Undo for historical data.

## B Baseline and constraints

Observed HEAD `0135228778059dc25c1a4925738f0b6934ed4f0c` plus shared dirty work; refresh before writing. Source reuse:

- `packages/contracts/src/coach.ts` / `coachActionProposalSchema`: `meal_log`, `workout_start`, `daily_plan`, `weekly_adaptation`, `multi_workout_plan`, `workout_edit`.
- `apps/api/src/modules/coach/routes.ts`: typed proposal persistence and weekly acceptance.
- `apps/mobile/src/features/coach/coach-setup-screen.tsx` / `reviewNutritionProposal`, `reviewWorkoutProposal`, action cards.
- `apps/mobile/src/features/log-meal/meal-form.ts`, `log-meal-screen.tsx`, `meal-retry-durability.test.ts`: operation identity and draft recovery.
- `apps/mobile/src/features/coach/workout-edit-proposal.ts` and `multi-workout-plan.ts`: existing mutation calls.

Observed gaps: workout edit proposal lacks expected source version; multi-session saving is sequential and can partially succeed; existing IDs do not establish a common durable outcome ledger. Plan 05 provides current constraints and coverage. Preserve free manual logging and current server authorization.

## C Staged implementation steps

### Stage 1 Version the envelope and preview contract

[MODIFY] `packages/contracts/src/coach.ts` and tests; [NEW] `packages/core/src/coach-action.ts` and tests; [MODIFY] public exports. Retain existing action kinds. Add a compatible versioned envelope with proposal ID, source references/revisions, created/expiry times, goal and constraints versions, allowed action kinds and evidence state. Older stored conversations remain readable; unsupported/legacy stale mutation proposals require regeneration rather than silently filling fresh revisions.

Define preview data separately from commit input: what will be created or changed, target record, before/after canonical values, editable fields and confirmation wording. Meal suggestion acceptance means opening a draft; only the user's later consumed-meal Save creates intake. A future meal plan is not proof of eating.

Acceptance: invalid kinds/revisions/expiry and fabricated record references fail schema or domain validation. Historical messages remain renderable without gaining new write privileges.

### Stage 2 Complete the meal action end to end

[NEW] `apps/mobile/src/features/coach/coach-action-controller.ts` and tests; [MODIFY] existing Coach card/handoff, meal draft and save integration. Persist an owner-scoped draft ID, proposal identity and operation payload before navigation/send. Put opaque draft IDs in routes, never meal content or health numbers in a URL.

The same draft opens from Coach and weekly review. Offer portion/name corrections through the existing form. Dismiss/cancel preserves no authoritative intake. Saving sends the frozen operation ID and payload; an intentional new meal creates a new operation. Changing a draft after an unknown outcome requires reconciliation before replacing its payload.

[MODIFY] existing food-entry transport/repository only for necessary proposal/outcome linkage, through public ports. A durable outcome record must be coupled with the actual accepted mutation in the database transaction, or derived from an existing unique mutation receipt. Do not save intake successfully and then depend on a separate best-effort request to prevent duplicates.

Acceptance: review/cancel changes no totals; Save creates one entry; double tap, app kill and lost response reconcile to the same entry; cross-account drafts cannot open or replay.

### Stage 3 Enforce server acceptance and invalidation

[NEW if required] `apps/api/src/modules/coach/action-acceptance.ts`, action repository port/adapter and tests; [MODIFY] existing authoritative routes rather than allowing the model a generic write endpoint. Proposed acceptance/reconciliation endpoints must dispatch only known action schemas.

Check principal, owned proposal/source, allowed kind, current consent where provider processing occurs, source/constraint/goal versions, expiry, deletion barriers and resource ownership. Unchanged valid operation replay returns the original result, including after the original proposal expires; do not execute it again. Changed payload with the same identity returns a conflict. A new unexecuted expired/stale proposal fails with a refresh requirement.

If a new `coach_action_receipts` table is necessary, define unique `(user_id, operation_id)`, payload fingerprint, proposal/kind, committed result ID, timestamps and status. Do not retain full meal/health payloads in a second log without a justified retention purpose. Include RLS/grants/indexes, owner-checked links, export/delete and restore reconciliation. Never return another user's receipt for a guessed ID.

Acceptance: real two-user deny cases pass; concurrent requests commit once; API restart retains outcome; failed persistence or version checks produce no mutation; known committed receipts remain reconcilable.

### Stage 4 Extend workout and target actions in bounded slices

[MODIFY] existing workout edit/start schemas, route/service and mobile preview. Add expected versions and transaction-time checks. Distinguish future routine/template edits from active sessions and completed historical workouts. No active workout overwrite. Compare user-edited preview with the current server record again when applying.

For weekly adaptation, couple goal version update and acceptance receipt atomically; preserve existing numeric bounds and require complete eligible evidence. For multi-session saving, explicitly choose resumable per-session receipts or a supported atomic transaction in a separate slice; show partial success and only retry unresolved session identities. Do not advertise Save all as atomic before that design passes.

Acceptance: concurrent user edits cannot be overwritten; active/finished session transitions reject incompatible changes; partial plans remain visible/recoverable; goal changes are applied once and are attributable to user confirmation.

### Stage 5 Measure saved effort

Compare suggestion → confirmed-record time/taps with current logging, including corrected drafts and failures. Measure completed actions rather than card taps. Keep operation/provenance evidence private; optional analytics records only approved coarse event categories. Failure of AI explanation preserves the draft and manual actions.

## D Verification plan

```sh
pnpm --filter @mizyun/contracts test src/coach.test.ts
pnpm --filter @mizyun/api test src/modules/coach src/modules/food-entries
pnpm --filter @mizyun/mobile test src/features/coach src/features/log-meal/meal-form.test.ts src/features/log-meal/meal-retry-durability.test.ts
```

Add meaningful contract/controller/repository tests for stale constraints, old proposal versions, lost responses, persistence failure, intentional repeat versus duplicate, payload conflicts, logout/restart, deletion races, and concurrent acceptance. Workout slices also run workout lifecycle/set tests. New receipts require disposable-local SQL/RLS plus authenticated HTTP isolation; a mocked request returning success is insufficient.

Settle a non-author High review for authorization/migration/lifecycle changes, format owned paths, then shared navigation/format/full gates on a stable candidate. Native acceptance covers preview/edit/cancel/Save/reopen, offline retry and restart, existing drafts, back navigation, late responses, both platforms and accessibility. This package is not accepted merely because a card renders or a server returns 200.

## E Next session prompt

```text
Implement only DIFF-02 meal slice stages 1–2 from docs/plans/mizyun-differentiation-2026-10-12/02-actionable-coach-suggestions.md under PC-02/#172 and #31. First inspect status/AGENTS/START_HERE, current tree and Coach/meal context; refresh Plan 05 dependencies. Reproduce the real lost-response and restart boundary before changing acceptance. Reuse typed meal_log proposals and owner-scoped LoggingDraft/meal operation identities; no parallel action engine or provider-authorized writes. Coordinate ownership of the concurrently edited Coach screen and meal files. Delegate bounded regression investigation; require a fresh non-author High review if server authorization, persistence or lifecycle changes. No live provider, build/install, deployment or Production action is authorized by this plan. Run focused final tests, format owned files and verify a stable candidate with pnpm check; record exact outcome and keep workout/goal extensions separate.
```
