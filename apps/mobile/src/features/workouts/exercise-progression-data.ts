import type { ApiClient, ApiError } from "@mizyun/api-client";
import { findCatalogExercise, getCatalogExerciseNames } from "@mizyun/core";
import {
  exerciseListResponseSchema,
  exercisePatchSchema,
  exerciseRecentSetsResponseSchema,
  exerciseResponseSchema,
  exerciseCreateSchema,
  workoutListResponseSchema,
  type Exercise,
  type ExerciseListResponse,
  type ExerciseRecentSetsResponse,
  type ExerciseResponse,
  type Workout,
  type WorkoutListResponse,
  type WorkoutSet,
} from "@mizyun/contracts";

import { apiClient } from "@/composition/api-client";
import { findCatalogExerciseRecord } from "./catalog-exercise-record";
import {
  displayWeightToKilograms,
  kilogramsToDisplayWeight,
  weightUnitLabel,
} from "@/lib/weight-units";

export interface ExerciseSessionProgression {
  readonly workoutId: string;
  readonly workoutName: string;
  readonly dateIso: string;
  readonly displayDate: string;
  readonly sets: ReadonlyArray<WorkoutSet>;
  readonly peakLoadKg: number | null;
  readonly peakLoadDisplay: string;
  readonly totalVolumeKg: number;
  readonly totalVolumeDisplay: string;
  readonly estimated1RMKg: number | null;
  readonly estimated1RMDisplay: string;
  readonly sessionTargetLoadKg: number | null;
  readonly targetStatus:
    "hit_target" | "exceeded_target" | "below_target" | "no_target";
}

export interface ExerciseProgressionSummary {
  readonly exerciseId: string | null;
  readonly exerciseName: string;
  readonly movementPattern?: string;
  readonly currentTargetLoadKg: number | null;
  readonly currentTargetLoadDisplay: string;
  readonly currentTargetReps: string | null;
  readonly allTimeBestLoadKg: number | null;
  readonly allTimeBestLoadDisplay: string;
  readonly allTimeBest1RMKg: number | null;
  readonly allTimeBest1RMDisplay: string;
  readonly totalSessionsCount: number;
  readonly totalSetsCount: number;
  readonly totalVolumeKg: number;
  readonly totalVolumeDisplay: string;
  readonly firstSessionDateIso: string | null;
  readonly latestSessionDateIso: string | null;
  readonly loadDeltaKg: number | null;
  readonly loadDeltaPercent: number | null;
  readonly sessionsChronological: ReadonlyArray<ExerciseSessionProgression>;
  readonly sessionsNewestFirst: ReadonlyArray<ExerciseSessionProgression>;
}

export interface ExerciseProgressionResult {
  readonly progression: ExerciseProgressionSummary | null;
  readonly message: string | null;
}

export interface TargetLoadMutationResult {
  readonly ok: boolean;
  readonly exercise?: Exercise;
  readonly message?: string;
}

const normalizeName = (name: string): string => name.trim().toLowerCase();

const knownRecordNames = (exerciseName: string): readonly string[] => {
  const catalogExercise = findCatalogExercise(exerciseName);
  if (
    catalogExercise &&
    getCatalogExerciseNames(catalogExercise).some(
      (name) => normalizeName(name) === normalizeName(exerciseName),
    )
  ) {
    return getCatalogExerciseNames(catalogExercise);
  }
  return [exerciseName];
};

const findRecordByName = (
  records: readonly Exercise[],
  exerciseName: string,
): Exercise | null => {
  const catalogExercise = findCatalogExercise(exerciseName);
  if (
    catalogExercise &&
    getCatalogExerciseNames(catalogExercise).some(
      (name) => normalizeName(name) === normalizeName(exerciseName),
    )
  ) {
    return findCatalogExerciseRecord(records, catalogExercise);
  }
  const matches = records.filter(
    (record) => normalizeName(record.name) === normalizeName(exerciseName),
  );
  return matches.length === 1 ? (matches[0] ?? null) : null;
};

const humanize = (error: ApiError, action: string): string => {
  switch (error.kind) {
    case "context_changed":
      return "This request is no longer current. Refresh before continuing.";
    case "session_expired":
      return "Your session expired. Sign in again.";
    case "network_error":
      return `Network unavailable. ${action} when you're online.`;
    case "http_error":
      if (error.status === 404) return "Exercise record not found.";
      if (error.status === 422) return "Invalid target load values.";
      return `The server could not ${action.toLowerCase()}.`;
    case "validation_error":
      return "Invalid target load values.";
    case "parse_error":
      return "Unexpected server response.";
    case "not_configured":
      return "API is not configured.";
    case "no_session":
      return "You are signed out. Sign in and try again.";
  }
};

