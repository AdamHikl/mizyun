import type { Workout } from "@mizyun/contracts";
import { isSessionDetails } from "@mizyun/core";

/** The owner selects a private source; only the separate deliberate preview can publish it. */
export function selectableSharedWorkouts(
  workouts: readonly Workout[],
  owner: string,
): Workout[] {
  return workouts.filter(
    (workout) =>
      workout.userId === owner &&
      workout.completedAt !== null &&
      isSessionDetails(workout.details) &&
      !workout.details?.runSummary,
  );
}
