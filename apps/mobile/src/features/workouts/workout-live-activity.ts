export interface WorkoutLiveActivityProps {
  readonly workoutId: string;
  readonly workoutName: string;
  readonly currentExerciseName: string;
  readonly completedSetsCount: number;
  readonly totalPlannedSetsCount: number | null;
  readonly nextSetSummary: string | null;
  readonly state: "active" | "resting" | "complete";
  readonly restStartedAt: number | null;
  readonly restEndsAt: number | null;
}

export const updateWorkoutLiveActivity = async (
  _props: WorkoutLiveActivityProps,
): Promise<string | null> => null;

export const endWorkoutLiveActivity = async (): Promise<void> => {};
