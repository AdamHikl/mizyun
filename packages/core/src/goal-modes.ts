/**
 * Goal modes (ENG-07): a named, rate-based reading of `(kind, pace)`.
 *
 * Pure: no database, no transport, no SDK. The stored goal keeps its
 * `kind` and `pace` columns; this module gives each pair a user-facing
 * name (lean bulk, aggressive cut, ...) and a target band of weekly
 * body-weight change expressed as a percentage of body weight. Rates
 * scale with the person, so a 55 kg and a 120 kg user on the same mode
 * get proportionate deficits or surpluses instead of one fixed kcal
 * number.
 *
 * Sources (accessed 2026-10-15, see docs/RESEARCH_LOG.md):
 * - Helms, Aragon & Fitschen 2014 (JISSN 11:20): ~0.5–1 %BW/week loss
 *   to retain lean mass during contest preparation.
 * - Garthe et al. 2011 (IJSNEM 21:97): 0.7 %/week preserved lean mass
 *   better than 1.4 %/week.
 * - Iraki et al. 2019 (Sports 7:154): ~0.25–0.5 %BW/week gain for
 *   novice/intermediate lifters; slower for advanced lifters.
 * - Helms et al. 2023 (Sports Med Open 9:102): larger surpluses mostly
 *   add fat mass.
 *
 * The exact band edges for recomp/maintain and the lean-bulk floor are
 * product design choices anchored on those ranges, not sourced values.
 */

import type { GoalKind, GoalPace } from "./goal";

/** Stable identifiers for the user-facing modes. */
export type GoalModeId =
  | "gradual_cut"
  | "standard_cut"
  | "aggressive_cut"
  | "lean_bulk"
  | "standard_bulk"
  | "aggressive_bulk"
  | "recomp"
  | "maintain";

export interface GoalMode {
  readonly id: GoalModeId;
  readonly kind: GoalKind;
  /** Pace stored for this mode. Recomp/maintain ignore pace. */
  readonly pace: GoalPace | null;
  readonly label: string;
  /** Inclusive weekly change band, % of body weight (negative = loss). */
  readonly minWeeklyPercent: number;
  readonly maxWeeklyPercent: number;
  /** Midpoint the energy engine plans for. */
  readonly targetWeeklyPercent: number;
}

const mode = (
  id: GoalModeId,
  kind: GoalKind,
  pace: GoalPace | null,
  label: string,
  minWeeklyPercent: number,
  maxWeeklyPercent: number,
): GoalMode => ({
  id,
  kind,
  pace,
  label,
  minWeeklyPercent,
  maxWeeklyPercent,
  targetWeeklyPercent:
    Math.round(((minWeeklyPercent + maxWeeklyPercent) / 2) * 1_000) / 1_000,
});

/**
 * Every mode in display order. `gradual` is the slowest pace,
 * `steady` the standard one and `aggressive` the fastest.
 */
export const GOAL_MODES: ReadonlyArray<GoalMode> = [
  mode("gradual_cut", "cut", "gradual", "Gradual cut", -0.5, -0.25),
  mode("standard_cut", "cut", "steady", "Standard cut", -0.75, -0.5),
  mode("aggressive_cut", "cut", "aggressive", "Aggressive cut", -1.0, -0.75),
  mode("lean_bulk", "bulk", "gradual", "Lean bulk", 0.1, 0.25),
  mode("standard_bulk", "bulk", "steady", "Standard bulk", 0.25, 0.5),
  mode("aggressive_bulk", "bulk", "aggressive", "Aggressive bulk", 0.5, 0.75),
  mode("recomp", "recomp", null, "Recomp", -0.25, 0.05),
  mode("maintain", "maintain", null, "Maintain", -0.1, 0.1),
];

/** Resolve the mode for a stored `(kind, pace)` pair. */
export const goalModeFor = (kind: GoalKind, pace: GoalPace): GoalMode => {
  const found =
    kind === "recomp" || kind === "maintain"
      ? GOAL_MODES.find((candidate) => candidate.kind === kind)
      : GOAL_MODES.find(
          (candidate) => candidate.kind === kind && candidate.pace === pace,
        );
  if (found === undefined) {
    throw new Error(`No goal mode for ${kind}/${pace}`);
  }
  return found;
};

/**
 * Approximate energy content of one kilogram of body-weight change.
 * Hall 2008 (Int J Obes 32:573) derives the classic 3,500 kcal/lb
 * (~7,700 kcal/kg) rule and shows it overstates the deficit needed by
 * leaner people. We use it as one conservative constant for planning
 * and trend-based estimates and never present it as exact.
 */
export const ENERGY_PER_KG_BODY_WEIGHT_KCAL = 7_700;

/** Daily kcal change implied by a weekly body-weight change in kg. */
export const dailyKcalForWeeklyChangeKg = (weeklyChangeKg: number): number =>
  (weeklyChangeKg * ENERGY_PER_KG_BODY_WEIGHT_KCAL) / 7;

/** Weekly kg change for a percent rate at a given body weight. */
export const weeklyChangeKgForPercent = (
  weeklyPercent: number,
  weightKg: number,
): number => (weeklyPercent / 100) * weightKg;

/** Rate-based daily goal adjustment (negative = deficit), whole kcal. */
export const goalAdjustmentKcalFor = (
  goalMode: GoalMode,
  weightKg: number,
): number =>
  Math.round(
    dailyKcalForWeeklyChangeKg(
      weeklyChangeKgForPercent(goalMode.targetWeeklyPercent, weightKg),
    ),
  );

export interface GoalProjection {
  /** Whole weeks until the target weight at the planned rate. */
  readonly projectedWeeksToTarget: number | null;
  /** ISO date the target is reached at the planned rate. */
  readonly projectedDate: string | null;
  /**
   * False when the goal's target date is earlier than the planned
   * rate allows. Null when no projection applies.
   */
  readonly targetDateRealistic: boolean | null;
}

const NO_PROJECTION: GoalProjection = {
  projectedWeeksToTarget: null,
  projectedDate: null,
  targetDateRealistic: null,
};

/**
 * Project when the target weight is reached at the mode's planned rate.
 * The target date is only checked, never used to size the deficit, so a
 * tight date cannot push the plan beyond the mode's safe band.
 */
export const projectGoal = (input: {
  readonly goalMode: GoalMode;
  readonly currentWeightKg: number;
  readonly targetWeightKg: number;
  readonly targetDate: string | null;
  readonly now: Date;
}): GoalProjection => {
  const remainingKg = input.targetWeightKg - input.currentWeightKg;
  const weeklyKg = weeklyChangeKgForPercent(
    input.goalMode.targetWeeklyPercent,
    input.currentWeightKg,
  );
  if (input.goalMode.kind === "maintain" || input.goalMode.kind === "recomp") {
    return NO_PROJECTION;
  }
  if (Math.abs(remainingKg) < 0.1) {
    return {
      projectedWeeksToTarget: 0,
      projectedDate: input.now.toISOString().slice(0, 10),
      targetDateRealistic: true,
    };
  }
  // Moving away from the target (e.g. cutting while already below it).
  if (weeklyKg === 0 || Math.sign(remainingKg) !== Math.sign(weeklyKg)) {
    return NO_PROJECTION;
  }
  const weeks = Math.ceil(remainingKg / weeklyKg);
  const projected = new Date(input.now.getTime() + weeks * 7 * 86_400_000);
  const projectedDate = projected.toISOString().slice(0, 10);
  return {
    projectedWeeksToTarget: weeks,
    projectedDate,
    targetDateRealistic:
      input.targetDate === null ? null : input.targetDate >= projectedDate,
  };
};
