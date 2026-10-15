import * as Crypto from "expo-crypto";
import type { ApiClient } from "@mizyun/api-client";
import {
  workoutCreateSchema,
  workoutResponseSchema,
  type Workout,
  type WorkoutResponse,
} from "@mizyun/contracts";
import {
  detectRoutineSuggestion,
  hasRunningActivity,
  isRoutineDetails,
  readWorkoutLifecycle,
  withWorkoutLifecycle,
  type RoutineSuggestion,
} from "@mizyun/core";
import { markFirstPartyWorkout } from "@/features/health-exports";
import { apiClient } from "@/composition/api-client";
import { readPlannedSetTypes } from "./planned-set-types";
import {
  createCustomWorkout,
  isReusableRoutine,
  type PlannedExerciseItem,
  type ProcessedWorkout,
  type WorkoutActionMutationResult,
  type WorkoutsHubResult,
} from "./workouts-hub-data";

const normalizeName = (name: string): string => name.trim().toLowerCase();

const completedMs = (item: ProcessedWorkout): number =>
  Date.parse(item.workout.completedAt ?? item.workout.startedAt);

const exerciseCount = (item: ProcessedWorkout): number =>
  item.plannedExercises.length > 0
    ? item.plannedExercises.length
    : item.exerciseSummaries.length;

/** Most recent completed strength workout (routine session or one-time). */
export const findRepeatableWorkout = (
  completed: readonly ProcessedWorkout[],
): ProcessedWorkout | null => {
  const candidates = completed.filter(
    (item) =>
      item.workout.completedAt !== null &&
      !hasRunningActivity(item.workout.details) &&
      exerciseCount(item) > 0,
  );
  candidates.sort(
    (a, b) =>
      completedMs(b) - completedMs(a) ||
      b.workout.id.localeCompare(a.workout.id),
  );
  return candidates[0] ?? null;
};

export interface RepeatSeedExercise {
  readonly name: string;
  readonly catalogId?: string;
  readonly movementPattern?: string;
  readonly setTypes?: ReturnType<typeof readPlannedSetTypes>;
  readonly repsMin?: number;
  readonly repsMax?: number;
  readonly restSeconds?: number;
  readonly targetSets?: number;
}

export type RepeatPlan =
  | { readonly kind: "routine"; readonly routine: Workout }
  | {
      readonly kind: "seed";
      readonly name: string;
      readonly oneTime: boolean;
      readonly exercises: readonly RepeatSeedExercise[];
    };

const parseReps = (
  targetReps: string | undefined,
): { repsMin?: number; repsMax?: number } => {
  if (targetReps === undefined) return {};
  const range = /^(\d{1,3})\s*-\s*(\d{1,3})$/.exec(targetReps.trim());
  if (range) return { repsMin: Number(range[1]), repsMax: Number(range[2]) };
  const single = /^(\d{1,3})$/.exec(targetReps.trim());
  return single
    ? { repsMin: Number(single[1]), repsMax: Number(single[1]) }
    : {};
};

/**
 * Decide how "Repeat" starts. A session copied from a routine that still
 * exists simply starts that routine again so its current targets apply.
 * Otherwise the same exercises, in the same order, seed a new session. Loads
 * are never copied: the logger derives them from current progression.
 */
export const planRepeat = (
  source: ProcessedWorkout,
  routines: readonly ProcessedWorkout[],
): RepeatPlan => {
  const lifecycle = readWorkoutLifecycle(source.workout.details);
  if (lifecycle?.kind === "session" && lifecycle.routineId !== undefined) {
    const routine = routines.find(
      (item) =>
        item.workout.id === lifecycle.routineId &&
        isReusableRoutine(item.workout),
    );
    if (routine) return { kind: "routine", routine: routine.workout };
  }
  const oneTime = source.workout.details.sessionMode === "one_time";
  const planned: readonly PlannedExerciseItem[] =
    source.plannedExercises.length > 0
      ? source.plannedExercises
      : source.exerciseSummaries.map((summary) => ({
          name: summary.exerciseName,
        }));
  return {
    kind: "seed",
    name: source.workout.name,
    oneTime,
    exercises: planned.map((exercise) => {
      const setTypes = readPlannedSetTypes(exercise.setTypes);
      return {
        name: exercise.name,
        ...(exercise.catalogId ? { catalogId: exercise.catalogId } : {}),
        ...(exercise.movementPattern
          ? { movementPattern: exercise.movementPattern }
          : {}),
        ...(setTypes ? { setTypes } : {}),
        ...parseReps(exercise.targetReps),
        ...(exercise.restSeconds !== undefined
          ? { restSeconds: exercise.restSeconds }
          : {}),
        ...(!oneTime && exercise.targetSets !== undefined
          ? { targetSets: exercise.targetSets }
          : {}),
      };
    }),
  };
};

/** Create a live session pre-filled with the previous workout's exercises. */
export const startRepeatSessionWith = async (
  client: ApiClient,
  plan: Extract<RepeatPlan, { kind: "seed" }>,
  clientOperationId?: string,
  now?: Date,
): Promise<WorkoutActionMutationResult> => {
  const base = {
    ...(plan.oneTime ? { sessionMode: "one_time" } : {}),
    sessionExercises: plan.exercises.map((exercise) => ({ ...exercise })),
  };
  const parsed = workoutCreateSchema.safeParse({
    clientOperationId: clientOperationId ?? Crypto.randomUUID(),
    name: plan.name.trim() || "One-time Workout",
    ...(now ? { startedAt: now.toISOString() } : {}),
    details: withWorkoutLifecycle(markFirstPartyWorkout(base), {
      kind: "session",
    }),
  });
  if (!parsed.success) {
    return { ok: false, message: "Invalid workout details." };
  }
  const result = await client.request<WorkoutResponse>({
    method: "POST",
    path: "/v1/workouts",
    body: parsed.data,
    schema: workoutResponseSchema,
  });
  return result.ok
    ? { ok: true, workout: result.value.workout }
    : { ok: false, message: "The workout could not be started. Try again." };
};

