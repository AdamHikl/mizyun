import {
  captureHealthExportOwner,
  exportSavedWorkout,
  deleteHealthExport,
  markFirstPartyWorkout,
} from "@/features/health-exports";
import type { ApiClient, ApiError, RequestOptions } from "@mizyun/api-client";
import * as Crypto from "expo-crypto";
import { runListBaseQuery } from "@/features/running/run-list-query";
import {
  type Result,
  isRoutineDetails,
  isSessionDetails,
  readWorkoutLifecycle,
  withWorkoutLifecycle,
  type WorkoutLifecycle,
} from "@mizyun/core";
import {
  runListResponseSchema,
  type RunListResponse,
  exerciseListResponseSchema,
  workoutCreateSchema,
  workoutListResponseSchema,
  workoutPatchSchema,
  workoutResponseSchema,
  workoutSetListResponseSchema,
  type Exercise,
  type ExerciseListResponse,
  type Workout,
  type RunRecord,
  type WorkoutListResponse,
  type WorkoutSet,
  type WorkoutSetType,
  type WorkoutSetListResponse,
  type WorkoutResponse,
} from "@mizyun/contracts";

import {
  runningDate,
  hasBoulderingActivity,
  hasRunningActivity,
} from "@mizyun/core";
import type { BoulderSessionRecord } from "@mizyun/contracts";
import { listBoulderSessions } from "@/features/bouldering/public-data";

import { apiClient, peekSessionRead } from "@/composition/api-client";
import { savedDisplayTime } from "@/composition/personal-read-events";
import type { AuthSession } from "@mizyun/identity";
import { readPlannedSetTypes } from "./planned-set-types";

export interface PlannedExerciseItem {
  readonly name: string;
  readonly catalogId?: string;
  readonly movementPattern?: string;
  readonly targetSets?: number;
  readonly setTypes?: readonly WorkoutSetType[];
  readonly targetReps?: string;
  readonly targetLoad?: string;
  readonly restSeconds?: number;
  readonly notes?: string;
}

export interface WorkoutExerciseSummary {
  readonly exerciseId: string;
  readonly exerciseName: string;
  readonly setCount: number;
  readonly topLoadKg: number | null;
}

export type WorkoutStatus = "planned" | "in_progress" | "completed";

export interface ProcessedWorkout {
  readonly workout: Workout;
  readonly status: WorkoutStatus;
  readonly displayDate: string;
  readonly plannedExercises: ReadonlyArray<PlannedExerciseItem>;
  readonly sets: ReadonlyArray<WorkoutSet>;
  readonly completedSetCount: number;
  readonly totalVolumeKg: number;
  readonly exerciseSummaries: ReadonlyArray<WorkoutExerciseSummary>;
  readonly durationMinutes: number | null;
}

export interface WorkoutsHubResult {
  readonly activeAndPlanned: ReadonlyArray<ProcessedWorkout>;
  readonly completed: ReadonlyArray<ProcessedWorkout>;
  readonly exercises: ReadonlyArray<Exercise>;
  readonly message: string | null;
  readonly runs?: readonly RunRecord[];
  readonly runsNextCursor?: string | null;
  readonly weeklyRuns?: readonly RunRecord[];
  readonly runWeek?: { from: string; to: string; incomplete: boolean };
  /** Finished indoor bouldering sessions (ADR-0066), newest first. */
  readonly boulderSessions?: readonly BoulderSessionRecord[];
  /**
   * When any part came from the snapshot saved on this device (offline, or
   * revalidating after a write without a server answer): its oldest save time.
   */
  readonly savedAt?: number;
}

export interface CreateWorkoutPayload {
  readonly name: string;
  readonly notes?: string | null;
  readonly startedAt?: string;
  /** Idempotency key so a retried create cannot duplicate the routine. */
  readonly clientOperationId?: string;
  readonly plannedExercises?: ReadonlyArray<PlannedExerciseItem>;
}

export interface UpdateWorkoutPayload {
  readonly name?: string;
  readonly notes?: string | null;
  readonly startedAt?: string;
  readonly completedAt?: string | null;
  readonly plannedExercises?: ReadonlyArray<PlannedExerciseItem>;
  readonly lifecycle?: WorkoutLifecycle;
}

