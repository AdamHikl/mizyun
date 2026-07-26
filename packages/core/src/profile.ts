import type { UserId } from "./index.js";

/**
 * Domain types and validation rules for the user profile (PROF-001).
 *
 * Pure: no database, no transport, no SDK. The wire schema lives in
 * `@mizyun/contracts`; this module owns the business rules and the
 * repository port that adapters implement.
 */

/** Closed set of unit systems. Mirrors the SQL check constraint. */
export type UnitSystem = "metric" | "imperial";

/**
 * Closed activity-level category. Mirrors the energy engine's
 * `ActivityLevel` so the profile carries the same vocabulary the
 * route consumes. A future segment moves the energy types here
 * and re-exports; the alias keeps the two in sync today.
 */
export type ProfileActivityLevel =
  | "sedentary"
  | "lightly_active"
  | "moderately_active"
  | "very_active"
  | "extra_active";

/** Closed biological-sex category. */
export type ProfileSexAtBirth = "male" | "female";

export const EXPERIENCE_LEVELS = [
  "beginner",
  "intermediate",
  "advanced",
] as const;
export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number];

export const TRAINING_FOCUS_PREFERENCES = [
  "balanced",
  "strength",
  "hypertrophy",
  "endurance",
] as const;
export type TrainingFocusPreference =
  (typeof TRAINING_FOCUS_PREFERENCES)[number];

export const EQUIPMENT_OPTIONS = [
  "bodyweight",
  "dumbbells",
  "barbell",
  "bench",
  "rack",
  "cable_machine",
  "resistance_bands",
  "pullup_bar",
  "cardio_machine",
  "full_gym",
] as const;
export type EquipmentOption = (typeof EQUIPMENT_OPTIONS)[number];

export const DIETARY_PREFERENCE_OPTIONS = [
  "omnivore",
  "vegetarian",
  "vegan",
  "pescatarian",
  "halal",
  "kosher",
  "lactose_free",
  "gluten_free",
] as const;
export type DietaryPreference = (typeof DIETARY_PREFERENCE_OPTIONS)[number];

/**
 * User-selected movement constraints. These are non-medical controls,
 * not diagnoses; the Coach must not infer a condition from them.
 */
export const TRAINING_LIMITATION_OPTIONS = [
  "low_impact_only",
  "no_overhead_work",
  "no_running",
  "no_jumping",
  "limited_knee_flexion",
  "limited_spinal_loading",
] as const;
export type TrainingLimitation = (typeof TRAINING_LIMITATION_OPTIONS)[number];

export interface CoachingPreferences {
  readonly experienceLevel: ExperienceLevel | null;
  readonly trainingDaysPerWeek: number | null;
  readonly sessionDurationMinutes: number | null;
  readonly trainingFocus: TrainingFocusPreference | null;
  readonly availableEquipment: readonly EquipmentOption[];
  readonly dietaryPreferences: readonly DietaryPreference[];
  readonly trainingLimitations: readonly TrainingLimitation[];
}

export const DEFAULT_COACHING_PREFERENCES: CoachingPreferences = {
  experienceLevel: null,
  trainingDaysPerWeek: null,
  sessionDurationMinutes: null,
  trainingFocus: null,
  availableEquipment: [],
  dietaryPreferences: [],
  trainingLimitations: [],
};

/** Plausible adult height range, in centimetres. Stored canonical. */
export const HEIGHT_CM_MIN = 50;
export const HEIGHT_CM_MAX = 260;

/** Plausible birth-year range. Year is stored; age is derived. */
export const BIRTH_YEAR_MIN = 1900;

/** Maximum length, in characters, of a profile display name. */
export const DISPLAY_NAME_MAX = 80;

/** Default profile values used when the SQL trigger has not yet run. */
export const DEFAULT_TIMEZONE = "UTC";
export const DEFAULT_UNIT_SYSTEM: UnitSystem = "metric";

/** Closed set of plan tiers. Mirrors the SQL check on `profiles.plan_tier`. */
export type PlanTier = "free" | "paid";

