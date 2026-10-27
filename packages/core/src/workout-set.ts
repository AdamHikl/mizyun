import type { UserId } from "./index";

/**
 * Workout-set domain types and validation rules (WO-002).
 *
 * Pure: no database, no transport, no SDK. The wire schema lives in
 * `@mizyun/contracts`; this module owns the bounded numeric rules
 * and the repository port that adapters implement.
 *
 * The shape mirrors `public.workout_sets`:
 *   - `sequence` is the per-workout ordinal. The repository
 *     enforces uniqueness; the in-memory implementation uses a
 *     per-workout set, the SQL implementation uses a partial
 *     unique index on `(workout_id, sequence)`.
 *   - The four performance fields (`repetitions`, `loadKg`,
 *     `durationSeconds`, `distanceMeters`) are nullable. The
 *     validator rejects a body where none of them is present so
 *     an "empty" set cannot land.
 *   - `completedAt` is nullable to support in-flight logging.
 *   - `perceivedExertion` is bounded to 0..10, matching the SQL
 *     `numeric(3, 1) CHECK (perceived_exertion BETWEEN 0 AND 10)`.
 *
 * Sets are immutable: the route layer has no `update` path. The
 * only domain mutation is `summariseExerciseSets`, a pure
 * function that aggregates the recent-sets view (WO-04).
 */

/** Bounded sequence ordinal. */
export const MAX_SEQUENCE = 9999;

/** Bounded repetitions, mirroring `numeric(7, 2)`. */
export const MAX_REPETITIONS = 9999.99;

/** Bounded load in kilograms, mirroring `numeric(8, 3)`. */
export const MAX_LOAD_KG = 9999.999;

/** Bounded duration in seconds. 86 400 = 24h. */
export const MAX_DURATION_SECONDS = 86_400;

/** Bounded distance in meters, mirroring `numeric(10, 2)`. */
export const MAX_DISTANCE_METERS = 1_000_000;

/** Bounded RPE, 0..10. */
export const MAX_PERCEIVED_EXERTION = 10;
export const MIN_PERCEIVED_EXERTION = 0;

export type WorkoutSetType = "normal" | "warmup" | "drop" | "failure";

export const VALID_WORKOUT_SET_TYPES: ReadonlySet<string> = new Set([
  "normal",
  "warmup",
  "drop",
  "failure",
]);

/**
 * Editable domain shape. The wire schema in `@mizyun/contracts`
 * adds `id`, `userId`, `workoutId`, and `createdAt`. This type is
 * the editable subset the route accepts and returns.
 */
export interface WorkoutSetCore {
  readonly exerciseId: string;
  readonly sequence: number;
  readonly setType?: WorkoutSetType;
  readonly repetitions: number | null;
  readonly loadKg: number | null;
  readonly durationSeconds: number | null;
  readonly distanceMeters: number | null;
  readonly perceivedExertion: number | null;
  readonly completedAt: Date | null;
}

/**
 * Full stored workout set, including the user id and audit
 * `createdAt` timestamp. No `updatedAt` — sets are immutable.
 */
export interface StoredWorkoutSet extends WorkoutSetCore {
  readonly id: string;
  readonly userId: UserId;
  readonly workoutId: string;
  /**
   * Optional client retry identity (REL-02 / REL-04). Unique per
   * owner when present; `null`/absent for older keyless clients.
   * Never part of the wire response.
   */
  readonly clientOperationId?: string | null;
  readonly createdAt: Date;
}

/**
 * Thrown by `WorkoutSetRepository.create` when the requested
 * `(workoutId, sequence)` is already taken by another set. Lets the
 * route retry a keyed (retry-safe) create at the next free sequence
 * without parsing database error text.
 */
export class WorkoutSetSequenceCollisionError extends Error {
  constructor(
    readonly workoutId: string,
    readonly sequence: number,
  ) {
    super(
      `workout set sequence collision: workout=${workoutId} sequence=${sequence}`,
    );
    this.name = "WorkoutSetSequenceCollisionError";
  }
}

/**
 * Why-not-valid reasons for a workout-set create.
 */
export type WorkoutSetValidationError =
  | { readonly kind: "empty_set" }
  | { readonly kind: "invalid_set_type" }
  | {
      readonly kind: "repetitions_out_of_range";
      readonly min: number;
      readonly max: number;
    }
  | {
      readonly kind: "load_kg_out_of_range";
      readonly min: number;
      readonly max: number;
    }
  | {
      readonly kind: "duration_out_of_range";
      readonly min: number;
      readonly max: number;
    }
  | {
      readonly kind: "distance_out_of_range";
      readonly min: number;
      readonly max: number;
    }
  | {
      readonly kind: "perceived_exertion_out_of_range";
      readonly min: number;
      readonly max: number;
    }
  | {
      readonly kind: "sequence_out_of_range";
      readonly min: number;
      readonly max: number;
    };