export type WorkoutActionMutationResult =
  | { readonly ok: true; readonly workout?: Workout }
  | { readonly ok: false; readonly message: string };

const humanize = (error: ApiError, action: string): string => {
  switch (error.kind) {
    case "context_changed":
      return "This request is no longer current. Refresh before continuing.";
    case "session_expired":
      return "Your session expired. Sign in again.";
    case "network_error":
      return `Network unavailable. ${action} when you're online.`;
    case "http_error":
      if (error.status === 404) return "That workout record no longer exists.";
      if (error.status === 409) return "That workout changed elsewhere.";
      return `The server could not ${action.toLowerCase()}. Try again.`;
    case "validation_error":
    case "parse_error":
      return "The server returned an unexpected workout record.";
    case "not_configured":
      return "The API isn't configured yet.";
    case "no_session":
      return "You're signed out. Sign in and try again.";
  }
};

export const extractPlannedExercisesFromWorkout = (
  workout: Workout,
): ReadonlyArray<PlannedExerciseItem> => {
  const details = workout.details;
  if (!details || typeof details !== "object") return [];

  const mapExercise = (e: Record<string, unknown>): PlannedExerciseItem => {
    const setTypes = readPlannedSetTypes(e.setTypes);
    let targetReps: string | undefined = undefined;
    if (typeof e.targetReps === "string" || typeof e.targetReps === "number") {
      targetReps = String(e.targetReps);
    } else if (typeof e.repsMin === "number" && typeof e.repsMax === "number") {
      targetReps = `${e.repsMin}-${e.repsMax}`;
    } else if (typeof e.repsMin === "number") {
      targetReps = String(e.repsMin);
    } else if (typeof e.repsMax === "number") {
      targetReps = String(e.repsMax);
    } else if (typeof e.durationMinutes === "number") {
      targetReps = `${e.durationMinutes} min`;
    }

    return {
      name: String(e.name ?? "Exercise"),
      ...(setTypes ? { setTypes } : {}),
      ...(typeof e.catalogId === "string" ? { catalogId: e.catalogId } : {}),
      ...(typeof e.movementPattern === "string"
        ? { movementPattern: e.movementPattern }
        : {}),
      ...(typeof e.targetSets === "number"
        ? { targetSets: e.targetSets }
        : typeof e.sets === "number"
          ? { targetSets: e.sets }
          : {}),
      ...(targetReps ? { targetReps } : {}),
      ...(typeof e.targetLoad === "string" && e.targetLoad.trim().length > 0
        ? { targetLoad: e.targetLoad.trim() }
        : typeof e.targetLoad === "number" && e.targetLoad > 0
          ? { targetLoad: String(e.targetLoad) }
          : typeof e.targetLoadKg === "number" && e.targetLoadKg > 0
            ? { targetLoad: `${e.targetLoadKg} kg` }
            : {}),
      ...(typeof e.restSeconds === "number"
        ? { restSeconds: e.restSeconds }
        : {}),
      ...(typeof e.notes === "string" ? { notes: e.notes } : {}),
    };
  };

  // 0. Active session exercises (sessionExercises)
  const sessionExercises = (details as Record<string, unknown>)
    .sessionExercises;
  if (Array.isArray(sessionExercises)) {
    return (sessionExercises as Array<Record<string, unknown>>).map(
      mapExercise,
    );
  }

  // 1. MultiWorkoutPlan (coachPlan)
  const coachPlan = (details as Record<string, unknown>).coachPlan;
  if (
    coachPlan &&
    typeof coachPlan === "object" &&
    Array.isArray((coachPlan as Record<string, unknown>).exercises)
  ) {
    return (
      coachPlan as { exercises: Array<Record<string, unknown>> }
    ).exercises.map(mapExercise);
  }

  // 2. Single workout start (aiDraft)
  const aiDraft = (details as Record<string, unknown>).aiDraft;
  if (aiDraft && typeof aiDraft === "object") {
    const session = (aiDraft as Record<string, unknown>).session;
    if (
      session &&
      typeof session === "object" &&
      Array.isArray((session as Record<string, unknown>).exercises)
    ) {
      return (
        session as { exercises: Array<Record<string, unknown>> }
      ).exercises.map(mapExercise);
    }
  }

  // 3. workoutProposal
  const workoutProposal = (details as Record<string, unknown>).workoutProposal;
  if (workoutProposal && typeof workoutProposal === "object") {
    const session = (workoutProposal as Record<string, unknown>).session;
    if (
      session &&
      typeof session === "object" &&
      Array.isArray((session as Record<string, unknown>).exercises)
    ) {
      return (
        session as { exercises: Array<Record<string, unknown>> }
      ).exercises.map(mapExercise);
    }
  }

  return [];
};

