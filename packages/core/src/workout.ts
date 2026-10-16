import type { UserId } from "./index";

/**
 * Workout domain types and validation rules (WO-001).
 *
 * Pure: no database, no transport, no SDK. The wire schema lives in
 * `@mizyun/contracts`; this module owns the bounded name and notes
 * rules, the closed `source` enum, and the repository port that
 * adapters implement.
 *
 * The shape mirrors `public.workouts`:
 *   - `name` is mandatory and bounded.
 *   - `startedAt` is the moment the workout began.
 *   - `completedAt` is the moment the workout finished, or `null`
 *     while in flight.
 *   - `notes` is a free-form text field. Nullable.
 *   - `source` is closed; only `"manual"` exists today. The route
 *     hard-codes it on create and the patch ignores it (a user
 *     can't change the provenance of their own workout).
 *   - `details` is an open `Record<string, unknown>` reserved for
 *     the future AI path.
 *
 * The set-list surface (`/v1/workouts/:id/sets`) lands in WO-002.
 */

export type WorkoutSource = "manual";

/** Bounded name length. Long enough for "Tuesday leg day (heavy)". */
export const WORKOUT_NAME_MAX = 200;

/** Bounded notes length. ~3 paragraphs of plain text. */
export const NOTES_MAX = 4_000;

/**
 * Editable domain shape. The wire schema in `@mizyun/contracts`
 * adds `id`, `userId`, audit timestamps, `source`, and `details`.
 * This type is the editable subset the route accepts and returns.
 */
export interface WorkoutCore {
  readonly name: string;
  readonly startedAt: Date;
  readonly completedAt: Date | null;
  readonly notes: string | null;
  readonly details: Readonly<Record<string, unknown>>;
}

/**
 * Full stored workout, including the user id, the source (always
 * `"manual"` in v1), and the audit timestamps. The API layer maps
 * `WorkoutCore` to this when reading from the repository.
 */
export interface StoredWorkout extends WorkoutCore {
  readonly id: string;
  readonly userId: UserId;
  readonly clientOperationId?: string | null | undefined;
  readonly source: WorkoutSource;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Patch shape for `PUT /v1/workouts/:id`. Every field is optional.
 * Setting `notes` or `completedAt` to `null` clears them. Setting
 * `details` replaces the stored object wholesale.
 *
 * The `| undefined` per-field is required because the wire schema
 * (`workoutPatchSchema` in `@mizyun/contracts`) uses Zod's
 * `.optional()`, which produces `T | undefined` under
 * `exactOptionalPropertyTypes: true`.
 */
export type WorkoutPatch = {
  readonly name?: string | undefined;
  readonly startedAt?: Date | undefined;
  readonly completedAt?: Date | null | undefined;
  readonly notes?: string | null | undefined;
  readonly details?: Readonly<Record<string, unknown>> | undefined;
};

/**
 * Why-not-valid reasons for a workout create or patch. The
 * discriminated union keeps the rejection reason machine-checkable
 * at the route layer (which translates it into the `apiErrorSchema`
 * `code`).
 */
export type WorkoutValidationError =
  | { readonly kind: "empty_patch" }
  | { readonly kind: "name_empty" }
  | { readonly kind: "name_too_long"; readonly max: number }
  | { readonly kind: "notes_too_long"; readonly max: number }
  | { readonly kind: "details_must_be_object" }
  | { readonly kind: "completed_at_before_started_at" }
  | { readonly kind: "started_at_required" };

const isBlank = (value: string): boolean => value.trim().length === 0;

const validateName = (value: string): WorkoutValidationError | null => {
  if (isBlank(value)) return { kind: "name_empty" };
  if (value.length > WORKOUT_NAME_MAX) {
    return { kind: "name_too_long", max: WORKOUT_NAME_MAX };
  }
  return null;
};

const validateNotes = (
  value: string | null | undefined,
): WorkoutValidationError | null => {
  if (value === undefined || value === null) return null;
  if (value.length > NOTES_MAX) {
    return { kind: "notes_too_long", max: NOTES_MAX };
  }
  return null;
};

const validateDetails = (
  value: Readonly<Record<string, unknown>> | undefined,
): WorkoutValidationError | null => {
  if (value === undefined) return null;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { kind: "details_must_be_object" };
  }
  return null;
};

const validateInstant = (value: Date | undefined): boolean =>
  value !== undefined &&
  value instanceof Date &&
  !Number.isNaN(value.getTime());

/**
 * Validate a create body. `startedAt` is required (the route
 * supplies `startedAt = new Date()` when the client omitted it).
 */
export const validateWorkoutCreate = (create: {
  readonly name: string;
  readonly startedAt?: Date;
  readonly completedAt?: Date | null;
  readonly notes?: string | null;
  readonly details?: Readonly<Record<string, unknown>>;
}): WorkoutValidationError | null => {
  const e0 = validateName(create.name);
  if (e0 !== null) return e0;
  if (!validateInstant(create.startedAt)) {
    // The wire Zod schema already enforces ISO 8601, so this branch
    // is defensive — the route layer supplies a `Date`.
    return { kind: "started_at_required" };
  }
  if (
    create.completedAt !== undefined &&
    create.completedAt !== null &&
    create.startedAt !== undefined &&
    create.completedAt.getTime() < create.startedAt.getTime()
  ) {
    return { kind: "completed_at_before_started_at" };
  }
  const e1 = validateNotes(create.notes);
  if (e1 !== null) return e1;
  const e2 = validateDetails(create.details);
  if (e2 !== null) return e2;
  return null;
};

