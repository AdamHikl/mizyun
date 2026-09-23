/**
 * Progressive overload calculation and evaluation module (WO-005).
 *
 * Pure: no external dependencies, no mobile/database/vendor imports.
 * Evaluates exercise progression based on completed set performance against
 * planned or historical load targets, handling unit conversions deterministically.
 */

/** Conversion factor: 1 lb = 0.45359237 kg (international avoirdupois pound). */
export const POUNDS_TO_KG_MULTIPLIER = 0.45359237;

export type ProgressionReason =
  | "no_valid_sets"
  | "initial_target_established"
  | "load_increased"
  | "target_not_exceeded";

export interface ExerciseProgressionEvaluation {
  readonly progressed: boolean;
  readonly previousTargetKg: number | null;
  readonly nextTargetKg: number | null;
  readonly peakLoadKg: number | null;
  readonly reason: ProgressionReason;
}

export interface WorkoutExerciseProgression {
  readonly exerciseId: string;
  readonly exerciseName: string;
  readonly currentTargetLoadKg: number | null;
  readonly progressed: boolean;
  readonly previousTargetKg: number | null;
  readonly nextTargetKg: number | null;
  readonly peakLoadKg: number | null;
  readonly reason: ProgressionReason;
  readonly evaluation: ExerciseProgressionEvaluation;
}

export interface PlannedExerciseProgressionInput {
  readonly name: string;
  readonly targetLoadKg?: number | null;
  readonly targetLoad?: string | null;
}

export interface CompletedSetProgressionInput {
  readonly exerciseId: string;
  readonly loadKg: number | null;
  readonly repetitions: number | null;
  readonly perceivedExertion?: number | null;
}

export interface ExerciseCatalogItemInput {
  readonly id: string;
  readonly name: string;
  readonly metadata?: Record<string, unknown> | null;
}

/**
 * Parses free-form target load strings into kilograms.
 * Handles plain numbers ("80", 80), metric indicators ("80 kg", "80kg"),
 * and imperial indicators ("175.5 lbs", "175.5lb"), converting imperial loads to kg.
 * Returns null for missing, zero, negative, or unparseable input.
 */
export const parseTargetLoadString = (
  raw: string | number | null | undefined,
  options?: { readonly roundDecimals?: number },
): number | null => {
  if (raw === null || raw === undefined) return null;

  if (typeof raw === "number") {
    return Number.isFinite(raw) && raw > 0 ? raw : null;
  }

  if (typeof raw !== "string") return null;

  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.includes("-")) return null;

  const lower = trimmed.toLowerCase();
  const hasLb = lower.includes("lb");
  const hasKg = lower.includes("kg");
  if (hasLb && hasKg) return null;

  // Clean comma to decimal point and match numeric portion and optional unit
  const match = lower.match(
    /^([0-9]+(?:[.,][0-9]+)?)\s*(kg|kgs|kilo|kilos|lb|lbs|pound|pounds)?$/,
  );

  let num: number;
  let isLb = false;

  if (match) {
    const numStr = match[1]!.replace(",", ".");
    num = Number(numStr);
    const unit = match[2];
    if (unit && (unit.startsWith("lb") || unit.startsWith("pound"))) {
      isLb = true;
    }
  } else {
    // Fallback: extract numeric token if present
    const cleaned = trimmed.replace(",", ".");
    const numMatch = cleaned.match(/([0-9]+(?:\.[0-9]+)?)/);
    if (!numMatch) return null;
    num = Number(numMatch[1]);
    if (hasLb) isLb = true;
  }

  if (!Number.isFinite(num) || num <= 0) return null;

  if (isLb) {
    const converted = num * POUNDS_TO_KG_MULTIPLIER;
    const decimals = options?.roundDecimals ?? 2;
    const factor = 10 ** decimals;
    return Math.round(converted * factor) / factor;
  }

  return num;
};

/**
 * Evaluates whether an exercise progressed during a workout session.
 *
 * Rules:
 * 1. Find peak valid load: maximum `loadKg` across sets where `loadKg > 0` and `repetitions > 0`.
 * 2. If peak load is null or <= 0: `{ progressed: false, previousTargetKg: currentTargetLoadKg, nextTargetKg: currentTargetLoadKg, peakLoadKg: null, reason: "no_valid_sets" }`
 * 3. If `currentTargetLoadKg === null`: `{ progressed: true, previousTargetKg: null, nextTargetKg: peakLoadKg, peakLoadKg, reason: "initial_target_established" }`
 * 4. If `currentTargetLoadKg !== null` and `peakLoadKg > currentTargetLoadKg`: `{ progressed: true, previousTargetKg: currentTargetLoadKg, nextTargetKg: peakLoadKg, peakLoadKg, reason: "load_increased" }`
 * 5. Else: `{ progressed: false, previousTargetKg: currentTargetLoadKg, nextTargetKg: currentTargetLoadKg, peakLoadKg, reason: "target_not_exceeded" }`
 */