/**
 * Calculate estimated 1-Rep Max using the Epley formula:
 * 1RM = loadKg * (1 + repetitions / 30) for reps > 1, or loadKg for 1 rep.
 */
export const calculateEstimated1RM = (
  loadKg: number | null,
  repetitions: number | null,
): number | null => {
  if (loadKg === null || loadKg <= 0) return null;
  if (repetitions === null || repetitions <= 0) return loadKg;
  if (repetitions === 1) return Math.round(loadKg * 10) / 10;
  const raw = loadKg * (1 + repetitions / 30);
  return Math.round(raw * 10) / 10;
};

/**
 * Extract target load in kg from workout planned details if available.
 */
export const extractPlannedTargetLoadKg = (
  workout: Workout | null,
  exerciseName: string,
  unitSystem: "metric" | "imperial",
): number | null => {
  if (!workout?.details || typeof workout.details !== "object") return null;

  const normalizedTarget = exerciseName.trim().toLowerCase();
  const details = workout.details as Record<string, unknown>;

  // Check coachPlan.exercises, aiDraft.session.exercises, workoutProposal.session.exercises
  const exerciseLists: unknown[] = [
    (details.coachPlan as Record<string, unknown> | undefined)?.exercises,
    (
      (details.aiDraft as Record<string, unknown> | undefined)?.session as
        Record<string, unknown> | undefined
    )?.exercises,
    (
      (details.workoutProposal as Record<string, unknown> | undefined)
        ?.session as Record<string, unknown> | undefined
    )?.exercises,
  ];

  for (const list of exerciseLists) {
    if (Array.isArray(list)) {
      const match = list.find(
        (item) =>
          typeof item === "object" &&
          item !== null &&
          typeof item.name === "string" &&
          item.name.trim().toLowerCase() === normalizedTarget,
      );
      if (match) {
        if (
          typeof match.targetLoad === "string" &&
          match.targetLoad.trim().length > 0
        ) {
          const num = Number.parseFloat(
            match.targetLoad.replace(/[^0-9.]/g, ""),
          );
          if (!Number.isNaN(num) && num > 0) {
            const isLbs =
              match.targetLoad.toLowerCase().includes("lb") ||
              (!match.targetLoad.toLowerCase().includes("kg") &&
                unitSystem === "imperial");
            return isLbs ? displayWeightToKilograms(num, "imperial") : num;
          }
        }
        if (typeof match.targetLoadKg === "number" && match.targetLoadKg > 0) {
          return match.targetLoadKg;
        }
      }
    }
  }

  return null;
};

/**
 * Pure function: aggregate raw sets and workouts into a structured progression summary.
 */
