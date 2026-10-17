import type { ApiClient, ApiError } from "@mizyun/api-client";
import {
  exerciseCreateSchema,
  runResponseSchema,
  type RunCreate,
  type RunResponse,
  exerciseListResponseSchema,
  exerciseResponseSchema,
  workoutCreateSchema,
  workoutResponseSchema,
  workoutSetCreateSchema,
  workoutSetListResponseSchema,
  workoutSetResponseSchema,
  type Exercise,
  type ExerciseListResponse,
  type ExerciseResponse,
  type Workout,
  type WorkoutResponse,
  type WorkoutSetListResponse,
  type WorkoutSetResponse,
} from "@mizyun/contracts";
import {
  getCatalogExerciseNames,
  getCatalogTrackingMode,
  resolveExerciseTrackingMode,
  withWorkoutLifecycle,
  type CatalogExercise,
} from "@mizyun/core";

import { findCatalogExerciseRecord } from "@/features/workouts/catalog-exercise-record";

/** Page size used to list saved exercises; a full page may be truncated. */
export const EXERCISE_LIST_LIMIT = 200;

/** An activity typed by the user that is not in the catalog. */
export interface CustomActivity {
  readonly custom: true;
  readonly name: string;
}

export const isCustomActivity = (
  activity: CatalogExercise | CustomActivity,
): activity is CustomActivity => "custom" in activity;

/**
 * One finished timed activity. The operation ID and both instants are fixed
 * when the first save starts so every retry sends an identical workout body
 * (the API rejects a reused operation ID with a different payload).
 */
export interface LogActivityPlan {
  /** The account the plan was made for; a retry under another is refused. */
  readonly ownerId: string;
  readonly operationId: string;
  readonly activity: CatalogExercise | CustomActivity;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationSeconds: number;
  readonly distanceMeters: number | null;
  readonly notes: string;
}

export type LogActivityResult =
  | { readonly ok: true; readonly workout: Workout }
  | {
      readonly ok: false;
      readonly message: string;
      /**
       * Whether the workout create was sent for this attempt. When it was
       * not, nothing reached the server and the form can be edited again.
       */
      readonly workoutRequested: boolean;
      /** False when resending the same plan cannot succeed. */
      readonly retryable: boolean;
    };

const RETRY = "Nothing was duplicated. Retry to finish saving.";

const describe = (error: ApiError, action: string): string => {
  switch (error.kind) {
    case "session_expired":
    case "no_session":
      return `Your session expired. Sign in again, then retry. ${RETRY}`;
    case "context_changed":
      return `This request is no longer current. Retry. ${RETRY}`;
    case "network_error":
      return `Network unavailable. ${action} when you're online. ${RETRY}`;
    case "http_error":
      if (error.status === 409)
        return `The server already has a different activity for this save. Close this sheet and check your workouts.`;
      if (error.status === 422)
        return "Please double-check the activity values.";
      return `The server could not ${action.toLowerCase()}. ${RETRY}`;
    case "validation_error":
      return "Please double-check the activity values.";
    case "parse_error":
      return `The server returned an unexpected record. ${RETRY}`;
    case "not_configured":
      return "The API isn't configured yet.";
  }
};

const NOT_RETRYABLE = new Set(["validation_error", "not_configured"]);

const isRetryable = (error: ApiError): boolean =>
  !NOT_RETRYABLE.has(error.kind) &&
  !(
    error.kind === "http_error" &&
    (error.status === 409 || error.status === 422)
  );

const failure = (
  message: string,
  workoutRequested: boolean,
  retryable: boolean,
): Exclude<LogActivityResult, { ok: true }> => ({
  ok: false,
  message,
  workoutRequested,
  retryable,
});

const instructionsFor = (activity: CatalogExercise): string =>
  activity.instructions
    .map((step, index) => `${index + 1}. ${step}`)
    .join("\n");

type ExerciseOutcome =
  | { readonly ok: true; readonly exercise: Exercise }
  | { readonly ok: false; readonly message: string };

/**
 * Find the saved exercise for a catalog activity or create it. Fails closed
 * when the saved list may be truncated or several records match, so history
 * is never split across duplicates.
 */
