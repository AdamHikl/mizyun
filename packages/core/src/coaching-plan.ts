import type { EnergyBreakdown } from "./energy";
import type { GoalKind } from "./goal";

export const COACHING_PLAN_VERSION = "v1-general-fitness-2026-07" as const;

export type CoachingPlanMissingInput =
  "active_goal" | "body_weight" | "energy_target";

export type CoachingTrainingFocus =
  | "retain_strength_and_lean_mass"
  | "hypertrophy_and_strength"
  | "hypertrophy_and_conditioning"
  | "balanced_fitness";

export type CoachingExerciseType =
  | "compound_resistance"
  | "accessory_resistance"
  | "moderate_aerobic"
  | "mobility_recovery";

export type CoachingTrainingStatus =
  | "below_base_frequency"
  | "within_base_frequency"
  | "above_base_frequency"
  | "unknown";

export interface CoachingPlan {
  readonly version: typeof COACHING_PLAN_VERSION;
  readonly computedAt: Date;
  readonly complete: boolean;
  readonly missingInputs: readonly CoachingPlanMissingInput[];
  readonly goalKind: GoalKind | null;
  readonly calorie: {
    readonly targetKcal: number;
    /**
     * An adherence/planning band, not a statement of physiological
     * measurement uncertainty.
     */
    readonly planningRangeLowKcal: number;
    readonly planningRangeHighKcal: number;
    readonly formulaVersion: string;
  } | null;
  readonly protein: {
    readonly basisWeightKg: number;
    readonly minG: number;
    readonly targetG: number;
    readonly maxG: number;
    readonly minGramsPerKg: number;
    readonly targetGramsPerKg: number;
    readonly maxGramsPerKg: number;
  } | null;
  readonly training: {
    readonly focus: CoachingTrainingFocus;
    readonly resistanceDaysMin: number;
    readonly resistanceDaysMax: number;
    readonly aerobicMinutesMin: number;
    readonly completedSessionsLast7Days: number;
    readonly status: CoachingTrainingStatus;
    readonly exerciseTypes: readonly CoachingExerciseType[];
  } | null;
  readonly assumptions: readonly string[];
  readonly safetyNotice: string;
}

const proteinMultipliers = (
  goalKind: GoalKind,
): {
  readonly min: number;
  readonly target: number;
  readonly max: number;
} => {
  if (goalKind === "maintain") {
    return { min: 1.4, target: 1.6, max: 1.8 };
  }
  return { min: 1.6, target: 1.8, max: 2 };
};

const trainingPrescription = (
  goalKind: GoalKind,
): {
  readonly focus: CoachingTrainingFocus;
  readonly resistanceDaysMin: number;
  readonly resistanceDaysMax: number;
} => {
  switch (goalKind) {
    case "cut":
      return {
        focus: "retain_strength_and_lean_mass",
        resistanceDaysMin: 2,
        resistanceDaysMax: 4,
      };
    case "bulk":
      return {
        focus: "hypertrophy_and_strength",
        resistanceDaysMin: 3,
        resistanceDaysMax: 4,
      };
    case "recomp":
      return {
        focus: "hypertrophy_and_conditioning",
        resistanceDaysMin: 3,
        resistanceDaysMax: 4,
      };
    case "maintain":
      return {
        focus: "balanced_fitness",
        resistanceDaysMin: 2,
        resistanceDaysMax: 4,
      };
  }
};

const trainingStatus = (
  completed: number,
  minimum: number,
  maximum: number,
): CoachingTrainingStatus => {
  if (completed < minimum) return "below_base_frequency";
  if (completed > maximum) return "above_base_frequency";
  return "within_base_frequency";
};

/**
 * Builds the conservative, deterministic foundation that the AI
 * Coach may explain and adapt. The model is never the authority for
 * calorie or protein arithmetic.
 */
export const buildCoachingPlan = (input: {
  readonly energy: EnergyBreakdown;
  readonly completedWorkoutsLast7Days: number;
}): CoachingPlan => {
  const goalKind = input.energy.inputs.goalKind;
  const weightKg = input.energy.inputs.weightKg;
  const completedWorkoutsLast7Days = Math.max(
    0,
    Math.floor(input.completedWorkoutsLast7Days),
  );
  const missingInputs: CoachingPlanMissingInput[] = [];

  if (goalKind === null) missingInputs.push("active_goal");
  if (weightKg === null) missingInputs.push("body_weight");
  if (input.energy.dailyTargetKcal === null) {
    missingInputs.push("energy_target");
  }

  const calorie =
    input.energy.dailyTargetKcal === null
      ? null
      : {
          targetKcal: input.energy.dailyTargetKcal,
          planningRangeLowKcal: Math.max(0, input.energy.dailyTargetKcal - 100),
          planningRangeHighKcal: input.energy.dailyTargetKcal + 100,
          formulaVersion: input.energy.formulaVersion,
        };

  const protein =
    goalKind === null || weightKg === null
      ? null
      : (() => {
          const multiplier = proteinMultipliers(goalKind);
          return {
            basisWeightKg: weightKg,
            minG: Math.round(weightKg * multiplier.min),
            targetG: Math.round(weightKg * multiplier.target),
            maxG: Math.round(weightKg * multiplier.max),
            minGramsPerKg: multiplier.min,
            targetGramsPerKg: multiplier.target,
            maxGramsPerKg: multiplier.max,
          };
        })();

  const training =
    goalKind === null
      ? null
      : (() => {
          const prescription = trainingPrescription(goalKind);
          return {
            ...prescription,
            aerobicMinutesMin: 150,
            completedSessionsLast7Days: completedWorkoutsLast7Days,
            status: trainingStatus(
              completedWorkoutsLast7Days,
              prescription.resistanceDaysMin,
              prescription.resistanceDaysMax,
            ),
            exerciseTypes: [
              "compound_resistance",
              "accessory_resistance",
              "moderate_aerobic",
              "mobility_recovery",
            ] satisfies readonly CoachingExerciseType[],
          };
        })();

  return {
    version: COACHING_PLAN_VERSION,
    computedAt: input.energy.computedAt,
    complete: missingInputs.length === 0,
    missingInputs,
    goalKind,
    calorie,
    protein,
    training,
    assumptions: [
      "Calorie planning range is an adherence band of plus or minus 100 kcal, not a measurement-confidence interval.",
      "Protein guidance is for generally healthy exercising adults and uses current confirmed body weight.",
      "Training guidance is a base frequency and exercise-type framework; experience, equipment, preferences, and limitations are not yet applied.",
      "Aerobic guidance assumes moderate-intensity activity; vigorous activity is not converted in this version.",
    ],
    safetyNotice:
      "General wellness guidance only. Stop and seek qualified medical help for pain, injury, faintness, or other concerning symptoms.",
  };
};