const validateNonNegative = (
  value: number | null | undefined,
  min: number,
  max: number,
  kind:
    | "repetitions_out_of_range"
    | "load_kg_out_of_range"
    | "duration_out_of_range"
    | "distance_out_of_range",
): WorkoutSetValidationError | null => {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { kind, min, max };
  }
  if (value < min || value > max) {
    return { kind, min, max };
  }
  return null;
};

const validatePerceivedExertion = (
  value: number | null | undefined,
): WorkoutSetValidationError | null => {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < MIN_PERCEIVED_EXERTION ||
    value > MAX_PERCEIVED_EXERTION
  ) {
    return {
      kind: "perceived_exertion_out_of_range",
      min: MIN_PERCEIVED_EXERTION,
      max: MAX_PERCEIVED_EXERTION,
    };
  }
  return null;
};

/**
 * Validate a create body. Rejects:
 *   - empty sets (no performance field present; null counts as absent);
 *   - sequence outside `[1, MAX_SEQUENCE]`;
 *   - performance fields outside their bounded ranges.
 */
export const validateWorkoutSetCreate = (create: {
  readonly sequence?: number;
  readonly setType?: string | null;
  readonly repetitions?: number | null;
  readonly loadKg?: number | null;
  readonly durationSeconds?: number | null;
  readonly distanceMeters?: number | null;
  readonly perceivedExertion?: number | null;
}): WorkoutSetValidationError | null => {
  if (
    create.setType !== undefined &&
    create.setType !== null &&
    !VALID_WORKOUT_SET_TYPES.has(create.setType)
  ) {
    return { kind: "invalid_set_type" };
  }
  const e0 = validateNonNegative(
    create.repetitions,
    0,
    MAX_REPETITIONS,
    "repetitions_out_of_range",
  );
  if (e0 !== null) return e0;
  const e1 = validateNonNegative(
    create.loadKg,
    0,
    MAX_LOAD_KG,
    "load_kg_out_of_range",
  );
  if (e1 !== null) return e1;
  const e2 = validateNonNegative(
    create.durationSeconds,
    0,
    MAX_DURATION_SECONDS,
    "duration_out_of_range",
  );
  if (e2 !== null) return e2;
  const e3 = validateNonNegative(
    create.distanceMeters,
    0,
    MAX_DISTANCE_METERS,
    "distance_out_of_range",
  );
  if (e3 !== null) return e3;
  const e4 = validatePerceivedExertion(create.perceivedExertion);
  if (e4 !== null) return e4;
  if (
    create.sequence !== undefined &&
    (create.sequence < 1 || create.sequence > MAX_SEQUENCE)
  ) {
    return {
      kind: "sequence_out_of_range",
      min: 1,
      max: MAX_SEQUENCE,
    };
  }
  if (
    (create.repetitions ?? null) === null &&
    (create.loadKg ?? null) === null &&
    (create.durationSeconds ?? null) === null &&
    (create.distanceMeters ?? null) === null
  ) {
    return { kind: "empty_set" };
  }
  return null;
};

/**
 * Per-exercise previous-performance summary. Pure function over
 * the user's recent sets for an exercise. Powers the
 * `/v1/exercises/:id/recent-sets` endpoint.
 */
export interface ExerciseRecentSetsSummary {
  readonly bestLoadKg: number | null;
  readonly lastSessionVolumeKg: number | null;
  readonly totalSetCount: number;
}

/**
 * Aggregate a flat list of the user's recent sets for an
 * exercise into the UI's summary view. Pure: same inputs, same
 * outputs.
 *
 *   - `bestLoadKg` is the maximum `loadKg` across the input (excluding warmup sets).
 *     A set without `loadKg` is ignored.
 *   - `lastSessionVolumeKg` is the volume
 *     (`loadKg * repetitions`) of the most-recent session for the
 *     exercise (excluding warmup sets). A session is identified by the
 *     `workoutId`. Sessions whose working sets have no load (cardio,
 *     bodyweight) report `null` (volume is meaningless for them).
 *   - `totalSetCount` is the size of the input.
 *
 * Inputs are pre-filtered (one exercise, owned by the user) by
 * the route before this sees them.
 */
