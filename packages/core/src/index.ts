export type Brand<T, Name extends string> = T & { readonly __brand: Name };

export type UserId = Brand<string, "UserId">;
export type ConversationId = Brand<string, "ConversationId">;
export type MemoryId = Brand<string, "MemoryId">;

export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

export const err = <E>(error: E): Result<never, E> => ({
  ok: false,
  error,
});

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export {
  applyProfilePatch,
  validateProfilePatch,
  HEIGHT_CM_MIN,
  HEIGHT_CM_MAX,
  BIRTH_YEAR_MIN,
  DEFAULT_TIMEZONE,
  DEFAULT_UNIT_SYSTEM,
  DISPLAY_NAME_MAX,
  type ProfileCore,
  type ProfilePatch,
  type ProfileRepository,
  type ProfileValidationError,
  type StoredProfile,
  type UnitSystem,
} from "./profile";

export {
  ALLOWED_STATUS_TRANSITIONS,
  BODY_FAT_PERCENT_MAX,
  BODY_FAT_PERCENT_MIN,
  WEIGHT_KG_MAX,
  WEIGHT_KG_MIN,
  applyGoalPatch,
  validateGoalCreate,
  validateGoalPatch,
  type GoalCore,
  type GoalKind,
  type GoalPace,
  type GoalPatch,
  type GoalRepository,
  type GoalStatus,
  type GoalTarget,
  type GoalValidationError,
  type StoredGoal,
} from "./goal";

export {
  CALORIES_MAX,
  CALORIES_MIN,
  FOOD_NAME_MAX,
  MACRO_MAX,
  MACRO_MIN,
  applyFoodEntryPatch,
  summariseFoodEntries,
  validateFoodEntryCreate,
  validateFoodEntryPatch,
  type DailyFoodSummary,
  type FoodEntryCore,
  type FoodEntryPatch,
  type FoodEntryRepository,
  type FoodEntryValidationError,
  type FoodSource,
  type StoredFoodEntry,
} from "./food-entry";