export const DEFAULT_PLAN_TIER: PlanTier = "free";

/**
 * Plain profile shape. The wire schema in `@mizyun/contracts` is the
 * superset (it also carries `userId`, `createdAt`, `updatedAt`). This
 * domain type is the editable subset the API accepts and returns.
 */
export interface ProfileCore {
  readonly displayName: string | null;
  readonly unitSystem: UnitSystem;
  readonly timezone: string;
  readonly birthYear: number | null;
  readonly heightCm: number | null;
  readonly activityLevel: ProfileActivityLevel | null;
  readonly sexAtBirth: ProfileSexAtBirth | null;
  readonly coachingPreferences: CoachingPreferences;
  readonly planTier: PlanTier;
}

/**
 * Full stored profile, including the user id and audit timestamps. The
 * API layer maps `ProfileCore` to this when reading from the
 * repository, and applies patches against the stored shape.
 */
export interface StoredProfile extends ProfileCore {
  readonly userId: UserId;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Patch shape for `PUT /v1/profile`. Every field is genuinely
 * optional; callers may set or clear any nullable field. The validator
 * rejects patches that touch no field at all (a no-op PUT).
 *
 * The `| undefined` per-field is required because the wire schema
 * (`profilePatchSchema` in `@mizyun/contracts`) uses Zod's
 * `.optional()`, which produces `T | undefined` under
 * `exactOptionalPropertyTypes: true`. Matching the wire type exactly
 * at the domain layer means the route can hand the parsed body to
 * `applyProfilePatch` without a cast.
 */
export type ProfilePatch = {
  readonly displayName?: string | null | undefined;
  readonly unitSystem?: UnitSystem | undefined;
  readonly timezone?: string | undefined;
  readonly birthYear?: number | null | undefined;
  readonly heightCm?: number | null | undefined;
  readonly activityLevel?: ProfileActivityLevel | null | undefined;
  readonly sexAtBirth?: ProfileSexAtBirth | null | undefined;
  readonly coachingPreferences?: CoachingPreferences | undefined;
};

/**
 * Why-not-valid reasons for a profile patch. The discriminated union
 * keeps the rejection reason machine-checkable at the route layer
 * (which translates it into the `apiErrorSchema` `code`).
 */
export type ProfileValidationError =
  | { readonly kind: "empty_patch" }
  | { readonly kind: "display_name_too_long"; readonly max: number }
  | { readonly kind: "display_name_empty" }
  | { readonly kind: "invalid_timezone"; readonly value: string }
  | {
      readonly kind: "height_out_of_range";
      readonly min: number;
      readonly max: number;
    }
  | {
      readonly kind: "birth_year_out_of_range";
      readonly min: number;
      readonly max: number;
    }
  | { readonly kind: "invalid_unit_system"; readonly value: string }
  | { readonly kind: "invalid_activity_level"; readonly value: string }
  | { readonly kind: "invalid_sex_at_birth"; readonly value: string }
  | { readonly kind: "invalid_coaching_preferences" };

const TIMEZONE_PATTERN = /^[A-Za-z][A-Za-z0-9_+\-/]*$/;
const MAX_BIRTH_YEAR = () => new Date().getUTCFullYear();

const ACTIVITY_LEVEL_VALUES = [
  "sedentary",
  "lightly_active",
  "moderately_active",
  "very_active",
  "extra_active",
] as const;

const SEX_AT_BIRTH_VALUES = ["male", "female"] as const;

const isBlank = (value: string): boolean => value.trim().length === 0;

/**
 * Validate a single field's value. Returns the failure reason or
 * `null` when the value passes. Per-field validators keep the
 * narrowed types intact without relying on a generic dispatch.
 */
const validateDisplayName = (
  value: string | null | undefined,
): ProfileValidationError | null => {
  if (value === undefined || value === null) return null; // clearing is always allowed
  if (isBlank(value)) return { kind: "display_name_empty" };
  if (value.length > DISPLAY_NAME_MAX) {
    return { kind: "display_name_too_long", max: DISPLAY_NAME_MAX };
  }
  return null;
};

const validateUnitSystem = (
  value: UnitSystem | undefined,
): ProfileValidationError | null => {
  if (value === undefined) return null;
  if (value !== "metric" && value !== "imperial") {
    return { kind: "invalid_unit_system", value };
  }
  return null;
};

const validateActivityLevel = (
  value: ProfileActivityLevel | null | undefined,
): ProfileValidationError | null => {
  if (value === undefined || value === null) return null;
  if (!(ACTIVITY_LEVEL_VALUES as ReadonlyArray<string>).includes(value)) {
    return { kind: "invalid_activity_level", value };
  }
  return null;
};

const validateSexAtBirth = (
  value: ProfileSexAtBirth | null | undefined,
): ProfileValidationError | null => {
  if (value === undefined || value === null) return null;
  if (!(SEX_AT_BIRTH_VALUES as ReadonlyArray<string>).includes(value)) {
    return { kind: "invalid_sex_at_birth", value };
  }
  return null;
};

const validateTimezone = (
  value: string | undefined,
): ProfileValidationError | null => {
  if (value === undefined) return null;
  if (isBlank(value) || !TIMEZONE_PATTERN.test(value)) {
    return { kind: "invalid_timezone", value };
  }
  return null;
};

const validateBirthYear = (
  value: number | null | undefined,
): ProfileValidationError | null => {
  if (value === undefined || value === null) return null;
  const max = MAX_BIRTH_YEAR();
  if (!Number.isInteger(value) || value < BIRTH_YEAR_MIN || value > max) {
    return { kind: "birth_year_out_of_range", min: BIRTH_YEAR_MIN, max };
  }
  return null;
};

const validateHeightCm = (
  value: number | null | undefined,
): ProfileValidationError | null => {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < HEIGHT_CM_MIN ||
    value > HEIGHT_CM_MAX
  ) {
    return {
      kind: "height_out_of_range",
      min: HEIGHT_CM_MIN,
      max: HEIGHT_CM_MAX,
    };
  }
  return null;
};

