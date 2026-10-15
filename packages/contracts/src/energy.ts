/**
 * Energy summary wire schemas (ENG-001, ENG-002).
 *
 * The `energySummarySchema` mirrors `EnergyBreakdown` in
 * `@mizyun/core`. Every numeric field is nullable so the wire
 * surface honours ENG-06 ("missing input surfaces as null, never
 * fabricated") and ENG-02 ("the user can inspect formula
 * version, assumptions, and inputs").
 *
 * `formulaVersion` is part of the public contract: a future
 * v2 can ship with a different value and the UI keeps working
 * against the version it was written against.
 */
import { z } from "zod";

/** Closed activity-multiplier categories. */
export const activityLevelSchema = z.enum([
  "sedentary",
  "lightly_active",
  "moderately_active",
  "very_active",
  "extra_active",
]);

export const sexAtBirthSchema = z.enum(["male", "female"]);

export const energyIncompleteReasonSchema = z.enum([
  "weight_missing",
  "height_missing",
  "birth_year_missing",
  "sex_missing",
  "no_active_goal",
  "below_safety_floor",
  "activity_unset",
  "exercise_data_stale",
]);

/** All numeric fields bounded to plausible kcal/day ranges. */
const boundedKcalSchema = z.number().gte(-10_000).lte(20_000).multipleOf(0.01);
const nonNegativeKcalSchema = z.number().gte(0).lte(20_000).multipleOf(0.01);

const energySummaryBaseSchema = z.object({
  formulaVersion: z.string(),
  userId: z.string().uuid(),
  computedAt: z.string().datetime(),
  complete: z.boolean(),
  incompleteReason: energyIncompleteReasonSchema.nullable(),
  ageYears: z.number().int().gte(0).lte(150).nullable(),
  bmrKcal: nonNegativeKcalSchema.nullable(),
  activityMultiplier: z.number().gte(1).lte(2.5).nullable(),
  tdeeKcal: nonNegativeKcalSchema.nullable(),
  exerciseKcal: boundedKcalSchema.nullable(),
  goalAdjustmentKcal: boundedKcalSchema.nullable(),
  dailyTargetKcal: nonNegativeKcalSchema.nullable(),
  targetProteinG: z.number().int().gte(0).lte(1000).nullable(),
  targetCarbohydrateG: z.number().int().gte(0).lte(2000).nullable(),
  targetFatG: z.number().int().gte(0).lte(1000).nullable(),
  balanceKcal: boundedKcalSchema.nullable(),
  balanceUncertaintyKcal: nonNegativeKcalSchema.nullable(),
  inputs: z.object({
    weightKg: nonNegativeKcalSchema.nullable(),
    heightCm: z.number().gte(50).lte(260).multipleOf(0.01).nullable(),
    birthYear: z.number().int().gte(1900).lte(2100).nullable(),
    sexAtBirth: sexAtBirthSchema.nullable(),
    activityLevel: activityLevelSchema.nullable(),
    goalKind: z.enum(["cut", "bulk", "recomp", "maintain"]).nullable(),
    goalPace: z.enum(["steady", "gradual", "aggressive"]).nullable(),
  }),
});

export const goalModeIdSchema = z.enum([
  "gradual_cut",
  "standard_cut",
  "aggressive_cut",
  "lean_bulk",
  "standard_bulk",
  "aggressive_bulk",
  "recomp",
  "maintain",
]);

const weeklyPercentSchema = z.number().gte(-5).lte(5);

/**
 * Observed values come from user logs, not the engine: a mistyped weight
 * or an unusually large logged day must not turn the dashboard into a 500.
 * Body weight is bounded at 250 kg and each day may hold many entries.
 */
const observedWeeklyChangeKgSchema = z.number().gte(-250).lte(250);
const observedIntakeKcalSchema = z.number().int().gte(0).lte(10_000_000);

export const goalModeSummarySchema = z.object({
  id: goalModeIdSchema,
  label: z.string().min(1).max(40),
  minWeeklyPercent: weeklyPercentSchema,
  maxWeeklyPercent: weeklyPercentSchema,
  targetWeeklyPercent: weeklyPercentSchema,
});

export const adaptiveMaintenanceSchema = z.object({
  status: z.enum(["ready", "insufficient"]),
  reason: z
    .enum([
      "weight_trend_too_short",
      "too_few_logged_days",
      "implausible_result",
    ])
    .nullable(),
  maintenanceKcal: z.number().int().gte(0).lte(20_000).nullable(),
  averageIntakeKcal: observedIntakeKcalSchema.nullable(),
  loggedDays: z.number().int().gte(0).lte(366),
  windowDays: z.number().int().gte(1).lte(366),
  weeklyChangeKg: observedWeeklyChangeKgSchema.nullable(),
});

export const goalProjectionSchema = z.object({
  projectedWeeksToTarget: z.number().int().gte(0).lte(10_000).nullable(),
  projectedDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  targetDateRealistic: z.boolean().nullable(),
});

/**
 * v2 additions (ENG-07/ENG-08). Optional so a newer client still parses
 * a v1 server response and cached v1 summaries.
 */
