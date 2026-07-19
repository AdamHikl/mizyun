import type { UserId } from "./index.js";

/**
 * Goal domain types and validation rules (GOAL-001).
 *
 * Pure: no database, no transport, no SDK. The wire schema lives in
 * `@mizyun/contracts`; this module owns the closed goal vocabulary
 * and the repository port that adapters implement.
 */

export type GoalKind = "cut" | "recomp" | "maintain";

export type GoalPace = "steady" | "gradual" | "aggressive";

export type GoalStatus = "draft" | "active" | "completed" | "archived";

/**
 * Allowed status transitions. Mizyun intentionally does not allow
 * any other transition: completed and archived are terminal,
 * re-activation requires creating a new goal (which preserves history).
 */
export const ALLOWED_STATUS_TRANSITIONS: Readonly<
  Record<GoalStatus, ReadonlyArray<GoalStatus>>
> = {
  draft: ["active", "archived"],
  active: ["completed", "archived"],
  completed: [],
  archived: [],
};

/** Plausible adult weight range, in kilograms. */
export const WEIGHT_KG_MIN = 30;
export const WEIGHT_KG_MAX = 250;

/** Plausible body-fat range, in percent. */
export const BODY_FAT_PERCENT_MIN = 3;
export const BODY_FAT_PERCENT_MAX = 60;

/**
 * Domain target shape, keyed by goal kind. `weightKg` is mandatory
 * for every kind; `bodyFatPercent` is optional and only meaningful
 * for `recomp`.
 *
 * The `| undefined` annotation matches the wire schema's inferred
 * type so the route can pass a parsed Zod body straight through
 * `exactOptionalPropertyTypes: true`.
 */
export interface GoalTarget {
  readonly weightKg: number;
  readonly bodyFatPercent?: number | undefined;
}

/**
 * Plain goal shape the API accepts. The wire schema in
 * `@mizyun/contracts` adds `id`, `userId`, `createdAt`, `updatedAt`,
 * `status`, and `reviewDate` on top of this. This type is the editable
 * subset the route merges into the stored shape.
 */
export interface GoalCore {
  readonly kind: GoalKind;
  readonly pace: GoalPace;
  readonly target: GoalTarget;
  readonly startsOn: string;
  readonly targetDate: string;
  readonly reviewDate?: string;
}

/**
 * Full stored goal, including the user id, status, and audit
 * timestamps. The API layer maps `GoalCore` to this when reading
 * from the repository, and applies patches against the stored shape.
 */