export const evaluateExerciseProgression = (params: {
  readonly currentTargetLoadKg: number | null;
  readonly completedSets: ReadonlyArray<{
    readonly loadKg: number | null;
    readonly repetitions: number | null;
    readonly perceivedExertion?: number | null;
  }>;
}): ExerciseProgressionEvaluation => {
  let peakLoadKg: number | null = null;

  for (const set of params.completedSets) {
    if (
      set.loadKg !== null &&
      set.loadKg !== undefined &&
      set.loadKg > 0 &&
      set.repetitions !== null &&
      set.repetitions !== undefined &&
      set.repetitions > 0
    ) {
      if (peakLoadKg === null || set.loadKg > peakLoadKg) {
        peakLoadKg = set.loadKg;
      }
    }
  }

  if (peakLoadKg === null || peakLoadKg <= 0) {
    return {
      progressed: false,
      previousTargetKg: params.currentTargetLoadKg,
      nextTargetKg: params.currentTargetLoadKg,
      peakLoadKg: null,
      reason: "no_valid_sets",
    };
  }

  if (params.currentTargetLoadKg === null) {
    return {
      progressed: true,
      previousTargetKg: null,
      nextTargetKg: peakLoadKg,
      peakLoadKg,
      reason: "initial_target_established",
    };
  }

  if (peakLoadKg > params.currentTargetLoadKg) {
    return {
      progressed: true,
      previousTargetKg: params.currentTargetLoadKg,
      nextTargetKg: peakLoadKg,
      peakLoadKg,
      reason: "load_increased",
    };
  }

  return {
    progressed: false,
    previousTargetKg: params.currentTargetLoadKg,
    nextTargetKg: params.currentTargetLoadKg,
    peakLoadKg,
    reason: "target_not_exceeded",
  };
};

/**
 * Computes progressive overload evaluations across all exercises in a workout session.
 * Correlates planned exercises (and metadata) with logged sets to establish baseline targets
 * and evaluate progress.
 */
export const computeWorkoutProgressions = (params: {
  readonly plannedExercises?: ReadonlyArray<PlannedExerciseProgressionInput>;
  readonly completedSets: ReadonlyArray<CompletedSetProgressionInput>;
  readonly exercises: ReadonlyArray<ExerciseCatalogItemInput>;
}): ReadonlyArray<WorkoutExerciseProgression> => {
  const result: WorkoutExerciseProgression[] = [];
  const processedExerciseIds = new Set<string>();

  const findPlannedForExercise = (
    name: string,
    id: string,
  ): PlannedExerciseProgressionInput | undefined => {
    if (!params.plannedExercises || params.plannedExercises.length === 0) {
      return undefined;
    }
    const normalizedName = name.trim().toLowerCase().replace(/\s+/g, " ");
    return params.plannedExercises.find((p) => {
      const pName = p.name.trim().toLowerCase().replace(/\s+/g, " ");
      return pName === normalizedName || p.name.trim() === id;
    });
  };

  const resolveTargetLoadKg = (
    exercise: ExerciseCatalogItemInput,
  ): number | null => {
    const planned = findPlannedForExercise(exercise.name, exercise.id);

    if (planned) {
      if (
        planned.targetLoadKg !== undefined &&
        planned.targetLoadKg !== null &&
        Number.isFinite(planned.targetLoadKg) &&
        planned.targetLoadKg > 0
      ) {
        return planned.targetLoadKg;
      }
      if (planned.targetLoad) {
        const parsed = parseTargetLoadString(planned.targetLoad);
        if (parsed !== null) return parsed;
      }
    }

    // Fall back to exercise metadata if available
    const meta = exercise.metadata;
    if (meta && typeof meta === "object") {
      if (
        typeof meta.targetLoadKg === "number" &&
        Number.isFinite(meta.targetLoadKg) &&
        meta.targetLoadKg > 0
      ) {
        return meta.targetLoadKg;
      }
      if (typeof meta.targetLoad === "string") {
        const parsed = parseTargetLoadString(meta.targetLoad);
        if (parsed !== null) return parsed;
      } else if (
        typeof meta.targetLoad === "number" &&
        Number.isFinite(meta.targetLoad) &&
        meta.targetLoad > 0
      ) {
        return meta.targetLoad;
      }
    }

    return null;
  };

  // Evaluate exercises specified in the workout exercise list
  for (const exercise of params.exercises) {
    processedExerciseIds.add(exercise.id);
    const currentTargetLoadKg = resolveTargetLoadKg(exercise);
    const exerciseSets = params.completedSets.filter(
      (s) => s.exerciseId === exercise.id,
    );
    const evaluation = evaluateExerciseProgression({
      currentTargetLoadKg,
      completedSets: exerciseSets,
    });

    result.push({
      exerciseId: exercise.id,
      exerciseName: exercise.name,
      currentTargetLoadKg,
      progressed: evaluation.progressed,
      previousTargetKg: evaluation.previousTargetKg,
      nextTargetKg: evaluation.nextTargetKg,
      peakLoadKg: evaluation.peakLoadKg,
      reason: evaluation.reason,
      evaluation,
    });
  }

  // Include any extra exercises present in completedSets but not in exercises list
  for (const set of params.completedSets) {
    if (!processedExerciseIds.has(set.exerciseId)) {
      processedExerciseIds.add(set.exerciseId);
      const planned = findPlannedForExercise(set.exerciseId, set.exerciseId);
      let currentTargetLoadKg: number | null = null;
      if (
        planned?.targetLoadKg !== undefined &&
        planned.targetLoadKg !== null &&
        Number.isFinite(planned.targetLoadKg) &&
        planned.targetLoadKg > 0
      ) {
        currentTargetLoadKg = planned.targetLoadKg;
      } else if (planned?.targetLoad) {
        currentTargetLoadKg = parseTargetLoadString(planned.targetLoad);
      }

      const exerciseSets = params.completedSets.filter(
        (s) => s.exerciseId === set.exerciseId,
      );
      const evaluation = evaluateExerciseProgression({
        currentTargetLoadKg,
        completedSets: exerciseSets,
      });

      result.push({
        exerciseId: set.exerciseId,
        exerciseName: planned?.name ?? set.exerciseId,
        currentTargetLoadKg,
        progressed: evaluation.progressed,
        previousTargetKg: evaluation.previousTargetKg,
        nextTargetKg: evaluation.nextTargetKg,
        peakLoadKg: evaluation.peakLoadKg,
        reason: evaluation.reason,
        evaluation,
      });
    }
  }

  return result;
};