export const energySummarySchema = energySummaryBaseSchema.extend({
  calibrationKcal: z.number().int().gte(-1000).lte(1000).optional(),
  weightSource: z.enum(["trend", "latest"]).nullable().optional(),
  goalMode: goalModeSummarySchema.nullable().optional(),
  targetWeeklyChangeKg: z.number().gte(-20).lte(20).nullable().optional(),
  projection: goalProjectionSchema.nullable().optional(),
  adaptiveMaintenance: adaptiveMaintenanceSchema.nullable().optional(),
});

export type EnergySummary = z.infer<typeof energySummarySchema>;

export const calorieReviewReasonSchema = z.enum([
  "no_target",
  "goal_too_new",
  "recent_adjustment",
  "too_few_logged_days",
  "adherence_out_of_range",
  "weight_trend_insufficient",
  "within_band",
  "below_band",
  "above_band",
  "safety_floor",
  "calibration_limit",
]);

const reviewKcalSchema = z.number().int().gte(-20_000).lte(20_000);

/** Deterministic weekly calorie review (core `CalorieReview`). */
export const calorieReviewSchema = z.object({
  version: z.string().min(1).max(40),
  computedAt: z.string().datetime(),
  status: z.enum(["insufficient_data", "hold", "adjust"]),
  reasons: z.array(calorieReviewReasonSchema).max(10),
  method: z.enum(["adaptive_maintenance", "rate_error"]).nullable(),
  goalMode: goalModeSummarySchema,
  goalAgeDays: z.number().int().gte(-100_000).lte(100_000),
  observedWeeklyPercent: z.number().gte(-10_000).lte(10_000).nullable(),
  observedWeeklyChangeKg: observedWeeklyChangeKgSchema.nullable(),
  smoothedWeightKg: z.number().gte(0).lte(1_000).nullable(),
  loggedDays: z.number().int().gte(0).lte(31),
  averageIntakeKcal: observedIntakeKcalSchema.nullable(),
  adherencePercent: z.number().int().gte(0).lte(1_000_000).nullable(),
  adaptiveMaintenanceKcal: reviewKcalSchema.nullable(),
  currentTargetKcal: reviewKcalSchema.nullable(),
  proposedTargetKcal: reviewKcalSchema.nullable(),
  deltaKcal: reviewKcalSchema,
  /** Visible target change; differs from deltaKcal only at the floor. */
  targetChangeKcal: reviewKcalSchema.optional(),
  calibrationBeforeKcal: reviewKcalSchema,
  calibrationAfterKcal: reviewKcalSchema,
});

export type CalorieReviewWire = z.infer<typeof calorieReviewSchema>;

export const calorieAdjustmentStatusSchema = z.enum([
  "pending",
  "accepted",
  "declined",
  "superseded",
]);

/** A stored weekly proposal the user accepts or declines. */
export const calorieAdjustmentProposalSchema = z.object({
  id: z.string().uuid(),
  goalId: z.string().uuid(),
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: calorieAdjustmentStatusSchema,
  review: calorieReviewSchema,
  createdAt: z.string().datetime(),
  decidedAt: z.string().datetime().nullable(),
});

export type CalorieAdjustmentProposal = z.infer<
  typeof calorieAdjustmentProposalSchema
>;

/**
 * `GET /v1/energy/weekly-review`. `review` is this week's freshly computed
 * review (null without an active goal); `proposal` is this week's stored
 * proposal, created when the review says "adjust".
 */
export const weeklyCalorieReviewResponseSchema = z.object({
  review: calorieReviewSchema.nullable(),
  proposal: calorieAdjustmentProposalSchema.nullable(),
});

export type WeeklyCalorieReviewResponse = z.infer<
  typeof weeklyCalorieReviewResponseSchema
>;

export const weeklyCalorieReviewQuerySchema = z
  .object({
    utcOffsetMinutes: z.coerce.number().int().gte(-840).lte(840).optional(),
  })
  .strict();

/** `POST /v1/energy/weekly-review/:id/decision`. */
export const calorieAdjustmentDecisionSchema = z
  .object({ decision: z.enum(["accept", "decline"]) })
  .strict();

export type CalorieAdjustmentDecision = z.infer<
  typeof calorieAdjustmentDecisionSchema
>;

export const calorieAdjustmentDecisionResponseSchema = z.object({
  proposal: calorieAdjustmentProposalSchema,
});

export const energySummaryResponseSchema = z.object({
  summary: energySummarySchema,
});

export type EnergySummaryResponse = z.infer<typeof energySummaryResponseSchema>;

/**
 * Optional query string accepted by `GET /v1/energy/summary`.
 * The body shape (profile + measurements + goal) is fetched from
 * the per-feature repositories, but the activity level and
 * sex-at-birth fields are not yet persisted on the profile and
 * travel in the query string in v1. A future segment promotes
 * them to profile fields.
 */
export const energySummaryQuerySchema = z
  .object({
    activityLevel: activityLevelSchema.optional(),
    sexAtBirth: sexAtBirthSchema.optional(),
    utcOffsetMinutes: z.coerce.number().int().gte(-840).lte(840).optional(),
  })
  .strict();

export type EnergySummaryQuery = z.infer<typeof energySummaryQuerySchema>;
