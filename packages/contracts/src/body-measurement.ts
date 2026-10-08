/**
 * Body measurement wire schemas (BODY-001).
 *
 * The shape mirrors `public.body_measurements`:
 *   - `measuredAt` is the moment the measurement was taken
 *     (timestamptz in SQL, ISO 8601 string on the wire). Stored
 *     in UTC.
 *   - `weightKg` is the canonical body weight in kilograms,
 *     bounded to a plausible adult range so a typo cannot regress
 *     the trend to negative territory. Nullable: a user may record
 *     waist/chest measurements without a weight.
 *   - `measurements` is an open `Record<string, unknown>` for
 *     arbitrary body measurements (waist_cm, chest_cm,
 *     body_fat_percent, etc.). The validator does not inspect its
 *     contents. This is the JSONB column on the SQL row.
 *   - `source` is a closed enum mirroring the SQL default
 *     `'manual'`. Future values (`'vision'`, `'scale_sync'`) land
 *     when the device-sync path surfaces.
 *
 * Producers and consumers parse against the same Zod schema so a
 * future shape change fails closed at the boundary.
 */
import { z } from "zod";

export const bodyMeasurementSourceSchema = z.enum(["manual"]);
export type BodyMeasurementSource = z.infer<typeof bodyMeasurementSourceSchema>;

const isoInstantSchema = z.string().datetime({ offset: true });

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be in YYYY-MM-DD form");

/**
 * Bounded weight value, in kilograms, mirroring `numeric(6, 3)`.
 * Range matches `@mizyun/core`'s `WEIGHT_KG_MIN/MAX` so the trend
 * surface and the goal-target surface share the same plausibility
 * gate.
 */
export const weightKgSchema = z.number().gte(30).lte(250).multipleOf(0.001);

export const bodyMeasurementSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  measuredAt: isoInstantSchema,
  weightKg: weightKgSchema.nullable(),
  measurements: z.record(z.unknown()),
  source: bodyMeasurementSourceSchema,
  createdAt: z.string().datetime(),
});

export type BodyMeasurement = z.infer<typeof bodyMeasurementSchema>;

export const bodyMeasurementResponseSchema = z.object({
  bodyMeasurement: bodyMeasurementSchema,
});

export type BodyMeasurementResponse = z.infer<
  typeof bodyMeasurementResponseSchema
>;

export const bodyMeasurementListResponseSchema = z.object({
  bodyMeasurements: z.array(bodyMeasurementSchema),
});

export type BodyMeasurementListResponse = z.infer<
  typeof bodyMeasurementListResponseSchema
>;

/**
 * Body for `POST /v1/body-measurements`. The route
 * server-generates `id`, `userId`, `source` (always `"manual"` in
 * v1), and `createdAt`. `weightKg` and `measurements` are both
 * optional; at least one must be present so an empty row cannot
 * land.
 */
export const bodyMeasurementCreateSchema = z
  .object({
    clientOperationId: z.string().uuid().optional(),
    measuredAt: isoInstantSchema.optional(),
    weightKg: weightKgSchema.nullable().optional(),
    measurements: z.record(z.unknown()).optional(),
  })
  .strict()
  .refine(
    (create) =>
      create.clientOperationId === undefined || create.measuredAt !== undefined,
    {
      message: "measuredAt is required with clientOperationId",
      path: ["measuredAt"],
    },
  )
  .refine(
    (create) =>
      create.weightKg !== undefined ||
      (create.measurements !== undefined &&
        Object.keys(create.measurements).length > 0),
    {
      message: "at least one of weightKg or measurements must be present",
    },
  );

export type BodyMeasurementCreate = z.infer<typeof bodyMeasurementCreateSchema>;

/**
 * Query params for `GET /v1/body-measurements`. `from` and `to`
 * are inclusive `YYYY-MM-DD` (UTC) date filters on `measuredAt`;
 * `limit` caps the page size. Defaults: most-recent 50
 * newest-first.
 */
export const bodyMeasurementListQuerySchema = z
  .object({
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
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

export type BodyMeasurementListQuery = z.infer<
  typeof bodyMeasurementListQuerySchema
>;
