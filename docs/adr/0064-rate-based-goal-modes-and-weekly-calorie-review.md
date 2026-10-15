# ADR0064 — Rate-based goal modes and weekly calorie review

- Status: Accepted for implementation; Dev/native/release acceptance open
- Date: 2026-10-15
- Scope: ENG-07, ENG-08, ENG-05; energy formula `v2-mifflin-rate-based-2026-10`

## Context

Energy v1 added a fixed kcal adjustment per `(kind, pace)` (e.g. −500 for a steady cut) and used the latest scale reading. A 55 kg and a 120 kg user got the same deficit, one noisy weigh-in moved the target, and the goal's target weight and date were ignored. The weekly coach adaptation could only step pace within three presets, used fixed bands that ignored the chosen pace, and could not slow a gradual bulk that gained too fast. Steps were displayed but never used.

## Decision

1. **Goal modes.** Keep the stored `kind`/`pace` columns (no destructive migration, older clients keep working) and name each pair: gradual/standard/aggressive cut, lean/standard/aggressive bulk, recomp, maintain (`packages/core/src/goal-modes.ts`). Each mode is a weekly change band in % of body weight; the engine plans for the band midpoint converted at 7,700 kcal/kg. The target date is only compared with the projected date; it never sizes the deficit.
2. **Trend weight.** BMR uses the ADR0010 smoothed trend weight when available, otherwise the latest reading, and reports which.
3. **Adaptive maintenance.** With ≥14 days of weight trend and ≥14 complete logged days, maintenance ≈ average intake − weekly trend change × 7,700 / 7, bounded to a plausible range. It is surfaced for transparency and used by the weekly review; it never silently replaces the target.
4. **Weekly review.** A pure deterministic rule (`packages/core/src/calorie-review.ts`) runs per goal per ISO week. Gates: goal at least 14 days old, ≥4 logged days in the last 7, 80–120 % adherence, ≥14-day trend. Inside the mode band: hold. Outside: propose a new target from adaptive maintenance + planned rate (or the observed rate error), always in the band's direction, 100–250 kcal per week, never below the 1,200/1,500 kcal floor (1,200 when sex is unknown) and never past ±1,000 kcal cumulative calibration. After an accepted change the review waits 14 days, because the 28-day slope still reflects the previous target; trend gates use the span of the regression window, not the whole history.
5. **User decision.** The proposal is stored (`calorie_adjustment_proposals`, owner RLS, one per goal and week) and shown as a Home pop-up and weekly local notification with its evidence. Accept atomically moves `goals.calorie_calibration_kcal` with optimistic checks (unchanged calibration and pace, active goal, current or previous ISO week, no other accepted change for the goal in 14 days); otherwise the proposal becomes `superseded` and a fresh one can be computed. Decline records the decision for that week. Nothing changes without acceptance. Owners can insert their own pending rows through the Data API; the API applies the full review gates, while the database enforces bounds, ownership, week recency, cadence and the decision path. Accepted calibration alone never removes the target: if it would cross the floor the target clamps to the floor.
6. **No AI decision, no service-role worker.** Models may explain a review later but never compute or decide it. Proposals are generated lazily on the user's authenticated request rather than by a background job reading every user's health data with the service role. Server push is not used (external push delivery is not enabled); a device-local weekly reminder opens the review.
7. **Steps excluded.** Step counts are device-only (HealthKit/Health Connect) and overlap the activity multiplier; adaptive maintenance captures real activity without double counting (ENG-04).

## Consequences

- Targets change for existing users on deploy (rate-based adjustments differ from the old table; e.g. a 70 kg standard cut moves from −500 to −481 kcal). The formula version bump invalidates recipe snapshots keyed on the old version, as intended.
- New goals start with zero calibration; changing goal kind creates a new goal and resets calibration.
- The review needs consistent logging and weighing; users who log rarely see "insufficient data" with the reason, never a guessed change.
- Rates and constants are planning approximations (see the research log); they are not medical advice and lean-bulk cannot guarantee muscle-only gain.
- Adaptive maintenance is shown as a point estimate with its inputs (logged days, window, trend); an explicit uncertainty range for ENG-05 remains a follow-up.
- Device notification, pop-up, populated-data, VoiceOver and Dev/Production acceptance remain open.

## Sources

See [research log 2026-10-15](../RESEARCH_LOG.md#2026-10-15--rate-based-goal-modes-and-weekly-calorie-review-eng-07eng-08) — Helms 2014, Garthe 2011, Iraki 2019, Helms 2023, Hall 2008, Morton 2018, NHLBI.