export const formatWorkoutDisplayDate = (
  isoDateStr: string,
  today: Date = new Date(),
): string => {
  const d = new Date(isoDateStr);
  if (Number.isNaN(d.getTime())) return isoDateStr;

  const todayYear = today.getFullYear();
  const todayMonth = today.getMonth();
  const todayDate = today.getDate();

  const isToday =
    d.getFullYear() === todayYear &&
    d.getMonth() === todayMonth &&
    d.getDate() === todayDate;

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday =
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate();

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow =
    d.getFullYear() === tomorrow.getFullYear() &&
    d.getMonth() === tomorrow.getMonth() &&
    d.getDate() === tomorrow.getDate();

  const weekday = d.toLocaleDateString("en-US", { weekday: "short" });
  const monthDay = d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

  if (isToday) return `Today · ${weekday}, ${monthDay}`;
  if (isYesterday) return `Yesterday · ${weekday}, ${monthDay}`;
  if (isTomorrow) return `Tomorrow · ${weekday}, ${monthDay}`;

  if (d.getFullYear() === todayYear) {
    return `${weekday}, ${monthDay}`;
  }
  return `${weekday}, ${monthDay}, ${d.getFullYear()}`;
};

export const calculateWorkoutVolume = (
  sets: ReadonlyArray<WorkoutSet>,
): number => {
  let volume = 0;
  for (const set of sets) {
    if (set.setType === "warmup") continue;
    if (typeof set.loadKg === "number" && typeof set.repetitions === "number") {
      volume += set.loadKg * set.repetitions;
    }
  }
  return Math.round(volume * 10) / 10;
};

export const buildExerciseSummaries = (
  sets: ReadonlyArray<WorkoutSet>,
  exercises: ReadonlyArray<Exercise>,
): ReadonlyArray<WorkoutExerciseSummary> => {
  const exerciseMap = new Map<string, string>();
  for (const ex of exercises) {
    exerciseMap.set(ex.id, ex.name);
  }

  const byExercise = new Map<
    string,
    { count: number; topLoad: number | null }
  >();

  for (const set of sets) {
    const current = byExercise.get(set.exerciseId) ?? {
      count: 0,
      topLoad: null,
    };
    const nextTop =
      set.setType !== "warmup" &&
      set.loadKg !== null &&
      (current.topLoad === null || set.loadKg > current.topLoad)
        ? set.loadKg
        : current.topLoad;

    byExercise.set(set.exerciseId, {
      count: current.count + 1,
      topLoad: nextTop,
    });
  }

  const summaries: WorkoutExerciseSummary[] = [];
  for (const [exerciseId, data] of byExercise.entries()) {
    summaries.push({
      exerciseId,
      exerciseName: exerciseMap.get(exerciseId) ?? "Custom Exercise",
      setCount: data.count,
      topLoadKg: data.topLoad,
    });
  }

  return summaries;
};

