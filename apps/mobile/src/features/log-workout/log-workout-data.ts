import {
  workoutCreateSchema,
  workoutResponseSchema,
  type WorkoutCreate,
  type WorkoutResponse,
} from "@mizyun/contracts";

import type { ApiClient, ApiError } from "@mizyun/api-client";
import { apiClient } from "@/composition/api-client";
import type { Result } from "@mizyun/core";

/**
 * Pure submit reducer for the log-workout form. The screen wires
 * this to a "Save workout" button; on success we navigate back.
 */

export type LogWorkoutResult =
  | { readonly ok: true; readonly id: string }
  | { readonly ok: false; readonly message: string };

export interface LogWorkoutForm {
  readonly name: string;
  readonly notes: string | null;
  readonly startedAt: string;
}

const humanize = (result: Result<unknown, ApiError>): string => {
  if (!result.ok) {
    switch (result.error.kind) {
      case "session_expired":
        return "Your session expired. Sign in again.";
      case "network_error":
        return "Network unavailable. Try again when you're online.";
      case "http_error":
        if (result.error.status === 422) {
          return "Please double-check the values and try again.";
        }
        return "The server rejected the entry.";
      case "validation_error":
        return "Please double-check the values and try again.";
      case "not_configured":
        return "The API isn't configured yet.";
      case "no_session":
        return "You're signed out. Sign in and try again.";
      default:
        return "Could not save the workout.";
    }
  }
  return "Could not save the workout.";
};

export const submitLogWorkout = async (
  form: LogWorkoutForm,
): Promise<LogWorkoutResult> =>
  submitLogWorkoutWith(form, apiClient, () => new Date());

export const submitLogWorkoutWith = async (
  form: LogWorkoutForm,
  client: ApiClient,
  now: () => Date = () => new Date(),
): Promise<LogWorkoutResult> => {
  const trimmedName = form.name.trim();
  if (trimmedName.length === 0) {
    return { ok: false, message: "Name a workout first." };
  }
  const startedAt = form.startedAt;
  const completedAt = now().toISOString();
  const payload: WorkoutCreate = {
    name: trimmedName,
    startedAt,
    completedAt,
    ...(form.notes !== null && form.notes.trim().length > 0
      ? { notes: form.notes.trim() }
      : {}),
  };
  const parsed = workoutCreateSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Please double-check the values and try again.",
    };
  }
  const result = await client.request<WorkoutResponse>({
    method: "POST",
    path: "/v1/workouts",
    body: parsed.data,
    schema: workoutResponseSchema,
  });
  if (!result.ok) {
    return { ok: false, message: humanize(result) };
  }
  return { ok: true, id: result.value.workout.id };
};