const uniqueKnownValues = (
  values: readonly string[],
  allowed: readonly string[],
): boolean =>
  new Set(values).size === values.length &&
  values.every((value) => allowed.includes(value));

const validateCoachingPreferences = (
  value: CoachingPreferences | undefined,
): ProfileValidationError | null => {
  if (value === undefined) return null;
  const baseDietCount = value.dietaryPreferences.filter((preference) =>
    ["omnivore", "vegetarian", "vegan", "pescatarian"].includes(preference),
  ).length;
  if (
    (value.experienceLevel !== null &&
      !EXPERIENCE_LEVELS.includes(value.experienceLevel)) ||
    (value.trainingFocus !== null &&
      !TRAINING_FOCUS_PREFERENCES.includes(value.trainingFocus)) ||
    (value.trainingDaysPerWeek !== null &&
      (!Number.isInteger(value.trainingDaysPerWeek) ||
        value.trainingDaysPerWeek < 1 ||
        value.trainingDaysPerWeek > 7)) ||
    (value.sessionDurationMinutes !== null &&
      (!Number.isInteger(value.sessionDurationMinutes) ||
        value.sessionDurationMinutes < 15 ||
        value.sessionDurationMinutes > 180)) ||
    !uniqueKnownValues(value.availableEquipment, EQUIPMENT_OPTIONS) ||
    !uniqueKnownValues(value.dietaryPreferences, DIETARY_PREFERENCE_OPTIONS) ||
    !uniqueKnownValues(
      value.trainingLimitations,
      TRAINING_LIMITATION_OPTIONS,
    ) ||
    baseDietCount > 1
  ) {
    return { kind: "invalid_coaching_preferences" };
  }
  return null;
};

/**
 * Validate the patch as a whole. Returns `null` on success or the
 * first failure reason encountered. The route layer wraps the failure
 * into the `apiErrorSchema` `code`.
 */
