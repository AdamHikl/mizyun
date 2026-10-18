import type { ApiClient } from "@mizyun/api-client";
import {
  exerciseListResponseSchema,
  workoutListResponseSchema,
  workoutSetListResponseSchema,
  type ExerciseListResponse,
  type Workout,
  type WorkoutListResponse,
  type WorkoutSetListResponse,
} from "@mizyun/contracts";
import {
  hasBoulderingActivity,
  hasRunningActivity,
  isRoutineDetails,
  type StretchActivity,
  type StretchSessionInput,
} from "@mizyun/core";

import { apiClient } from "@/composition/api-client";
import { listRuns } from "@/features/running/public-data";
import { isoLocalDate } from "./evening-stretch-reminder";

export interface TodayTraining {
  readonly trained: boolean;
  readonly input: StretchSessionInput;
}

const isToday = (instant: string | null, today: string): boolean =>
  instant !== null && isoLocalDate(new Date(instant)) === today;

/**
 * Today's finished training as stretch-session input. Returns null when the
 * workout list cannot be read, so callers leave any reminder unchanged.
 */
export const fetchTodayTraining = async (
  client: ApiClient = apiClient,
  now: Date = new Date(),
): Promise<TodayTraining | null> => {
  const today = isoLocalDate(now);

  const [workoutResult, runResult] = await Promise.all([
    client.request<WorkoutListResponse>({
      method: "GET",
      path: "/v1/workouts?limit=200",
      schema: workoutListResponseSchema,
    }),
    listRuns(client, { from: today, to: today }),
  ]);
  if (!workoutResult.ok) return null;

  const finished = workoutResult.value.workouts.filter(
    (workout) =>
      !isRoutineDetails(workout.details) && isToday(workout.completedAt, today),
  );
  const activities = new Set<StretchActivity>();
  if (runResult.ok && runResult.value.runs.length > 0) {
    activities.add("running");
  }
  const sessions: Workout[] = [];
  for (const workout of finished) {
    if (hasRunningActivity(workout.details)) activities.add("running");
    else if (hasBoulderingActivity(workout.details))
      activities.add("bouldering");
    else sessions.push(workout);
  }

  const setCounts = new Map<string, number>();
  if (sessions.length > 0) {
    const setResults = await Promise.all(
      sessions.map((workout) =>
        client.request<WorkoutSetListResponse>({
          method: "GET",
          path: `/v1/workouts/${encodeURIComponent(workout.id)}/sets`,
          schema: workoutSetListResponseSchema,
        }),
      ),
    );
    for (const result of setResults) {
      if (!result.ok) continue;
      for (const set of result.value.workoutSets) {
        if (set.completedAt === null) continue;
        setCounts.set(set.exerciseId, (setCounts.get(set.exerciseId) ?? 0) + 1);
      }
    }
  }

  let names = new Map<string, string>();
  if (setCounts.size > 0) {
    const exerciseResult = await client.request<ExerciseListResponse>({
      method: "GET",
      path: "/v1/exercises?limit=200",
      schema: exerciseListResponseSchema,
    });
    if (exerciseResult.ok) {
      names = new Map(
        exerciseResult.value.exercises.map((exercise) => [
          exercise.id,
          exercise.name,
        ]),
      );
    }
  }

  const exercises = [...setCounts.entries()].flatMap(([id, setCount]) => {
    const name = names.get(id);
    return name === undefined ? [] : [{ name, setCount }];
  });

  const trained = sessions.length > 0 || activities.size > 0;
  // Without the run list, "no training" may just be a missed run.
  if (!trained && !runResult.ok) return null;
  return {
    // A finished session counts even when its sets or names could not be read.
    trained,
    input: { exercises, activities: [...activities] },
  };
};
