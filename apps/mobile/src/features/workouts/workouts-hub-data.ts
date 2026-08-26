import type { ApiClient, ApiError } from "@mizyun/api-client";
import {
  exerciseListResponseSchema,
  workoutCreateSchema,
  workoutListResponseSchema,
  workoutResponseSchema,
  workoutSetListResponseSchema,
  type Exercise,
  type ExerciseListResponse,
  type Workout,
  type WorkoutListResponse,
  type WorkoutSet,
  type WorkoutSetListResponse,
  type WorkoutResponse,
} from "@mizyun/contracts";

import { apiClient } from "@/composition/api-client";

export interface PlannedExerciseItem {
  readonly name: string;
  readonly targetSets?: number;
  readonly targetReps?: string;
  readonly targetLoad?: string;
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
}

export type WorkoutActionMutationResult =
  | { readonly ok: true; readonly workout?: Workout }
  | { readonly ok: false; readonly message: string };

const humanize = (error: ApiError, action: string): string => {
  switch (error.kind) {
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

  // 1. MultiWorkoutPlan (coachPlan)
  const coachPlan = (details as Record<string, unknown>).coachPlan;
  if (
    coachPlan &&
    typeof coachPlan === "object" &&
    Array.isArray((coachPlan as Record<string, unknown>).exercises)
  ) {
    return (
      coachPlan as { exercises: Array<Record<string, unknown>> }
    ).exercises.map((e) => ({
      name: String(e.name ?? "Exercise"),
      ...(typeof e.targetSets === "number" ? { targetSets: e.targetSets } : {}),
      ...(typeof e.targetReps === "string" || typeof e.targetReps === "number"
        ? { targetReps: String(e.targetReps) }
        : {}),
      ...(typeof e.targetLoad === "string" ? { targetLoad: e.targetLoad } : {}),
      ...(typeof e.notes === "string" ? { notes: e.notes } : {}),
    }));
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
      ).exercises.map((e) => ({
        name: String(e.name ?? "Exercise"),
        ...(typeof e.targetSets === "number"
          ? { targetSets: e.targetSets }
          : {}),
        ...(typeof e.targetReps === "string" || typeof e.targetReps === "number"
          ? { targetReps: String(e.targetReps) }
          : {}),
        ...(typeof e.targetLoad === "string"
          ? { targetLoad: e.targetLoad }
          : {}),
        ...(typeof e.notes === "string" ? { notes: e.notes } : {}),
      }));
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
      ).exercises.map((e) => ({
        name: String(e.name ?? "Exercise"),
        ...(typeof e.targetSets === "number"
          ? { targetSets: e.targetSets }
          : {}),
        ...(typeof e.targetReps === "string" || typeof e.targetReps === "number"
          ? { targetReps: String(e.targetReps) }
          : {}),
        ...(typeof e.targetLoad === "string"
          ? { targetLoad: e.targetLoad }
          : {}),
        ...(typeof e.notes === "string" ? { notes: e.notes } : {}),
      }));
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
  } else if (workoutSets.length > 0) {
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

export const fetchWorkoutsHubData = async (
  client: ApiClient = apiClient,
): Promise<WorkoutsHubResult> => {
  const [workoutResult, exerciseResult] = await Promise.all([
    client.request<WorkoutListResponse>({
      method: "GET",
      path: "/v1/workouts?limit=200",
      schema: workoutListResponseSchema,
    }),
    client.request<ExerciseListResponse>({
      method: "GET",
      path: "/v1/exercises?limit=200",
      schema: exerciseListResponseSchema,
    }),
  ]);

  if (!workoutResult.ok) {
    return {
      activeAndPlanned: [],
      completed: [],
      exercises: [],
      message: humanize(workoutResult.error, "Fetch workouts"),
    };
  }

  const exercises = exerciseResult.ok ? exerciseResult.value.exercises : [];
  const workouts = workoutResult.value.workouts;

  // Fetch sets for all workouts in parallel
  const setsResults = await Promise.all(
    workouts.map((w) =>
      client.request<WorkoutSetListResponse>({
        method: "GET",
        path: `/v1/workouts/${encodeURIComponent(w.id)}/sets`,
        schema: workoutSetListResponseSchema,
      }),
    ),
  );

  const allSets: WorkoutSet[] = [];
  for (const res of setsResults) {
    if (res.ok) {
      allSets.push(...res.value.workoutSets);
    }
  }

  const today = new Date();
  const processed = workouts.map((w) =>
    processWorkout(w, allSets, exercises, today),
  );

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

  return {
    activeAndPlanned,
    completed,
    exercises,
    message: null,
  };
};

export const deleteWorkout = async (
  workoutId: string,
  client: ApiClient = apiClient,
): Promise<WorkoutActionMutationResult> => {
  const result = await client.request<void>({
    method: "DELETE",
    path: `/v1/workouts/${encodeURIComponent(workoutId)}`,
  });

  return result.ok
    ? { ok: true }
    : { ok: false, message: humanize(result.error, "Delete workout") };
};

export const createBlankWorkout = async (
  name: string = "Custom Workout",
  client: ApiClient = apiClient,
): Promise<WorkoutActionMutationResult> => {
  const parsed = workoutCreateSchema.safeParse({
    name: name.trim() || "Custom Workout",
  });
  if (!parsed.success) {
    return { ok: false, message: "Invalid workout name." };
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
