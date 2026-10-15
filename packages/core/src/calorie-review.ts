/**
 * Adaptive maintenance estimate and weekly calorie review (ENG-05, ENG-08).
 *
 * Pure and deterministic: the same logged intake, weights and goal always
 * produce the same proposal. Models may explain a review; they never
 * compute or decide it. A proposal changes nothing until the user accepts
 * it, and acceptance only moves the goal's calibration offset.
 *
 * ## Adaptive maintenance
 *
 * Energy balance says intake − expenditure ≈ stored energy change. Over a
 * window of logged days, maintenance ≈ average intake − (weekly weight
 * change × 7,700 kcal/kg ÷ 7). The estimate needs at least 14 days of
 * weight trend and 14 logged nutrition days because shorter windows are
 * dominated by water and glycogen. It replaces activity guesses (steps,
 * activity level, exercise) with what the logs actually show.
 *
 * ## Weekly review
 *
 * Compares the smoothed weekly rate (least-squares slope, ADR-0010)
 * against the goal mode's band. Inside the band: hold. Outside: propose a
 * new daily target, capped at ±250 kcal per week, never below the safety
 * floor and never beyond ±1,000 kcal of cumulative calibration.
 */

import type { WeightTrendSummary } from "./body-measurement";
import type { GoalKind, GoalPace } from "./goal";
import {
  dailyKcalForWeeklyChangeKg,
  goalModeFor,
  type GoalMode,
  weeklyChangeKgForPercent,
} from "./goal-modes";

export const CALORIE_REVIEW_VERSION = "v1-2026-10" as const;

/** Minimum weight-trend span and logged days for adaptive maintenance. */
export const ADAPTIVE_MIN_TREND_DAYS = 14;
export const ADAPTIVE_MIN_LOGGED_DAYS = 14;
/** Plausible adult maintenance range; outside it the logs are suspect. */
const ADAPTIVE_MIN_KCAL = 1_000;
const ADAPTIVE_MAX_KCAL = 6_000;

/** Weekly review gates and limits. */
export const REVIEW_MIN_GOAL_AGE_DAYS = 14;
export const REVIEW_MIN_LOGGED_DAYS = 4;
export const REVIEW_MAX_STEP_KCAL = 250;
export const REVIEW_MIN_STEP_KCAL = 100;
export const REVIEW_MAX_CALIBRATION_KCAL = 1_000;
/**
 * After an accepted change the 28-day slope still reflects the old target;
 * wait two weeks so corrections do not stack before weight responds.
 */
export const REVIEW_ADJUSTMENT_COOLDOWN_DAYS = 14;
/** Conservative floor when sex is unknown (the lower guideline value). */
export const REVIEW_DEFAULT_SAFETY_FLOOR_KCAL = 1_200;
const REVIEW_ROUNDING_KCAL = 25;

/** One local day of logged intake; null calories = incomplete day. */
export interface IntakeDay {
  readonly date: string;
  readonly caloriesKcal: number | null;
}

export type AdaptiveMaintenanceStatus = "ready" | "insufficient";
export type AdaptiveMaintenanceReason =
  "weight_trend_too_short" | "too_few_logged_days" | "implausible_result";

export interface AdaptiveMaintenanceEstimate {
  readonly status: AdaptiveMaintenanceStatus;
  readonly reason: AdaptiveMaintenanceReason | null;
  readonly maintenanceKcal: number | null;
  readonly averageIntakeKcal: number | null;
  readonly loggedDays: number;
  readonly windowDays: number;
  readonly weeklyChangeKg: number | null;
}

const average = (values: readonly number[]): number | null =>
  values.length === 0
    ? null
    : values.reduce((total, value) => total + value, 0) / values.length;

/** Evidence span behind the weekly slope (falls back for older summaries). */
const trendEvidenceDays = (trend: WeightTrendSummary): number =>
  trend.windowSpanDays ?? trend.spanDays;

const completeIntake = (days: readonly IntakeDay[]): number[] =>
  days
    .map((day) => day.caloriesKcal)
    .filter(
      (value): value is number =>
        value !== null && Number.isFinite(value) && value > 0,
    );

