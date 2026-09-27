import { requireNativeModule } from "expo";

export interface WorkoutLiveUpdateInput {
  readonly workoutId: string;
  readonly workoutName: string;
  readonly currentExerciseName: string;
  readonly nextSetSummary?: string;
  readonly completedSetsCount: number;
  readonly totalPlannedSetsCount?: number;
  readonly allPlannedSetsCompleted?: boolean;
  readonly restEndsAt?: number;
  readonly deepLinkUrl: string;
  /** Set only after an explicit in-app opt-in to show this workout again. */
  readonly allowReshow?: boolean;
}

export type WorkoutLiveUpdateResult = "posted" | "fallback" | "suppressed";

interface WorkoutLiveUpdateNativeModule {
  updateWorkoutLiveUpdate(
    input: WorkoutLiveUpdateInput,
  ): Promise<WorkoutLiveUpdateResult>;
  dismissWorkoutLiveUpdate(): Promise<boolean>;
}

let nativeModule: WorkoutLiveUpdateNativeModule | null = null;

function module(): WorkoutLiveUpdateNativeModule {
  nativeModule ??=
    requireNativeModule<WorkoutLiveUpdateNativeModule>("WorkoutLiveUpdate");
  return nativeModule;
}

export function updateWorkoutLiveUpdate(
  input: WorkoutLiveUpdateInput,
): Promise<WorkoutLiveUpdateResult> {
  return module().updateWorkoutLiveUpdate(input);
}

export function dismissWorkoutLiveUpdate(): Promise<boolean> {
  return module().dismissWorkoutLiveUpdate();
}