export const calculateExerciseProgression = (
  exercise: Exercise | null,
  exerciseName: string,
  sets: ReadonlyArray<WorkoutSet>,
  workouts: ReadonlyArray<Workout>,
  unitSystem: "metric" | "imperial" = "metric",
): ExerciseProgressionSummary => {
  const unit = weightUnitLabel(unitSystem);

  // Extract target load from exercise metadata if present
  let currentTargetLoadKg: number | null = null;
  let currentTargetReps: string | null = null;

  if (exercise?.metadata && typeof exercise.metadata === "object") {
    const meta = exercise.metadata as Record<string, unknown>;
    if (typeof meta.targetLoadKg === "number" && meta.targetLoadKg > 0) {
      currentTargetLoadKg = meta.targetLoadKg;
    } else if (
      typeof meta.targetLoad === "string" &&
      meta.targetLoad.trim().length > 0
    ) {
      const num = Number.parseFloat(meta.targetLoad.replace(/[^0-9.]/g, ""));
      if (!Number.isNaN(num) && num > 0) {
        const isLbs = meta.targetLoad.toLowerCase().includes("lb");
        currentTargetLoadKg = isLbs
          ? displayWeightToKilograms(num, "imperial")
          : num;
      }
    }
    if (
      typeof meta.targetReps === "string" &&
      meta.targetReps.trim().length > 0
    ) {
      currentTargetReps = meta.targetReps.trim();
    }
  }

  // Group sets by workoutId
  const setsByWorkoutId = new Map<string, WorkoutSet[]>();
  for (const set of sets) {
    const existing = setsByWorkoutId.get(set.workoutId) ?? [];
    existing.push(set);
    setsByWorkoutId.set(set.workoutId, existing);
  }

  const sessions: ExerciseSessionProgression[] = [];

  for (const [workoutId, sessionSets] of setsByWorkoutId.entries()) {
    const workout = workouts.find((w) => w.id === workoutId) ?? null;
    const dateIso =
      workout?.completedAt ??
      workout?.startedAt ??
      sessionSets[0]?.createdAt ??
      new Date().toISOString();
    const dateObj = new Date(dateIso);
    const displayDate = Number.isNaN(dateObj.getTime())
      ? "Unknown Date"
      : dateObj.toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
        });

    const sortedSets = [...sessionSets].sort((a, b) => a.sequence - b.sequence);

    let peakLoadKg: number | null = null;
    let totalVolumeKg = 0;
    let best1RMKg: number | null = null;

    for (const s of sortedSets) {
      if (s.loadKg !== null && s.loadKg > 0) {
        if (peakLoadKg === null || s.loadKg > peakLoadKg) {
          peakLoadKg = s.loadKg;
        }
        if (s.repetitions !== null && s.repetitions > 0) {
          totalVolumeKg += s.loadKg * s.repetitions;
          const e1rm = calculateEstimated1RM(s.loadKg, s.repetitions);
          if (e1rm !== null && (best1RMKg === null || e1rm > best1RMKg)) {
            best1RMKg = e1rm;
          }
        }
      }
    }

    const sessionTargetLoadKg =
      extractPlannedTargetLoadKg(workout, exerciseName, unitSystem) ??
      currentTargetLoadKg;

    let targetStatus: ExerciseSessionProgression["targetStatus"] = "no_target";
    if (sessionTargetLoadKg !== null && peakLoadKg !== null) {
      if (peakLoadKg > sessionTargetLoadKg) {
        targetStatus = "exceeded_target";
      } else if (peakLoadKg === sessionTargetLoadKg) {
        targetStatus = "hit_target";
      } else {
        targetStatus = "below_target";
      }
    }

    sessions.push({
      workoutId,
      workoutName: workout?.name ?? "Workout Session",
      dateIso,
      displayDate,
      sets: sortedSets,
      peakLoadKg,
      peakLoadDisplay:
        peakLoadKg !== null
          ? `${kilogramsToDisplayWeight(peakLoadKg, unitSystem)} ${unit}`
          : "—",
      totalVolumeKg: Math.round(totalVolumeKg),
      totalVolumeDisplay:
        totalVolumeKg > 0
          ? `${kilogramsToDisplayWeight(totalVolumeKg, unitSystem)} ${unit}`
          : "—",
      estimated1RMKg: best1RMKg,
      estimated1RMDisplay:
        best1RMKg !== null
          ? `${kilogramsToDisplayWeight(best1RMKg, unitSystem)} ${unit}`
          : "—",
      sessionTargetLoadKg,
      targetStatus,
    });
  }

  // Sort chronological (oldest to newest)
  const sessionsChronological = [...sessions].sort(
    (a, b) => new Date(a.dateIso).getTime() - new Date(b.dateIso).getTime(),
  );

  // Newest first for list display
  const sessionsNewestFirst = [...sessionsChronological].reverse();

  // All-time metrics
  let allTimeBestLoadKg: number | null = null;
  let allTimeBest1RMKg: number | null = null;
  let allTimeTotalVolumeKg = 0;

  for (const s of sessions) {
    if (
      s.peakLoadKg !== null &&
      (allTimeBestLoadKg === null || s.peakLoadKg > allTimeBestLoadKg)
    ) {
      allTimeBestLoadKg = s.peakLoadKg;
    }
    if (
      s.estimated1RMKg !== null &&
      (allTimeBest1RMKg === null || s.estimated1RMKg > allTimeBest1RMKg)
    ) {
      allTimeBest1RMKg = s.estimated1RMKg;
    }
    allTimeTotalVolumeKg += s.totalVolumeKg;
  }

  const firstSessionDateIso = sessionsChronological[0]?.dateIso ?? null;
  const latestSessionDateIso =
    sessionsChronological[sessionsChronological.length - 1]?.dateIso ?? null;

  let loadDeltaKg: number | null = null;
  let loadDeltaPercent: number | null = null;

  if (sessionsChronological.length >= 2) {
    const firstPeak = sessionsChronological[0]?.peakLoadKg;
    const latestPeak =
      sessionsChronological[sessionsChronological.length - 1]?.peakLoadKg;
    if (
      firstPeak !== null &&
      latestPeak !== null &&
      firstPeak !== undefined &&
      latestPeak !== undefined &&
      firstPeak > 0
    ) {
      loadDeltaKg = Math.round((latestPeak - firstPeak) * 10) / 10;
      loadDeltaPercent =
        Math.round(((latestPeak - firstPeak) / firstPeak) * 1000) / 10;
    }
  }

  return {
    exerciseId: exercise?.id ?? null,
    exerciseName,
    movementPattern: (exercise?.metadata as Record<string, unknown> | undefined)
      ?.movementPattern as string | undefined,
    currentTargetLoadKg,
    currentTargetLoadDisplay:
      currentTargetLoadKg !== null
        ? `${kilogramsToDisplayWeight(currentTargetLoadKg, unitSystem)} ${unit}`
        : "Not set",
    currentTargetReps,
    allTimeBestLoadKg,
    allTimeBestLoadDisplay:
      allTimeBestLoadKg !== null
        ? `${kilogramsToDisplayWeight(allTimeBestLoadKg, unitSystem)} ${unit}`
        : "—",
    allTimeBest1RMKg,
    allTimeBest1RMDisplay:
      allTimeBest1RMKg !== null
        ? `${kilogramsToDisplayWeight(allTimeBest1RMKg, unitSystem)} ${unit}`
        : "—",
    totalSessionsCount: sessions.length,
    totalSetsCount: sets.length,
    totalVolumeKg: Math.round(allTimeTotalVolumeKg),
    totalVolumeDisplay:
      allTimeTotalVolumeKg > 0
        ? `${kilogramsToDisplayWeight(allTimeTotalVolumeKg, unitSystem)} ${unit}`
        : "—",
    firstSessionDateIso,
    latestSessionDateIso,
    loadDeltaKg,
    loadDeltaPercent,
    sessionsChronological,
    sessionsNewestFirst,
  };
};