/**
 * Validate a patch body. Empty patches are rejected because they
 * have no effect.
 */
export const validateWorkoutPatch = (
  stored: StoredWorkout,
  patch: WorkoutPatch,
): WorkoutValidationError | null => {
  const touched =
    patch.name !== undefined ||
    patch.startedAt !== undefined ||
    patch.completedAt !== undefined ||
    patch.notes !== undefined ||
    patch.details !== undefined;
  if (!touched) return { kind: "empty_patch" };

  if (patch.name !== undefined) {
    const e = validateName(patch.name);
    if (e !== null) return e;
  }
  if (patch.startedAt !== undefined && !validateInstant(patch.startedAt)) {
    return { kind: "started_at_required" };
  }
  if (
    patch.completedAt !== undefined &&
    patch.completedAt !== null &&
    (patch.startedAt ?? stored.startedAt).getTime() >
      patch.completedAt.getTime()
  ) {
    return { kind: "completed_at_before_started_at" };
  }
  const e1 = validateNotes(patch.notes);
  if (e1 !== null) return e1;
  const e2 = validateDetails(patch.details);
  if (e2 !== null) return e2;
  return null;
};

/**
 * Apply a validated patch to a stored workout. Returns the new
 * stored shape with `updatedAt` advanced. Assumes the patch has
 * already passed `validateWorkoutPatch`; if it has not, the result
 * is undefined behaviour and the route layer is responsible for
 * rejecting it.
 */
export const applyWorkoutPatch = (
  stored: StoredWorkout,
  patch: WorkoutPatch,
  now: Date,
): StoredWorkout => {
  // `null` clears (the property is set explicitly to `null`); `undefined`
  // leaves the stored value alone.
  const completedAt =
    patch.completedAt === undefined ? stored.completedAt : patch.completedAt;
  return {
    id: stored.id,
    userId: stored.userId,
    ...(stored.clientOperationId !== undefined
      ? { clientOperationId: stored.clientOperationId }
      : {}),
    source: stored.source,
    name: patch.name === undefined ? stored.name : patch.name,
    startedAt:
      patch.startedAt === undefined ? stored.startedAt : patch.startedAt,
    completedAt,
    notes: patch.notes === undefined ? stored.notes : patch.notes,
    details:
      patch.details === undefined ? stored.details : { ...patch.details },
    createdAt: stored.createdAt,
    updatedAt: now,
  };
};

/**
 * Repository port. The Supabase adapter implements this against
 * the `public.workouts` table; tests implement it with an
 * in-memory map.
 */
export interface WorkoutRepository {
  /**
   * `accessToken` is the verified principal's bearer token. The
   * in-memory adapter ignores it; the Supabase adapter uses it
   * to construct a per-request client bound to the user's RLS
   * session. PERSIST-002.
   */
  create(
    userId: UserId,
    workout: StoredWorkout,
    options: { readonly accessToken: string },
  ): Promise<StoredWorkout>;
  /**
   * Return the user's workouts, bounded by `startedAt`, newest-first.
   * `limit` caps the page size. `kind` filters routines vs sessions.
   */
  list(
    userId: UserId,
    options: {
      readonly from: Date | null;
      readonly to: Date | null;
      readonly limit: number;
      readonly kind?: "routine" | "session" | undefined;
      readonly excludeRunning?: boolean;
      readonly accessToken: string;
    },
  ): Promise<ReadonlyArray<StoredWorkout>>;
  /**
   * Lookup a workout by its client-supplied operation id (idempotency key).
   * Used to prevent duplicate workouts when the client retries a start/create.
   */
  findByClientOperationId?(
    userId: UserId,
    clientOperationId: string,
    options: { readonly accessToken: string },
  ): Promise<StoredWorkout | null>;
  /**
   * Return the stored workout by id, or `null` when no workout
   * exists with that id for any user. The route is responsible
   * for the ownership check.
   */
  getById(
    id: string,
    options: { readonly accessToken: string },
  ): Promise<StoredWorkout | null>;
  /**
   * Apply a patch to an existing workout. Returns the new stored
   * shape. Throws if the workout id does not exist.
   */
  update(
    workout: StoredWorkout,
    options: { readonly accessToken: string },
  ): Promise<StoredWorkout>;
  /**
   * Permanently remove a workout. Returns `true` when the row
   * existed and was removed, `false` otherwise.
   */
  delete(
    id: string,
    options: { readonly accessToken: string },
  ): Promise<boolean>;
}

/** Activity types whose workouts are not strength sessions. */
export const NON_STRENGTH_ACTIVITY_TYPES = ["running", "bouldering"] as const;

export const isNonStrengthWorkoutDetails = (
  details: Readonly<Record<string, unknown>>,
): boolean =>
  (NON_STRENGTH_ACTIVITY_TYPES as readonly unknown[]).includes(
    details.activityType,
  ) ||
  Object.hasOwn(details, "runSummary") ||
  Object.hasOwn(details, "boulderSession");