export const processWorkout = (
  workout: Workout,
  sets: ReadonlyArray<WorkoutSet>,
  exercises: ReadonlyArray<Exercise>,
  today: Date = new Date(),
): ProcessedWorkout => {
  const plannedExercises = extractPlannedExercisesFromWorkout(workout);
  const workoutSets = sets.filter((s) => s.workoutId === workout.id);
  const isCompleted = workout.completedAt !== null;

  let status: WorkoutStatus = "planned";
  if (isCompleted) {
    status = "completed";
  } else if (
    isSessionDetails(workout.details) ||
    (!isRoutineDetails(workout.details) && plannedExercises.length === 0) ||
    workoutSets.length > 0
  ) {
    status = "in_progress";
  }

  let durationMinutes: number | null = null;
  if (workout.completedAt !== null) {
    const start = new Date(workout.startedAt).getTime();
    const end = new Date(workout.completedAt).getTime();
    if (!Number.isNaN(start) && !Number.isNaN(end) && end >= start) {
      durationMinutes = Math.max(1, Math.round((end - start) / 60000));
    }
  }

  return {
    workout,
    status,
    displayDate: formatWorkoutDisplayDate(
      isCompleted && workout.completedAt
        ? workout.completedAt
        : workout.startedAt,
      today,
    ),
    plannedExercises,
    sets: workoutSets,
    completedSetCount: workoutSets.length,
    totalVolumeKg: calculateWorkoutVolume(workoutSets),
    exerciseSummaries: buildExerciseSummaries(workoutSets, exercises),
    durationMinutes,
  };
};

const workoutListRead = (routine = false): RequestOptions => ({
  method: "GET",
  path: routine
    ? "/v1/workouts?kind=routine&limit=200"
    : "/v1/workouts?limit=200",
  schema: workoutListResponseSchema,
});
const exerciseListRead = (): RequestOptions => ({
  method: "GET",
  path: "/v1/exercises?limit=200",
  schema: exerciseListResponseSchema,
});
const workoutSetsRead = (id: string): RequestOptions => ({
  method: "GET",
  path: `/v1/workouts/${encodeURIComponent(id)}/sets`,
  schema: workoutSetListResponseSchema,
});
const runListRead = (
  options: { cursor?: string; from?: string; to?: string } = {},
): RequestOptions => {
  const query = new URLSearchParams(runListBaseQuery());
  if (options.cursor) query.set("cursor", options.cursor);
  if (options.from) query.set("from", options.from);
  if (options.to) query.set("to", options.to);
  return {
    method: "GET",
    path: `/v1/runs?${query}`,
    schema: runListResponseSchema,
  };
};
const hubWorkouts = (
  base: readonly Workout[],
  routines: readonly Workout[],
): Workout[] => [
  ...new Map(
    [...routines, ...base].map((workout) => [workout.id, workout]),
  ).values(),
];
const sessionWorkouts = (workouts: readonly Workout[]) =>
  workouts.filter(
    (workout) =>
      !isRoutineDetails(workout.details) &&
      !hasRunningActivity(workout.details) &&
      !hasBoulderingActivity(workout.details),
  );

type RunningWeekData = {
  runs: RunRecord[];
  week: { from: string; to: string; incomplete: boolean };
};

/** Same request identities and projection as async startup/focus reads. */
export function peekWorkoutsHubData(
  session: AuthSession | null,
  read: <T>(
    options: RequestOptions,
    session: AuthSession | null,
  ) => Result<T, ApiError> | null = peekSessionRead,
  now = new Date(),
  zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
): WorkoutsHubResult | null {
  const workoutResult = read<WorkoutListResponse>(workoutListRead(), session);
  const routineResult = read<WorkoutListResponse>(
    workoutListRead(true),
    session,
  );
  const exerciseResult = read<ExerciseListResponse>(
    exerciseListRead(),
    session,
  );
  const runResult = read<RunListResponse>(runListRead(), session);
  if (
    !workoutResult?.ok ||
    !routineResult?.ok ||
    !exerciseResult?.ok ||
    !runResult?.ok
  )
    return null;
  const weekReads = runningWeekReads(now, zone);
  let step = weekReads.next();
  while (!step.done) {
    const result = read<RunListResponse>(step.value, session);
    if (!result?.ok) return null;
    step = weekReads.next(result);
  }
  if (step.value.week.incomplete) return null;
  const setsResults: Result<WorkoutSetListResponse, ApiError>[] = [];
  for (const workout of sessionWorkouts(
    hubWorkouts(workoutResult.value.workouts, routineResult.value.workouts),
  )) {
    const result = read<WorkoutSetListResponse>(
      workoutSetsRead(workout.id),
      session,
    );
    if (!result?.ok) return null;
    setsResults.push(result);
  }
  return projectWorkoutsHub(
    workoutResult,
    routineResult,
    exerciseResult,
    runResult,
    step.value,
    setsResults,
    now,
  );
}

