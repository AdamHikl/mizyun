/**
 * Food entry wire schemas (NUT-001).
 *
 * The shape mirrors `public.food_entries`:
 *   - `consumedAt` is the moment the user ate the food (timestamptz in
 *     SQL, ISO 8601 string on the wire). Stored in UTC; the client is
 *     responsible for rendering in the user's timezone.
 *   - `name` is the user-visible label. The `name` is mandatory and
 *     bounded to a sane length so it always renders cleanly.
 *   - Calories and macro grams are optional numeric values. Any of
 *     them may be omitted (`null`) when the user did not record them.
 *     The model treats `calories_kcal` as the canonical value for a
 *     manual entry; the low/high range columns stay in SQL for the
 *     future AI path but are NOT exposed on the wire in v1.
 *   - `source` is a closed enum mirroring the SQL default `'manual'`.
 *     Future values (`'vision'`, `'search'`) land when the AI path
 *     surfaces.
 *   - `details` is an open `Record<string, unknown>` for forward
 *     compatibility — the schema rejects nothing inside it but the
 *     route layer never reads from it.
 *
 * Producers and consumers parse against the same Zod schema so a
 * future shape change fails closed at the boundary.
 */
import { z } from "zod";

export const foodSourceSchema = z.enum(["manual"]);
export type FoodSource = z.infer<typeof foodSourceSchema>;

/** A `consumedAt` value is a UTC ISO 8601 instant. */
const isoInstantSchema = z.string().datetime({ offset: true });

/** A `YYYY-MM-DD` date for the day-filter query params. */
const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be in YYYY-MM-DD form");

/** UTC offset in minutes, positive east of UTC (for example, UTC+2 = 120). */
const utcOffsetMinutesSchema = z.coerce.number().int().gte(-840).lte(840);

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
  details: z.record(z.unknown()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type FoodEntry = z.infer<typeof foodEntrySchema>;

export const foodEntryResponseSchema = z.object({
  foodEntry: foodEntrySchema,
});

export type FoodEntryResponse = z.infer<typeof foodEntryResponseSchema>;

export const foodEntryListResponseSchema = z.object({
  foodEntries: z.array(foodEntrySchema),
});

export type FoodEntryListResponse = z.infer<typeof foodEntryListResponseSchema>;

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
    name: foodEntrySchema.shape.name,
    consumedAt: isoInstantSchema.optional(),
    caloriesKcal: foodEntrySchema.shape.caloriesKcal.optional(),
    proteinG: foodEntrySchema.shape.proteinG.optional(),
    carbohydrateG: foodEntrySchema.shape.carbohydrateG.optional(),
    fatG: foodEntrySchema.shape.fatG.optional(),
    details: z.record(z.unknown()).optional(),
  })
  .strict();

export type FoodEntryCreate = z.infer<typeof foodEntryCreateSchema>;

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

export type FoodEntryPatch = z.infer<typeof foodEntryPatchSchema>;

/**
 * Query params for `GET /v1/food-entries`. Both are optional: when
 * omitted, the endpoint returns the user's most recent entries
 * newest-first. `from` and `to` are inclusive; `from <= to`.
 *
 * `limit` caps the page size to protect the API from a runaway
 * request. The route clamps to `[1, 200]`; the default is `50`.
 */
export const foodEntryListQuerySchema = z
  .object({
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
    utcOffsetMinutes: utcOffsetMinutesSchema.optional(),
    limit: z.coerce.number().int().gte(1).lte(200).optional(),
  })
  .strict()
  .refine(
    (query) =>
      query.from === undefined ||
      query.to === undefined ||
      query.from <= query.to,
    { message: "from must be on or before to", path: ["from"] },
  );

export type FoodEntryListQuery = z.infer<typeof foodEntryListQuerySchema>;

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

export type DailyFoodSummary = z.infer<typeof dailyFoodSummarySchema>;

export const dailyFoodSummaryResponseSchema = z.object({
  summary: dailyFoodSummarySchema,
});

export type DailyFoodSummaryResponse = z.infer<
  typeof dailyFoodSummaryResponseSchema
>;

export const dailyFoodSummaryListResponseSchema = z.object({
  summaries: z.array(dailyFoodSummarySchema),
});

export type DailyFoodSummaryListResponse = z.infer<
  typeof dailyFoodSummaryListResponseSchema
>;

/**
 * Query params for `GET /v1/food-entries/summary`. Exactly one of
 * `date` or `from`+`to` is required:
 *   - `date=YYYY-MM-DD` returns a single day's summary. The route
 *     returns a 200 with `summary` filled in even when the user
 *     logged nothing (a UI welcome state). Days with zero entries
 *     have `entryCount: 0` and all numeric totals `null`.
 *   - `from=YYYY-MM-DD&to=YYYY-MM-DD` returns an array of per-day
 *     summaries, oldest-first. Days with zero entries are not
 *     included in the array.
 *
 * `limit` caps the response size to protect the API from a runaway
 * request. The route clamps to `[1, 366]`; the default is `92`
 * (one quarter). `limit` only applies to range queries; a `date`
 * query is always exactly one row.
 */
export const foodEntrySummaryQuerySchema = z
  .object({
    date: isoDateSchema.optional(),
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
    utcOffsetMinutes: utcOffsetMinutesSchema.optional(),
    limit: z.coerce.number().int().gte(1).lte(366).optional(),
  })
  .strict()
  .refine(
    (query) =>
      // Either `date` xor (`from` and `to`) is present. Any other
      // combination is rejected so the route never has to guess.
      (query.date !== undefined) !==
      (query.from !== undefined && query.to !== undefined),
    { message: "provide either `date` or both `from` and `to`" },
  )
  .refine(
    (query) =>
      query.from === undefined ||
      query.to === undefined ||
      query.from <= query.to,
    { message: "from must be on or before to", path: ["from"] },
  );

export type FoodEntrySummaryQuery = z.infer<typeof foodEntrySummaryQuerySchema>;

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
 *   3. post-screens the candidate for medical claims, sub-800-kcal
 *      targets, and unsafe macro values per ADR-0017
 *      §"Photo / vision invariants";
 *   4. returns the candidate to the user, who edits and confirms
 *      by posting to `POST /v1/food-entries`.
 *
 * The route never persists the photo bytes. The draft is
 * ephemeral in v1; a future segment may add a server-side
 * `food_entry_drafts` table for cross-device resume.
 */
export const foodDraftCandidateSchema = z.object({
  name: z.string().trim().min(1).max(200).nullable(),
  caloriesKcal: z.number().gte(0).lte(20_000).multipleOf(0.01).nullable(),
  proteinG: macroSchema.nullable(),
  carbohydrateG: macroSchema.nullable(),
  fatG: macroSchema.nullable(),
  confidence: z.number().gte(0).lte(1),
  warnings: z.array(z.string().trim().min(1).max(500)).max(8),
});

export type FoodDraftCandidate = z.infer<typeof foodDraftCandidateSchema>;

export const foodDraftResponseSchema = z.object({
  draft: foodDraftCandidateSchema,
  /**
   * Server-side correlation id for log tracing. NOT a client-side
   * field; the route stamps it so the user can quote it when
   * reporting a bad draft.
   */
  requestId: z.string().min(1),
});

export type FoodDraftResponse = z.infer<typeof foodDraftResponseSchema>;
