/**
 * Workout wire schemas (WO-001).
 *
 * The shape mirrors `public.workouts`:
 *   - `name` is the user-visible label. Mandatory and bounded to a
 *     sane length so it always renders cleanly.
 *   - `startedAt` is the moment the workout began (timestamptz in
 *     SQL, ISO 8601 string on the wire). Stored in UTC.
 *   - `completedAt` is the moment the workout finished, or `null`
 *     while the workout is in flight. The route enforces
 *     `completedAt >= startedAt` when both are present.
 *   - `notes` is a free-form text field. Nullable; bounded so a
 *     typo cannot regress to unbounded storage.
 *   - `source` is a closed enum mirroring the SQL default `'manual'`.
 *     Future values (`'vision'`, etc.) land when an AI path
 *     surfaces.
 *   - `details` is an open `Record<string, unknown>` reserved for
 *     the future AI path. The validator does not inspect its
 *     contents.
 *
 * The wire schema does NOT include workout sets: those land in
 * WO-002 (`/v1/workouts/:id/sets`).
 *
 * Producers and consumers parse against the same Zod schema so a
 * future shape change fails closed at the boundary.
 */
import { z } from "zod";

export const workoutSourceSchema = z.enum(["manual"]);
export type WorkoutSource = z.infer<typeof workoutSourceSchema>;

/** A `startedAt`/`completedAt` value is a UTC ISO 8601 instant. */
const isoInstantSchema = z.string().datetime({ offset: true });

/** A `YYYY-MM-DD` date for the day-filter query params. */
const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be in YYYY-MM-DD form");

/**
 * The plain object schema (no `.refine()` wrapper) so other schemas
 * can reference individual fields via `workoutSchemaBase.shape.X`.
 * `workoutSchema` (below) wraps this with a `completedAt >= startedAt`
 * refine; that wrapper strips the `.shape` accessor.
 */
export const workoutSchemaBase = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  startedAt: isoInstantSchema,
  completedAt: isoInstantSchema.nullable(),
  notes: z.string().trim().max(4_000).nullable(),
  source: workoutSourceSchema,
  details: z.record(z.unknown()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const workoutSchema = workoutSchemaBase.refine(
  (workout) =>
    workout.completedAt === null || workout.completedAt >= workout.startedAt,
  {
    message: "completedAt must be on or after startedAt",
    path: ["completedAt"],
  },
);

export type Workout = z.infer<typeof workoutSchema>;

export const workoutResponseSchema = z.object({
  workout: workoutSchema,
});

export type WorkoutResponse = z.infer<typeof workoutResponseSchema>;

export const workoutListResponseSchema = z.object({
  workouts: z.array(workoutSchema),
});

export type WorkoutListResponse = z.infer<typeof workoutListResponseSchema>;

/**
 * Body for `POST /v1/workouts`. The route server-generates `id`,
 * `userId`, audit timestamps, `source` (always `"manual"` in v1),
 * and `details` (always `{}`). `completedAt` defaults to `null`
 * when omitted so a "I just started" entry is a one-liner.
 */
export const workoutCreateSchema = z
  .object({
    name: workoutSchemaBase.shape.name,
    startedAt: isoInstantSchema.optional(),
    completedAt: isoInstantSchema.nullable().optional(),
    notes: workoutSchemaBase.shape.notes.optional(),
    details: z.record(z.unknown()).optional(),
  })
  .strict()
  .refine(
    (create) =>
      create.completedAt === undefined ||
      create.completedAt === null ||
      create.startedAt === undefined ||
      create.completedAt >= create.startedAt,
    {
      message: "completedAt must be on or after startedAt",
      path: ["completedAt"],
    },
  );

export type WorkoutCreate = z.infer<typeof workoutCreateSchema>;

/**
 * Body for `PUT /v1/workouts/:id`. Every field is optional; the
 * route merges the patch into the stored workout. Setting
 * `notes` or `completedAt` to `null` clears them.
 *
 * `name` may not be set to `null` (it is required by the schema);
 * to remove the workout, send `DELETE`. `startedAt` may not be
 * cleared for the same reason — it always has a value.
 */
export const workoutPatchSchema = z
  .object({
    name: workoutSchemaBase.shape.name.optional(),
    startedAt: isoInstantSchema.optional(),
    completedAt: isoInstantSchema.nullable().optional(),
    notes: workoutSchemaBase.shape.notes.nullable().optional(),
    details: z.record(z.unknown()).optional(),
  })
  .strict()
  .refine(
    (patch) =>
      patch.name !== undefined ||
      patch.startedAt !== undefined ||
      patch.completedAt !== undefined ||
      patch.notes !== undefined ||
      patch.details !== undefined,
    { message: "at least one field must be present" },
  )
  .refine(
    (patch) =>
      patch.completedAt === undefined ||
      patch.completedAt === null ||
      patch.startedAt === undefined ||
      patch.completedAt >= patch.startedAt,
    {
      message: "completedAt must be on or after startedAt",
      path: ["completedAt"],
    },
  );

export type WorkoutPatch = z.infer<typeof workoutPatchSchema>;

/**
 * Query params for `GET /v1/workouts`. `from` and `to` are
 * inclusive `YYYY-MM-DD` (UTC) date filters on `startedAt`;
 * `limit` caps the page size. Defaults: most-recent 50 newest-first.
 */
export const workoutListQuerySchema = z
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

export type WorkoutListQuery = z.infer<typeof workoutListQuerySchema>;