export const fetchWorkoutsHubData = async (
  client: ApiClient = apiClient,
): Promise<WorkoutsHubResult> => {
  const [workoutResult, routineResult, exerciseResult, runResult, weekResult] =
    await Promise.all([
      client.request<WorkoutListResponse>(workoutListRead()),
      client.request<WorkoutListResponse>(workoutListRead(true)),
      client.request<ExerciseListResponse>(exerciseListRead()),
      client.request<RunListResponse>(runListRead()),
      fetchRunningWeek(client),
    ]);
  const workouts = hubWorkouts(
    workoutResult.ok ? workoutResult.value.workouts : [],
    routineResult.ok ? routineResult.value.workouts : [],
  );
  const setsResults = workoutResult.ok
    ? await Promise.all(
        sessionWorkouts(workouts).map((workout) =>
          client.request<WorkoutSetListResponse>(workoutSetsRead(workout.id)),
        ),
      )
    : [];
  return projectWorkoutsHub(
    workoutResult,
    routineResult,
    exerciseResult,
    runResult,
    weekResult,
    setsResults,
  );
};

function projectWorkoutsHub(
  workoutResult: Result<WorkoutListResponse, ApiError>,
  routineResult: Result<WorkoutListResponse, ApiError>,
  exerciseResult: Result<ExerciseListResponse, ApiError>,
  runResult: Result<RunListResponse, ApiError>,
  weekResult: RunningWeekData,
  setsResults: readonly Result<WorkoutSetListResponse, ApiError>[],
  today = new Date(),
): WorkoutsHubResult {
  if (!workoutResult.ok) {
    return {
      activeAndPlanned: [],
      completed: [],
      exercises: [],
      message: humanize(workoutResult.error, "Fetch workouts"),
    };
  }

  const exercises = exerciseResult.ok ? exerciseResult.value.exercises : [];
  const routineWorkouts = routineResult.ok ? routineResult.value.workouts : [];
  const workouts = hubWorkouts(workoutResult.value.workouts, routineWorkouts);

  const allSets: WorkoutSet[] = [];
  for (const res of setsResults) {
    if (res.ok) {
      allSets.push(...res.value.workoutSets);
    }
  }

  const processed = workouts
    // Runs and bouldering sessions have their own rows; never show them as strength.
    .filter(
      (w) =>
        !hasRunningActivity(w.details) && !hasBoulderingActivity(w.details),
    )
    .map((w) => processWorkout(w, allSets, exercises, today));

  const activeAndPlanned = processed
    .filter((p) => p.status !== "completed")
    .sort(
      (a, b) =>
        new Date(a.workout.startedAt).getTime() -
        new Date(b.workout.startedAt).getTime(),
    );

  const completed = processed
    .filter((p) => p.status === "completed")
    .sort(
      (a, b) =>
        new Date(b.workout.completedAt ?? b.workout.startedAt).getTime() -
        new Date(a.workout.completedAt ?? a.workout.startedAt).getTime(),
    );

  const savedTimes = [
    workoutResult,
    routineResult,
    exerciseResult,
    runResult,
    ...setsResults,
  ].flatMap((result) => savedDisplayTime(result) ?? []);
  return {
    activeAndPlanned,
    completed,
    exercises,
    ...(savedTimes.length > 0 ? { savedAt: Math.min(...savedTimes) } : {}),
    runs: runResult.ok ? runResult.value.runs : [],
    runsNextCursor: runResult.ok ? runResult.value.nextCursor : null,
    weeklyRuns: weekResult.runs,
    runWeek: weekResult.week,
    message:
      !runResult.ok ||
      weekResult.week.incomplete ||
      !routineResult.ok ||
      !exerciseResult.ok ||
      setsResults.some((result) => !result.ok)
        ? "Some workout details could not be loaded. Pull to refresh to try again."
        : null,
  };
}

export const deleteWorkout = async (
  workoutId: string,
  client: ApiClient = apiClient,
): Promise<WorkoutActionMutationResult> => {
  const binding = client === apiClient ? captureHealthExportOwner() : null;
  const result = await client.request<void>({
    method: "DELETE",
    path: `/v1/workouts/${encodeURIComponent(workoutId)}`,
  });

  if (result.ok) deleteHealthExport(binding, "workout", workoutId);
  return result.ok
    ? { ok: true }
    : { ok: false, message: humanize(result.error, "Delete workout") };
};

