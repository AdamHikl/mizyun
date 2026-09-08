import type { ApiClient, ApiError } from "@mizyun/api-client";
import {
  exerciseCreateSchema,
  exerciseListResponseSchema,
  exerciseRecentSetsResponseSchema,
  exerciseResponseSchema,
  workoutCreateSchema,
  workoutListResponseSchema,
  workoutPatchSchema,
  workoutResponseSchema,
  workoutSetCreateSchema,
  workoutSetListResponseSchema,
  workoutSetResponseSchema,
  type Exercise,
  type ExerciseListResponse,
  type ExerciseRecentSetsResponse,
  type ExerciseResponse,
  type Workout,
  type WorkoutListResponse,
  type WorkoutResponse,
  type WorkoutSet,
  type WorkoutSetListResponse,
  type WorkoutSetResponse,
} from "@mizyun/contracts";

import { apiClient } from "@/composition/api-client";
import { displayWeightToKilograms } from "@/lib/weight-units";

export interface WorkoutWorkspace {
  readonly exercises: ReadonlyArray<Exercise>;
  readonly workout: Workout | null;
  readonly sets: ReadonlyArray<WorkoutSet>;
  readonly message: string | null;
}

export type WorkoutMutationResult =
  { readonly ok: true } | { readonly ok: false; readonly message: string };

export type AddWorkoutSetResult =
  | { readonly ok: true; readonly workoutSet: WorkoutSet }
  | { readonly ok: false; readonly message: string };

export type StartWorkoutResult =
  | { readonly ok: true; readonly workout: Workout }
  | { readonly ok: false; readonly message: string };

export type CreateExerciseResult =
  | { readonly ok: true; readonly exercise: Exercise }
  | { readonly ok: false; readonly message: string };

export interface WorkoutSetForm {
  readonly exerciseId: string;
  readonly repetitions: string;
  readonly load: string;
  readonly durationSeconds: string;
  readonly distanceMeters: string;
  readonly perceivedExertion: string;
  readonly unitSystem: "metric" | "imperial";
}

const humanize = (error: ApiError, action: string): string => {
  switch (error.kind) {
    case "session_expired":
      return "Your session expired. Sign in again.";
    case "network_error":
      return `Network unavailable. ${action} when you're online.`;
    case "http_error":
      if (error.status === 404) return "That workout record no longer exists.";
      if (error.status === 409)
        return "That set changed elsewhere. Refresh and retry.";
      if (error.status === 422)
        return "Please double-check the workout values.";
      return `The server could not ${action.toLowerCase()}. Try again.`;
    case "validation_error":
      return "Please double-check the workout values.";
    case "parse_error":
      return "The server returned an unexpected workout record.";
    case "not_configured":
      return "The API isn't configured yet.";
    case "no_session":
      return "You're signed out. Sign in and try again.";
  }
};

export const loadWorkoutWorkspace = async (
  targetWorkoutId?: string,
): Promise<WorkoutWorkspace> =>
  loadWorkoutWorkspaceWith(apiClient, targetWorkoutId);