/**
 * Estimate maintenance from logged intake and the weight trend.
 * `intakeDays` should cover the same recent window as the trend (the
 * caller passes up to 28 completed local days, today excluded).
 */
export const estimateAdaptiveMaintenance = (input: {
  readonly intakeDays: readonly IntakeDay[];
  readonly weightTrend: WeightTrendSummary;
  readonly windowDays: number;
}): AdaptiveMaintenanceEstimate => {
  const intake = completeIntake(input.intakeDays);
  const averageIntake = average(intake);
  const base = {
    loggedDays: intake.length,
    windowDays: input.windowDays,
    weeklyChangeKg: input.weightTrend.weeklyChangeKg,
    averageIntakeKcal:
      averageIntake === null ? null : Math.round(averageIntake),
  };
  if (
    input.weightTrend.weeklyChangeKg === null ||
    trendEvidenceDays(input.weightTrend) < ADAPTIVE_MIN_TREND_DAYS
  ) {
    return {
      ...base,
      status: "insufficient",
      reason: "weight_trend_too_short",
      maintenanceKcal: null,
    };
  }
  if (intake.length < ADAPTIVE_MIN_LOGGED_DAYS || averageIntake === null) {
    return {
      ...base,
      status: "insufficient",
      reason: "too_few_logged_days",
      maintenanceKcal: null,
    };
  }
  const maintenance = Math.round(
    averageIntake -
      dailyKcalForWeeklyChangeKg(input.weightTrend.weeklyChangeKg),
  );
  if (maintenance < ADAPTIVE_MIN_KCAL || maintenance > ADAPTIVE_MAX_KCAL) {
    return {
      ...base,
      status: "insufficient",
      reason: "implausible_result",
      maintenanceKcal: null,
    };
  }
  return {
    ...base,
    status: "ready",
    reason: null,
    maintenanceKcal: maintenance,
  };
};

export type CalorieReviewStatus = "insufficient_data" | "hold" | "adjust";

export type CalorieReviewReason =
  | "no_target"
  | "goal_too_new"
  | "recent_adjustment"
  | "too_few_logged_days"
  | "adherence_out_of_range"
  | "weight_trend_insufficient"
  | "within_band"
  | "below_band"
  | "above_band"
  | "safety_floor"
  | "calibration_limit";

export type CalorieReviewMethod = "adaptive_maintenance" | "rate_error";

export interface CalorieReview {
  readonly version: typeof CALORIE_REVIEW_VERSION;
  readonly computedAt: Date;
  readonly status: CalorieReviewStatus;
  /** Primary reason first; further reasons add context. */
  readonly reasons: readonly CalorieReviewReason[];
  readonly method: CalorieReviewMethod | null;
  readonly goalMode: GoalMode;
  readonly goalAgeDays: number;
  readonly observedWeeklyPercent: number | null;
  readonly observedWeeklyChangeKg: number | null;
  readonly smoothedWeightKg: number | null;
  readonly loggedDays: number;
  readonly averageIntakeKcal: number | null;
  readonly adherencePercent: number | null;
  readonly adaptiveMaintenanceKcal: number | null;
  readonly currentTargetKcal: number | null;
  readonly proposedTargetKcal: number | null;
  /** Change to the stored calibration (what acceptance applies). */
  readonly deltaKcal: number;
  /**
   * Change to the daily target the user will see. Equals `deltaKcal`
   * unless the safety-floor clamp is absorbing part of the calibration.
   */
  readonly targetChangeKcal: number;
  readonly calibrationBeforeKcal: number;
  readonly calibrationAfterKcal: number;
}

const roundTo = (value: number, step: number): number =>
  Math.round(value / step) * step;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** Whole days elapsed; null when the start date is missing or invalid. */
const daysBetween = (fromIsoDate: string, now: Date): number | null => {
  const days = Math.floor(
    (now.getTime() - new Date(`${fromIsoDate}T00:00:00Z`).getTime()) /
      86_400_000,
  );
  return Number.isFinite(days) ? days : null;
};

