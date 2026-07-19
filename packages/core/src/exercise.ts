import type { UserId } from "./index";

/**
 * Exercise domain types and validation rules (EX-001).
 *
 * Pure: no database, no transport, no SDK. The wire schema lives in
 * `@mizyun/contracts`; this module owns the bounded name rules and
 * the repository port that adapters implement.
 *
 * The shape mirrors `public.exercises`:
 *   - `name` is the user-visible label. Mandatory and bounded to a
 *     sane length so it renders cleanly in a picker.
 *   - `instructions` is a free-form text field the user can use for
 *     cues. Nullable: most exercises have no text.
 *   - `metadata` is an open `Record<string, unknown>` reserved for
 *     the future AI path. The validator does not inspect its
 *     contents.
 */

/** Bounded name length. Long enough for "Romanian deadlift (barbell)". */
export const EXERCISE_NAME_MAX = 120;

/** Bounded instructions length. ~3 paragraphs of plain text. */
export const INSTRUCTIONS_MAX = 4_000;

/**
 * Editable domain shape. The wire schema in `@mizyun/contracts`
 * adds `id`, `userId`, and audit timestamps. This type is the
 * editable subset the route accepts and returns.
 */
export interface ExerciseCore {
  readonly name: string;
  readonly instructions: string | null;
  readonly metadata: Readonly<Record<string, unknown>>;
}

/**
 * Full stored exercise, including the user id and audit timestamps.
 * The API layer maps `ExerciseCore` to this when reading from the
 * repository, and applies patches against the stored shape.
 */
export interface StoredExercise extends ExerciseCore {
  readonly id: string;
  readonly userId: UserId;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Patch shape for `PUT /v1/exercises/:id`. Every field is optional.
 * Setting `instructions` to `null` clears it. Setting `metadata`
 * replaces the stored object wholesale.
 *
 * The `| undefined` per-field is required because the wire schema
 * (`exercisePatchSchema` in `@mizyun/contracts`) uses Zod's
 * `.optional()`, which produces `T | undefined` under
 * `exactOptionalPropertyTypes: true`.
 */
export type ExercisePatch = {
  readonly name?: string | undefined;
  readonly instructions?: string | null | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
};

/**
 * Why-not-valid reasons for an exercise create or patch. The
 * discriminated union keeps the rejection reason machine-checkable
 * at the route layer (which translates it into the `apiErrorSchema`
 * `code`).
 */
export type ExerciseValidationError =
  | { readonly kind: "empty_patch" }
  | { readonly kind: "name_empty" }
  | { readonly kind: "name_too_long"; readonly max: number }
  | { readonly kind: "instructions_too_long"; readonly max: number }
  | { readonly kind: "metadata_must_be_object" };

const isBlank = (value: string): boolean => value.trim().length === 0;

const validateName = (value: string): ExerciseValidationError | null => {
  if (isBlank(value)) return { kind: "name_empty" };
  if (value.length > EXERCISE_NAME_MAX) {
    return { kind: "name_too_long", max: EXERCISE_NAME_MAX };
  }
  return null;
};

const validateInstructions = (
  value: string | null | undefined,
): ExerciseValidationError | null => {
  if (value === undefined || value === null) return null;
  if (value.length > INSTRUCTIONS_MAX) {
    return { kind: "instructions_too_long", max: INSTRUCTIONS_MAX };
  }
  return null;
};

const validateMetadata = (
  value: Readonly<Record<string, unknown>> | undefined,
): ExerciseValidationError | null => {
  if (value === undefined) return null;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { kind: "metadata_must_be_object" };
  }
  return null;
};

/**
 * Validate a create body. `name` is required; everything else is
 * optional. The route supplies `instructions = null` and
 * `metadata = {}` when the client omitted them.
 */
export const validateExerciseCreate = (create: {
  readonly name: string;
  readonly instructions?: string | null;
  readonly metadata?: Readonly<Record<string, unknown>>;
}): ExerciseValidationError | null => {
  const e0 = validateName(create.name);
  if (e0 !== null) return e0;
  const e1 = validateInstructions(create.instructions);
  if (e1 !== null) return e1;
  const e2 = validateMetadata(create.metadata);
  if (e2 !== null) return e2;
  return null;
};

/**
 * Validate a patch body. Empty patches are rejected because they
 * have no effect.
 */
export const validateExercisePatch = (
  patch: ExercisePatch,
): ExerciseValidationError | null => {
  const touched =
    patch.name !== undefined ||
    patch.instructions !== undefined ||
    patch.metadata !== undefined;
  if (!touched) return { kind: "empty_patch" };

  if (patch.name !== undefined) {
    const e = validateName(patch.name);
    if (e !== null) return e;
  }
  const e1 = validateInstructions(patch.instructions);
  if (e1 !== null) return e1;
  const e2 = validateMetadata(patch.metadata);
  if (e2 !== null) return e2;
  return null;
};

/**
 * Apply a validated patch to a stored exercise. Returns the new
 * stored shape with `updatedAt` advanced. Assumes the patch has
 * already passed `validateExercisePatch`; if it has not, the result
 * is undefined behaviour and the route layer is responsible for
 * rejecting it.
 */
export const applyExercisePatch = (
  stored: StoredExercise,
  patch: ExercisePatch,
  now: Date,
): StoredExercise => ({
  id: stored.id,
  userId: stored.userId,
  name: patch.name === undefined ? stored.name : patch.name,
  instructions:
    patch.instructions === undefined ? stored.instructions : patch.instructions,
  metadata:
    patch.metadata === undefined ? stored.metadata : { ...patch.metadata },
  createdAt: stored.createdAt,
  updatedAt: now,
});

/**
 * Repository port. The Supabase adapter implements this against the
 * `public.exercises` table; tests implement it with an in-memory
 * array.
 */
export interface ExerciseRepository {
  /**
   * `accessToken` is the verified principal's bearer token. The
   * in-memory adapter ignores it; the Supabase adapter uses it
   * to construct a per-request client bound to the user's RLS
   * session. PERSIST-002.
   */
  create(
    userId: UserId,
    exercise: StoredExercise,
    options: { readonly accessToken: string },
  ): Promise<StoredExercise>;
  /**
   * Return every exercise the user has created, ordered by name
   * (case-insensitive) for a stable picker experience. `limit`
   * caps the page size.
   */
  list(
    userId: UserId,
    options: { readonly limit: number; readonly accessToken: string },
  ): Promise<ReadonlyArray<StoredExercise>>;
  /**
   * Return the stored exercise by id, or `null` when no exercise
   * exists with that id for any user. The route is responsible
   * for the ownership check (it filters on `userId` after the call).
   */
  getById(
    id: string,
    options: { readonly accessToken: string },
  ): Promise<StoredExercise | null>;
  /**
   * Apply a patch to an existing exercise. Returns the new stored
   * shape. Throws if the exercise id does not exist.
   */
  update(
    exercise: StoredExercise,
    options: { readonly accessToken: string },
  ): Promise<StoredExercise>;
  /**
   * Permanently remove an exercise. Returns `true` when the row
   * existed and was removed, `false` otherwise. The route is the
   * owner of the 404 decision (no idempotency-200 on miss).
   */
  delete(
    id: string,
    options: { readonly accessToken: string },
  ): Promise<boolean>;
}