export const summariseExerciseSets = (
  sets: ReadonlyArray<StoredWorkoutSet>,
): ExerciseRecentSetsSummary => {
  if (sets.length === 0) {
    return { bestLoadKg: null, lastSessionVolumeKg: null, totalSetCount: 0 };
  }
  let bestLoadKg: number | null = null;
  for (const s of sets) {
    if (s.setType === "warmup") continue;
    if (s.loadKg !== null && (bestLoadKg === null || s.loadKg > bestLoadKg)) {
      bestLoadKg = s.loadKg;
    }
  }
  const newest = sets[0];
  let lastSessionVolumeKg: number | null = null;
  if (newest !== undefined) {
    const sessionId = newest.workoutId;
    // Volume is only meaningful when every working set in the session has
    // a load × reps contribution. A single non-load working set (cardio,
    // bodyweight) makes the whole session's volume unreportable.
    let tainted = false;
    let volume = 0;
    let workingSetsCount = 0;
    for (const s of sets) {
      if (s.workoutId !== sessionId) continue;
      if (s.setType === "warmup") continue;
      workingSetsCount++;
      if (s.loadKg === null || s.repetitions === null) {
        tainted = true;
        continue;
      }
      volume += s.loadKg * s.repetitions;
    }
    lastSessionVolumeKg =
      tainted || workingSetsCount === 0
        ? null
        : Math.round(volume * 1000) / 1000;
  }
  return {
    bestLoadKg,
    lastSessionVolumeKg,
    totalSetCount: sets.length,
  };
};

/**
 * Repository port. The Supabase adapter implements this against
 * the `public.workout_sets` table; tests implement it with an
 * in-memory map. The unique `(workout_id, sequence)` invariant
 * lives here (and in the SQL constraint) so a runner cannot have
 * two rows at the same ordinal.
 */
export interface WorkoutSetRepository {
  /**
   * Return the caller's set saved under `clientOperationId`, or
   * `null`. The identity is unique per owner (REL-02 / REL-04).
   */
  findByClientOperationId(
    userId: UserId,
    clientOperationId: string,
    options: { readonly accessToken: string },
  ): Promise<StoredWorkoutSet | null>;
  /**
   * `accessToken` is the verified principal's bearer token. The
   * in-memory adapter ignores it; the Supabase adapter uses it
   * to construct a per-request client bound to the user's RLS
   * session. PERSIST-002.
   *
   * When `set.clientOperationId` is already used by the owner, the
   * existing row is returned (the caller compares its payload). A
   * `(workoutId, sequence)` collision with another row throws
   * `WorkoutSetSequenceCollisionError`.
   */
  create(
    userId: UserId,
    set: StoredWorkoutSet,
    options: { readonly accessToken: string },
  ): Promise<StoredWorkoutSet>;
  /**
   * List every set for a workout, ordered by `sequence`
   * ascending. The route enforces ownership on the workout
   * before calling this.
   */
  listForWorkout(
    workoutId: string,
    options: { readonly accessToken: string },
  ): Promise<ReadonlyArray<StoredWorkoutSet>>;
  /**
   * List the most-recent sets for an exercise across all
   * workouts, most recently performed first: ordered by
   * `completedAt` descending (null last), then `createdAt`
   * descending. Backdated sets therefore rank by when they were
   * performed, not when they were entered. Capped at `limit`.
   * Used by the previous-performance view.
   */
  recentForExercise(
    userId: UserId,
    exerciseId: string,
    limit: number,
    options: { readonly accessToken: string },
  ): Promise<ReadonlyArray<StoredWorkoutSet>>;
  /**
   * Return the stored set by id. The route enforces ownership
   * after the call.
   */
  getById(
    id: string,
    options: { readonly accessToken: string },
  ): Promise<StoredWorkoutSet | null>;
  /**
   * Permanently remove a set. Returns `true` when a row was
   * removed, `false` when the id was unknown.
   */
  delete(
    id: string,
    options: { readonly accessToken: string },
  ): Promise<boolean>;
  /**
   * Cascade-delete every set belonging to a workout. Called by
   * the workout DELETE route so an in-memory test stub doesn't
   * leak orphaned rows. SQL implementations rely on the FK
   * `ON DELETE CASCADE` instead; the in-memory implementation
   * must call this explicitly.
   */
  deleteAllForWorkout(
    workoutId: string,
    options: { readonly accessToken: string },
  ): Promise<number>;
}