export interface StoredGoal extends GoalCore {
  readonly id: string;
  readonly userId: UserId;
  readonly status: GoalStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Patch shape for `PUT /v1/goals/:id`. Status is the only field
 * that drives a transition; other fields update the stored value
 * directly. `reviewDate` accepts `null` to clear it.
 */
export type GoalPatch = {
  readonly status?: GoalStatus | undefined;
  readonly pace?: GoalPace | undefined;
  readonly target?: GoalTarget | undefined;
  readonly targetDate?: string | undefined;
  readonly reviewDate?: string | null | undefined;
};

/**
 * Why-not-valid reasons for a goal patch or create. The
 * discriminated union keeps the rejection reason machine-checkable
 * at the route layer (which translates it into the `apiErrorSchema`
 * `code`).
 */
export type GoalValidationError =
  | { readonly kind: "empty_patch" }
  | { readonly kind: "target_date_before_start" }
  | { readonly kind: "review_date_before_start" }
  | {
      readonly kind: "weight_out_of_range";
      readonly min: number;
      readonly max: number;
    }
  | {
      readonly kind: "body_fat_out_of_range";
      readonly min: number;
      readonly max: number;
    }
  | { readonly kind: "invalid_date_format"; readonly value: string }
  | {
      readonly kind: "invalid_status_transition";
      readonly from: GoalStatus;
      readonly to: GoalStatus;
    };

/**
 * Validate the create body. Returns the first failure reason or
 * `null` when the body passes.
 */
export const validateGoalCreate = (create: {
  readonly kind: GoalKind;
  readonly pace: GoalPace;
  readonly target: GoalTarget;
  readonly startsOn: string;
  readonly targetDate: string;
  readonly reviewDate?: string;
}): GoalValidationError | null => {
  const startsOn = create.startsOn;
  const targetDate = create.targetDate;
  const reviewDate = create.reviewDate;

  if (!isIsoDate(startsOn)) {
    return { kind: "invalid_date_format", value: startsOn };
  }
  if (!isIsoDate(targetDate)) {
    return { kind: "invalid_date_format", value: targetDate };
  }
  if (reviewDate !== undefined && !isIsoDate(reviewDate)) {
    return { kind: "invalid_date_format", value: reviewDate };
  }

  if (targetDate < startsOn) {
    return { kind: "target_date_before_start" };
  }
  if (reviewDate !== undefined && reviewDate < startsOn) {
    return { kind: "review_date_before_start" };
  }

  const weightError = validateWeight(create.target.weightKg);
  if (weightError !== null) return weightError;
  const bodyFatError = validateBodyFat(create.target.bodyFatPercent);
  if (bodyFatError !== null) return bodyFatError;
  return null;
};

/**
 * Validate the patch body. `kind` cannot be patched (the goal kind
 * is set at creation; changing it would distort history). Status is
 * validated against the transition table; other fields are checked
 * for shape.
 */
export const validateGoalPatch = (
  stored: StoredGoal,
  patch: GoalPatch,
): GoalValidationError | null => {
  const touched =
    patch.status !== undefined ||
    patch.pace !== undefined ||
    patch.target !== undefined ||
    patch.targetDate !== undefined ||
    patch.reviewDate !== undefined;

  if (!touched) return { kind: "empty_patch" };

  if (patch.status !== undefined && patch.status !== stored.status) {
    const allowed = ALLOWED_STATUS_TRANSITIONS[stored.status];
    if (!allowed.includes(patch.status)) {
      return {
        kind: "invalid_status_transition",
        from: stored.status,
        to: patch.status,
      };
    }
  }

  if (patch.targetDate !== undefined && patch.targetDate < stored.startsOn) {
    return { kind: "target_date_before_start" };
  }
  if (
    patch.reviewDate !== undefined &&
    patch.reviewDate !== null &&
    patch.reviewDate < stored.startsOn
  ) {
    return { kind: "review_date_before_start" };
  }

  if (patch.target !== undefined) {
    const weightError = validateWeight(patch.target.weightKg);
    if (weightError !== null) return weightError;
    const bodyFatError = validateBodyFat(patch.target.bodyFatPercent);
    if (bodyFatError !== null) return bodyFatError;
  }
  return null;
};

/**
 * Apply a validated patch to a stored goal. Returns the new stored
 * shape with `updatedAt` advanced. Assumes the patch has already
 * passed `validateGoalPatch`; if it has not, the result is undefined
 * behaviour and the route layer is responsible for rejecting it.
 */
export const applyGoalPatch = (
  stored: StoredGoal,
  patch: GoalPatch,
  now: Date,
): StoredGoal => ({
  id: stored.id,
  userId: stored.userId,
  kind: stored.kind,
  status: patch.status === undefined ? stored.status : patch.status,
  pace: patch.pace === undefined ? stored.pace : patch.pace,
  target: patch.target === undefined ? stored.target : patch.target,
  startsOn: stored.startsOn,
  targetDate:
    patch.targetDate === undefined ? stored.targetDate : patch.targetDate,
  // clearing (null) and updating both flow through here; `undefined`
  // leaves the stored value alone.
  ...(patch.reviewDate === undefined
    ? stored.reviewDate !== undefined
      ? { reviewDate: stored.reviewDate }
      : {}
    : patch.reviewDate === null
      ? {}
      : { reviewDate: patch.reviewDate }),
  createdAt: stored.createdAt,
  updatedAt: now,
});

/**
 * Repository port. The Supabase adapter implements this against the
 * `public.goals` table (and a future `goal_history` table or view);
 * tests implement it with an in-memory map.
 */
export interface GoalRepository {
  /**
   * `accessToken` is the verified principal's bearer token. The
   * in-memory adapter ignores it; the Supabase adapter uses it
   * to construct a per-request client bound to the user's RLS
   * session. PERSIST-001.
   */
  getActive(
    userId: UserId,
    options: { readonly accessToken: string },
  ): Promise<StoredGoal | null>;
  /**
   * Return the full goal history (newest first), including draft,
   * active, completed, and archived goals. Empty array if the user
   * has never created a goal.
   */
  getHistory(
    userId: UserId,
    options: { readonly accessToken: string },
  ): Promise<ReadonlyArray<StoredGoal>>;
  /**
   * Insert a new goal. The repository must ensure the user does
   * not already have an active goal of the same kind (or any kind,
   * depending on the future product decision). For GOAL-001 we
   * allow at most one active goal; the SQL implementation will use
   * the partial unique index.
   */
  create(
    userId: UserId,
    goal: StoredGoal,
    options: { readonly accessToken: string },
  ): Promise<StoredGoal>;
  /**
   * Apply a patch to an existing goal. Returns the new stored shape.
   * Throws if the goal id does not belong to the user.
   */
  update(
    userId: UserId,
    goal: StoredGoal,
    options: { readonly accessToken: string },
  ): Promise<StoredGoal>;
}

/** Validate an ISO `YYYY-MM-DD` date. */
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const isIsoDate = (value: string): boolean =>
  ISO_DATE_PATTERN.test(value) && !Number.isNaN(Date.parse(value));

const validateWeight = (value: number): GoalValidationError | null => {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < WEIGHT_KG_MIN ||
    value > WEIGHT_KG_MAX
  ) {
    return {
      kind: "weight_out_of_range",
      min: WEIGHT_KG_MIN,
      max: WEIGHT_KG_MAX,
    };
  }
  return null;
};

const validateBodyFat = (
  value: number | undefined,
): GoalValidationError | null => {
  if (value === undefined) return null;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < BODY_FAT_PERCENT_MIN ||
    value > BODY_FAT_PERCENT_MAX
  ) {
    return {
      kind: "body_fat_out_of_range",
      min: BODY_FAT_PERCENT_MIN,
      max: BODY_FAT_PERCENT_MAX,
    };
  }
  return null;
};
