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

export const loadWorkoutWorkspace = async (): Promise<WorkoutWorkspace> =>
  loadWorkoutWorkspaceWith(apiClient);

export const loadWorkoutWorkspaceWith = async (
  client: ApiClient,
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
  const workout = workoutResult.value.workouts.find(
    (candidate) => candidate.completedAt === null,
  );
  if (workout === undefined) {
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
): Promise<StartWorkoutResult> => startWorkoutWith(apiClient, name, notes);

export const startWorkoutWith = async (
  client: ApiClient,
  name: string,
  notes: string,
  now: () => Date = () => new Date(),
): Promise<StartWorkoutResult> => {
  const parsed = workoutCreateSchema.safeParse({
    name: name.trim(),
    startedAt: now().toISOString(),
    ...(notes.trim().length > 0 ? { notes: notes.trim() } : {}),
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
): Promise<WorkoutMutationResult> =>
  addWorkoutSetWith(apiClient, workoutId, form);

export const addWorkoutSetWith = async (
  client: ApiClient,
  workoutId: string,
  form: WorkoutSetForm,
  now: () => Date = () => new Date(),
): Promise<WorkoutMutationResult> => {
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
    ? { ok: true }
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
): Promise<WorkoutMutationResult> => completeWorkoutWith(apiClient, workoutId);

export const completeWorkoutWith = async (
  client: ApiClient,
  workoutId: string,
  now: () => Date = () => new Date(),
): Promise<WorkoutMutationResult> => {
  const body = workoutPatchSchema.parse({ completedAt: now().toISOString() });
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
