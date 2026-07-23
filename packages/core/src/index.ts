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
  type ProfileActivityLevel,
  type ProfileCore,
  type ProfilePatch,
  type ProfileRepository,
  type ProfileSexAtBirth,
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

export {
  EXERCISE_NAME_MAX,
  INSTRUCTIONS_MAX,
  applyExercisePatch,
  validateExerciseCreate,
  validateExercisePatch,
  type ExerciseCore,
  type ExercisePatch,
  type ExerciseRepository,
  type ExerciseValidationError,
  type StoredExercise,
} from "./exercise";

export {
  NOTES_MAX,
  WORKOUT_NAME_MAX,
  applyWorkoutPatch,
  validateWorkoutCreate,
  validateWorkoutPatch,
  type StoredWorkout,
  type WorkoutCore,
  type WorkoutPatch,
  type WorkoutRepository,
  type WorkoutSource,
  type WorkoutValidationError,
} from "./workout";

export {
  MAX_DISTANCE_METERS,
  MAX_DURATION_SECONDS,
  MAX_LOAD_KG,
  MAX_PERCEIVED_EXERTION,
  MAX_REPETITIONS,
  MAX_SEQUENCE,
  MIN_PERCEIVED_EXERTION,
  summariseExerciseSets,
  validateWorkoutSetCreate,
  type ExerciseRecentSetsSummary,
  type StoredWorkoutSet,
  type WorkoutSetCore,
  type WorkoutSetRepository,
  type WorkoutSetValidationError,
} from "./workout-set";

export {
  type AccountDeletionError,
  type AccountExport,
  type AccountRepository,
  type StoredConversationStub,
} from "./account";

export {
  ACTIVITY_MULTIPLIERS,
  CURRENT_YEAR_REF,
  ENERGY_FORMULA_VERSION,
  ageFromBirthYear,
  computeEnergy,
  estimateExerciseKcal,
  mifflinStJeorBmr,
  mifflinStJeorFormula,
  type ActivityLevel,
  type EnergyBreakdown,
  type EnergyComputeResult,
  type EnergyFormula,
  type EnergyIncompleteReason,
  type EnergyInputs,
  type SexAtBirth,
} from "./energy";

export {
  MEDIA_ALLOWED_MIME_TYPES,
  MEDIA_MAX_BYTE_SIZE,
  MEDIA_MAX_DIMENSION,
  MEDIA_MIN_DIMENSION,
  MEDIA_PURPOSES,
  buildMediaTimeline,
  buildObjectPath,
  compareMediaAssets,
  validateMediaAssetCreate,
  type MediaAssetCore,
  type MediaAssetRepository,
  type MediaAssetValidationError,
  type MediaPurpose,
  type MediaTimelineDayBucket,
  type StoredMediaAsset,
} from "./media-asset";

export {
  type ConversationMessageRole,
  type ConversationMessageStatus,
  type ConversationRepository,
  type ConversationRepositoryOptions,
  type ConversationStatus,
  type StoredConversation,
  type StoredConversationMessage,
} from "./conversation";

export {
  BODY_WEIGHT_KG_MAX,
  BODY_WEIGHT_KG_MIN,
  summariseWeightTrend,
  validateBodyMeasurementCreate,
  type BodyMeasurementCore,
  type BodyMeasurementRepository,
  type BodyMeasurementSource,
  type BodyMeasurementValidationError,
  type StoredBodyMeasurement,
  type WeightTrendSummary,
} from "./body-measurement";
