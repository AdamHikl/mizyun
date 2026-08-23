import { z } from "zod";

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string().optional(),
  }),
});

export type ApiError = z.infer<typeof apiErrorSchema>;

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("mizyun-api"),
  timestamp: z.string().datetime(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const chatRoleSchema = z.enum(["user", "assistant"]);

export const chatMessageSchema = z.object({
  role: chatRoleSchema,
  text: z.string().trim().min(1).max(20_000),
});

export const coachRequestSchema = z.object({
  conversationId: z.string().uuid().optional(),
  message: chatMessageSchema.refine((message) => message.role === "user", {
    message: "A new coach message must use the user role.",
  }),
});

export type CoachRequest = z.infer<typeof coachRequestSchema>;

export const coachResponseSchema = z.object({
  conversationId: z.string().uuid(),
  message: chatMessageSchema.refine((message) => message.role === "assistant", {
    message: "A coach response must use the assistant role.",
  }),
  provider: z.string(),
});

export type CoachResponse = z.infer<typeof coachResponseSchema>;

export {
  coachActionProposalSchema,
  coachDailyPlanProposalSchema,
  coachMultiWorkoutPlanProposalSchema,
  coachMultiWorkoutPlanProposalSessionSchema,
  coachWeeklyAdaptationProposalSchema,
  coachWeeklyAdaptationAcceptResponseSchema,
  coachConversationCreateSchema,
  coachConversationListResponseSchema,
  coachConversationPatchSchema,
  coachConversationResponseSchema,
  coachConversationSchema,
  coachConversationStatusSchema,
  coachMemoryKindSchema,
  coachMemoryCreateSchema,
  coachMemoryListResponseSchema,
  coachMemoryPatchSchema,
  coachMemoryResponseSchema,
  coachMemorySchema,
  coachMemoryStatusSchema,
  coachMemorySummarySchema,
  coachMessageCreateSchema,
  coachMessageResponseSchema,
  coachMessageSchema,
  coachNutritionProposalSchema,
  coachProviderStatusSchema,
  coachThreadResponseSchema,
  coachWorkoutProposalSchema,
  type CoachActionProposal,
  type CoachDailyPlanProposal,
  type CoachMultiWorkoutPlanProposal,
  type CoachMultiWorkoutPlanProposalSession,
  type CoachWeeklyAdaptationProposal,
  type CoachWeeklyAdaptationAcceptResponse,
  type CoachConversation,
  type CoachConversationCreate,
  type CoachConversationListResponse,
  type CoachConversationPatch,
  type CoachConversationResponse,
  type CoachMemory,
  type CoachMemoryCreate,
  type CoachMemoryKind,
  type CoachMemoryListResponse,
  type CoachMemoryPatch,
  type CoachMemoryResponse,
  type CoachMemoryStatus,
  type CoachMemorySummary,
  type CoachMessage,
  type CoachMessageCreate,
  type CoachMessageResponse,
  type CoachNutritionProposal,
  type CoachProviderStatus,
  type CoachThreadResponse,
  type CoachWorkoutProposal,
} from "./coach";

/**
 * Wire schema for the verified principal returned by `/v1/me`. Decoupled
 * from `@mizyun/identity`'s runtime `AuthPrincipal` interface so a future
 * change to either side does not silently break the other.
 */
export const authPrincipalSchema = z.object({
  userId: z.string().uuid(),
  email: z.string().email().optional(),
  role: z.string().optional(),
});

export type AuthPrincipalWire = z.infer<typeof authPrincipalSchema>;

export const meResponseSchema = z.object({
  user: authPrincipalSchema,
});

export type MeResponse = z.infer<typeof meResponseSchema>;

/**
 * Profile domain shape (PROF-001).
 *
 * The values mirror the `public.profiles` migration:
 *   - `unit_system` is the closed enum the SQL check constraint enforces.
 *   - `height_cm` is bounded to plausible adult range; the canonical
 *     storage is metric. Conversion to imperial happens at the
 *     presentation layer in a later segment.
 *   - `birth_year` is bounded to a plausible adult range so the API
 *     rejects obviously malformed input early. Age in years is derived
 *     at the presentation layer rather than stored, to avoid timezone
 *     ambiguity.
 *   - `display_name` is optional and bounded to a sane length so it
 *     can render in a list view without truncation surprises.
 *
 * The schema is the single source of truth for the `/v1/profile`
 * wire contract. Producers and consumers parse against the same
 * Zod schema so a future shape change fails closed at the boundary.
 */
export const unitSystemSchema = z.enum(["metric", "imperial"]);

export type UnitSystem = z.infer<typeof unitSystemSchema>;

export const coachingPreferencesSchema = z
  .object({
    experienceLevel: z
      .enum(["beginner", "intermediate", "advanced"])
      .nullable(),
    trainingDaysPerWeek: z.number().int().gte(1).lte(7).nullable(),
    sessionDurationMinutes: z.number().int().gte(15).lte(180).nullable(),
    trainingFocus: z
      .enum(["balanced", "strength", "hypertrophy", "endurance"])
      .nullable(),
    availableEquipment: z
      .array(
        z.enum([
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
        ]),
      )
      .max(10),
    dietaryPreferences: z
      .array(
        z.enum([
          "omnivore",
          "vegetarian",
          "vegan",
          "pescatarian",
          "halal",
          "kosher",
          "lactose_free",
          "gluten_free",
        ]),
      )
      .max(8),
    trainingLimitations: z
      .array(
        z.enum([
          "low_impact_only",
          "no_overhead_work",
          "no_running",
          "no_jumping",
          "limited_knee_flexion",
          "limited_spinal_loading",
        ]),
      )
      .max(6),
  })
  .strict()
  .superRefine((value, context) => {
    for (const key of [
      "availableEquipment",
      "dietaryPreferences",
      "trainingLimitations",
    ] as const) {
      if (new Set(value[key]).size !== value[key].length) {
        context.addIssue({
          code: "custom",
          path: [key],
          message: "values must be unique",
        });
      }
    }
    const baseDiets = value.dietaryPreferences.filter((preference) =>
      ["omnivore", "vegetarian", "vegan", "pescatarian"].includes(preference),
    );
    if (baseDiets.length > 1) {
      context.addIssue({
        code: "custom",
        path: ["dietaryPreferences"],
        message: "select at most one base diet",
      });
    }
  });

export type CoachingPreferences = z.infer<typeof coachingPreferencesSchema>;

export const profileSchema = z.object({
  userId: z.string().uuid(),
  displayName: z.string().trim().min(1).max(80).nullable().optional(),
  unitSystem: unitSystemSchema,
  timezone: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .describe("IANA timezone string, e.g. 'UTC', 'Europe/Paris'."),
  birthYear: z
    .number()
    .int()
    .gte(1900)
    .lte(new Date().getUTCFullYear())
    .nullable()
    .optional(),
  heightCm: z.number().gte(50).lte(260).multipleOf(0.01).nullable().optional(),
  /**
   * Self-reported activity level. Mirrors the canonical
   * energy-engine multipliers in `@mizyun/core`. Nullable so
   * existing users don't lose data on migration; the energy
   * route treats null as "ask me again" and prompts the UI.
   */
  activityLevel: z
    .enum([
      "sedentary",
      "lightly_active",
      "moderately_active",
      "very_active",
      "extra_active",
    ])
    .nullable()
    .optional(),
  /**
   * Self-reported sex at birth. Nullable by design — the
   * user owns the field; the energy engine refuses to
   * fabricate a number without it (ENG-06).
   */
  sexAtBirth: z.enum(["male", "female"]).nullable().optional(),
  coachingPreferences: coachingPreferencesSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Profile = z.infer<typeof profileSchema>;

export const profileResponseSchema = z.object({
  profile: profileSchema,
});

export type ProfileResponse = z.infer<typeof profileResponseSchema>;

/**
 * Partial-update body for `PUT /v1/profile`. Every field is optional;
 * the route handler merges the patch into the stored profile and
 * validates the merged shape. Sending `null` clears a nullable
 * field; omitting a field leaves it unchanged.
 *
 * The inferred type allows `undefined` per Zod's `.optional()` so the
 * type matches the optional input shape exactly under
 * `exactOptionalPropertyTypes: true`.
 */
export const profilePatchSchema = z
  .object({
    displayName: profileSchema.shape.displayName.optional(),
    unitSystem: unitSystemSchema.optional(),
    timezone: profileSchema.shape.timezone.optional(),
    birthYear: profileSchema.shape.birthYear.optional(),
    heightCm: profileSchema.shape.heightCm.optional(),
    activityLevel: profileSchema.shape.activityLevel.optional(),
    sexAtBirth: profileSchema.shape.sexAtBirth.optional(),
    coachingPreferences: coachingPreferencesSchema.optional(),
  })
  .strict()
  .refine(
    (patch) =>
      patch.displayName !== undefined ||
      patch.unitSystem !== undefined ||
      patch.timezone !== undefined ||
      patch.birthYear !== undefined ||
      patch.heightCm !== undefined ||
      patch.activityLevel !== undefined ||
      patch.sexAtBirth !== undefined ||
      patch.coachingPreferences !== undefined,
    { message: "at least one field must be present" },
  );

export type ProfilePatch = z.infer<typeof profilePatchSchema>;

/**
 * Goal domain shape (GOAL-001).
 *
 * Mizyun uses three closed goal kinds: cut (lose body mass), recomp
 * (re-distribute mass with no net change), maintain (hold the
 * current body mass within a tolerance band). The pace preference
 * shapes the rate of weekly change the energy engine targets.
 *
 * `target` is a small open shape keyed by kind:
 *   - cut / maintain: `weightKg` (mandatory, in canonical kg)
 *   - recomp: `weightKg` (mandatory) plus `bodyFatPercent`
 *     (optional, canonical 0..100, the trend target)
 *
 * The schema parses the wire shape and is the source of truth for
 * `/v1/goals` endpoints. The SQL `public.goals` table currently
 * stores `kind text` and `target jsonb`; the route layer maps the
 * closed union onto the open column. A follow-up migration tightens
 * the SQL constraint.
 */
export const goalKindSchema = z.enum(["cut", "bulk", "recomp", "maintain"]);
export type GoalKind = z.infer<typeof goalKindSchema>;

export const goalPaceSchema = z.enum(["steady", "gradual", "aggressive"]);
export type GoalPace = z.infer<typeof goalPaceSchema>;

export const goalStatusSchema = z.enum([
  "draft",
  "active",
  "completed",
  "archived",
]);
export type GoalStatus = z.infer<typeof goalStatusSchema>;

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be in YYYY-MM-DD form");

/**
 * Weight target stored in canonical kilograms. Range is the plausible
 * adult band (mirrors `height_cm`); values outside the band are
 * rejected so a typo cannot derail the energy engine.
 */
export const targetWeightKgSchema = z.number().gte(30).lte(250).multipleOf(0.1);

export const goalTargetSchema = z.object({
  weightKg: targetWeightKgSchema,
  bodyFatPercent: z.number().gte(3).lte(60).multipleOf(0.1).optional(),
});

export type GoalTarget = z.infer<typeof goalTargetSchema>;

/**
 * Full stored goal. `startsOn` and `targetDate` are dates in the user's
 * local timezone semantically, but stored as ISO `YYYY-MM-DD` UTC
 * dates; the energy engine derives a calendar from them. `reviewDate`
 * is optional and triggers a UI prompt at the start of that day.
 */
export const goalSchema = z
  .object({
    id: z.string().uuid(),
    userId: z.string().uuid(),
    kind: goalKindSchema,
    status: goalStatusSchema,
    pace: goalPaceSchema,
    target: goalTargetSchema,
    startsOn: isoDateSchema,
    targetDate: isoDateSchema,
    reviewDate: isoDateSchema.optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .refine((goal) => goal.targetDate >= goal.startsOn, {
    message: "targetDate must be on or after startsOn",
    path: ["targetDate"],
  })
  .refine(
    (goal) => goal.reviewDate === undefined || goal.reviewDate >= goal.startsOn,
    {
      message: "reviewDate must be on or after startsOn",
      path: ["reviewDate"],
    },
  );

export type Goal = z.infer<typeof goalSchema>;

export const goalResponseSchema = z.object({
  goal: goalSchema,
});
export type GoalResponse = z.infer<typeof goalResponseSchema>;

export const goalHistoryResponseSchema = z.object({
  goals: z.array(goalSchema),
});
export type GoalHistoryResponse = z.infer<typeof goalHistoryResponseSchema>;

/**
 * Body for `POST /v1/goals`. The route server-generates `id`,
 * `userId`, `createdAt`, `updatedAt`, and `status` (always `active`
 * for newly created goals). The first goal ever created for a user
 * is also their primary active goal by definition.
 */
export const goalCreateSchema = z
  .object({
    kind: goalKindSchema,
    pace: goalPaceSchema,
    target: goalTargetSchema,
    startsOn: isoDateSchema,
    targetDate: isoDateSchema,
    reviewDate: isoDateSchema.optional(),
  })
  .strict()
  .refine((create) => create.targetDate >= create.startsOn, {
    message: "targetDate must be on or after startsOn",
    path: ["targetDate"],
  })
  .refine(
    (create) =>
      create.reviewDate === undefined || create.reviewDate >= create.startsOn,
    {
      message: "reviewDate must be on or after startsOn",
      path: ["reviewDate"],
    },
  );

export type GoalCreate = z.infer<typeof goalCreateSchema>;

/**
 * Body for `PUT /v1/goals/:id`. Status transitions are restricted:
 *   - active → completed (the goal is met)
 *   - active → archived (the user changed their mind)
 *   - draft → active (the user accepts the goal)
 *   - draft → archived
 * Any other transition is rejected at the route layer.
 */
export const goalPatchSchema = z
  .object({
    status: goalStatusSchema.optional(),
    pace: goalPaceSchema.optional(),
    target: goalTargetSchema.optional(),
    targetDate: isoDateSchema.optional(),
    reviewDate: isoDateSchema.nullable().optional(),
  })
  .strict()
  .refine(
    (patch) =>
      patch.status !== undefined ||
      patch.pace !== undefined ||
      patch.target !== undefined ||
      patch.targetDate !== undefined ||
      patch.reviewDate !== undefined,
    { message: "at least one field must be present" },
  );

export type GoalPatch = z.infer<typeof goalPatchSchema>;

export {
  foodDraftCandidateSchema,
  foodDraftResponseSchema,
  foodRefineDraftRequestSchema,
  foodTextDraftRequestSchema,
  foodEntryCreateSchema,
  foodEntryListQuerySchema,
  foodEntryListResponseSchema,
  foodEntryPatchSchema,
  foodEntryResponseSchema,
  foodEntrySchema,
  foodEntrySummaryQuerySchema,
  foodSourceSchema,
  dailyFoodSummaryListResponseSchema,
  dailyFoodSummaryResponseSchema,
  dailyFoodSummarySchema,
  type DailyFoodSummary,
  type DailyFoodSummaryListResponse,
  type DailyFoodSummaryResponse,
  type FoodDraftCandidate,
  type FoodDraftResponse,
  type FoodRefineDraftRequest,
  type FoodTextDraftRequest,
  type FoodEntry,
  type FoodEntryCreate,
  type FoodEntryListQuery,
  type FoodEntryListResponse,
  type FoodEntryPatch,
  type FoodEntryResponse,
  type FoodEntrySummaryQuery,
  type FoodSource,
} from "./food-entry";

export {
  exerciseCreateSchema,
  exerciseListQuerySchema,
  exerciseListResponseSchema,
  exercisePatchSchema,
  exerciseResponseSchema,
  exerciseSchema,
  type Exercise,
  type ExerciseCreate,
  type ExerciseListQuery,
  type ExerciseListResponse,
  type ExercisePatch,
  type ExerciseResponse,
} from "./exercise";

export {
  workoutCreateSchema,
  workoutListQuerySchema,
  workoutListResponseSchema,
  workoutPatchSchema,
  workoutResponseSchema,
  workoutSchema,
  workoutSchemaBase,
  workoutSourceSchema,
  type Workout,
  type WorkoutCreate,
  type WorkoutListQuery,
  type WorkoutListResponse,
  type WorkoutPatch,
  type WorkoutResponse,
  type WorkoutSource,
} from "./workout";

export {
  exerciseRecentSetsQuerySchema,
  exerciseRecentSetsResponseSchema,
  workoutSetCreateSchema,
  workoutSetListResponseSchema,
  workoutSetResponseSchema,
  workoutSetSchema,
  type ExerciseRecentSetsQuery,
  type ExerciseRecentSetsResponse,
  type WorkoutSet,
  type WorkoutSetCreate,
  type WorkoutSetListResponse,
  type WorkoutSetResponse,
} from "./workout-set";

export {
  accountDeleteChallengeResponseSchema,
  accountDeleteResponseSchema,
  accountDeleteSchema,
  accountExportResponseSchema,
  accountExportSchema,
  conversationStubSchema,
  privateMediaStubSchema,
  type AccountDeleteBody,
  type AccountDeleteChallengeResponse,
  type AccountDeleteResponse,
  type AccountExport,
  type AccountExportResponse,
} from "./account";

export {
  activityLevelSchema,
  energyIncompleteReasonSchema,
  energySummaryQuerySchema,
  energySummaryResponseSchema,
  energySummarySchema,
  sexAtBirthSchema,
  type EnergySummary,
  type EnergySummaryQuery,
  type EnergySummaryResponse,
} from "./energy";

export { coachingPlanSchema, type CoachingPlan } from "./coaching-plan";

export {
  trainingPrescriptionResponseSchema,
  trainingPrescriptionSchema,
  type TrainingPrescription,
  type TrainingPrescriptionResponse,
} from "./training-prescription";

export {
  mediaAssetListResponseSchema,
  mediaAssetResponseSchema,
  mediaAssetSchema,
  mediaCompareRequestSchema,
  mediaCompareResponseSchema,
  mediaCompareSideSchema,
  mediaListQuerySchema,
  mediaPurposeSchema,
  mediaSignRequestSchema,
  mediaSignResponseSchema,
  mediaTimelineBucketSchema,
  mediaTimelineEntrySchema,
  mediaTimelineQuerySchema,
  mediaTimelineResponseSchema,
  mediaUploadUrlRequestSchema,
  mediaUploadUrlResponseSchema,
  type MediaAsset,
  type MediaAssetListResponse,
  type MediaAssetResponse,
  type MediaCompareRequest,
  type MediaCompareResponse,
  type MediaCompareSide,
  type MediaListQuery,
  type MediaSignRequest,
  type MediaSignResponse,
  type MediaTimelineBucket,
  type MediaTimelineEntry,
  type MediaTimelineQuery,
  type MediaTimelineResponse,
  type MediaUploadUrlRequest,
  type MediaUploadUrlResponse,
} from "./media-asset";

export {
  bodyMeasurementCreateSchema,
  bodyMeasurementListQuerySchema,
  bodyMeasurementListResponseSchema,
  bodyMeasurementResponseSchema,
  bodyMeasurementSchema,
  bodyMeasurementSourceSchema,
  weightKgSchema,
  type BodyMeasurement,
  type BodyMeasurementCreate,
  type BodyMeasurementListQuery,
  type BodyMeasurementListResponse,
  type BodyMeasurementResponse,
  type BodyMeasurementSource,
} from "./body-measurement";

export {
  createFeedbackResponseSchema,
  createFeedbackSchema,
  feedbackCategorySchema,
  feedbackItemSchema,
  feedbackRatingSchema,
  listFeedbackResponseSchema,
  type CreateFeedbackBody,
  type CreateFeedbackInput,
  type CreateFeedbackResponse,
  type FeedbackCategory,
  type FeedbackItem,
  type FeedbackRating,
  type ListFeedbackResponse,
} from "./feedback";