export const startRepeatSession = (
  plan: Extract<RepeatPlan, { kind: "seed" }>,
  clientOperationId?: string,
): Promise<WorkoutActionMutationResult> =>
  startRepeatSessionWith(apiClient, plan, clientOperationId);

export const repeatLabel = (source: ProcessedWorkout): string => {
  const name = source.workout.name.trim();
  return name.length === 0 || /^one-time workout$/i.test(name)
    ? "Repeat last workout"
    : `Repeat ${name}`;
};

// ---- Save-as-routine suggestion ------------------------------------------

export interface ResolvedRoutineSuggestion {
  readonly suggestion: RoutineSuggestion;
  readonly name: string;
  readonly exercises: readonly PlannedExerciseItem[];
}

const FALLBACK_EXERCISE_NAME = "Custom Exercise";

/**
 * Exercise names as stored on the workout record itself, so identity does not
 * depend on the (paged) exercise list. A routine created from a suggestion
 * persists the same names, so the round trip yields the same keys.
 */
const sessionExerciseNames = (item: ProcessedWorkout): string[] =>
  item.plannedExercises.length > 0
    ? item.plannedExercises.map((exercise) => exercise.name)
    : item.exerciseSummaries.map((summary) => summary.exerciseName);

const exerciseKeys = (names: readonly string[]): string[] =>
  names.map((name) => `name:${normalizeName(name)}`);

/**
 * Detect a repeated one-time exercise set that is not already a routine.
 * Identity is the normalized exercise name taken from each workout record
 * (exercise ids are not stored on routines). Names are not guaranteed unique,
 * so two distinct exercises sharing a name are treated as one.
 */
export const deriveRoutineSuggestion = (
  data: Pick<WorkoutsHubResult, "completed" | "activeAndPlanned">,
  now: Date,
  isDismissed?: (signature: string) => boolean,
): ResolvedRoutineSuggestion | null => {
  const oneTime = data.completed.filter(
    (item) =>
      item.workout.details.sessionMode === "one_time" &&
      item.workout.completedAt !== null,
  );
  const suggestion = detectRoutineSuggestion({
    sessions: oneTime.map((item) => ({
      id: item.workout.id,
      completedAt: item.workout.completedAt,
      exerciseKeys: exerciseKeys(sessionExerciseNames(item)),
    })),
    existingRoutines: data.activeAndPlanned
      .filter(
        (item) =>
          isRoutineDetails(item.workout.details) ||
          isReusableRoutine(item.workout),
      )
      .map((item) => ({
        exerciseKeys: exerciseKeys(item.plannedExercises.map((e) => e.name)),
      })),
    now,
    ...(isDismissed ? { isDismissed } : {}),
  });
  if (suggestion === null) return null;
  const latest = oneTime.find(
    (item) => item.workout.id === suggestion.latestSessionId,
  );
  if (!latest) return null;
  const setCounts = new Map(
    latest.exerciseSummaries.map((summary) => [
      normalizeName(summary.exerciseName),
      summary.setCount,
    ]),
  );
  const seen = new Set<string>();
  const exercises: PlannedExerciseItem[] = [];
  const source: readonly PlannedExerciseItem[] =
    latest.plannedExercises.length > 0
      ? latest.plannedExercises
      : latest.exerciseSummaries.map((s) => ({ name: s.exerciseName }));
  for (const planned of source) {
    const key = normalizeName(planned.name);
    if (seen.has(key)) continue;
    seen.add(key);
    exercises.push({
      name: planned.name,
      ...(planned.catalogId ? { catalogId: planned.catalogId } : {}),
      ...(planned.movementPattern
        ? { movementPattern: planned.movementPattern }
        : {}),
      targetSets: Math.min(10, Math.max(1, setCounts.get(key) ?? 3)),
      ...(planned.targetReps ? { targetReps: planned.targetReps } : {}),
      ...(planned.restSeconds !== undefined
        ? { restSeconds: planned.restSeconds }
        : {}),
    });
  }
  if (
    exercises.length < 2 ||
    exercises.some((e) => e.name === FALLBACK_EXERCISE_NAME)
  )
    return null;
  const names = exercises.map((e) => e.name);
  const name =
    names.length <= 3
      ? names.join(" + ")
      : `${names.slice(0, 3).join(" + ")} +${names.length - 3}`;
  return { suggestion, name: name.slice(0, 120), exercises };
};

/** Explicit user action only: creates a routine via the normal routine path. */
export const saveSuggestedRoutine = (
  resolved: ResolvedRoutineSuggestion,
  clientOperationId?: string,
  client: ApiClient = apiClient,
): Promise<WorkoutActionMutationResult> =>
  createCustomWorkout(
    {
      name: resolved.name,
      plannedExercises: resolved.exercises,
      clientOperationId: clientOperationId ?? Crypto.randomUUID(),
    },
    client,
  );