/**
 * Fetch progression for an exercise by ID or name.
 */
export const fetchExerciseProgression = async (
  identifier: { readonly exerciseId?: string; readonly exerciseName: string },
  unitSystem: "metric" | "imperial" = "metric",
  client: ApiClient = apiClient,
): Promise<ExerciseProgressionResult> => {
  try {
    const exercisesRequest = identifier.exerciseId
      ? client
          .request<ExerciseResponse>({
            method: "GET",
            path: `/v1/exercises/${encodeURIComponent(identifier.exerciseId)}`,
            schema: exerciseResponseSchema,
          })
          .then((result) =>
            result.ok
              ? {
                  ok: true as const,
                  value: { exercises: [result.value.exercise] },
                }
              : result,
          )
      : client.request<ExerciseListResponse>({
          method: "GET",
          path: "/v1/exercises?limit=200",
          schema: exerciseListResponseSchema,
        });
    // 1. Fetch user exercises and workouts in parallel
    const [exercisesRes, workoutsRes] = await Promise.all([
      exercisesRequest,
      client.request<WorkoutListResponse>({
        method: "GET",
        path: "/v1/workouts?limit=200",
        schema: workoutListResponseSchema,
      }),
    ]);

    if (!exercisesRes.ok) {
      return {
        progression: null,
        message: humanize(exercisesRes.error, "Fetch exercises"),
      };
    }
    if (!workoutsRes.ok) {
      return {
        progression: null,
        message: humanize(workoutsRes.error, "Fetch workouts"),
      };
    }

    const allExercises = exercisesRes.value.exercises;
    const allWorkouts = workoutsRes.value.workouts;

    // Find exercise
    let exercise: Exercise | null = null;
    if (identifier.exerciseId) {
      exercise =
        allExercises.find((e) => e.id === identifier.exerciseId) ?? null;
    }
    if (!identifier.exerciseId) {
      exercise = findRecordByName(allExercises, identifier.exerciseName);
      if (!exercise && allExercises.length >= 200) {
        return {
          progression: null,
          message:
            "Could not load your complete exercise list. Open the existing exercise to view its history.",
        };
      }
    }

    let sets: ReadonlyArray<WorkoutSet> = [];

    // If user exercise exists, fetch recent sets
    if (exercise) {
      const setsRes = await client.request<ExerciseRecentSetsResponse>({
        method: "GET",
        path: `/v1/exercises/${encodeURIComponent(exercise.id)}/recent-sets?limit=50`,
        schema: exerciseRecentSetsResponseSchema,
      });
      if (setsRes.ok) {
        sets = setsRes.value.sets;
      }
    }

    const summary = calculateExerciseProgression(
      exercise,
      exercise?.name ?? identifier.exerciseName,
      sets,
      allWorkouts,
      unitSystem,
    );

    return {
      progression: summary,
      message: null,
    };
  } catch (cause) {
    const message =
      cause instanceof Error
        ? cause.message
        : "Could not load exercise progression.";
    return {
      progression: null,
      message,
    };
  }
};