export const fetchWorkout = async (
  workoutId: string,
  client: ApiClient = apiClient,
): Promise<
  | { readonly ok: true; readonly workout: Workout }
  | { readonly ok: false; readonly message: string }
> => {
  const result = await client.request<WorkoutResponse>({
    method: "GET",
    path: `/v1/workouts/${encodeURIComponent(workoutId)}`,
    schema: workoutResponseSchema,
  });

  return result.ok
    ? { ok: true, workout: result.value.workout }
    : { ok: false, message: humanize(result.error, "Fetch workout") };
};

export const createCustomWorkout = async (
  payload: CreateWorkoutPayload,
  client: ApiClient = apiClient,
): Promise<WorkoutActionMutationResult> => {
  const name = payload.name.trim() || "Custom Workout";
  const exercises = payload.plannedExercises ?? [];

  const body = {
    ...(payload.clientOperationId
      ? { clientOperationId: payload.clientOperationId }
      : {}),
    name,
    ...(payload.notes && payload.notes.trim().length > 0
      ? { notes: payload.notes.trim() }
      : {}),
    ...(payload.startedAt ? { startedAt: payload.startedAt } : {}),
    details: withWorkoutLifecycle(
      {
        coachPlan: {
          exercises: exercises.map((e) => ({
            catalogId: e.catalogId ?? e.name.toLowerCase().replace(/\s+/g, "_"),
            name: e.name,
            movementPattern: e.movementPattern ?? "general",
            sets: e.targetSets ?? 3,
            targetSets: e.targetSets ?? 3,
            ...(e.setTypes
              ? { setTypes: readPlannedSetTypes(e.setTypes) }
              : {}),
            targetReps: e.targetReps ?? "8-12",
            repsMin:
              typeof e.targetReps === "string" && e.targetReps.includes("-")
                ? Number.parseInt(e.targetReps.split("-")[0] ?? "8", 10)
                : null,
            repsMax:
              typeof e.targetReps === "string" && e.targetReps.includes("-")
                ? Number.parseInt(e.targetReps.split("-")[1] ?? "12", 10)
                : typeof e.targetReps === "string" &&
                    !Number.isNaN(Number.parseInt(e.targetReps, 10))
                  ? Number.parseInt(e.targetReps, 10)
                  : null,
            targetLoad: e.targetLoad,
            restSeconds: e.restSeconds ?? 90,
            notes: e.notes,
          })),
        },
      },
      { kind: "routine" },
    ),
  };

  const parsed = workoutCreateSchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Invalid workout details.",
    };
  }

  const result = await client.request<WorkoutResponse>({
    method: "POST",
    path: "/v1/workouts",
    body: parsed.data,
    schema: workoutResponseSchema,
  });

  return result.ok
    ? { ok: true, workout: result.value.workout }
    : { ok: false, message: humanize(result.error, "Create workout") };
};

