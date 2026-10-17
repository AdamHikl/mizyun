# ADR-0068: Timed exercise tracking and Log activity

Date: 2026-10-17. Status: accepted by Adam on 2026-10-17 ("Timed exercises + quick log"). Package [#278](https://github.com/AdamHikl/mizyun/issues/278).

## Context

Adam wants to log time-based workouts such as swimming. Workout sets have always stored nullable `duration_seconds` and `distance_meters` (contract, table, API and mobile form plumbing), but the live workout card only collected weight and reps, exercises had no measurement type, and the catalog lacked swimming and outdoor cycling. Running and bouldering use dedicated session envelopes (ADR-0046/0065/0066); generalising that template to every cardio activity needs migrations, RPCs and a database review. Adam chose the smaller option.

## Decision

1. **Tracking mode.** `packages/core/src/exercise-tracking.ts` defines `load_reps` (default), `duration` and `duration_distance`. The mode is presentation and validation only; it changes which set inputs the app shows, not the stored set shape.
2. **Resolution.** A saved exercise's valid `metadata.trackingMode` wins, then `metadata.catalogId`, then an **exact** catalog name or previous name (case-insensitive). Fuzzy search hits and unknown custom exercises stay `load_reps`, so existing records keep today's behaviour.
3. **Input.** Time accepts `mm:ss`, `h:mm:ss` or a bare number. A bare number means seconds for `duration` holds (45 → a 45-second plank) and minutes for `duration_distance` activities (45 → a 45-minute swim). Distance displays in m/yd for swimming, rowing and SkiErg and km/mi otherwise; storage is always metres at 0.01. Timed cards hide rep and load targets; older sets stored only as reps still show as reps.
4. **Catalog assignment.** Explicit ID lists, not categories: aerobic entries with meaningful distance are `duration_distance`; stair climber, jump rope, battle ropes, planks, holds, hangs and wall sit are `duration`. Rep-style cardio (burpees, jumping jacks, mountain climbers) and stretches stay `load_reps`.
5. **Catalog supplement.** Mizyun-authored Swimming, Outdoor Cycling and Hiking entries are merged alphabetically into the active catalog (609 → 612). They omit the RepDB `source` and stay `pending_professional`.
6. **Log activity.** Workouts → Log activity saves a completed, already-finished activity as one ordinary completed workout (`startedAt`, `completedAt = startedAt + duration`, lifecycle `session`, no `activityType`) with one exercise and one duration set. It appears in existing workout history. Today ends now; an earlier day (last seven) starts at local noon, moved earlier so it never ends in the future. The workout create reuses a stable `clientOperationId`; before adding the set the client reads the workout's sets and skips the add if one exists, so a lost-response retry does not duplicate either row. A pending save belongs to the account that made it and is discarded, never resent, after an account switch. If nothing was sent the form unlocks; a non-retryable failure offers Close.
7. **No Health export from Log activity.** These workouts carry no first-party export marker: the native writers would label them strength training, and their start times are estimates. Exporting timed activities needs activity-type mapping and a real start time, a separate decision.
8. **Unchanged.** No migration, RLS, route or contract change. Energy still counts each set with the flat per-set hint, so a timed set counts like any set; MET-based estimates are a separate decision. Watch companions keep logging weight and reps only, so exercises that are now timed (for example Plank, Jump Rope, Walking, Rowing Machine) can no longer be logged from the watch; they are logged on the phone.

## Consequences

- Swimming and similar activities do not get running-style pace or weekly totals; Option B (dedicated activity sessions) remains possible later from the running template.
- Follow-ups: custom-exercise tracking type and routine time targets ([#280](https://github.com/AdamHikl/mizyun/issues/280)), watch logging of timed sets ([#281](https://github.com/AdamHikl/mizyun/issues/281)), Health export and energy for timed activities ([#282](https://github.com/AdamHikl/mizyun/issues/282)), timed history and progress ([#283](https://github.com/AdamHikl/mizyun/issues/283)).
- Coach's app-capability catalog describes the feature and owns the `log-activity.tsx` route; Coach does not receive new data from it.
- Previously logged plank sets that stored seconds in reps still display as reps.

## Sources

[React Native TextInput](https://reactnative.dev/docs/textinput), checked 2026-10-17; see the [research log](../RESEARCH_LOG.md).
