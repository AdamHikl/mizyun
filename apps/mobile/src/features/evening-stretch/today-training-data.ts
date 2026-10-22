import type { ApiClient } from "@mizyun/api-client";
import {
  exerciseListResponseSchema,
  workoutListResponseSchema,
  type Exercise,
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
  resolveExerciseTrackingMode,
  type StretchActivity,
  type StretchSessionExerciseInput,
  type StretchSessionInput,
} from "@mizyun/core";

import { apiClient } from "@/composition/api-client";
import { listBoulderSessions } from "@/features/bouldering/public-data";
import { listRuns } from "@/features/running/public-data";
import { isoLocalDate } from "./evening-stretch-reminder";

export interface TodayTraining {
  readonly trained: boolean;
  readonly input: StretchSessionInput;
}

const isToday = (instant: string | null, today: string): boolean =>
  instant !== null && isoLocalDate(new Date(instant)) === today;

/** Bouldering sessions read per day; more than this in one day is not expected. */
const BOULDER_SESSION_LIMIT = 20;

/**
 * Today's finished training as stretch-session input: strength sessions,
 * timed activities from Log activity, runs and bouldering sessions (the
 * last two have their own APIs and are left out of the workout list).
 * Exercises keep their workout as `session` so each one is represented.
 * Returns null when the workout list cannot be read, so callers leave any
 * reminder unchanged.
 */
export const fetchTodayTraining = async (
  client: ApiClient = apiClient,
  now: Date = new Date(),
): Promise<TodayTraining | null> => {
  const today = isoLocalDate(now);

  const [workoutResult, runResult, boulderResult] = await Promise.all([
    client.request<WorkoutListResponse>({
      method: "GET",
      path: "/v1/workouts?limit=200",
      schema: workoutListResponseSchema,
    }),
    listRuns(client, { from: today, to: today }),
    listBoulderSessions(client, { limit: BOULDER_SESSION_LIMIT }).catch(
      () => null,
    ),
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
  // Where bouldering is turned off there are no sessions to miss.
  const boulderOk =
    boulderResult !== null &&
    (boulderResult.ok || boulderResult.error.kind === "disabled");
  if (
    boulderResult?.ok &&
    boulderResult.value.sessions.some((session) =>
      isToday(session.completedAt, today),
    )
  ) {
    activities.add("bouldering");
  }
  const sessions: Workout[] = [];
  for (const workout of finished) {
    if (hasRunningActivity(workout.details)) activities.add("running");
    else if (hasBoulderingActivity(workout.details))
      activities.add("bouldering");
    else sessions.push(workout);
  }

  // Completed sets per workout and exercise.
  const setCounts = new Map<
    string,
    { session: string; exerciseId: string; count: number }
  >();
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
    setResults.forEach((result, index) => {
      const session = sessions[index]!.id;
      if (!result.ok) return;
      for (const set of result.value.workoutSets) {
        if (set.completedAt === null) continue;
        const key = `${session}\u0000${set.exerciseId}`;
        const entry = setCounts.get(key) ?? {
          session,
          exerciseId: set.exerciseId,
          count: 0,
        };
        entry.count++;
        setCounts.set(key, entry);
      }
    });
  }

  let saved = new Map<string, Exercise>();
  if (setCounts.size > 0) {
    const exerciseResult = await client.request<ExerciseListResponse>({
      method: "GET",
      path: "/v1/exercises?limit=200",
      schema: exerciseListResponseSchema,
    });
    if (exerciseResult.ok) {
      saved = new Map(
        exerciseResult.value.exercises.map((exercise) => [
          exercise.id,
          exercise,
        ]),
      );
    }
  }

  const exercises = [...setCounts.values()].flatMap(
    ({ session, exerciseId, count }): StretchSessionExerciseInput[] => {
      const exercise = saved.get(exerciseId);
      if (exercise === undefined) return [];
      const catalogId = exercise.metadata?.catalogId;
      // Log activity saves timed activities (catalog or typed) as one set.
      const timed = resolveExerciseTrackingMode(exercise) !== "load_reps";
      return [
        {
          name: exercise.name,
          setCount: count,
          session,
          ...(typeof catalogId === "string" && catalogId !== ""
            ? { catalogId }
            : {}),
          ...(timed ? { timed: true } : {}),
        },
      ];
    },
  );

  const trained = sessions.length > 0 || activities.size > 0;
  // Without the run or bouldering list, "no training" may be a missed one.
  if (!trained && (!runResult.ok || !boulderOk)) return null;
  return {
    // A finished session counts even when its sets or names could not be read.
    trained,
    input: { exercises, activities: [...activities] },
  };
};