export const updateWorkoutDetails = async (
  workoutId: string,
  payload: UpdateWorkoutPayload,
  client: ApiClient = apiClient,
): Promise<WorkoutActionMutationResult> => {
  const binding = client === apiClient ? captureHealthExportOwner() : null;
  const exercises = payload.plannedExercises;

  const body: Record<string, unknown> = {
    ...(payload.name !== undefined ? { name: payload.name.trim() } : {}),
    ...(payload.notes !== undefined
      ? { notes: payload.notes ? payload.notes.trim() : null }
      : {}),
    ...(payload.startedAt !== undefined
      ? { startedAt: payload.startedAt }
      : {}),
    ...(payload.completedAt !== undefined
      ? { completedAt: payload.completedAt }
      : {}),
    ...(exercises !== undefined
      ? {
          details: withWorkoutLifecycle(
            {
              coachPlan: {
                exercises: exercises.map((e) => ({
                  catalogId:
                    e.catalogId ?? e.name.toLowerCase().replace(/\s+/g, "_"),
                  name: e.name,
                  movementPattern: e.movementPattern ?? "general",
                  sets: e.targetSets ?? 3,
                  targetSets: e.targetSets ?? 3,
                  ...(e.setTypes
                    ? { setTypes: readPlannedSetTypes(e.setTypes) }
                    : {}),
                  targetReps: e.targetReps ?? "8-12",
                  repsMin:
                    typeof e.targetReps === "string" &&
                    e.targetReps.includes("-")
                      ? Number.parseInt(e.targetReps.split("-")[0] ?? "8", 10)
                      : null,
                  repsMax:
                    typeof e.targetReps === "string" &&
                    e.targetReps.includes("-")
                      ? Number.parseInt(e.targetReps.split("-")[1] ?? "12", 10)
                      : typeof e.targetReps === "string" &&
                          !Number.isNaN(Number.parseInt(e.targetReps, 10))
                        ? Number.parseInt(e.targetReps, 10)
                        : null,
                  targetLoad: e.targetLoad,
                  restSeconds: e.restSeconds ?? 90,
                  notes: e.notes,
                })),
              },
            },
            payload.lifecycle ?? { kind: "routine" },
          ),
        }
      : {}),
  };

  const parsed = workoutPatchSchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Invalid workout changes.",
    };
  }

  const result = await client.request<WorkoutResponse>({
    method: "PUT",
    path: `/v1/workouts/${encodeURIComponent(workoutId)}`,
    body: parsed.data,
    schema: workoutResponseSchema,
  });

  if (result.ok) exportSavedWorkout(binding, result.value.workout, true);
  return result.ok
    ? { ok: true, workout: result.value.workout }
    : { ok: false, message: humanize(result.error, "Update workout") };
};

/**
 * Update planned exercise target loads in a routine template after session progression.
 */
export const syncRoutineExerciseTargets = async (
  routineId: string,
  updatedTargets: ReadonlyMap<string, number>,
  client: ApiClient = apiClient,
): Promise<WorkoutActionMutationResult> => {
  const routineRes = await client.request<WorkoutResponse>({
    method: "GET",
    path: `/v1/workouts/${encodeURIComponent(routineId)}`,
    schema: workoutResponseSchema,
  });
  if (!routineRes.ok) {
    return { ok: false, message: humanize(routineRes.error, "Find routine") };
  }
  const routine = routineRes.value.workout;
  const currentPlanned = extractPlannedExercisesFromWorkout(routine);
  if (currentPlanned.length === 0) {
    return { ok: true, workout: routine };
  }
  let hasChanges = false;
  const updatedPlanned = currentPlanned.map((item) => {
    const key = item.name.trim().toLowerCase();
    const newTargetKg = updatedTargets.get(key);
    if (newTargetKg !== undefined && newTargetKg > 0) {
      hasChanges = true;
      return {
        ...item,
        targetLoad: `${newTargetKg} kg`,
      };
    }
    return item;
  });

  if (!hasChanges) {
    return { ok: true, workout: routine };
  }

  return updateWorkoutDetails(
    routineId,
    {
      name: routine.name,
      notes: routine.notes,
      plannedExercises: updatedPlanned,
      lifecycle: readWorkoutLifecycle(routine.details) ?? { kind: "routine" },
    },
    client,
  );
};

export const createBlankWorkout = async (
  name: string = "Custom Workout",
  clientOrOperationId?: string | ApiClient,
  client?: ApiClient,
): Promise<WorkoutActionMutationResult> => {
  const actualClient =
    typeof clientOrOperationId === "object" && clientOrOperationId !== null
      ? clientOrOperationId
      : (client ?? apiClient);
  const operationId =
    typeof clientOrOperationId === "string" ? clientOrOperationId : undefined;
  return createBlankWorkoutWith(actualClient, name, undefined, operationId);
};