export const loadWorkoutWorkspaceWith = async (
  client: ApiClient,
  targetWorkoutId?: string,
): Promise<WorkoutWorkspace> => {
  const [exerciseResult, workoutResult] = await Promise.all([
    client.request<ExerciseListResponse>({
      method: "GET",
      path: "/v1/exercises?limit=200",
      schema: exerciseListResponseSchema,
    }),
    client.request<WorkoutListResponse>({
      method: "GET",
      path: "/v1/workouts?limit=200",
      schema: workoutListResponseSchema,
    }),
  ]);
  if (!exerciseResult.ok) {
    return {
      exercises: [],
      workout: null,
      sets: [],
      message: humanize(exerciseResult.error, "Refresh your workout"),
    };
  }
  if (!workoutResult.ok) {
    return {
      exercises: [],
      workout: null,
      sets: [],
      message: humanize(workoutResult.error, "Refresh your workout"),
    };
  }
  let workout: Workout | null = null;
  if (
    typeof targetWorkoutId === "string" &&
    targetWorkoutId.trim().length > 0
  ) {
    const trimmedId = targetWorkoutId.trim();
    workout =
      workoutResult.value.workouts.find(
        (candidate) => candidate.id === trimmedId,
      ) ?? null;
    if (workout === null) {
      const singleWorkoutResult = await client.request<WorkoutResponse>({
        method: "GET",
        path: `/v1/workouts/${encodeURIComponent(trimmedId)}`,
        schema: workoutResponseSchema,
      });
      if (singleWorkoutResult.ok) {
        workout = singleWorkoutResult.value.workout;
      }
    }
  } else {
    const incomplete = workoutResult.value.workouts.filter(
      (candidate) => candidate.completedAt === null,
    );
    if (incomplete.length > 0) {
      const todayIso = new Date().toISOString().slice(0, 10);
      // Prefer workout matching today's startedAt date (YYYY-MM-DD),
      // otherwise pick the earliest incomplete workout (sorted by startedAt ascending)
      const matchingToday = incomplete.find(
        (candidate) => candidate.startedAt.slice(0, 10) === todayIso,
      );
      if (matchingToday !== undefined) {
        workout = matchingToday;
      } else {
        const sortedIncomplete = [...incomplete].sort(
          (a, b) =>
            new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
        );
        workout = sortedIncomplete[0] ?? null;
      }
    }
  }
  if (workout === null) {
    return {
      exercises: exerciseResult.value.exercises,
      workout: null,
      sets: [],
      message: null,
    };
  }
  const setsResult = await client.request<WorkoutSetListResponse>({
    method: "GET",
    path: `/v1/workouts/${encodeURIComponent(workout.id)}/sets`,
    schema: workoutSetListResponseSchema,
  });
  return {
    exercises: exerciseResult.value.exercises,
    workout,
    sets: setsResult.ok ? setsResult.value.workoutSets : [],
    message: setsResult.ok
      ? null
      : humanize(setsResult.error, "Refresh your sets"),
  };
};

export const startWorkout = async (
  name: string,
  notes: string,
  details?: Readonly<Record<string, unknown>>,
): Promise<StartWorkoutResult> =>
  startWorkoutWith(apiClient, name, notes, () => new Date(), details);

export const startWorkoutWith = async (
  client: ApiClient,
  name: string,
  notes: string,
  now: () => Date = () => new Date(),
  details?: Readonly<Record<string, unknown>>,
): Promise<StartWorkoutResult> => {
  const parsed = workoutCreateSchema.safeParse({
    name: name.trim(),
    startedAt: now().toISOString(),
    ...(notes.trim().length > 0 ? { notes: notes.trim() } : {}),
    ...(details === undefined ? {} : { details }),
  });
  if (!parsed.success) return { ok: false, message: "Name the workout first." };
  const result = await client.request<WorkoutResponse>({
    method: "POST",
    path: "/v1/workouts",
    body: parsed.data,
    schema: workoutResponseSchema,
  });
  return result.ok
    ? { ok: true, workout: result.value.workout }
    : { ok: false, message: humanize(result.error, "Start your workout") };
};

export const createExercise = async (
  name: string,
  instructions: string,
): Promise<CreateExerciseResult> =>
  createExerciseWith(apiClient, name, instructions);

export const createExerciseWith = async (
  client: ApiClient,
  name: string,
  instructions: string,
): Promise<CreateExerciseResult> => {
  const parsed = exerciseCreateSchema.safeParse({
    name: name.trim(),
    ...(instructions.trim().length > 0
      ? { instructions: instructions.trim() }
      : {}),
  });
  if (!parsed.success)
    return { ok: false, message: "Name the exercise first." };
  const result = await client.request<ExerciseResponse>({
    method: "POST",
    path: "/v1/exercises",
    body: parsed.data,
    schema: exerciseResponseSchema,
  });
  return result.ok
    ? { ok: true, exercise: result.value.exercise }
    : { ok: false, message: humanize(result.error, "Create the exercise") };
};

const optionalNumber = (raw: string): number | null | "invalid" => {
  if (raw.trim().length === 0) return null;
  const value = Number(raw.trim());
  return Number.isFinite(value) && value >= 0 ? value : "invalid";
};

