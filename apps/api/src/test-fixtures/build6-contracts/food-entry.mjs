import { z } from "./zod-runtime.mjs";
export const foodSourceSchema = z.enum(["manual"]);
/** A `consumedAt` value is a UTC ISO 8601 instant. */
const isoInstantSchema = z.string().datetime({ offset: true });
/** A `YYYY-MM-DD` date for the day-filter query params. */
const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be in YYYY-MM-DD form");
/**
 * Bounded numeric value for a macro field. We store macros in grams
 * with two decimal places, mirroring the SQL `numeric(8, 2)` shape.
 * Negative values are rejected so a typo cannot regress the daily
 * total to negative territory.
 */
const macroSchema = z.number().gte(0).lte(10_000).multipleOf(0.01);
export const foodEntrySchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  consumedAt: isoInstantSchema,
  caloriesKcal: z.number().gte(0).lte(20_000).multipleOf(0.01).nullable(),
  proteinG: macroSchema.nullable(),
  carbohydrateG: macroSchema.nullable(),
  fatG: macroSchema.nullable(),
  source: foodSourceSchema,
  confidence: z.number().gte(0).lte(1).nullable(),
  confirmedByUser: z.boolean(),
  clientOperationId: z.string().uuid().nullable().optional(),
  details: z.record(z.unknown()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export const foodEntryResponseSchema = z.object({
  foodEntry: foodEntrySchema,
});
export const foodEntryListResponseSchema = z.object({
  foodEntries: z.array(foodEntrySchema),
  nextCursor: z.string().nullable().optional(),
  cutoffDateIsPartial: z.boolean().optional(),
});
/**
 * Body for `POST /v1/food-entries`. The route server-generates `id`,
 * `userId`, audit timestamps, `source` (always `manual` in v1),
 * `confirmedByUser` (always `true` for entries the user just made),
 * and `details` (always `{}`).
 *
 * `consumedAt` is optional in the create body so a quick "I just ate
 * this" entry defaults to "now" — the client passes the explicit
 * timestamp when backfilling an earlier meal.
 */
export const foodEntryCreateSchema = z
  .object({
    clientOperationId: z.string().uuid().optional(),
    name: foodEntrySchema.shape.name,
    consumedAt: isoInstantSchema.optional(),
    caloriesKcal: foodEntrySchema.shape.caloriesKcal.optional(),
    proteinG: foodEntrySchema.shape.proteinG.optional(),
    carbohydrateG: foodEntrySchema.shape.carbohydrateG.optional(),
    fatG: foodEntrySchema.shape.fatG.optional(),
    details: z.record(z.unknown()).optional(),
  })
  .strict();
/**
 * Body for `PUT /v1/food-entries/:id`. Every field is optional; the
 * route merges the patch into the stored entry. Sending `null`
 * clears a nullable field; omitting leaves it unchanged.
 *
 * `name` may not be set to `null` (it is required by the schema);
 * to remove the entry, send `DELETE`. `consumedAt` may not be
 * cleared for the same reason — it always has a value.
 */
export const foodEntryPatchSchema = z
  .object({
    name: foodEntrySchema.shape.name.optional(),
    consumedAt: isoInstantSchema.optional(),
    caloriesKcal: foodEntrySchema.shape.caloriesKcal.nullable().optional(),
    proteinG: foodEntrySchema.shape.proteinG.nullable().optional(),
    carbohydrateG: foodEntrySchema.shape.carbohydrateG.nullable().optional(),
    fatG: foodEntrySchema.shape.fatG.nullable().optional(),
    details: z.record(z.unknown()).optional(),
  })
  .strict()
  .refine(
    (patch) =>
      patch.name !== undefined ||
      patch.consumedAt !== undefined ||
      patch.caloriesKcal !== undefined ||
      patch.proteinG !== undefined ||
      patch.carbohydrateG !== undefined ||
      patch.fatG !== undefined ||
      patch.details !== undefined,
    { message: "at least one field must be present" },
  );
/**
 * Daily summary wire schema (NUT-002). Mirrors the domain shape
 * `DailyFoodSummary`. Each numeric total is nullable: the
 * aggregator returns `null` when **any** entry on the day has a
 * `null` for that field, so the UI can prompt the user to backfill
 * rather than silently report a misleading zero.
 *
 * `entryCount` is always present (the UI needs it to render an
 * honest "you logged N items today" label).
 */
export const dailyFoodSummarySchema = z.object({
  date: isoDateSchema,
  entryCount: z.number().int().gte(0),
  caloriesKcal: z.number().gte(0).lte(20_000).multipleOf(0.01).nullable(),
  proteinG: macroSchema.nullable(),
  carbohydrateG: macroSchema.nullable(),
  fatG: macroSchema.nullable(),
});
export const dailyFoodSummaryResponseSchema = z.object({
  summary: dailyFoodSummarySchema,
});
export const dailyFoodSummaryListResponseSchema = z.object({
  summaries: z.array(dailyFoodSummarySchema),
});
// =========================================================================
// VISION-001 — Editable photo-to-draft food entry surface.
// =========================================================================
/**
 * Wire shape for `POST /v1/food-entries/draft` (the multipart
 * fields are read directly by the route; this schema documents
 * the optional `textHint` and the response shape).
 *
 * The route:
 *   1. reads the multipart `image` field (required) + `textHint`
 *      (optional) from the request;
 *   2. calls the configured VisionDraftProvider with the bytes;
 *   3. validates the structured candidate and post-screens medical claims
 *      per ADR-0017
 *      §"Photo / vision invariants";
 *   4. returns the candidate to the user, who edits and confirms
 *      by posting to `POST /v1/food-entries`.
 *
 * The route never persists the photo bytes. The draft is
 * ephemeral in v1; a future segment may add a server-side
 * `food_entry_drafts` table for cross-device resume.
 */
const nutritionEstimateRangeSchema = z
  .object({
    low: z.number().gte(0).lte(20_000),
    high: z.number().gte(0).lte(20_000),
  })
  .strict()
  .refine((range) => range.low <= range.high, {
    message: "low must be less than or equal to high",
  });
export const foodDraftCandidateSchema = z.object({
  name: z.string().trim().min(1).max(200).nullable(),
  portionWeightG: z
    .number()
    .gte(1)
    .lte(20_000)
    .multipleOf(0.1)
    .nullable()
    .optional(),
  caloriesKcal: z.number().gte(0).lte(20_000).multipleOf(0.01).nullable(),
  proteinG: macroSchema.nullable(),
  carbohydrateG: macroSchema.nullable(),
  fatG: macroSchema.nullable(),
  calorieRangeKcal: nutritionEstimateRangeSchema.nullable(),
  proteinRangeG: nutritionEstimateRangeSchema.nullable(),
  carbohydrateRangeG: nutritionEstimateRangeSchema.nullable(),
  fatRangeG: nutritionEstimateRangeSchema.nullable(),
  confidence: z.number().gte(0).lte(1),
  warnings: z.array(z.string().trim().min(1).max(500)).max(8),
  assumptions: z.array(z.string().trim().min(1).max(500)).max(8),
  provenance: z
    .object({
      inputKind: z.enum(["photo", "text"]),
      provider: z.string().trim().min(1).max(100),
      model: z.string().trim().min(1).max(200),
      promptVersion: z.string().trim().min(1).max(100),
    })
    .strict(),
  tokensUsed: z.number().int().nonnegative().optional(),
  calculation: z.string().trim().min(1).max(5_000).nullable().optional(),
});