/**
 * Build the weekly calorie review. `recentIntakeDays` are the last seven
 * completed local days; `currentTargetKcal` is today's target including
 * the current calibration.
 */
export const buildCalorieReview = (input: {
  readonly goalKind: GoalKind;
  readonly goalPace: GoalPace;
  readonly goalStartsOn: string;
  readonly calibrationKcal: number;
  readonly currentTargetKcal: number | null;
  /** Target before calibration (TDEE + goal adjustment), when known. */
  readonly uncalibratedTargetKcal?: number | null;
  /** Goal adjustment the target was planned with (rate-based). */
  readonly goalAdjustmentKcal: number | null;
  readonly safetyFloorKcal: number | null;
  readonly weightTrend: WeightTrendSummary;
  readonly recentIntakeDays: readonly IntakeDay[];
  readonly adaptiveMaintenance: AdaptiveMaintenanceEstimate | null;
  /** When this goal's most recent proposal was accepted, if ever. */
  readonly lastAcceptedAt?: Date | null;
  readonly now: Date;
}): CalorieReview => {
  const goalMode = goalModeFor(input.goalKind, input.goalPace);
  const intake = completeIntake(input.recentIntakeDays);
  const averageIntake = average(intake);
  const weight =
    input.weightTrend.smoothedWeightKg ?? input.weightTrend.latestWeightKg;
  const observedKg = input.weightTrend.weeklyChangeKg;
  const observedPercent =
    observedKg === null || weight === null || weight <= 0
      ? null
      : Math.round((observedKg / weight) * 10_000) / 100;
  const adherence =
    averageIntake === null ||
    input.currentTargetKcal === null ||
    input.currentTargetKcal <= 0
      ? null
      : Math.round((averageIntake / input.currentTargetKcal) * 100);
  const elapsedGoalDays = daysBetween(input.goalStartsOn, input.now);
  const goalAgeDays = elapsedGoalDays ?? 0;
  const adaptive =
    input.adaptiveMaintenance?.status === "ready"
      ? input.adaptiveMaintenance.maintenanceKcal
      : null;

  const base = {
    version: CALORIE_REVIEW_VERSION,
    computedAt: input.now,
    goalMode,
    goalAgeDays,
    observedWeeklyPercent: observedPercent,
    observedWeeklyChangeKg: observedKg,
    smoothedWeightKg: input.weightTrend.smoothedWeightKg,
    loggedDays: intake.length,
    averageIntakeKcal:
      averageIntake === null ? null : Math.round(averageIntake),
    adherencePercent: adherence,
    adaptiveMaintenanceKcal: adaptive,
    currentTargetKcal: input.currentTargetKcal,
    calibrationBeforeKcal: input.calibrationKcal,
  };
  const unchanged = (
    status: CalorieReviewStatus,
    reasons: CalorieReviewReason[],
    method: CalorieReviewMethod | null = null,
  ): CalorieReview => ({
    ...base,
    status,
    reasons,
    method,
    proposedTargetKcal: null,
    deltaKcal: 0,
    targetChangeKcal: 0,
    calibrationAfterKcal: input.calibrationKcal,
  });

  if (input.currentTargetKcal === null) {
    return unchanged("insufficient_data", ["no_target"]);
  }
  if (elapsedGoalDays === null || elapsedGoalDays < REVIEW_MIN_GOAL_AGE_DAYS) {
    return unchanged("insufficient_data", ["goal_too_new"]);
  }
  if (
    input.lastAcceptedAt != null &&
    input.now.getTime() - input.lastAcceptedAt.getTime() <
      REVIEW_ADJUSTMENT_COOLDOWN_DAYS * 86_400_000
  ) {
    return unchanged("insufficient_data", ["recent_adjustment"]);
  }
  if (intake.length < REVIEW_MIN_LOGGED_DAYS) {
    return unchanged("insufficient_data", ["too_few_logged_days"]);
  }
  if (adherence === null || adherence < 80 || adherence > 120) {
    return unchanged("insufficient_data", ["adherence_out_of_range"]);
  }
  if (
    observedPercent === null ||
    observedKg === null ||
    weight === null ||
    trendEvidenceDays(input.weightTrend) < ADAPTIVE_MIN_TREND_DAYS
  ) {
    return unchanged("insufficient_data", ["weight_trend_insufficient"]);
  }
  if (
    observedPercent >= goalMode.minWeeklyPercent &&
    observedPercent <= goalMode.maxWeeklyPercent
  ) {
    return unchanged("hold", ["within_band"]);
  }

  const direction: CalorieReviewReason =
    observedPercent < goalMode.minWeeklyPercent ? "below_band" : "above_band";
  const sign = direction === "below_band" ? 1 : -1;

  // Ideal target: maintenance from the logs plus the planned rate when
  // adaptive maintenance is ready; otherwise correct the observed rate
  // error from what was actually eaten this week.
  const plannedAdjustment = dailyKcalForWeeklyChangeKg(
    weeklyChangeKgForPercent(goalMode.targetWeeklyPercent, weight),
  );
  const method: CalorieReviewMethod =
    adaptive !== null ? "adaptive_maintenance" : "rate_error";
  const ideal =
    adaptive !== null
      ? adaptive + plannedAdjustment
      : (averageIntake as number) +
        dailyKcalForWeeklyChangeKg(
          weeklyChangeKgForPercent(
            goalMode.targetWeeklyPercent - observedPercent,
            weight,
          ),
        );

  let delta = roundTo(ideal - input.currentTargetKcal, REVIEW_ROUNDING_KCAL);
  // The proposal must move in the direction the band demands. Intake that
  // differed from the target can make the arithmetic point the other way;
  // then a minimum step in the right direction is the conservative answer.
  if (Math.sign(delta) !== sign || Math.abs(delta) < REVIEW_MIN_STEP_KCAL) {
    delta = sign * REVIEW_MIN_STEP_KCAL;
  }
  delta = clamp(delta, -REVIEW_MAX_STEP_KCAL, REVIEW_MAX_STEP_KCAL);

  const reasons: CalorieReviewReason[] = [direction];
  const floor = input.safetyFloorKcal;
  // Target before calibration. When the floor clamp is active, part of the
  // stored calibration has no effect; working in target space keeps an
  // accepted raise from being swallowed by that dead calibration.
  const uncalibrated =
    input.uncalibratedTargetKcal ??
    input.currentTargetKcal - input.calibrationKcal;
  let target = input.currentTargetKcal + delta;
  if (floor !== null && target < floor) {
    reasons.push("safety_floor");
    target = floor;
  }
  let calibrationAfter = Math.round(target - uncalibrated);
  const limited = clamp(
    calibrationAfter,
    -REVIEW_MAX_CALIBRATION_KCAL,
    REVIEW_MAX_CALIBRATION_KCAL,
  );
  if (limited !== calibrationAfter) {
    reasons.push("calibration_limit");
    calibrationAfter = limited;
    target = Math.max(floor ?? -Infinity, uncalibrated + calibrationAfter);
  }
  const targetChange = Math.round(target - input.currentTargetKcal);
  if (
    targetChange === 0 ||
    Math.sign(targetChange) !== sign ||
    calibrationAfter === input.calibrationKcal
  ) {
    return unchanged("hold", reasons, method);
  }

  return {
    ...base,
    status: "adjust",
    reasons,
    method,
    proposedTargetKcal: Math.round(target),
    deltaKcal: calibrationAfter - input.calibrationKcal,
    targetChangeKcal: targetChange,
    calibrationAfterKcal: calibrationAfter,
  };
};

/** Monday (ISO week start) of a local `YYYY-MM-DD` day. */
export const isoWeekStart = (localDayIso: string): string => {
  const day = new Date(`${localDayIso}T00:00:00Z`);
  const weekday = (day.getUTCDay() + 6) % 7;
  return new Date(day.getTime() - weekday * 86_400_000)
    .toISOString()
    .slice(0, 10);
};
