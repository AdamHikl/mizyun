import type { ApiClient, ApiError } from "@mizyun/api-client";
import {
  customExerciseMetadata,
  type NormalizedCustomExercise,
} from "@mizyun/core";
import {
  exerciseListResponseSchema,
  exerciseRecentSetsResponseSchema,
  exerciseResponseSchema,
  type Exercise,
  type ExerciseListResponse,
  type ExerciseRecentSetsResponse,
  type ExerciseResponse,
} from "@mizyun/contracts";

import { apiClient } from "@/composition/api-client";

/** The exercises API returns at most this many rows, with no cursor. */
export const SAVED_EXERCISE_LIMIT = 200;

export type SavedExercisesResult =
  | {
      readonly ok: true;
      readonly exercises: ReadonlyArray<Exercise>;
      /** The list hit the API cap, so some records may be missing. */
      readonly truncated: boolean;
    }
  | { readonly ok: false; readonly message: string };

export type CustomExerciseSaveResult =
  | { readonly ok: true; readonly exercise: Exercise }
  | { readonly ok: false; readonly message: string };

export type CustomExerciseDeleteResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly inUse: boolean; readonly message: string };

export type ExerciseUsageResult =
  | { readonly ok: true; readonly hasLoggedSets: boolean }
  | { readonly ok: false };

const humanize = (error: ApiError, action: string): string => {
  switch (error.kind) {
    case "session_expired":
      return "Your session expired. Sign in again.";
    case "no_session":
      return "You're signed out. Sign in and try again.";
    case "network_error":
      return `Network unavailable. ${action} when you're online.`;
    case "http_error":
      if (error.status === 404) return "That exercise no longer exists.";
      if (error.status === 422) return "Please double-check the exercise.";
      return `Could not ${action.toLowerCase()}. Try again.`;
    default:
      return `Could not ${action.toLowerCase()}. Try again.`;
  }
};

export const loadSavedExercises = (
  client: ApiClient = apiClient,
): Promise<SavedExercisesResult> =>
  client
    .request<ExerciseListResponse>({
      method: "GET",
      path: `/v1/exercises?limit=${SAVED_EXERCISE_LIMIT}`,
      schema: exerciseListResponseSchema,
    })
    .then((result) =>
      result.ok
        ? {
            ok: true,
            exercises: result.value.exercises,
            truncated: result.value.exercises.length >= SAVED_EXERCISE_LIMIT,
          }
        : {
            ok: false,
            message: humanize(result.error, "Load your exercises"),
          },
    );

export const createCustomExercise = async (
  value: NormalizedCustomExercise,
  client: ApiClient = apiClient,
): Promise<CustomExerciseSaveResult> => {
  const result = await client.request<ExerciseResponse>({
    method: "POST",
    path: "/v1/exercises",
    body: {
      name: value.name,
      ...(value.instructions !== null
        ? { instructions: value.instructions }
        : {}),
      metadata: customExerciseMetadata(value.trackingMode),
    },
    schema: exerciseResponseSchema,
  });
  return result.ok
    ? { ok: true, exercise: result.value.exercise }
    : { ok: false, message: humanize(result.error, "Create the exercise") };
};

/**
 * Re-reads the record before writing, so metadata saved elsewhere since
 * the library loaded (for example a target load) is kept, and an earlier
 * name is remembered for routines that plan the exercise by name.
 */
export const updateCustomExercise = async (
  exercise: Exercise,
  value: NormalizedCustomExercise,
  client: ApiClient = apiClient,
): Promise<CustomExerciseSaveResult> => {
  const path = `/v1/exercises/${encodeURIComponent(exercise.id)}`;
  const current = await client.request<ExerciseResponse>({
    method: "GET",
    path,
    schema: exerciseResponseSchema,
  });
  if (!current.ok) {
    return { ok: false, message: humanize(current.error, "Save the exercise") };
  }
  const fresh = current.value.exercise;
  const result = await client.request<ExerciseResponse>({
    method: "PUT",
    path,
    body: {
      name: value.name,
      instructions: value.instructions,
      metadata: customExerciseMetadata(value.trackingMode, fresh.metadata, {
        from: fresh.name,
        to: value.name,
      }),
    },
    schema: exerciseResponseSchema,
  });
  if (result.ok) return { ok: true, exercise: result.value.exercise };
  if (result.error.kind === "http_error" && result.error.status === 409) {
    return {
      ok: false,
      message:
        "This exercise has logged sets, so its tracking type can't change.",
    };
  }
  return { ok: false, message: humanize(result.error, "Save the exercise") };
};

export const deleteCustomExercise = async (
  exerciseId: string,
  client: ApiClient = apiClient,
): Promise<CustomExerciseDeleteResult> => {
  const result = await client.request<void>({
    method: "DELETE",
    path: `/v1/exercises/${encodeURIComponent(exerciseId)}`,
  });
  if (result.ok) return { ok: true };
  const inUse =
    result.error.kind === "http_error" && result.error.status === 409;
  return {
    ok: false,
    inUse,
    message: inUse
      ? "This exercise has logged sets, so it stays to keep your history."
      : humanize(result.error, "Delete the exercise"),
  };
};

/** Whether any set (finished or in progress) references the exercise. */
export const loadExerciseUsage = async (
  exerciseId: string,
  client: ApiClient = apiClient,
): Promise<ExerciseUsageResult> => {
  const result = await client.request<ExerciseRecentSetsResponse>({
    method: "GET",
    path: `/v1/exercises/${encodeURIComponent(exerciseId)}/recent-sets?limit=1`,
    schema: exerciseRecentSetsResponseSchema,
  });
  return result.ok
    ? {
        ok: true,
        hasLoggedSets:
          result.value.sets.length > 0 ||
          result.value.summary.totalSetCount > 0,
      }
    : { ok: false };
};
