# Running support implementation plan

> Authored 2026-10-06. Planning artifact only: running is not implemented or accepted by this document. Baseline HEAD `f40e8941afc5307efce6d5c5909c0146ed1f3dda`; source observations include the disclosed working tree. Research informs design hypotheses; user testing and exact-candidate acceptance remain required. Package: **RUN-00–08**. Tracking issue: [#216](https://github.com/AdamHikl/mizyun/issues/216), ready for RUN-00 discovery.

## A. Context and scope

### Product decision

Add running to **Workouts**, using a direct completed-run entry flow and useful history. Deliver **manual logging first**, coordinate **health-platform imports second**, and implement **live outdoor GPS recording only after a demand and native-reliability spike**. Basic manual running belongs in the free tracking tier under the existing product strategy; this is a recommendation, not a new billing implementation.

The user reports requests for running. The number, frequency and exact job behind those requests have not been measured. A runner wanting watch imports will not necessarily accept manual entry; a runner wanting live pace needs a recorder. RUN-00 validates which job the requesters need before implementation priority is fixed. The engineering plan is ready for that discovery without assuming that GPS is the first deliverable.

Running supports goals O2–O4: a confirmed training record, meaningful trends, and context for coaching. It extends the current gym-goer audience to people combining lifting and running. It does not require changing Mizyun's overall positioning or adding a separate top-level fitness product. Preserve the current roadmap and core release gates; this document proposes a bounded expansion rather than accepting a new roadmap sequence.

### First release: completed manual runs

- Direct **Workouts → Log run**; date defaults to Today; duration is required; distance is optional.
- Metric/imperial distance, calculated average pace when possible, optional environment, effort and notes.
- Durable account-scoped drafts and pending saves; one logical run after a lost response, restart or repeated tap.
- Combined training history with run-specific cards, detail, edit and delete; running-only weekly distance/time/frequency.
- Truthful occurrence-date precision, private export/deletion, old-client compatibility and isolation.
- Confirmed run context for existing Coach; strength progression and nutrition targets retain their meanings.
- Native iPhone and Android usability/accessibility/failure acceptance before feature rollout.

### Later packages

| Package | User outcome                                                                | Entry dependency                                                                  |
| ------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| RUN-06  | See completed runs from a watch/app through Apple Health or Health Connect  | Coordinate with INT-00–03 and their separate device/account-consent gates         |
| RUN-07  | Record an outdoor run with the phone, pause/resume, review and save         | Requester demand, least-permission feasibility, native lifecycle/battery evidence |
| RUN-08  | Improve intervals, comparable records, deliberate sharing or training plans | Observed repeated need and separately scoped acceptance                           |

Initial exclusions: routes/maps, GPS permissions, watch app, live audio coaching, automatic calorie credit, auto-pause, race predictions, heart-rate zones, interval prescription, shoes/equipment tracking, public leaderboards, provider cloud OAuth, GPX/FIT import and automatic Community publication. Those are product choices with costs, not prerequisites for a useful completed-run log.

### Success and discovery

Interview five people who requested running, including people who lift and people using a watch/treadmill. Ask them to show their current workflow with consent, describe their last run and identify the inconvenience they want Mizyun to remove. Record desired job, existing source, frequency, platform, units, offline use and whether duplicate entry is acceptable. Do not collect real routes or health values in the research artifact.

Use a task prototype to test: “Log yesterday's 5 km run in 30 minutes”, “Log a 25-minute treadmill run with unknown distance”, “Find and correct the first run”, and “Find this week's running time while keeping your strength routine available”. Proposed acceptance: at least four of five complete each primary task without moderator instructions; participants distinguish Log run from Record run and understand unavailable pace. Aim for under 30 seconds to enter a familiar completed run after reaching Workouts. These are targets to measure, not established performance claims or statistically representative demand evidence.

## B. Baseline and constraints

### Verified implementation boundaries

| Source                                                                                                                                         | Current fact and implementation consequence                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/mobile/src/components/app-tabs.tsx:20–57`                                                                                                | Five main tabs already exist. Keep Workouts as the destination; running does not justify another bottom tab.                                                                   |
| `apps/mobile/src/features/workouts/workouts-hub-screen.tsx:301–380`                                                                            | One-time/Resume Workout, Create Routine and Exercise Library are current actions. Add a compact Log run action in this context.                                                |
| Same screen `:749–803`                                                                                                                         | Completed cards show sets/strength volume. Running needs a separate presentation branch.                                                                                       |
| `apps/mobile/src/features/log-workout/log-workout-screen.tsx:2205–2256`                                                                        | Primary logging fields are load/reps and Log Set. Do not use this screen as a completed-run form.                                                                              |
| `packages/core/src/exercise-catalog-data.ts:19603–19623`                                                                                       | Running is already an aerobic/cardio catalog entry. Preserve its ID; catalog presence is not a running feature.                                                                |
| `packages/contracts/src/workout-set.ts:43–75`                                                                                                  | Sets can represent duration/distance, but the set POST is not the right atomic boundary for this new summary flow.                                                             |
| `packages/contracts/src/workout.ts:46–109`                                                                                                     | Workout rows have arbitrary details, operation ID and mandatory start/end envelope semantics; completed rows can be created in one request.                                    |
| `apps/api/src/modules/workouts/routes.ts:266–335`                                                                                              | Create replay compares details/timestamps. Freeze the request before sending; changing timestamps on retry conflicts.                                                          |
| `apps/api/src/modules/workout-sets/routes.ts:283–354`                                                                                          | Set POST allocates its own identity/sequence; using a fake set introduces a second mutation and lost-response risk.                                                            |
| `packages/core/src/energy.ts:246–267`; `apps/api/src/modules/energy/routes.ts:235–244`                                                         | Legacy exercise estimate counts sets at 8 kcal each. Runs must not become strength sets or inherit this heuristic.                                                             |
| `packages/core/src/energy.ts:386–410`; energy route `:256–263`                                                                                 | Calorie target uses profile activity level; workout samples also affect confidence. Classify runs explicitly so new rows do not silently change resistance-derived confidence. |
| `apps/api/src/modules/coach/tools.ts:215–245`; `packages/core/src/coaching-plan.ts:172–184`                                                    | Existing completed-workout counters feed resistance prescription. Runs require distinct frequency/context.                                                                     |
| `apps/api/src/modules/coach/grounding.ts:280–299`                                                                                              | Existing grounding summarizes workout names/times rather than run distance/pace. Add an explicit run projection.                                                               |
| `apps/api/src/modules/account/routes.ts:198–209`; `packages/adapters/supabase-server/src/account-repository.ts:322–330`                        | Export already includes workout details. Verify summary completeness and explain any technical timestamp anchors.                                                              |
| `apps/api/src/modules/community/publication-routes.ts:143–157`; `supabase/migrations/20261001140000_community_detailed_workout_sharing.sql:50` | Current sharing derives duration from timestamps and omits run distance. Block run publication until a later run-aware projection is accepted.                                 |

These are source observations, not fresh device/database/Dev evidence. Line anchors can drift; use `pnpm context --path` and current symbol reads at implementation start.

### Concurrent work and existing acceptance

At planning start the tree already contained simulator/release/research/status changes. During research another session added health-connections native/presentation files and health-observation/contracts changes, plus Settings/config edits. **All are outside this plan's write ownership.** Do not overwrite, stage, reformat or treat them as accepted integration functionality. Reconcile the final integration contract before RUN-06. Shared `src/index.ts`, `status.md`, research log and feature map require coordination.

The concurrent session's research log subsequently identifies **#215 / INT-01–02 ephemeral health previews** and ADR-0045. Its bounded foreground observations and permission UI are a separate implementation authority, with native/device/account-persistence exits governed by its own evidence. Re-read that handoff at implementation start; RUN-06 must extend the accepted connection work and preserve its local-only consent boundary.

Current `status.md` retains exact-build physical/accessibility gates for #210/#213, one-time workouts #187, action hierarchy #202, cache recovery #182/#200, Store/native release #27/#32 and broader Q1–Q9 acceptance. Running does not close them. Integration #198 remains a separate package; #39/#40 do not establish completed-run import acceptance. Keep source checks, Dev deployment, native acceptance and Production release separate.

Installed mobile baseline: Expo `~57.0.23`, Router `~57.0.21`, React Native `0.86.3`. Use SDK57/versioned guidance and installed native targets before coding. No location dependency is added by this planning session.

### Recommended data representation

Use **one existing workout row per completed manual run**. Keep `details.workoutLifecycle.kind = "session"`; add `details.activityType = "running"` and a strict versioned `details.runSummary`. Lifecycle and activity type answer different questions. Preserve missing activity-type behavior for legacy workout rows. Do not reclassify legacy records from names alone or change catalog IDs.

Create a pure running module and a typed `/v1/runs` facade over the workout repository. It owns validation, safe edits and truthful read responses. Keep the existing wire `source: "manual"` for this initial manual record; represent provenance in the run summary. Imported observations later retain their true provider identity and are not relabelled manual to fit this enum.

Proposed manual summary contract:

```ts
type ManualRunSummaryV1 = {
  version: 1;
  activityDate: string; // valid YYYY-MM-DD, date of start if time is known
  recordingTimezone: string; // validated IANA zone, captured with the draft
  timePrecision: "day" | "instant";
  startedAt: string | null; // observed/user-entered UTC instant only
  durationSeconds: number; // required integer, >0, <=86400 initially
  durationBasis: "elapsed";
  distanceMeters: number | null; // >0 when known; null means not recorded
  environment: "outdoor" | "treadmill" | "unspecified";
  perceivedExertion: number | null; // optional RPE 0..10
  origin: { kind: "manual" };
  timestampEnvelope: "observed" | "date_anchor";
  revision: number; // server-owned monotonic edit revision
};
```

Use existing bounded workout notes, not a second notes field in summary. Default title **Run**; optional custom title is a later refinement unless discovery shows a need. Accept duration-only runs. Reject distance zero when entered rather than invent a pace; clearing distance sets null. New manual boundaries may reuse current maximum distance of 1,000,000 metres and duration cap of 86,400 seconds; align core/wire/database validation. These are technical caps, not claims about safe running. Unusual but valid values may receive a review hint rather than an ungrounded medical judgement.

Server constructs reserved metadata. Generic details cannot override revision, origin, timestamp precision or operation state. Parse tagged run summaries on every ingestion/read boundary; corrupt or unsupported versions produce an explicit unavailable-record state and a recoverable error, never a silent strength conversion. Export retains the raw owned record for recovery as appropriate, with its validity state.

### Date and duration semantics

Date defaults to Today in the draft's captured timezone. Date picker supports previous dates and a clear selected date. Do not silently change a pending run's date/zone because the device travels or midnight passes. UI and server reject future completed-run dates. Validate real calendar dates and resolve DST ambiguity if the user supplies a local start time.

Optional start time is under More details. If supplied, convert it with the captured IANA timezone; ask which offset applies for an ambiguous repeated time and ask for correction for a nonexistent local time. The authoritative summary start instant is known; end is start plus the entered elapsed duration. Server validation rejects an observed start/end later than authoritative server time; document any small clock-skew tolerance if implementation evidence requires one. Do not silently clamp times. Synthetic date anchors are exempt from observed-instant future checks; their selected day still cannot be future. Overnight runs belong to their start date in the first release, including full duration/distance; disclose that convention in progress help.

For date-only entry, the existing workout envelope still requires instants. Adopt an explicit compatibility adapter: **both envelope timestamps equal one synthetic local-noon instant for the selected day**; summary `startedAt` remains null, `timePrecision="day"`, `timestampEnvelope="date_anchor"`. Duration comes only from summary. Never display that noon as a run time, subtract anchors to calculate run duration, or represent the anchors as observed times in Coach/export. RUN-00 must record this durable choice in an ADR and prove every consumer uses the typed summary. If this cannot be made truthful across consumers, revise the workout envelope contract to support date precision before shipping rather than silently inventing times.

New run-aware date queries use the stored activity date. Existing workout UTC filters must not drop UTC+14/UTC−12 records: query a bounded UTC superset, then filter exact run dates/zone semantics with deterministic cursor pagination, or use an indexed stored-date projection if volume requires it. Filtering happens before the final page limit; cursor identity includes ordering key and row ID. Test consecutive pages, date edits and equal timestamps. Display manual date-only runs grouped by date without implying within-day chronology. Device timezone changes affect display of true instants only under a documented policy; the entered day of a date-only run remains stable.

### Save, edit and delete guarantees

Initial reuse provides an idempotent create while its row exists. Before releasing edit/delete, also prevent a delayed create retry from resurrecting a deleted run. Introduce a narrow private **run operation receipt** mechanism if the baseline lacks a durable equivalent. Do not reuse social-operation storage or retain deleted health payloads there.

- Persist account, operation UUID, canonical payload and timestamps locally before network send. Local persistence failure means no request; keep the editable draft and explain the failure.
- Server create and its owner-scoped receipt commit in one database transaction. Same operation/payload returns the same run; changed payload is a stable 409 conflict; concurrent requests produce one row.
- Receipts retain minimal operation identity, run ID/reference, canonical payload digest, accepted revision and deleted state, without notes/distance/route payloads. Retain deleted-operation identity for the account lifetime so stale requests cannot recreate the run; account erasure removes receipts. Declare this retention in the lifecycle inventory.
- Conditional edit atomically checks expected revision, validates the full new summary and preserves identity/provenance. Two devices cannot silently overwrite each other. Edit operation replay acknowledges the accepted revision; if a newer edit now exists, return current state/conflict information rather than replaying stale content over it.
- Delete and receipt tombstoning are atomic and idempotent; a lost delete response can be retried. Late create/update returns a removed-record outcome and cannot restore the run. Clear local drafts/queues/read caches only at the matching identity boundary.
- Pending cancellation uses the frozen create-operation identity. Atomically install a cancellation tombstone even if the run row does not yet exist; a concurrent/in-flight create either creates then is deleted or observes the tombstone and cannot create. Persist offline cancellation until the server acknowledges it, and prioritize cancellation over resend on reconnect. Locally hiding a pending run is not proof of remote deletion. Pending edits reconcile the original operation before replacing it; an uncertain transmitted payload stays immutable.
- A local pending run may appear once with **Saved on this device · Waiting to sync** only after durable local write. Confirmed history and totals distinguish it from server-accepted records. Local/account deletion cancels retries before clearing data.
- Background/reconnect retry is bounded and account-scoped; manual Retry remains available. Retire old-account responses, consent-related import generations and queued UI updates on account change. A failed transport request alone is not proof of expired Auth.

A forward migration for receipts/CAS/invariants is expected for the complete editable release; immutable single-row creation alone does not require a new summary table. Any new user-owned table requires `user_id` index, RLS, narrow grants, ownership checks, account erasure/export inventory and an independent High review. Follow current authenticated RPC patterns; security-definer functions, if required, use a fixed search path, explicit principal checks and restricted execution. No remote database operation is authorized by this document.

### Compatibility and calculation rules

- Legacy `/v1/workouts` listings exclude tagged run rows by default **before pagination**. Updated clients explicitly opt into run-aware combined history; a proposed `includeRunning=true` query can preserve the old default. Keep response schemas backward compatible.
- Generic workout update/delete routes must route through run invariants or reject run mutation with a stable supported-client error. Set insertion, routine conversion, reopening and discriminator removal must not mutate a completed run. Enforce required invariants at database boundaries where direct authenticated writes can bypass API checks.
- Account export reads all owned rows, independent of legacy UI list exclusion. It includes summary, precision, provenance and notes; technical anchors are described as such. Do not omit runs because they have zero sets.
- Running frequency is separate from resistance frequency. Neither a run nor imported steps automatically changes load targets, estimated 1RM, routine progression, resistance sample confidence or nutrition targets.
- Do not calculate or display running calorie burn in the first release. Activity multipliers and steps already cover parts of expenditure; adding exercise credit requires a separate versioned model and deduplication decision.
- For positive known distance, pace is `durationSeconds / (distanceMeters / metresPerDisplayedUnit)`. Use 1000 m/km and exactly 1609.344 m/mile. Round only the final pace display to the nearest second, with proper seconds carry. Format 1800 s / 5000 m as **6:00 /km**; imperial display is approximately **9:39 /mi**. Missing distance means unavailable pace, not zero.
- Manual duration is user-entered elapsed duration. Imports may have elapsed/active/moving definitions; preserve basis and only compare like metrics. Average weekly pace, if later shown, is total comparable duration divided by total comparable distance; never average pace strings or mix elapsed and moving bases.

## C. Staged implementation steps

### RUN-00 — Validate the job and review the flow

**Files:** [NEW] `docs/evidence/running/UX_RESEARCH_YYYY-MM-DD.md`; [NEW] decision ADR under `docs/adr/` when representation/precision is accepted; [MODIFY] this plan with observed outcomes; [MODIFY] `docs/RESEARCH_LOG.md` for newly checked sources. No runtime code in this stage.

Interview and task-test the four scenarios above. Produce two simple prototypes: completed manual entry and future live recorder states, clearly labelled so participants can distinguish them. Audit existing Workouts navigation against the proposed compact action row, shared typography/green action styling and feathered header. Choose required fields, date semantics, initial scope, import dependency and old-client strategy from evidence. Do not claim that design guidance establishes the best UI without user observations.

**Exit:** research outcome and prioritized user job recorded; data/precision ADR reviewed; smallest selected package and ownership defined; no unresolved choice that changes authoritative data semantics. Discovery can promote imports ahead of GPS or defer running if the requests do not match the current target cohort.

### RUN-01 — Pure contracts, classification and deterministic metrics

**Files:** [NEW] `packages/contracts/src/run.ts`, `run.test.ts`; [NEW] `packages/core/src/running.ts`, `running.test.ts`; [MODIFY] their public `src/index.ts`; [MODIFY] `packages/core/src/workout.ts` and tests for reserved-details validation where needed; [MODIFY] `packages/contracts/src/workout.ts` and tests for the opt-in list query. Coordinate shared exports with current health work.

Define strict create/read/edit schemas, run-summary version, origin/precision/duration semantics, validated dates/timezones, epoch comparisons and missing-field behavior. Add pure classification and summary builders, km/mile conversion, pace formatting, start-day aggregation and selection of comparable records. Avoid a generic sports taxonomy beyond the actual running need. A health observation is an observation until its explicit persistence gate passes.

**Exit:** reference examples, duration-only records, malformed summaries, impossible dates, locale decimal inputs and unit round trips pass. Legacy workout records parse unchanged. No framework/database/native/vendor import enters core.

### RUN-02 — Atomic persistence, retry and privacy lifecycle

**Files:** [NEW] `apps/api/src/modules/runs/routes.ts` and tests; [MODIFY] `apps/api/src/app.ts`; [MODIFY] workout repository port and its current Supabase/in-memory adapters/tests, including `packages/adapters/supabase-server/src/workout-repository.ts`; [NEW] a forward `supabase/migrations/<fresh_timestamp>_running_mutation_guarantees.sql` if no existing durable receipt/CAS facility meets the plan; [NEW] corresponding disposable database/RLS tests; [MODIFY] generic workout/set route guards and tests; [MODIFY] `packages/api-client/src/index.ts` and focused client tests.

Proposed facade: `POST /v1/runs`, `GET /v1/runs/:id`, paginated `GET /v1/runs`, conditional `PUT /v1/runs/:id`, and idempotent `DELETE /v1/runs/:id`. Route registration/auth/error envelopes follow current composition. POST returns one completed workout identity with typed summary; generic storage remains a single workout record. Reject request `userId`; derive ownership from verified principal.

Implement frozen create replay, conflict handling, revision checks, deletion tombstones and guarded generic mutations. Index the actual owner/date lookup when evidence warrants it; inspect plans in the disposable database instead of adding unproven indexes. Export/deletion covers receipts and runs, including interruption/retry/account switching. Update `docs/ACCOUNT_EXPORT_INVENTORY.md` and the existing deletion inventory/runbook discovered through `pnpm context account-lifecycle`.

**Exit:** authenticated disposable-database two-user CRUD/RPC tests; concurrent/lost-response/restart cases produce one record; conflicting payloads and stale edits are explicit; delete replay cannot resurrect; account erasure removes receipts and rows; complete export contains the run and truthful precision. Independent non-author High review has no unresolved safety finding. No Dev/Production migration yet.

### RUN-03 — Direct manual entry and useful detail

**Files:** [NEW] `apps/mobile/src/features/log-run/{index.ts,log-run-screen.tsx,log-run-data.ts,run-draft-store.ts}` and boundary tests; [NEW] `apps/mobile/src/features/running/{index.ts,run-detail-screen.tsx,run-detail-data.ts}` and tests; [NEW] route wrappers under `apps/mobile/src/app/` following existing routing conventions (proposed `log-run.tsx` and `run/[id].tsx`); [MODIFY] root stack route registration as needed; [MODIFY] existing account cleanup registration to clear run drafts/queues. Use exported feature entry points.

#### Entry and form

Workouts shows two direct capture actions: the existing **Start one-time workout / Resume workout** and **Log run**. Keep Log run visible while a strength session is active: logging a completed run is not starting another active timer. Add a short hint **Add a completed run**. Create Routine and Exercise Library remain quieter nearby actions. Avoid a choose-sport wizard or another introductory page.

Suggested form hierarchy, in the current design system:

```text
Back                 Log run                Save

Date                 Today          [change]

Duration *           [ 30 ] min   [ 00 ] sec
                     Total time, including pauses
Distance             [ 5.00 ]          [km ▾]
                     Optional if you don't know

Average pace         6:00 /km

More details ▾
  Environment        Outdoor / Treadmill / Unspecified
  Start time         Not specified
  Effort             Not recorded
  Notes              Optional
```

Duration minutes accepts whole minutes beyond 59 (e.g. 90); seconds accepts 0–59. Show **Total time, including pauses** beside Duration, and test that explanation with watch users in RUN-00; moving-time import needs its own preserved basis. Render a readable normalized duration in the preview/detail. Keep decimal distance keyboard, labelled visible unit and locale-aware decimal separator. Support pasted valid numbers; reject ambiguous grouping rather than silently changing magnitude. Profile units provide defaults. Switching a populated unit converts the physical quantity and preserves canonical value/entered precision rather than reinterpreting “5” as another distance.

Do not prefill distance/duration from a previous run. Date and units are safe defaults; environment stays unspecified unless the user chooses it. Offer effort as an optional labelled RPE selector with verbal anchors; never require it. Date/start-time controls use existing native picker conventions or a reviewed SDK57-compatible picker if the repository lacks one. Do not add an unverified UI dependency casually.

Use one semantic Save action in the shared navigation header, reachable with the keyboard open. If a bottom Save is needed for native accessibility, it must call the same guarded action, with the primary hierarchy reviewed rather than introducing two competing flows. Busy state says **Saving…**; primary validation appears next to the field and focuses the first error. A valid duration-only entry can save; preview explains **Add distance to see pace**.

#### Draft and completion

Autosave the bounded draft through the existing suitable encrypted account storage adapter. Capture operation identity before transmission and keep its request immutable while pending. Draft writes must not trigger visible screen reloads. Ordinary Back, back gesture and Android Back retain the successfully persisted draft and exit immediately; reopening resumes it. Provide a separate **Discard draft** action. Prompt only when persistence fails or an explicit destructive action would lose input: explain the failure and offer **Keep editing / Discard unsaved changes**. An empty form leaves directly.

After confirmed Save, return to combined history with the saved run visible and a quiet **Run saved** acknowledgement. Keep the user's history/date/filter state; if Running is filtered out, select All or explicitly reveal the new run. No celebration screen or extra Finish confirmation for a completed manual record. A pending offline entry is visibly provisional and has Retry/Discard pending. Edit draft is available before first transmission; after an uncertain send, reconcile the original operation before editing its accepted revision or atomically cancelling it. Discard pending uses the cancellation receipt, including when create is in flight; keep a truthful pending-removal state until acknowledged.

Run detail shows distance, duration, average pace when available, date/time precision, environment, notes, effort and **Entered manually** source. Edit uses the same form prefilled from the accepted revision; Delete sits in overflow/detail with a destructive confirmation. On a two-device conflict, explain **This run changed on another device** and let the user review current values or preserve their unsaved draft. Never silently merge numeric metrics.

**Exit:** all field/date/unit/keyboard/draft/save/edit/delete states pass component tests and simulator interaction; source persistence failure sends no request; account switch cannot restore someone else's draft; already-active strength session remains intact. Native acceptance follows RUN-05.

### RUN-04 — History, progress and connected context

**Files:** [MODIFY] `apps/mobile/src/features/workouts/workouts-hub-{data,screen}.ts[x]` and tests; [NEW] run card/progress components under `apps/mobile/src/features/running/`; [MODIFY] `apps/mobile/src/composition/startup-data.ts` and its tests only for bounded run-aware retained reads; [MODIFY] dashboard data/screen/tests if Training summary includes runs; [MODIFY] `apps/api/src/modules/energy/routes.ts` and tests; [MODIFY] `apps/api/src/modules/coach/{tools.ts,grounding.ts}` and related tests; [MODIFY] `packages/core/src/coaching-plan.ts` classification/tests as required; [MODIFY] Community publication guard/tests and release compatibility tests.

Keep the hub's existing All/Routines/History navigation. Inside History, add **All activities / Strength / Running** as accessible filters rather than a second top-level destination or a replacement for Routines. Keep filter state across ordinary tab returns; hidden running filters are optional only when no running feature is enabled, never based on a loading error. A running-empty state says **Your runs will appear here** with direct Log run; no zero-value dashboard cards before a record exists.

```text
Workouts
[Start one-time workout / Resume workout]  [Log run]
Create Routine                 Exercise Library

All | Routines | History
History: All activities | Strength | Running

Running this week: 2 runs · 9.0 km · 55 min

Today
Run                  5.0 km · 30:00 · 6:00 /km
Upper-body session   18 sets · strength-specific metrics
```

On narrow/large-text layouts, stack capture actions and wrap filters; do not shrink touch targets or make labels ellipsize. The running weekly summary appears in Running history and/or as a compact training summary after actual records exist. Show total confirmed distance, duration and runs for a clearly labelled Monday–Sunday local week initially; align with any established week preference discovered in RUN-00. A duration-only run contributes time/count; distance total reports known distance and **1 run without distance** rather than implying complete mileage.

Run cards contain date, distance if known, duration and pace if known. They show no strength sets/volume/load targets. Mixed history uses a stable day grouping and typed navigation: run cards open run detail; strength cards open the existing workout flow. Use server pagination through the filtered dataset; retained content can revalidate quietly and must reflect accepted edits/deletions. Do not depend on the first 200 records for complete weekly totals or history search.

Home keeps Steps separate. The Training count may show completed sessions including runs only if explicitly labelled **Training sessions**; expose type breakdown in detail. Keep the existing direct strength shortcut; a Home Log run shortcut is optional after discoverability testing, not a reason to add an action menu to every existing shortcut.

Coach receives confirmed run date/precision, duration/basis, distance, derived pace, optional effort and source. It must not infer injury, heart rate, VO2 max, precise calories or readiness from missing fields. New feature knowledge explains where Log run lives and distinguishes it from future recording/imports. User notes remain untrusted content within existing prompt-injection boundaries. No automatic provider call is introduced merely by saving a run; existing AI consent/admission/budget gates remain.

Runs are excluded from legacy resistance progression/counters and sample-confidence calculations unless a reviewed model explicitly includes them. Add an end-to-end regression comparing the same account before/after a saved run: calorie target/TDEE, resistance prescription/load progression and resistance-based confidence stay equal. Running summaries change as expected. Account export bypasses compatibility UI filters. Community publication rejects running at both transport and database/RPC boundaries until RUN-08 explicitly includes it.

**Exit:** mixed history, incomplete-distance totals, pagination, stale cache invalidation, Coach grounding, energy/progression invariants and old-client compatibility pass. No missing metric is rendered as zero or Bodyweight.

### RUN-05 — Native acceptance and bounded delivery

**Files:** [NEW] dated `docs/evidence/running/` acceptance artifacts and package handoff; [MODIFY] `docs/feature-map.json` with actual entry points/requirements/tests; coordinator updates issue/status/evidence only after settled writes.

Run the focused tests below, format owned files, and run one serialized `pnpm check` on a stable exact candidate. Obtain independent UI/IA review and High review for migration/privacy/account/Coach boundaries. Fix findings before the final gate. If concurrent work continues, use a stable isolated candidate; record SHA, exact owned overlay hashes and excluded scope. Do not use another chat's check as this candidate's evidence.

Native matrix: iPhone and physical Android, both themes, narrow widths, maximum supported text including live changes, VoiceOver/TalkBack, keyboard/native picker entry, system Back, Reduce Motion, offline/reconnect, app/API restart, lost save/edit/delete response, two accounts and two-device edit conflict. Simulators provide useful interaction evidence; native permission/background/battery or physical accessibility acceptance remains separate.

After separately authorized Dev delivery, verify exact backend SHA/schema on Hetzner Dev and installed standalone Dev clients. Record complete journeys against public Dev hosts. Production promotion, signed Store artifacts and upload remain separate explicit milestones; hand Adam any future verified IPA for manual Transporter upload under the existing release policy.

**Exit:** RUN-01–04 source/check, real DB isolation/lifecycle and exact native journeys accepted; observed user task targets reported honestly; issue remains open if any required exit is missing. First manual release can then be proposed with a concrete accepted candidate.

### RUN-06 — Completed-run imports through existing health connections

**Files:** [MODIFY] the final accepted `apps/mobile/modules/mizyun-health-connections/`, health-connections feature and provider-neutral observation contracts; [NEW/MODIFY] running preview/display adapter; account-sync routes/storage only in coordinated INT-03. Do not create a second Health settings screen or independent provider connection registry.

Follow INT-00–03. Begin with device-local read previews. Settings → Health connections manages permissions; Workouts may expose a quiet **Import runs** action after availability is known. Present a bounded preview with source/date/duration/distance and explicit **Add selected runs** only when account storage consent and INT-03 are accepted. Local read consent is not permission to upload health data or send it to Coach.

Apple: classify running workouts and obtain available statistics/metadata using currently supported HealthKit APIs; deprecated `totalDistance` is not a durable new API choice. Android: exercise sessions and distance records are separate types/permissions; associate metrics by interval and data origin instead of summing unrelated walking or duplicate source records. Do not request routes, heart rate, calories or background reads to import simple summaries.

Identity includes account, provider, source app and provider record ID/version; re-reading the same sample is a no-op. Preserve elapsed/active duration basis, optional distance and true source. A manual/import overlap is a **Possible duplicate**, not automatic deletion or averaging. Keep the already confirmed manual run counted; hold the candidate import out of confirmed totals until the user keeps it, dismisses it, or explicitly links it as the same activity. Any accepted link keeps both provenance references and avoids double counting. Source deletion/correction, disconnect/revocation, account deletion and restore reconciliation follow INT-03; manual records are not deleted by disconnect.

Imported metrics are read-only provider facts. Local notes may be editable and are clearly separate. A correction through an explicit editable copy is a new derived record with retained origin and per-field permitted-use lineage, not a hidden write-back. Copying, linking or confirming imported metrics cannot turn restricted provider data into unrestricted manual origin or grant Coach/developer/outbound eligibility; preserve the integration plan's use restrictions through derived records. No provider write permissions or outbound publishing in this package. Fail gracefully when permission is partial, there are no readable samples, the platform is unavailable, or records lack distance.

**Exit:** real iPhone/Android known sample previews and selected persistence; no-request network proof for local-only mode; consented upload isolation; repeat sync/correction/deletion/restore/dedup cases; no nutrition credit; final integration owner's acceptance. #39/#40 and #198 retain their own exits.

### RUN-07 — Live GPS recording, conditional on demand

**Files:** [NEW] native/device recording adapter and durable run recorder under a dedicated module/feature; [MODIFY] run contracts/core with separate elapsed/active duration and quality semantics; [MODIFY] app permissions/config/notifications after ownership review; route storage and lifecycle only after an ADR. Exact filenames depend on the spike. Do not put route arrays into the small workout JSON summary.

First prove the least-permission implementation on the installed targets. Native iOS user-started background tracking can use When In Use authorization with the appropriate active-session configuration; Expo57's background API documents Always authorization. Android screen-off tracking with a correctly started location foreground service is foreground access and may not need `ACCESS_BACKGROUND_LOCATION`. Evaluate the actual chosen library against native behavior; do not request Always/background permission by assumption. Choose Expo Location/TaskManager only if its permission/lifecycle tradeoffs satisfy the product; use an owned native adapter when required. Request permissions only after **Record run**, explain their purpose and retain manual logging after denial.

Recorder IA: **Record run → Ready/GPS status → Start run → Recording → Pause → Resume or Finish → Review → Save run**. Log run remains a separate completed-entry action. Indoor/treadmill uses manual logging initially; GPS must not invent indoor distance.

During recording, prioritize duration, distance and average pace above a secondary map. Use large Pause/Resume controls (target at least 56 points/dp), clear text state and separated destructive action. Finish opens review with editable title/notes and explicit Save; discard requires confirmation. Allow offline start/record/save with no required backend connectivity. Do not force a full account reauthentication mid-run; protect upload by current account and authorization.

Start with manual pause. Measure elapsed time by timestamps and active time by a persisted monotonic interval model; do not rely on JavaScript timers while backgrounded. Persist session identity, state transitions and points at a bounded cadence; deduplicate delivery and cap storage. Model preparing/recording/paused/interrupted/review/pending upload/accepted states, including process death. On restart, present a recovered partial run with known gaps; never claim continuous recording across a terminated app.

GPS quality policy needs empirical thresholds. Reject stale, out-of-order, impossible or unusably inaccurate samples; calculate distance using accepted consecutive segments, excluding gaps/pauses according to an explicit basis. State **GPS signal weak · Distance may be incomplete**. Do not bridge unknown sections or show precise instantaneous pace from noisy samples. Review keeps coverage/quality flags; user confirmation does not turn missing route data into measured data. Audio/haptics are optional and have visual equivalents; avoid screen-reader announcements every second.

Route handling is private and separately consented. First spike can calculate on device and retain only the accepted summary; a saved map requires a distinct retention/storage/export/delete/restore design. Persisted routes use separate bounded private child records/objects with RLS/ownership; implement deletion cleanup and no health/location logging. No maps service/provider credentials, raw routes in analytics/Coach, social sharing or automatic health write-back. Any future map tile provider requires current SDK/licence/cost/privacy research before selection.

**Spike exit:** two comparable outdoor routes repeated on iPhone/Android; screen lock/background/interruption/low-power/OEM behavior; known reference-distance comparison, reported battery drain and GPS gaps; permission-denied/revoked/approximate-only fallback; restart recovery; stopping releases location/service resources. Proposed product budgets for acceptable error/battery must be chosen from measured spike results, not invented here. A successful library demo is not a shipping recorder.

**Release exit:** all recorder state transitions, storage/erasure, lost upload, exact-candidate native matrix and Store permission declarations accepted; separate explicit rollout scope. Auto-pause waits until its movement-time semantics and device evidence are accepted.

### RUN-08 — Demand-based improvements

Potential packages: interval/lap records, comparable 5 km/10 km personal records, user-set weekly goals, deliberate run sharing and selected health write-back. Each starts with its own measured need, requirements and tests. Manual single-summary runs cannot establish best segment times or GPS-verified records; label achievements by source/measurement basis. Sharing requires a reviewed run preview, visible audience consent, run-aware server/SQL projection, withdrawal/deletion and route protection. None inherits authority from strength sharing or the Community gate status.

## D. Verification plan

### Automated failure boundaries

| Boundary          | Required acceptance                                                                                                                                                                                        |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Duration/distance | Positive duration; null distance works; invalid/negative/zero/overflow/NaN rejected; same rules in core/wire/RPC                                                                                           |
| Units/pace        | Exact km/mile conversions; decimal comma/paste; populated-unit switch; display rounding/carry; no pace at missing distance                                                                                 |
| Dates             | Invalid calendar days, midnight, DST gaps/repeats, UTC+14/UTC−12, overnight run, travel after draft creation, observed future start/end rejection, legitimate same-day synthetic anchors, date-only export |
| Durable create    | Persistence failure sends nothing; double tap/concurrency/lost response/API restart/mobile restart yield one record                                                                                        |
| Identity          | Account/token generations retire stale responses; account B cannot retrieve/patch/delete/export account A's row or receipt                                                                                 |
| Edit              | Two-device CAS conflict; lost accepted response; newer edit during old retry; metadata cannot be stripped or forged                                                                                        |
| Delete            | Lost response retries; delayed POST/PUT cannot resurrect; pending discard/create race and cancellation before row exists survive restart; cached/pending run disappears truthfully                         |
| Lifecycle         | Complete paginated export with truthful precision; account-delete interruption resumes and removes row/receipt/draft                                                                                       |
| Bypass            | Generic workout/set/routine and direct DB/RPC boundaries cannot invalidate reserved running semantics                                                                                                      |
| History           | Default old-client list omits runs; updated pagination includes full mixed history; filtering before limits; equal-date stable ordering                                                                    |
| Connected views   | Running totals change; calorie target/TDEE, resistance progression and resistance confidence stay stable                                                                                                   |
| Coach             | Correct run metrics/precision/basis; notes injection stays untrusted; consent/limits unchanged; no automatic provider call                                                                                 |
| Community         | A running row cannot publish through current strength endpoints/RPC; no route/summary silently shared                                                                                                      |
| Imports later     | Partial permission, unavailable/no records, same-ID replay, overlap review, source correction/deletion, revocation and restore                                                                             |
| GPS later         | Native screen-off and interruption, bounded points, paused/gapped distance, approximate-only fallback, resources stop                                                                                      |

Focused commands after implementation (confirm package/test names at that time):

```bash
pnpm --filter @mizyun/contracts test src/run.test.ts src/workout.test.ts
pnpm --filter @mizyun/core test src/running.test.ts src/workout.test.ts src/energy.test.ts src/coaching-plan.test.ts
pnpm --filter @mizyun/api test src/modules/runs src/modules/workouts src/modules/workout-sets src/modules/energy src/modules/coach src/modules/account src/release-compatibility.test.ts
pnpm --filter @mizyun/mobile test src/features/log-run src/features/running src/features/workouts src/composition/startup-data.test.ts
pnpm navigation:check
pnpm format:check
pnpm check
```

Run every new/modified test, including adapter/client/account-erasure/community suites outside these illustrative filters. Discover and run the repository's guarded disposable-Mac DB/RLS command for new migrations; never reset/verify remote authorities. Before full check: complete all edits/reviews, format only owned files and settle concurrent inputs. Full check performs mobile bundle gates; provider integration checks remain gated by `docs/BEFORE_TESTING.md`. Tests are prospective here and have not been run for running.

### Native UI and accessibility acceptance

- iOS targets at least 44×44 pt; Android at least 48×48 dp. Use the existing 48-point app control pattern where possible. Do not treat Apple's lower technical minimum as Mizyun's product target.
- Logical labels, roles, selected/busy/error states and focus order; **Average pace, six minutes per kilometre** rather than an unexplained timestamp. Decorative icons excluded.
- System text scaling including maximum accessibility size and live font changes; narrow layout around 320 points; filters/actions wrap without overlap. Focused input/save remains reachable above keyboard and safe areas.
- Metric/imperial/locale keyboards, native date/time ambiguity, light/dark contrast, TalkBack/VoiceOver and reduced motion. States are identifiable without colour.
- Ordinary tab return retains content/draft/filter and quietly revalidates. Errors/permission denial give a useful manual fallback. Loading must not flash an empty history or erase totals.
- Real offline save/retry, app/background/restart and two accounts on both platforms. GPS/battery/permissions must be accepted on hardware, not inferred from web previews or mocks.

### Effort and dependency guide

RUN-00 is small discovery/prototype work. RUN-01 is a bounded contract/calculation package. RUN-02 and RUN-04 carry the highest first-release correctness risk because they touch retries, privacy and cross-module semantics. RUN-03 is moderate presentation/state work; RUN-05 is an acceptance package, not a ceremonial final test. RUN-06 depends on integration ownership and actual platform samples. RUN-07 is a large native subsystem and must be estimated after its spike. Calendar estimates require the selected scope, available devices and owner capacity; no delivery date is promised by this plan.

## E. Next-session prompt

> Work on RUN-00 in `docs/RUNNING_IMPLEMENTATION_PLAN_2026-10-06.md` and its linked tracking issue. First run `git -c core.fsmonitor=false status --short`, read the current root/mobile AGENTS instructions and current status, then use `pnpm context workouts-sets --query "running run summary history"`. Preserve concurrent health-connections, simulator, Settings and release work. Reconcile the final #198/INT-00–03 owner and current contract before planning imports. Read the plan fully, identify current gate/dependency changes, and prepare the completed-run task prototype and research script. Validate the requesting users' job and the date-precision/typed-summary decision; record results and an ADR for the durable design when accepted. Delegate a bounded independent UI/IA review at Medium; use High for privacy/data/migration/Coach design and a non-author High reviewer. Only the coordinator edits continuity/issues. RUN-00 authorizes discovery/prototype/planning within the selected session; feature implementation, migration application, builds, deployment, provider calls and Store actions require their separately selected package/scope. After RUN-00, implement RUN-01–05 only when that bounded implementation is explicitly authorized, following frozen mutation receipts, CAS/deletion, old-client guards and native acceptance in this plan. Do not use a fake strength set for a run or grant imports/GPS/Community authority from this document.

## F. Dated primary research and design consequences

Sources accessed **2026-10-06**. The consequences below are Mizyun design recommendations unless explicitly described as platform behavior. Recheck exact versions, policies and installed targets when each native/service package starts.

| Primary source                                                                                                                                                                                                                                                        | Finding and consequence                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Apple HIG — Tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars)                                                                                                                                                                        | Tabs represent top-level sections; weigh additional destinations against complexity. Keep running within Workouts and retain current navigation state.                                                               |
| [Apple HIG — Entering data](https://developer.apple.com/design/human-interface-guidelines/entering-data)                                                                                                                                                              | Clear fields, reasonable defaults and early feedback reduce avoidable entry mistakes. Default date/units; optional details stay secondary.                                                                           |
| [Apple HIG — Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)                                                                                                                                                              | Adaptable text and usable controls inform scaling/focus/nonvisual acceptance. Use Mizyun's 44pt minimum product target on iOS.                                                                                       |
| [Android — Make apps more accessible](https://developer.android.com/guide/topics/ui/accessibility/apps)                                                                                                                                                               | At least 48dp touch targets and purpose-based semantics; verify TalkBack and unique record/action descriptions.                                                                                                      |
| [Strava — Manual activity](https://support.strava.com/en-us/articles/15402188-how-do-i-upload-a-manual-activity-to-strava)                                                                                                                                            | Official manual activity workflow captures activity/date/time/distance/duration. This supports a completed-run fallback pattern, not a claim about Mizyun users or retention.                                        |
| [Nike — Manually add an NRC run](https://www.nike.com/help/a/add-run-nrc)                                                                                                                                                                                             | Manually added runs appear in activity history. Use a shared record/history concept while preserving source and precision.                                                                                           |
| [Strava — Record an activity](https://support.strava.com/en-us/articles/15402137-how-do-i-record-an-activity-on-strava)                                                                                                                                               | Recording has explicit start/pause/finish/save and signal states. Use deliberate recorder transitions; do not equate moving and elapsed duration.                                                                    |
| [Nike — Run settings](https://www.nike.com/help/a/nrc-settings/nrc-activity)                                                                                                                                                                                          | Indoor/outdoor and recording options illustrate distinct use cases. Keep treadmill manual, and make later audio/pause options optional.                                                                              |
| [Expo57 — Location](https://docs.expo.dev/versions/v57.0.0/sdk/location/)                                                                                                                                                                                             | Background task/configuration/permission requirements and process-termination limitations make GPS a native acceptance package. Expo background APIs document Always on iOS; verify whether that tradeoff is needed. |
| [Apple — Location authorization](https://developer.apple.com/documentation/corelocation/requesting-authorization-to-use-location-services), [Background location](https://developer.apple.com/documentation/corelocation/handling-location-updates-in-the-background) | Native user-started active location sessions can have different authorization needs from a library wrapper. Spike least-permission behavior and recovery on supported OS versions.                                   |
| [Android — Location permissions](https://developer.android.com/develop/sensors-and-location/location/permissions)                                                                                                                                                     | A location foreground service can maintain foreground access with the screen off. Approximate permission remains possible; do not unconditionally request background access. Recheck target-specific policy.         |
| [Apple — Workout activity type/statistics](https://developer.apple.com/documentation/healthkit/hkworkout/workoutactivitytype), [Workout duration](https://developer.apple.com/documentation/healthkit/hkworkout/duration)                                             | Import source activity/basis; current API documentation marks legacy aggregate distance access deprecated. Use supported statistics and test pause semantics.                                                        |
| [Android — Workout experiences](https://developer.android.com/health-and-fitness/health-connect/experiences/workouts), [Exercise routes](https://developer.android.com/health-and-fitness/health-connect/features/exercise-routes)                                    | Sessions, distance and routes have distinct data/permission boundaries. Initial summary import requests the smallest required set and omits routes.                                                                  |
| [Supabase — RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)                                                                                                                                                                               | Grants and policies both matter. New receipts/child data require allow/deny tests and controlled authenticated execution. Existing private table ownership does not prove a new RPC is safe.                         |

Known limits: no user interviews/prototype testing in this session, no UI/device/API/DB acceptance for running, no GPS/battery measurements, and unfinished concurrent health work. This is a researched execution guide; the current feature remains unimplemented.

## G. Planning-session handoff

- Authored this plan, added the dated running entry to `docs/RESEARCH_LOG.md`, and linked it from `status.md` while retaining existing authorities and gates. `plan.md` and `goals.md` are unchanged; no roadmap reprioritization was accepted.
- Created [#216](https://github.com/AdamHikl/mizyun/issues/216) with `enhancement`, `priority:P2`, `status:ready`, `area:workout`. Ready means RUN-00 discovery is specified; running runtime implementation is still absent.
- Independent UI/IA review (GPT-6.1 Sol, Medium) and non-author architecture/data plan review (GPT-6.1 Sol, High) completed. All reported plan findings were resolved and re-reviewed: duration basis, Back behavior, route path, future completion, pending-create cancellation and derived-import restrictions. This is document review only.
- Document formatting check passed. `pnpm navigation:check` passed with zero errors and 23 advisory warnings about existing review drift/unmapped/concurrent sources. These warnings do not accept current parallel implementation.
- No running runtime tests, database verification, full `pnpm check`, builds, migration application, provider call, deployment or Store operation were performed. The session changed planning documents and the tracking issue only; all pre-existing/concurrent feature changes remain outside its evidence scope.
- Next exact action: execute RUN-00's requester interviews and task prototype, reconcile #215/#198, and settle the data-precision ADR. Select the first implementation package after that evidence; maintain separate Dev/native/Production exits.