export const addWorkoutSet = async (
  workoutId: string,
  form: WorkoutSetForm,
): Promise<AddWorkoutSetResult> =>
  addWorkoutSetWith(apiClient, workoutId, form);

export const addWorkoutSetWith = async (
  client: ApiClient,
  workoutId: string,
  form: WorkoutSetForm,
  now: () => Date = () => new Date(),
): Promise<AddWorkoutSetResult> => {
  const repetitions = optionalNumber(form.repetitions);
  const load = optionalNumber(form.load);
  const durationSeconds = optionalNumber(form.durationSeconds);
  const distanceMeters = optionalNumber(form.distanceMeters);
  const perceivedExertion = optionalNumber(form.perceivedExertion);
  if (
    [
      repetitions,
      load,
      durationSeconds,
      distanceMeters,
      perceivedExertion,
    ].some((value) => value === "invalid")
  ) {
    return {
      ok: false,
      message: "Set values must be valid non-negative numbers.",
    };
  }
  const parsed = workoutSetCreateSchema.safeParse({
    exerciseId: form.exerciseId,
    ...(typeof repetitions === "number" ? { repetitions } : {}),
    ...(typeof load === "number"
      ? { loadKg: displayWeightToKilograms(load, form.unitSystem) }
      : {}),
    ...(typeof durationSeconds === "number" ? { durationSeconds } : {}),
    ...(typeof distanceMeters === "number" ? { distanceMeters } : {}),
    ...(typeof perceivedExertion === "number" ? { perceivedExertion } : {}),
    completedAt: now().toISOString(),
  });
  if (!parsed.success) {
    return { ok: false, message: "Enter reps, load, duration, or distance." };
  }
  const result = await client.request<WorkoutSetResponse>({
    method: "POST",
    path: `/v1/workouts/${encodeURIComponent(workoutId)}/sets`,
    body: parsed.data,
    schema: workoutSetResponseSchema,
  });
  return result.ok
    ? { ok: true, workoutSet: result.value.workoutSet }
    : { ok: false, message: humanize(result.error, "Save that set") };
};

export const loadRecentPerformance = async (
  exerciseId: string,
  excludeWorkoutId?: string,
): Promise<ExerciseRecentSetsResponse | null> =>
  loadRecentPerformanceWith(apiClient, exerciseId, excludeWorkoutId);

export const loadRecentPerformanceWith = async (
  client: ApiClient,
  exerciseId: string,
  excludeWorkoutId?: string,
): Promise<ExerciseRecentSetsResponse | null> => {
  const exclude =
    excludeWorkoutId === undefined
      ? ""
      : `&excludeWorkoutId=${encodeURIComponent(excludeWorkoutId)}`;
  const result = await client.request<ExerciseRecentSetsResponse>({
    method: "GET",
    path: `/v1/exercises/${encodeURIComponent(exerciseId)}/recent-sets?limit=20${exclude}`,
    schema: exerciseRecentSetsResponseSchema,
  });
  return result.ok ? result.value : null;
};

export const completeWorkout = async (
  workoutId: string,
  workoutStartedAt?: string,
): Promise<WorkoutMutationResult> =>
  completeWorkoutWith(apiClient, workoutId, () => new Date(), workoutStartedAt);

export const completeWorkoutWith = async (
  client: ApiClient,
  workoutId: string,
  now: () => Date = () => new Date(),
  workoutStartedAt?: string,
): Promise<WorkoutMutationResult> => {
  const completionTime = now();
  const startedAtDate = workoutStartedAt ? new Date(workoutStartedAt) : null;
  const updateStartedAt =
    startedAtDate !== null &&
    !Number.isNaN(startedAtDate.getTime()) &&
    startedAtDate > completionTime
      ? completionTime.toISOString()
      : undefined;
  const body = workoutPatchSchema.parse({
    completedAt: completionTime.toISOString(),
    ...(updateStartedAt ? { startedAt: updateStartedAt } : {}),
  });
  const result = await client.request<WorkoutResponse>({
    method: "PUT",
    path: `/v1/workouts/${encodeURIComponent(workoutId)}`,
    body,
    schema: workoutResponseSchema,
  });
  return result.ok
    ? { ok: true }
    : { ok: false, message: humanize(result.error, "Complete your workout") };
};

