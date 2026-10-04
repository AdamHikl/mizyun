import { z } from "./zod-runtime.mjs";
export const workoutSourceSchema = z.enum(["manual"]);
/** A `startedAt`/`completedAt` value is a UTC ISO 8601 instant. */
const isoInstantSchema = z.string().datetime({ offset: true });
/**
 * The plain object schema (no `.refine()` wrapper) so other schemas
 * can reference individual fields via `workoutSchemaBase.shape.X`.
 * `workoutSchema` (below) wraps this with a `completedAt >= startedAt`
 * refine; that wrapper strips the `.shape` accessor.
 */
export const workoutSchemaBase = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  clientOperationId: z.string().uuid().nullable().optional(),
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
export const workoutResponseSchema = z.object({
  workout: workoutSchema,
});
export const workoutListResponseSchema = z.object({
  workouts: z.array(workoutSchema),
});
/**
 * Body for `POST /v1/workouts`. The route server-generates `id`,
 * `userId`, audit timestamps, `source` (always `"manual"` in v1),
 * and `details` (always `{}`). `completedAt` defaults to `null`
 * when omitted so a "I just started" entry is a one-liner.
 */
export const workoutCreateSchema = z
  .object({
    clientOperationId: z.string().uuid().optional(),
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