export const resolveActivityExerciseWith = async (
  client: ApiClient,
  activity: CatalogExercise,
): Promise<ExerciseOutcome> => {
  const listed = await client.request<ExerciseListResponse>({
    method: "GET",
    path: `/v1/exercises?limit=${EXERCISE_LIST_LIMIT}`,
    schema: exerciseListResponseSchema,
  });
  if (!listed.ok) {
    return {
      ok: false,
      message: describe(listed.error, "Load your exercises"),
    };
  }
  const saved = listed.value.exercises;
  const match = findCatalogExerciseRecord(saved, activity);
  if (match) {
    // A record changed to sets and reps must not gain a timed set.
    if (resolveExerciseTrackingMode(match) === "load_reps") {
      return {
        ok: false,
        message: `Your saved ${activity.name} exercise is logged with sets and reps. Use Log workout for it.`,
      };
    }
    return { ok: true, exercise: match };
  }
  const known = new Set(
    getCatalogExerciseNames(activity).map((name) => name.trim().toLowerCase()),
  );
  if (saved.some((exercise) => known.has(exercise.name.trim().toLowerCase()))) {
    return {
      ok: false,
      message: `Multiple saved exercises match ${activity.name}. Open the existing exercise in Log workout to keep its history.`,
    };
  }
  if (saved.length >= EXERCISE_LIST_LIMIT) {
    return {
      ok: false,
      message: `Your saved exercise list may be incomplete. Open the existing ${activity.name} exercise in Log workout before logging it here.`,
    };
  }
  const body = exerciseCreateSchema.safeParse({
    name: activity.name.trim(),
    instructions: instructionsFor(activity),
    metadata: {
      catalogId: activity.id,
      trackingMode: getCatalogTrackingMode(activity),
    },
  });
  if (!body.success) {
    return { ok: false, message: "Please double-check the activity values." };
  }
  const created = await client.request<ExerciseResponse>({
    method: "POST",
    path: "/v1/exercises",
    body: body.data,
    schema: exerciseResponseSchema,
  });
  return created.ok
    ? { ok: true, exercise: created.value.exercise }
    : {
        ok: false,
        message: describe(created.error, "Create the exercise"),
      };
};

/**
 * Find the saved exercise named like a custom activity or create it. Fails
 * closed when the list may be truncated or several records share the name.
 */
export const resolveCustomExerciseWith = async (
  client: ApiClient,
  activity: CustomActivity,
): Promise<ExerciseOutcome> => {
  const listed = await client.request<ExerciseListResponse>({
    method: "GET",
    path: `/v1/exercises?limit=${EXERCISE_LIST_LIMIT}`,
    schema: exerciseListResponseSchema,
  });
  if (!listed.ok) {
    return {
      ok: false,
      message: describe(listed.error, "Load your exercises"),
    };
  }
  const name = activity.name.trim();
  const key = name.toLowerCase();
  const saved = listed.value.exercises;
  const matches = saved.filter(
    (exercise) => exercise.name.trim().toLowerCase() === key,
  );
  if (matches.length === 1 && matches[0]) {
    // A sets-and-reps exercise must not gain a duration/distance set.
    if (resolveExerciseTrackingMode(matches[0]) === "load_reps") {
      return {
        ok: false,
        message: `Your saved ${name} exercise is logged with sets and reps. Use Log workout for it, or choose another name.`,
      };
    }
    return { ok: true, exercise: matches[0] };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      message: `Multiple saved exercises are named ${name}. Open the one you use in Log workout to keep its history.`,
    };
  }
  if (saved.length >= EXERCISE_LIST_LIMIT) {
    return {
      ok: false,
      message: `Your saved exercise list may be incomplete. Open the existing ${name} exercise in Log workout before logging it here.`,
    };
  }
  const body = exerciseCreateSchema.safeParse({
    name,
    metadata: { trackingMode: "duration_distance" },
  });
  if (!body.success) {
    return { ok: false, message: "Please double-check the activity name." };
  }
  const created = await client.request<ExerciseResponse>({
    method: "POST",
    path: "/v1/exercises",
    body: body.data,
    schema: exerciseResponseSchema,
  });
  return created.ok
    ? { ok: true, exercise: created.value.exercise }
    : {
        ok: false,
        message: describe(created.error, "Create the exercise"),
      };
};