export const deleteWorkoutSet = async (
  workoutId: string,
  setId: string,
): Promise<WorkoutMutationResult> =>
  deleteWorkoutSetWith(apiClient, workoutId, setId);

export const deleteWorkoutSetWith = async (
  client: ApiClient,
  workoutId: string,
  setId: string,
): Promise<WorkoutMutationResult> => {
  const result = await client.request<void>({
    method: "DELETE",
    path: `/v1/workouts/${encodeURIComponent(workoutId)}/sets/${encodeURIComponent(setId)}`,
  });
  return result.ok
    ? { ok: true }
    : { ok: false, message: humanize(result.error, "Delete that set") };
};

export const abandonWorkout = async (
  workoutId: string,
): Promise<WorkoutMutationResult> => abandonWorkoutWith(apiClient, workoutId);

export const abandonWorkoutWith = async (
  client: ApiClient,
  workoutId: string,
): Promise<WorkoutMutationResult> => {
  const result = await client.request<void>({
    method: "DELETE",
    path: `/v1/workouts/${encodeURIComponent(workoutId)}`,
  });
  return result.ok
    ? { ok: true }
    : { ok: false, message: humanize(result.error, "Delete that workout") };
};

/**
 * WO-UX-002 — Clone-on-complete routine preservation.
 *
 * When a workout that originated from a routine (has planned exercises
 * in `details.coachPlan`, `details.aiDraft`, or
 * `details.workoutProposal`) is finished, this function creates a fresh
 * "planned" workout with the same name, notes, and exercise template so
 * the routine stays available for re-use. Ad-hoc workouts (no planned
 * exercises) are silently skipped.
 */
export const cloneRoutineFromWorkout = async (
  workout: Workout,
): Promise<WorkoutMutationResult> =>
  cloneRoutineFromWorkoutWith(apiClient, workout);

export const cloneRoutineFromWorkoutWith = async (
  client: ApiClient,
  workout: Workout,
): Promise<WorkoutMutationResult> => {
  const details = workout.details;
  if (!details || typeof details !== "object") return { ok: true };

  // Preserve the original details blob (coachPlan, aiDraft, etc.) verbatim
  // so the cloned routine has the same structure the logger expects.
  const hasPlannedExercises = (() => {
    const d = details as Record<string, unknown>;

    const coachPlan = d.coachPlan;
    if (
      coachPlan &&
      typeof coachPlan === "object" &&
      Array.isArray((coachPlan as Record<string, unknown>).exercises) &&
      ((coachPlan as Record<string, unknown>).exercises as unknown[]).length > 0
    ) {
      return true;
    }

    const aiDraft = d.aiDraft;
    if (aiDraft && typeof aiDraft === "object") {
      const session = (aiDraft as Record<string, unknown>).session;
      if (
        session &&
        typeof session === "object" &&
        Array.isArray((session as Record<string, unknown>).exercises) &&
        ((session as Record<string, unknown>).exercises as unknown[]).length > 0
      ) {
        return true;
      }
    }

    const workoutProposal = d.workoutProposal;
    if (workoutProposal && typeof workoutProposal === "object") {
      const session = (workoutProposal as Record<string, unknown>).session;
      if (
        session &&
        typeof session === "object" &&
        Array.isArray((session as Record<string, unknown>).exercises) &&
        ((session as Record<string, unknown>).exercises as unknown[]).length > 0
      ) {
        return true;
      }
    }

    return false;
  })();

  if (!hasPlannedExercises) return { ok: true };

  const body = workoutCreateSchema.safeParse({
    name: workout.name,
    ...(workout.notes ? { notes: workout.notes } : {}),
    details,
  });

  if (!body.success) return { ok: true };

  const result = await client.request<WorkoutResponse>({
    method: "POST",
    path: "/v1/workouts",
    body: body.data,
    schema: workoutResponseSchema,
  });

  return result.ok
    ? { ok: true }
    : { ok: false, message: humanize(result.error, "Re-create routine") };
};
