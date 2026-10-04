import { z } from "./zod-runtime.mjs";
const isoInstantSchema = z.string().datetime({ offset: true });
/** Bounded sequences; 9999 is the natural cap for a single session. */
const MAX_SEQUENCE = 9999;
/** Bounded repetitions, mirroring `numeric(7, 2)`. */
const repetitionsSchema = z.number().gte(0).lte(9999.99).multipleOf(0.01);
/** Bounded load in kilograms, mirroring `numeric(8, 3)`. */
const loadKgSchema = z.number().gte(0).lte(9999.999).multipleOf(0.001);
/** Bounded duration in seconds, mirroring the SQL `integer`. */
const durationSecondsSchema = z.number().int().gte(0).lte(86_400);
/** Bounded distance in meters, mirroring `numeric(10, 2)`. */
const distanceMetersSchema = z.number().gte(0).lte(1_000_000).multipleOf(0.01);
/** Bounded RPE, 0..10. */
const perceivedExertionSchema = z.number().gte(0).lte(10).multipleOf(0.1);
export const workoutSetSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  workoutId: z.string().uuid(),
  exerciseId: z.string().uuid(),
  sequence: z.number().int().gte(1).lte(MAX_SEQUENCE),
  repetitions: repetitionsSchema.nullable(),
  loadKg: loadKgSchema.nullable(),
  durationSeconds: durationSecondsSchema.nullable(),
  distanceMeters: distanceMetersSchema.nullable(),
  perceivedExertion: perceivedExertionSchema.nullable(),
  completedAt: isoInstantSchema.nullable(),
  createdAt: z.string().datetime(),
});
export const workoutSetResponseSchema = z.object({
  workoutSet: workoutSetSchema,
});
export const workoutSetListResponseSchema = z.object({
  workoutSets: z.array(workoutSetSchema),
});
/**
 * Body for `POST /v1/workouts/:workoutId/sets`. The route
 * server-generates `id`, `userId`, `workoutId` (from the URL),
 * `createdAt`, and `sequence` when omitted.
 *
 * `exerciseId` is required at the boundary even though the SQL
 * column allows NULL in v1: a workout set without an exercise
 * cannot be replayed in WO-04's previous-performance view, so the
 * route rejects the create.
 *
 * At least one of the four numeric performance fields
 * (`repetitions`, `loadKg`, `durationSeconds`, `distanceMeters`)
 * must be present. A "set" of nothing has no practical value and
 * is rejected at the wire layer.
 */
export const workoutSetCreateSchema = z
  .object({
    exerciseId: z.string().uuid(),
    sequence: z.number().int().gte(1).lte(MAX_SEQUENCE).optional(),
    repetitions: repetitionsSchema.nullable().optional(),
    loadKg: loadKgSchema.nullable().optional(),
    durationSeconds: durationSecondsSchema.nullable().optional(),
    distanceMeters: distanceMetersSchema.nullable().optional(),
    perceivedExertion: perceivedExertionSchema.nullable().optional(),
    completedAt: isoInstantSchema.nullable().optional(),
  })
  .strict()
  .refine(
    (create) =>
      create.repetitions !== undefined ||
      create.loadKg !== undefined ||
      create.durationSeconds !== undefined ||
      create.distanceMeters !== undefined,
    {
      message:
        "at least one of repetitions, loadKg, durationSeconds, or distanceMeters must be present",
    },
  );
/**
 * Response for `GET /v1/exercises/:id/recent-sets`. Returns the
 * most-recent sets for the user's exercise, newest-first, plus a
 * `summary` block with the previous best load (max `loadKg` ever
 * recorded for that exercise), the previous session's volume
 * (sum of `loadKg * repetitions` for that session), and the total
 * set count. Used by the UI's previous-performance pane (WO-04).
 */
export const exerciseRecentSetsResponseSchema = z.object({
  sets: z.array(workoutSetSchema),
  summary: z.object({
    bestLoadKg: loadKgSchema.nullable(),
    lastSessionVolumeKg: z.number().gte(0).nullable(),
    totalSetCount: z.number().int().gte(0),
  }),
});