export const createBlankWorkoutWith = async (
  client: ApiClient,
  name: string = "Custom Workout",
  now?: (() => Date) | Date,
  clientOperationId?: string,
): Promise<WorkoutActionMutationResult> => {
  const operationId = clientOperationId ?? Crypto.randomUUID();
  const startedAtDate = typeof now === "function" ? now() : now;
  const parsed = workoutCreateSchema.safeParse({
    clientOperationId: operationId,
    name: name.trim() || "Custom Workout",
    ...(startedAtDate ? { startedAt: startedAtDate.toISOString() } : {}),
    details: withWorkoutLifecycle(
      markFirstPartyWorkout({ sessionMode: "one_time", sessionExercises: [] }),
      { kind: "session" },
    ),
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
    : { ok: false, message: humanize(result.error, "Start workout") };
};

/** Create a disposable live session while leaving its reusable routine intact. */
export const startRoutineSession = async (
  routine: Workout,
  clientOperationId?: string,
): Promise<WorkoutActionMutationResult> =>
  startRoutineSessionWith(apiClient, routine, undefined, clientOperationId);

export const startRoutineSessionWith = async (
  client: ApiClient,
  routine: Workout,
  now?: (() => Date) | Date,
  clientOperationId?: string,
): Promise<WorkoutActionMutationResult> => {
  if (!isReusableRoutine(routine)) {
    return {
      ok: false,
      message: "Only an available routine can start a new session.",
    };
  }
  const operationId = clientOperationId ?? Crypto.randomUUID();
  const startedAtDate = typeof now === "function" ? now() : now;
  const parsed = workoutCreateSchema.safeParse({
    clientOperationId: operationId,
    name: routine.name,
    ...(startedAtDate ? { startedAt: startedAtDate.toISOString() } : {}),
    ...(routine.notes ? { notes: routine.notes } : {}),
    details: withWorkoutLifecycle(routine.details, {
      kind: "session",
      routineId: routine.id,
    }),
  });
  if (!parsed.success) {
    return { ok: false, message: "Invalid routine details." };
  }

  const result = await client.request<WorkoutResponse>({
    method: "POST",
    path: "/v1/workouts",
    body: parsed.data,
    schema: workoutResponseSchema,
  });
  return result.ok
    ? { ok: true, workout: result.value.workout }
    : { ok: false, message: humanize(result.error, "Start session") };
};

export const isReusableRoutine = (workout: Workout): boolean =>
  isRoutineDetails(workout.details) ||
  (!isSessionDetails(workout.details) &&
    workout.completedAt === null &&
    extractPlannedExercisesFromWorkout(workout).length > 0);

function* runningWeekReads(
  now: Date,
  zone: string,
): Generator<
  RequestOptions,
  RunningWeekData,
  Result<RunListResponse, ApiError>
> {
  const today = runningDate(now, zone);
  const day = new Date(`${today}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  const from = day.toISOString().slice(0, 10);
  day.setUTCDate(day.getUTCDate() + 6);
  const to = day.toISOString().slice(0, 10);
  const runs: RunRecord[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  let incomplete = false;
  for (let page = 0; page < 10; page++) {
    const result = yield runListRead({ from, to, cursor });
    if (!result.ok) {
      incomplete = true;
      break;
    }
    for (const run of result.value.runs)
      if (!seen.has(run.id)) {
        seen.add(run.id);
        runs.push(run);
      }
    if (!result.value.nextCursor) break;
    if (result.value.nextCursor === cursor || page === 9) {
      incomplete = true;
      break;
    }
    cursor = result.value.nextCursor;
  }
  return { runs, week: { from, to, incomplete } };
}

export async function fetchRunningWeek(
  client: ApiClient,
  now = new Date(),
  zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
): Promise<RunningWeekData> {
  const reads = runningWeekReads(now, zone);
  let step = reads.next();
  while (!step.done)
    step = reads.next(await client.request<RunListResponse>(step.value));
  return step.value;
}

/**
 * Recent finished bouldering sessions for Workouts history. A failure is
 * reported separately so strength and running history still render.
 */
export const fetchBoulderingHistory = async (
  client: ApiClient = apiClient,
): Promise<
  | { readonly ok: true; readonly sessions: readonly BoulderSessionRecord[] }
  | {
      readonly ok: false;
      readonly message: string;
      /** The server has bouldering switched off: show nothing, warn nothing. */
      readonly disabled: boolean;
    }
> => {
  const result = await listBoulderSessions(client, { limit: 20 });
  if (!result.ok)
    return {
      ok: false,
      message: result.error.message,
      disabled: result.error.kind === "disabled",
    };
  return {
    ok: true,
    sessions: result.value.sessions.filter(
      (session) => session.completedAt !== null,
    ),
  };
};
