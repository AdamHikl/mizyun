import type { CoachingPlan } from "./coaching-plan";

export const DAILY_ACTION_PLAN_VERSION = "v1-2026-07" as const;

export type DailyNextAction =
  | "complete_setup"
  | "log_meal"
  | "prioritise_protein"
  | "train"
  | "stay_on_plan";

export interface DailyActionPlan {
  readonly version: typeof DAILY_ACTION_PLAN_VERSION;
  readonly computedAt: Date;
  readonly date: string;
  readonly calorie: {
    readonly targetKcal: number;
    readonly consumedKcal: number | null;
    readonly remainingKcal: number | null;
  } | null;
  readonly protein: {
    readonly targetG: number;
    readonly consumedG: number | null;
    readonly remainingG: number | null;
  } | null;
  readonly training: {
    readonly due: boolean;
    readonly completedToday: boolean;
    readonly completedSessionsLast7Days: number;
  } | null;
  readonly missingInputs: readonly string[];
  readonly nextAction: DailyNextAction;
}

const remaining = (target: number, consumed: number | null): number | null =>
  consumed === null ? null : Math.max(0, Math.round(target - consumed));

/**
 * Produces the inspectable daily decision used by Coach. Models may explain
 * this result, but never own its arithmetic or action priority.
 */
export const buildDailyActionPlan = (input: {
  readonly plan: CoachingPlan;
  readonly date: string;
  readonly consumedKcal: number | null;
  readonly consumedProteinG: number | null;
  readonly completedWorkoutToday: boolean;
}): DailyActionPlan => {
  const calorie =
    input.plan.calorie === null
      ? null
      : {
          targetKcal: input.plan.calorie.targetKcal,
          consumedKcal: input.consumedKcal,
          remainingKcal: remaining(
            input.plan.calorie.targetKcal,
            input.consumedKcal,
          ),
        };
  const protein =
    input.plan.protein === null
      ? null
      : {
          targetG: input.plan.protein.targetG,
          consumedG: input.consumedProteinG,
          remainingG: remaining(
            input.plan.protein.targetG,
            input.consumedProteinG,
          ),
        };
  const training =
    input.plan.training === null
      ? null
      : {
          due:
            !input.completedWorkoutToday &&
            input.plan.training.status === "below_base_frequency",
          completedToday: input.completedWorkoutToday,
          completedSessionsLast7Days:
            input.plan.training.completedSessionsLast7Days,
        };

  const nextAction: DailyNextAction =
    input.plan.missingInputs.length > 0
      ? "complete_setup"
      : input.consumedKcal === null && input.consumedProteinG === null
        ? "log_meal"
        : protein?.remainingG !== null &&
            protein?.remainingG !== undefined &&
            protein.remainingG >= Math.max(20, protein.targetG * 0.2)
          ? "prioritise_protein"
          : training?.due === true
            ? "train"
            : "stay_on_plan";

  return {
    version: DAILY_ACTION_PLAN_VERSION,
    computedAt: input.plan.computedAt,
    date: input.date,
    calorie,
    protein,
    training,
    missingInputs: input.plan.missingInputs,
    nextAction,
  };
};