/** A finished run; the operation ID inside the body makes retries safe. */
export interface LogRunPlan {
  readonly ownerId: string;
  readonly body: RunCreate;
}

/**
 * Save a run through the runs API. Resending the same body after a failure
 * or lost response returns the run already created for its operation ID.
 */
export const saveLoggedRunWith = async (
  client: ApiClient,
  plan: LogRunPlan,
): Promise<
  { readonly ok: true } | Exclude<LogActivityResult, { ok: true }>
> => {
  const created = await client.request<RunResponse>({
    method: "POST",
    path: "/v1/runs",
    body: plan.body,
    schema: runResponseSchema,
  });
  if (created.ok) return { ok: true };
  const message =
    created.error.kind === "http_error" && created.error.status === 409
      ? "The server already has a different run for this save. Close this sheet and check your runs."
      : describe(created.error, "Save your run").replaceAll("activity", "run");
  return failure(message, true, isRetryable(created.error));
};

/**
 * Save a finished timed activity as a completed workout with one set.
 * Safe to call again with the same plan after any failure or lost response:
 * the workout is deduplicated by operation ID, the exercise is looked up by
 * name, and the set is skipped when the workout already has one.
 */
export const saveLoggedActivityWith = async (
  client: ApiClient,
  plan: LogActivityPlan,
): Promise<LogActivityResult> => {
  const exercise = isCustomActivity(plan.activity)
    ? await resolveCustomExerciseWith(client, plan.activity)
    : await resolveActivityExerciseWith(client, plan.activity);
  // Nothing was sent yet, so the user can change the details and try again.
  if (!exercise.ok) return failure(exercise.message, false, true);

  const notes = plan.notes.trim();
  const body = workoutCreateSchema.safeParse({
    clientOperationId: plan.operationId,
    name: plan.activity.name,
    startedAt: plan.startedAt,
    completedAt: plan.completedAt,
    ...(notes.length > 0 ? { notes } : {}),
    // No first-party Health export marker: the native writers would export
    // this as strength training with an estimated start time (ADR-0068).
    details: withWorkoutLifecycle({}, { kind: "session" }),
  });
  if (!body.success) {
    return failure("Please double-check the activity values.", false, false);
  }
  const created = await client.request<WorkoutResponse>({
    method: "POST",
    path: "/v1/workouts",
    body: body.data,
    schema: workoutResponseSchema,
  });
  if (!created.ok) {
    return failure(
      describe(created.error, "Save your activity"),
      true,
      isRetryable(created.error),
    );
  }
  const workout = created.value.workout;
  const setsPath = `/v1/workouts/${encodeURIComponent(workout.id)}/sets`;

  const existing = await client.request<WorkoutSetListResponse>({
    method: "GET",
    path: setsPath,
    schema: workoutSetListResponseSchema,
  });
  const partial = `Your ${plan.activity.name} workout was saved without its time.`;
  if (!existing.ok) {
    return failure(
      `${partial} ${describe(existing.error, "Check your activity")}`,
      true,
      isRetryable(existing.error),
    );
  }
  if (existing.value.workoutSets.length > 0) return { ok: true, workout };

  const set = workoutSetCreateSchema.safeParse({
    exerciseId: exercise.exercise.id,
    durationSeconds: plan.durationSeconds,
    ...(plan.distanceMeters !== null
      ? { distanceMeters: plan.distanceMeters }
      : {}),
    completedAt: plan.completedAt,
  });
  if (!set.success) {
    return failure(
      `${partial} Delete it from Workouts and log the activity again.`,
      true,
      false,
    );
  }
  const added = await client.request<WorkoutSetResponse>({
    method: "POST",
    path: setsPath,
    body: set.data,
    schema: workoutSetResponseSchema,
  });
  return added.ok
    ? { ok: true, workout }
    : failure(
        `${partial} ${describe(added.error, "Save your activity")}`,
        true,
        isRetryable(added.error),
      );
};