export const validateProfilePatch = (
  patch: ProfilePatch,
): ProfileValidationError | null => {
  const errors: ProfileValidationError[] = [];
  const e1 = validateDisplayName(patch.displayName);
  if (e1 !== null) errors.push(e1);
  const e2 = validateUnitSystem(patch.unitSystem);
  if (e2 !== null) errors.push(e2);
  const e3 = validateTimezone(patch.timezone);
  if (e3 !== null) errors.push(e3);
  const e4 = validateBirthYear(patch.birthYear);
  if (e4 !== null) errors.push(e4);
  const e5 = validateHeightCm(patch.heightCm);
  if (e5 !== null) errors.push(e5);
  const e6 = validateActivityLevel(patch.activityLevel);
  if (e6 !== null) errors.push(e6);
  const e7 = validateSexAtBirth(patch.sexAtBirth);
  if (e7 !== null) errors.push(e7);
  const e8 = validateCoachingPreferences(patch.coachingPreferences);
  if (e8 !== null) errors.push(e8);

  if (errors.length === 0) {
    // Empty patch is still rejected because it has no effect.
    const anyTouched =
      patch.displayName !== undefined ||
      patch.unitSystem !== undefined ||
      patch.timezone !== undefined ||
      patch.birthYear !== undefined ||
      patch.heightCm !== undefined ||
      patch.activityLevel !== undefined ||
      patch.sexAtBirth !== undefined ||
      patch.coachingPreferences !== undefined;
    return anyTouched ? null : { kind: "empty_patch" };
  }
  return errors[0] as ProfileValidationError;
};

/**
 * Apply a validated patch to a stored profile. Returns the new
 * profile with `updatedAt` advanced. Assumes the patch has already
 * passed `validateProfilePatch`; if it has not, the result is
 * undefined behaviour and the route layer is responsible for
 * rejecting it.
 *
 * `planTier` is preserved verbatim. It is not editable from the
 * public PATCH endpoint — billing (BILL-001) owns that surface.
 */
export const applyProfilePatch = (
  stored: StoredProfile,
  patch: ProfilePatch,
  now: Date,
): StoredProfile => ({
  userId: stored.userId,
  displayName:
    patch.displayName === undefined ? stored.displayName : patch.displayName,
  unitSystem:
    patch.unitSystem === undefined ? stored.unitSystem : patch.unitSystem,
  timezone: patch.timezone === undefined ? stored.timezone : patch.timezone,
  birthYear: patch.birthYear === undefined ? stored.birthYear : patch.birthYear,
  heightCm: patch.heightCm === undefined ? stored.heightCm : patch.heightCm,
  activityLevel:
    patch.activityLevel === undefined
      ? stored.activityLevel
      : patch.activityLevel,
  sexAtBirth:
    patch.sexAtBirth === undefined ? stored.sexAtBirth : patch.sexAtBirth,
  coachingPreferences:
    patch.coachingPreferences === undefined
      ? stored.coachingPreferences
      : patch.coachingPreferences,
  planTier: stored.planTier,
  createdAt: stored.createdAt,
  updatedAt: now,
});

/**
 * Repository port. The Supabase adapter implements this against the
 * `public.profiles` table; tests implement it with an in-memory map.
 *
 * `getOrCreate` is the read entry point: the SQL trigger creates a
 * row on user signup, but a client could race ahead of the trigger
 * (e.g. polling `/v1/me`-style endpoints before the trigger fires).
 * The implementation is responsible for the idempotent create.
 */
export interface ProfileRepository {
  /**
   * `accessToken` is the verified principal's bearer token. The
   * in-memory adapter ignores it; the Supabase adapter uses it
   * to construct a per-request client bound to the user's RLS
   * session. PERSIST-001.
   */
  getOrCreate(
    userId: UserId,
    defaults: { readonly now: Date; readonly accessToken: string },
  ): Promise<StoredProfile>;
  update(
    userId: UserId,
    next: StoredProfile,
    options: { readonly accessToken: string },
  ): Promise<StoredProfile>;
}
