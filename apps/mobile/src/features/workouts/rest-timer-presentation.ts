import type { RestTimerState } from "./active-workout-state";

export interface RestTimerNextAction {
  readonly title: string;
  readonly detail: string | null;
}

export interface CurrentWorkoutNextAction {
  readonly currentExerciseName: string;
  readonly nextSetSummary?: string;
  readonly allPlannedSetsCompleted?: boolean;
}

export const restTimerNextAction = (
  rest: RestTimerState,
  current: CurrentWorkoutNextAction | null = null,
): RestTimerNextAction => {
  if (current?.allPlannedSetsCompleted ?? rest.allPlannedSetsCompleted) {
    return {
      title: "All planned sets completed",
      detail: "Finish when ready",
    };
  }

  const nextExerciseName =
    current?.currentExerciseName ?? rest.nextExerciseName;
  if (nextExerciseName) {
    return {
      title: `Next: ${nextExerciseName}`,
      detail: current
        ? (current.nextSetSummary ?? null)
        : (rest.nextSetSummary ?? null),
    };
  }

  return {
    title: `Rest after ${rest.exerciseName}`,
    detail: null,
  };
};
