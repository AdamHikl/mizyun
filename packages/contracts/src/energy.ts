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

export const energySummarySchema = z.object({
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
  balanceKcal: boundedKcalSchema.nullable(),
  balanceUncertaintyKcal: nonNegativeKcalSchema.nullable(),
  inputs: z.object({
    weightKg: nonNegativeKcalSchema.nullable(),
    heightCm: z.number().gte(50).lte(260).multipleOf(0.01).nullable(),
    birthYear: z.number().int().gte(1900).lte(2100).nullable(),
    sexAtBirth: sexAtBirthSchema.nullable(),
    activityLevel: activityLevelSchema.nullable(),
    goalKind: z.enum(["cut", "recomp", "maintain"]).nullable(),
    goalPace: z.enum(["steady", "gradual", "aggressive"]).nullable(),
  }),
});

export type EnergySummary = z.infer<typeof energySummarySchema>;

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
  })
  .strict();

export type EnergySummaryQuery = z.infer<typeof energySummaryQuerySchema>;
