import type { WeightTrendSummary } from "./body-measurement";
import type { DailyFoodSummary } from "./food-entry";
import type { GoalKind, GoalPace } from "./goal";
import type { TrainingVolumeAction } from "./training-prescription";

export const WEEKLY_ADAPTATION_VERSION = "v1-2026-07" as const;

export type WeeklyAdaptationReadiness = "ready" | "insufficient_data";
export type WeeklyCalorieAction = "hold" | "increase" | "decrease";

export interface WeeklyAdaptation {
  readonly version: typeof WEEKLY_ADAPTATION_VERSION;
  readonly computedAt: Date;
  readonly readiness: WeeklyAdaptationReadiness;
  readonly goalKind: GoalKind | null;
  readonly currentPace: GoalPace | null;
  readonly proposedPace: GoalPace | null;
  readonly calorieAction: WeeklyCalorieAction;
  readonly trainingVolumeAction: TrainingVolumeAction;
  readonly observations: {
    readonly loggedNutritionDays: number;
    readonly averageCalorieAdherencePercent: number | null;
    readonly averageProteinAdherencePercent: number | null;
    readonly weeklyWeightChangeKg: number | null;
    readonly weeklyWeightChangePercent: number | null;
    readonly targetKcal?: number | null;
    readonly averageCaloriesKcal?: number | null;
    readonly targetProteinG?: number | null;
    readonly averageProteinG?: number | null;
    readonly completedWorkoutsCount?: number | null;
    readonly smoothedWeightKg?: number | null;
    readonly latestWeightKg?: number | null;
  };
  readonly reasons: readonly string[];
}

const paceOrder: readonly GoalPace[] = ["gradual", "steady", "aggressive"];

const stepPace = (current: GoalPace, direction: "more" | "less"): GoalPace => {
  const index = paceOrder.indexOf(current);
  const next = direction === "more" ? index + 1 : index - 1;
  return (
    paceOrder[Math.max(0, Math.min(paceOrder.length - 1, next))] ?? current
  );
};

const averagePercent = (
  values: readonly number[],
  target: number | null,
): number | null => {
  if (values.length === 0 || target === null || target <= 0) return null;
  return Math.round(
    (values.reduce((total, value) => total + value, 0) /
      values.length /
      target) *
      100,
  );
};

/**
 * A conservative weekly decision rule. It only changes goal pace when both
 * adherence and trend evidence are adequate; models may explain, never decide.
 */
export const buildWeeklyAdaptation = (input: {
  readonly goalKind: GoalKind | null;
  readonly currentPace: GoalPace | null;
  readonly targetKcal: number | null;
  readonly targetProteinG: number | null;
  readonly nutritionDays: readonly DailyFoodSummary[];
  readonly weightTrend: WeightTrendSummary;
  readonly trainingVolumeAction: TrainingVolumeAction;
  readonly completedWorkoutsLast7Days?: number | null;
  readonly now: Date;
}): WeeklyAdaptation => {
  const calorieDays = input.nutritionDays
    .map((day) => day.caloriesKcal)
    .filter((value): value is number => value !== null);
  const proteinDays = input.nutritionDays
    .map((day) => day.proteinG)
    .filter((value): value is number => value !== null);
  const averageCaloriesKcal =
    calorieDays.length === 0
      ? null
      : Math.round(
          calorieDays.reduce((total, val) => total + val, 0) /
            calorieDays.length,
        );
  const averageProteinG =
    proteinDays.length === 0
      ? null
      : Math.round(
          proteinDays.reduce((total, val) => total + val, 0) /
            proteinDays.length,
        );
  const calorieAdherence = averagePercent(calorieDays, input.targetKcal);
  const proteinAdherence = averagePercent(proteinDays, input.targetProteinG);
  const latestWeight = input.weightTrend.latestWeightKg;
  const weightChangePercent =
    input.weightTrend.weeklyChangeKg === null ||
    latestWeight === null ||
    latestWeight <= 0
      ? null
      : Math.round((input.weightTrend.weeklyChangeKg / latestWeight) * 10_000) /
        100;
  const ready =
    input.goalKind !== null &&
    input.currentPace !== null &&
    calorieDays.length >= 4 &&
    calorieAdherence !== null &&
    calorieAdherence >= 80 &&
    calorieAdherence <= 120 &&
    weightChangePercent !== null;

  let calorieAction: WeeklyCalorieAction = "hold";
  let proposedPace = input.currentPace;
  const reasons: string[] = [];

  if (!ready) {
    reasons.push(
      calorieDays.length < 4
        ? "Need at least four complete nutrition days before adapting."
        : weightChangePercent === null
          ? "Need at least three weights spanning seven days before adapting."
          : "Calorie adherence must be within 80–120% before trend-based adaptation.",
    );
  } else if (
    input.goalKind === "cut" &&
    (weightChangePercent as number) > -0.5
  ) {
    calorieAction = "decrease";
    proposedPace = stepPace(input.currentPace as GoalPace, "more");
    reasons.push(
      "Confirmed weight loss is below the conservative weekly band.",
    );
  } else if (input.goalKind === "cut" && (weightChangePercent as number) < -1) {
    calorieAction = "increase";
    proposedPace = stepPace(input.currentPace as GoalPace, "less");
    reasons.push(
      "Confirmed weight loss is above the conservative weekly band.",
    );
  } else if (
    input.goalKind === "bulk" &&
    (weightChangePercent as number) < 0.25
  ) {
    calorieAction = "increase";
    proposedPace = stepPace(input.currentPace as GoalPace, "more");
    reasons.push(
      "Confirmed weight gain is below the conservative weekly band.",
    );
  } else if (
    input.goalKind === "bulk" &&
    (weightChangePercent as number) > 0.5
  ) {
    calorieAction = "decrease";
    proposedPace = stepPace(input.currentPace as GoalPace, "less");
    reasons.push(
      "Confirmed weight gain is above the conservative weekly band.",
    );
  } else {
    reasons.push(
      "Confirmed adherence and weight trend support holding the plan.",
    );
  }

  if (proposedPace === input.currentPace) calorieAction = "hold";

  return {
    version: WEEKLY_ADAPTATION_VERSION,
    computedAt: input.now,
    readiness: ready ? "ready" : "insufficient_data",
    goalKind: input.goalKind,
    currentPace: input.currentPace,
    proposedPace,
    calorieAction,
    trainingVolumeAction: input.trainingVolumeAction,
    observations: {
      loggedNutritionDays: calorieDays.length,
      averageCalorieAdherencePercent: calorieAdherence,
      averageProteinAdherencePercent: proteinAdherence,
      weeklyWeightChangeKg: input.weightTrend.weeklyChangeKg,
      weeklyWeightChangePercent: weightChangePercent,
      targetKcal: input.targetKcal,
      averageCaloriesKcal,
      targetProteinG: input.targetProteinG,
      averageProteinG,
      completedWorkoutsCount: input.completedWorkoutsLast7Days ?? null,
      smoothedWeightKg: input.weightTrend.smoothedWeightKg,
      latestWeightKg: input.weightTrend.latestWeightKg,
    },
    reasons,
  };
};