/**
 * Update or set target load for an exercise.
 * If user exercise doesn't exist yet, creates it.
 */
export const updateExerciseTargetLoad = async (
  exerciseName: string,
  targetLoadKg: number,
  targetReps?: string,
  exerciseId?: string | null,
  client: ApiClient = apiClient,
): Promise<TargetLoadMutationResult> => {
  try {
    let targetId = exerciseId;
    let existingExercise: Exercise | null = null;

    if (targetId) {
      const readRes = await client.request<ExerciseResponse>({
        method: "GET",
        path: `/v1/exercises/${encodeURIComponent(targetId)}`,
        schema: exerciseResponseSchema,
      });
      if (!readRes.ok) {
        return {
          ok: false,
          message: humanize(readRes.error, "Fetch exercise"),
        };
      }
      existingExercise = readRes.value.exercise;
    }

    // If ID not provided, check if exercise already exists
    if (!targetId) {
      const listRes = await client.request<ExerciseListResponse>({
        method: "GET",
        path: "/v1/exercises?limit=200",
        schema: exerciseListResponseSchema,
      });
      if (!listRes.ok) {
        return {
          ok: false,
          message: humanize(listRes.error, "Fetch exercises"),
        };
      }
      existingExercise = findRecordByName(
        listRes.value.exercises,
        exerciseName,
      );
      if (existingExercise) {
        targetId = existingExercise.id;
      } else {
        const knownNames = new Set(
          knownRecordNames(exerciseName).map(normalizeName),
        );
        if (
          listRes.value.exercises.some((record) =>
            knownNames.has(normalizeName(record.name)),
          )
        ) {
          return {
            ok: false,
            message:
              "More than one exercise record matches. Open the original exercise to set its target.",
          };
        }
        if (listRes.value.exercises.length >= 200) {
          return {
            ok: false,
            message:
              "Could not load your complete exercise list. Open the existing exercise before setting its target.",
          };
        }
      }
    }

    if (targetId) {
      // Patch existing exercise metadata
      const patchRes = await client.request<ExerciseResponse>({
        method: "PUT",
        path: `/v1/exercises/${encodeURIComponent(targetId)}`,
        body: {
          metadata: {
            ...existingExercise?.metadata,
            targetLoadKg,
            ...(targetReps ? { targetReps: targetReps.trim() } : {}),
            targetUpdatedAt: new Date().toISOString(),
          },
        },
        schema: exerciseResponseSchema,
      });

      return patchRes.ok
        ? { ok: true, exercise: patchRes.value.exercise }
        : { ok: false, message: humanize(patchRes.error, "Save target load") };
    }

    // Create new exercise with target load metadata
    const createRes = await client.request<ExerciseResponse>({
      method: "POST",
      path: "/v1/exercises",
      body: {
        name: exerciseName.trim(),
        metadata: {
          targetLoadKg,
          ...(targetReps ? { targetReps: targetReps.trim() } : {}),
          targetUpdatedAt: new Date().toISOString(),
        },
      },
      schema: exerciseResponseSchema,
    });

    return createRes.ok
      ? { ok: true, exercise: createRes.value.exercise }
      : {
          ok: false,
          message: humanize(createRes.error, "Create exercise target"),
        };
  } catch (cause) {
    const message =
      cause instanceof Error ? cause.message : "Could not save target load.";
    return { ok: false, message };
  }
};
