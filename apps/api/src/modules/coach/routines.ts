import type { StoredWorkout } from "@mizyun/core";

export interface PlannedExercise {
  readonly name: string;
  readonly catalogId?: string;
  readonly movementPattern?: string;
  readonly targetSets?: number;
  readonly targetReps?: string;
  readonly targetLoad?: string;
  readonly restSeconds?: number;
  readonly notes?: string;
}

export interface RoutineSummary {
  readonly id: string;
  readonly name: string;
  readonly startedAt: string;
  readonly exerciseCount: number;
  readonly exercises: readonly PlannedExercise[];
}

const extractRawExercises = (
  details: Readonly<Record<string, unknown>> | null | undefined,
): readonly unknown[] => {
  if (!details || typeof details !== "object") {
    return [];
  }

  // 1. CoachPlan (coachPlan.exercises or coachPlan.session.exercises)
  const coachPlan = details.coachPlan;
  if (coachPlan && typeof coachPlan === "object") {
    const cp = coachPlan as Record<string, unknown>;
    if (Array.isArray(cp.exercises)) {
      return cp.exercises;
    }
    const session = cp.session;
    if (session && typeof session === "object") {
      const exercises = (session as Record<string, unknown>).exercises;
      if (Array.isArray(exercises)) {
        return exercises;
      }
    }
  }

  // 2. AI draft (aiDraft.session.exercises or aiDraft.exercises)
  const aiDraft = details.aiDraft;
  if (aiDraft && typeof aiDraft === "object") {
    const ad = aiDraft as Record<string, unknown>;
    const session = ad.session;
    if (session && typeof session === "object") {
      const exercises = (session as Record<string, unknown>).exercises;
      if (Array.isArray(exercises)) {
        return exercises;
      }
    }
    if (Array.isArray(ad.exercises)) {
      return ad.exercises;
    }
  }

  // 3. Workout proposal (workoutProposal.session.exercises or workoutProposal.exercises)
  const workoutProposal = details.workoutProposal;
  if (workoutProposal && typeof workoutProposal === "object") {
    const wp = workoutProposal as Record<string, unknown>;
    const session = wp.session;
    if (session && typeof session === "object") {
      const exercises = (session as Record<string, unknown>).exercises;
      if (Array.isArray(exercises)) {
        return exercises;
      }
    }
    if (Array.isArray(wp.exercises)) {
      return wp.exercises;
    }
  }

  return [];
};

const mapExercise = (e: Record<string, unknown>): PlannedExercise => {
  let targetReps: string | undefined;
  const hasTargetReps =
    (typeof e.targetReps === "string" && e.targetReps.trim().length > 0) ||
    typeof e.targetReps === "number";

  if (hasTargetReps) {
    targetReps = String(e.targetReps);
  } else if (
    (typeof e.repsMin === "number" || typeof e.repsMin === "string") &&
    (typeof e.repsMax === "number" || typeof e.repsMax === "string") &&
    String(e.repsMin).trim().length > 0 &&
    String(e.repsMax).trim().length > 0
  ) {
    targetReps = `${e.repsMin}-${e.repsMax}`;
  } else if (
    (typeof e.repsMin === "number" || typeof e.repsMin === "string") &&
    String(e.repsMin).trim().length > 0
  ) {
    targetReps = String(e.repsMin);
  } else if (
    (typeof e.repsMax === "number" || typeof e.repsMax === "string") &&
    String(e.repsMax).trim().length > 0
  ) {
    targetReps = String(e.repsMax);
  } else if (
    (typeof e.durationMinutes === "number" ||
      typeof e.durationMinutes === "string") &&
    String(e.durationMinutes).trim().length > 0
  ) {
    targetReps = `${e.durationMinutes} min`;
  }

  const rawSets = e.targetSets ?? e.sets;
  const targetSets = typeof rawSets === "number" ? rawSets : undefined;

  let targetLoad: string | undefined;
  if (typeof e.targetLoad === "string" && e.targetLoad.trim().length > 0) {
    targetLoad = e.targetLoad;
  } else if (typeof e.targetLoad === "number") {
    targetLoad = String(e.targetLoad);
  }

  const name =
    typeof e.name === "string" && e.name.trim().length > 0
      ? e.name
      : "Exercise";
  const catalogId =
    typeof e.catalogId === "string" && e.catalogId.trim().length > 0
      ? e.catalogId
      : undefined;
  const movementPattern =
    typeof e.movementPattern === "string" && e.movementPattern.trim().length > 0
      ? e.movementPattern
      : undefined;
  const restSeconds =
    typeof e.restSeconds === "number" ? e.restSeconds : undefined;
  const notes =
    typeof e.notes === "string" && e.notes.trim().length > 0
      ? e.notes
      : undefined;

  return {
    name,
    ...(catalogId !== undefined ? { catalogId } : {}),
    ...(movementPattern !== undefined ? { movementPattern } : {}),
    ...(targetSets !== undefined ? { targetSets } : {}),
    ...(targetReps !== undefined ? { targetReps } : {}),
    ...(targetLoad !== undefined ? { targetLoad } : {}),
    ...(restSeconds !== undefined ? { restSeconds } : {}),
    ...(notes !== undefined ? { notes } : {}),
  };
};

export const extractPlannedExercisesFromWorkout = (
  workout: StoredWorkout,
): PlannedExercise[] => {
  const rawExercises = extractRawExercises(workout.details);
  const result: PlannedExercise[] = [];

  for (const item of rawExercises) {
    if (!item || typeof item !== "object") {
      continue;
    }
    result.push(mapExercise(item as Record<string, unknown>));
  }

  return result;
};

export const isAvailableRoutine = (workout: StoredWorkout): boolean => {
  return (
    workout.completedAt === null &&
    extractPlannedExercisesFromWorkout(workout).length > 0
  );
};

export const toRoutineSummary = (workout: StoredWorkout): RoutineSummary => {
  const exercises = extractPlannedExercisesFromWorkout(workout);
  return {
    id: workout.id,
    name: workout.name,
    startedAt:
      workout.startedAt instanceof Date
        ? workout.startedAt.toISOString()
        : new Date(workout.startedAt).toISOString(),
    exerciseCount: exercises.length,
    exercises,
  };
};
