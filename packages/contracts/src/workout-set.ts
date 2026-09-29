/**
 * Workout-set wire schemas (WO-002).
 *
 * The shape mirrors `public.workout_sets`:
 *   - `sequence` is the per-workout ordinal (1..N). Unique within
 *     a workout: the SQL `unique (workout_id, sequence)` constraint
 *     (and the in-memory repository) guarantees one row per
 *     sequence. The wire schema caps it at 9999 so a runaway
 *     client cannot crash the write path.
 *   - `repetitions`, `load_kg`, `duration_seconds`, and
 *     `distance_meters` are nullable: not every set has all four
 *     (some exercises are timed, others are rep-based, cardio
 *     exercises record distance). All four, when present, are
 *     bounded to non-negative ranges so a typo cannot regress a
 *     daily total to negative territory.
 *   - `perceivedExertion` is the user's RPE for the set, 0..10,
 *     nullable. The numeric SQL column has a `between 0 and 10`
 *     check constraint; the wire schema mirrors it.
 *   - `completedAt` is the moment the set was completed, or `null`
 *     when the user is logging it in-flight.
 *
 * Sets are immutable observations — there is no PUT/PATCH route.
 * Re-recording a set means DELETing the wrong one and POSTing the
 * corrected entry. The route layer documents this so the client
 * doesn't try to update a set in place.
 *
 * Producers and consumers parse against the same Zod schema so a
 * future shape change fails closed at the boundary.
 */
import { z } from "zod";

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

export const workoutSetTypeSchema = z.enum([
  "normal",
  "warmup",
  "drop",
  "failure",
]);

export type WorkoutSetType = z.infer<typeof workoutSetTypeSchema>;

export const workoutSetSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  workoutId: z.string().uuid(),
  exerciseId: z.string().uuid(),
  sequence: z.number().int().gte(1).lte(MAX_SEQUENCE),
  setType: workoutSetTypeSchema.default("normal"),
  repetitions: repetitionsSchema.nullable(),
  loadKg: loadKgSchema.nullable(),
  durationSeconds: durationSecondsSchema.nullable(),
  distanceMeters: distanceMetersSchema.nullable(),
  perceivedExertion: perceivedExertionSchema.nullable(),
  completedAt: isoInstantSchema.nullable(),
  createdAt: z.string().datetime(),
});

export type WorkoutSet = z.infer<typeof workoutSetSchema>;

export const workoutSetResponseSchema = z.object({
  workoutSet: workoutSetSchema,
});

export type WorkoutSetResponse = z.infer<typeof workoutSetResponseSchema>;

export const workoutSetListResponseSchema = z.object({
  workoutSets: z.array(workoutSetSchema),
});

export type WorkoutSetListResponse = z.infer<
  typeof workoutSetListResponseSchema
>;

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
    setType: workoutSetTypeSchema.optional(),
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

export type WorkoutSetCreate = z.infer<typeof workoutSetCreateSchema>;

export const exerciseRecentSetsQuerySchema = z
  .object({
    limit: z.coerce.number().int().gte(1).lte(50).optional(),
    excludeWorkoutId: z.string().uuid().optional(),
  })
  .strict();

export type ExerciseRecentSetsQuery = z.infer<
  typeof exerciseRecentSetsQuerySchema
>;

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

export type ExerciseRecentSetsResponse = z.infer<
  typeof exerciseRecentSetsResponseSchema
>;
