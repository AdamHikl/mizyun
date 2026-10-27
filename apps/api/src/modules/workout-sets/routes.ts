import type { FastifyPluginAsync } from "fastify";
import {
  isNonStrengthWorkoutDetails,
  MAX_SEQUENCE,
  summariseExerciseSets,
  validateWorkoutSetCreate,
  isRoutineDetails,
  WorkoutSetSequenceCollisionError,
  type StoredWorkout,
  type StoredWorkoutSet,
  type UserId,
  type WorkoutSetRepository,
  type WorkoutSetValidationError,
} from "@mizyun/core";
import {
  exerciseRecentSetsQuerySchema,
  exerciseRecentSetsResponseSchema,
  workoutSetCreateSchema,
  workoutSetListResponseSchema,
  workoutSetResponseSchema,
  type ExerciseRecentSetsResponse,
  type WorkoutSetListResponse,
  type WorkoutSetResponse,
} from "@mizyun/contracts";

import type { ExerciseRepository, WorkoutRepository } from "@mizyun/core";

import { sendApiError } from "../../errors.js";

interface WorkoutSetsRoutesOptions {
  readonly workoutSetRepository: WorkoutSetRepository;
  readonly workoutRepository: WorkoutRepository;
  readonly exerciseRepository: ExerciseRepository;
}

const GENERIC_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const RECENT_SETS_DEFAULT_LIMIT = 20;

/**
 * Keyed (retry-safe) creates whose requested sequence is taken by a
 * different set move to the next free ordinal at most this many times.
 */
const KEYED_SEQUENCE_RETRIES = 3;

const OPERATION_CONFLICT_MESSAGE =
  "This operation already saved a different set. Recover the original entry before making changes.";

/** Compare two values at the SQL column's numeric scale. */
const sameAtScale = (
  stored: number | null,
  requested: number | null,
  scale: number,
): boolean => {
  if (stored === null || requested === null) return stored === requested;
  const factor = 10 ** scale;
  return Math.round(stored * factor) === Math.round(requested * factor);
};
const RECENT_SETS_MAX_LIMIT = 50;

/**
 * Map a domain validation failure to the wire contract. Each
 * `WorkoutSetValidationError` variant becomes a stable `code` and
 * a human-readable message.
 */
const validationErrorToApi = (
  error: WorkoutSetValidationError,
  requestId: string,
): {
  status: number;
  code: "VALIDATION_ERROR";
  message: string;
  requestId: string;
} => {
  switch (error.kind) {
    case "empty_set":
      return {
        status: 422,
        code: "VALIDATION_ERROR",
        message:
          "At least one of repetitions, loadKg, durationSeconds, or distanceMeters must be present.",
        requestId,
      };
    case "repetitions_out_of_range":
      return {
        status: 422,
        code: "VALIDATION_ERROR",
        message: `repetitions must be between ${error.min} and ${error.max}.`,
        requestId,
      };
    case "load_kg_out_of_range":
      return {
        status: 422,
        code: "VALIDATION_ERROR",
        message: `loadKg must be between ${error.min} and ${error.max}.`,
        requestId,
      };
    case "duration_out_of_range":
      return {
        status: 422,
        code: "VALIDATION_ERROR",
        message: `durationSeconds must be between ${error.min} and ${error.max}.`,
        requestId,
      };
    case "distance_out_of_range":
      return {
        status: 422,
        code: "VALIDATION_ERROR",
        message: `distanceMeters must be between ${error.min} and ${error.max}.`,
        requestId,
      };
    case "perceived_exertion_out_of_range":
      return {
        status: 422,
        code: "VALIDATION_ERROR",
        message: `perceivedExertion must be between ${error.min} and ${error.max}.`,
        requestId,
      };
    case "invalid_set_type":
      return {
        status: 422,
        code: "VALIDATION_ERROR",
        message: "setType must be normal, warmup, drop, or failure.",
        requestId,
      };
    case "sequence_out_of_range":
      return {
        status: 422,
        code: "VALIDATION_ERROR",
        message: `sequence must be between ${error.min} and ${error.max}.`,
        requestId,
      };
  }
};

const toWire = (set: StoredWorkoutSet): WorkoutSetResponse =>
  workoutSetResponseSchema.parse({
    workoutSet: {
      id: set.id,
      userId: set.userId,
      workoutId: set.workoutId,
      exerciseId: set.exerciseId,
      sequence: set.sequence,
      setType: set.setType,
      repetitions: set.repetitions,
      loadKg: set.loadKg,
      durationSeconds: set.durationSeconds,
      distanceMeters: set.distanceMeters,
      perceivedExertion: set.perceivedExertion,
      completedAt:
        set.completedAt === null ? null : set.completedAt.toISOString(),
      createdAt: set.createdAt.toISOString(),
    },
  });

const listToWire = (
  sets: ReadonlyArray<StoredWorkoutSet>,
): WorkoutSetListResponse =>
  workoutSetListResponseSchema.parse({
    workoutSets: sets.map((s) => toWire(s).workoutSet),
  });

/**
 * Resolve the next free `sequence` for a workout. Returns 1 when
 * the workout has no sets yet. The repository will reject a
 * collision if two clients race for the same sequence, which is
 * the documented behaviour.
 */
const nextSequence = async (
  workoutSetRepository: WorkoutSetRepository,
  workoutId: string,
  accessToken: string,
): Promise<number> => {
  const existing = await workoutSetRepository.listForWorkout(workoutId, {
    accessToken,
  });
  if (existing.length === 0) return 1;
  const max = existing.reduce((m, s) => (s.sequence > m ? s.sequence : m), 0);
  return max + 1;
};

/**
 * Insert a set. Keyless (older-client) creates keep the documented
 * behaviour: a sequence collision is rejected. A keyed create is an
 * already-acknowledged user action (possibly replayed from an offline
 * queue), so when another set has taken its ordinal it moves to the next
 * free sequence a bounded number of times. Before each move it re-reads
 * its identity in case a concurrent replay of the same operation won.
 */
const createWithSequenceRetry = async (
  workoutSetRepository: WorkoutSetRepository,
  stored: StoredWorkoutSet,
  accessToken: string,
): Promise<StoredWorkoutSet> => {
  let candidate = stored;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await workoutSetRepository.create(candidate.userId, candidate, {
        accessToken,
      });
    } catch (cause) {
      const operation = candidate.clientOperationId;
      if (
        !operation ||
        !(cause instanceof WorkoutSetSequenceCollisionError) ||
        attempt >= KEYED_SEQUENCE_RETRIES
      ) {
        throw cause;
      }
      const winner = await workoutSetRepository.findByClientOperationId(
        candidate.userId,
        operation,
        { accessToken },
      );
      if (winner !== null) return winner;
      const sequence = await nextSequence(
        workoutSetRepository,
        candidate.workoutId,
        accessToken,
      );
      if (sequence > MAX_SEQUENCE) throw cause;
      candidate = { ...candidate, sequence };
    }
  }
};

/**
 * Verify that the exercise exists and belongs to the user. The
 * route is the only place this check lives.
 */
const assertOwnedExercise = async (
  exerciseRepository: ExerciseRepository,
  userId: UserId,
  exerciseId: string,
  accessToken: string,
): Promise<boolean> => {
  const exercise = await exerciseRepository.getById(exerciseId, {
    accessToken,
  });
  if (exercise === null) return false;
  return exercise.userId === userId;
};

/**
 * Verify that the workout exists and belongs to the user.
 */
const getOwnedWorkout = async (
  workoutRepository: WorkoutRepository,
  userId: UserId,
  workoutId: string,
  accessToken: string,
): Promise<StoredWorkout | null> => {
  const workout = await workoutRepository.getById(workoutId, {
    accessToken,
  });
  if (
    workout === null ||
    workout.userId !== userId ||
    isNonStrengthWorkoutDetails(workout.details)
  )
    return null;
  return workout;
};

const assertOwnedWorkout = async (
  workoutRepository: WorkoutRepository,
  userId: UserId,
  workoutId: string,
  accessToken: string,
): Promise<boolean> =>
  (await getOwnedWorkout(workoutRepository, userId, workoutId, accessToken)) !==
  null;

export const workoutSetsRoutes: FastifyPluginAsync<
  WorkoutSetsRoutesOptions
> = async (app, options) => {
  // POST /v1/workouts/:workoutId/sets — append a new set to the
  // workout. The route server-generates the `id`, `userId`, and
  // audit `createdAt`. When the client omits `sequence`, the
  // route picks the next free ordinal for that workout.
  app.post(
    "/workouts/:workoutId/sets",
    { preHandler: app.authenticate },
    async (request, reply): Promise<WorkoutSetResponse | void> => {
      const principal = request.principal;
      if (!principal) {
        throw new Error("principal missing after authentication");
      }
      const { workoutId } = request.params as { workoutId?: string };
      if (typeof workoutId !== "string" || !GENERIC_UUID.test(workoutId)) {
        await sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "Workout id must be a UUID.",
        );
        return;
      }
      const workout = await getOwnedWorkout(
        options.workoutRepository,
        principal.userId,
        workoutId,
        principal.accessToken,
      );
      if (workout === null) {
        await sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "No workout with that id exists for this user.",
        );
        return;
      }
      if (isRoutineDetails(workout.details)) {
        await sendApiError(
          reply,
          request,
          409,
          "CONFLICT",
          "Start a workout session before logging sets.",
        );
        return;
      }
      const body = request.body as unknown;
      const parsed = workoutSetCreateSchema.safeParse(body);
      if (!parsed.success) {
        await sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          `Invalid workout set create: ${parsed.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; ")}`,
        );
        return;
      }
      if (
        !(await assertOwnedExercise(
          options.exerciseRepository,
          principal.userId,
          parsed.data.exerciseId,
          principal.accessToken,
        ))
      ) {
        await sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          "exerciseId must reference an exercise owned by the user.",
        );
        return;
      }
      const clientOperationId = parsed.data.clientOperationId?.toLowerCase();
      if (clientOperationId && !parsed.data.completedAt) {
        await sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          "completedAt is required for repeatable sets.",
        );
        return;
      }
      const sequence =
        parsed.data.sequence ??
        (await nextSequence(
          options.workoutSetRepository,
          workoutId,
          principal.accessToken,
        ));
      const completedAt =
        parsed.data.completedAt === null
          ? null
          : parsed.data.completedAt
            ? new Date(parsed.data.completedAt)
            : new Date();
      const validation = validateWorkoutSetCreate({
        sequence,
        ...(parsed.data.setType !== undefined
          ? { setType: parsed.data.setType }
          : {}),
        ...(parsed.data.repetitions !== undefined
          ? { repetitions: parsed.data.repetitions }
          : {}),
        ...(parsed.data.loadKg !== undefined
          ? { loadKg: parsed.data.loadKg }
          : {}),
        ...(parsed.data.durationSeconds !== undefined
          ? { durationSeconds: parsed.data.durationSeconds }
          : {}),
        ...(parsed.data.distanceMeters !== undefined
          ? { distanceMeters: parsed.data.distanceMeters }
          : {}),
        ...(parsed.data.perceivedExertion !== undefined
          ? { perceivedExertion: parsed.data.perceivedExertion }
          : {}),
      });
      if (validation !== null) {
        const apiError = validationErrorToApi(validation, request.id);
        await sendApiError(
          reply,
          request,
          apiError.status,
          apiError.code,
          apiError.message,
        );
        return;
      }
      const now = new Date();
      const stored: StoredWorkoutSet = {
        id: crypto.randomUUID(),
        userId: principal.userId,
        workoutId,
        clientOperationId: clientOperationId ?? null,
        exerciseId: parsed.data.exerciseId,
        sequence,
        setType: parsed.data.setType ?? "normal",
        repetitions: parsed.data.repetitions ?? null,
        loadKg: parsed.data.loadKg ?? null,
        durationSeconds: parsed.data.durationSeconds ?? null,
        distanceMeters: parsed.data.distanceMeters ?? null,
        perceivedExertion: parsed.data.perceivedExertion ?? null,
        completedAt,
        createdAt: now,
      };
      // Canonical replay identity. `sequence` is excluded: a keyed
      // create may have moved to the next free ordinal.
      const matches = (existing: StoredWorkoutSet): boolean =>
        existing.userId === principal.userId &&
        existing.workoutId === workoutId &&
        existing.exerciseId === stored.exerciseId &&
        (existing.setType ?? "normal") === stored.setType &&
        sameAtScale(existing.repetitions, stored.repetitions, 2) &&
        sameAtScale(existing.loadKg, stored.loadKg, 3) &&
        sameAtScale(existing.durationSeconds, stored.durationSeconds, 0) &&
        sameAtScale(existing.distanceMeters, stored.distanceMeters, 2) &&
        sameAtScale(existing.perceivedExertion, stored.perceivedExertion, 1) &&
        existing.completedAt?.getTime() === stored.completedAt?.getTime();
      if (clientOperationId) {
        const existing =
          await options.workoutSetRepository.findByClientOperationId(
            principal.userId,
            clientOperationId,
            { accessToken: principal.accessToken },
          );
        if (existing !== null) {
          if (!matches(existing)) {
            await sendApiError(
              reply,
              request,
              409,
              "CONFLICT",
              OPERATION_CONFLICT_MESSAGE,
            );
            return;
          }
          return toWire(existing);
        }
      }
      let saved: StoredWorkoutSet;
      try {
        saved = await createWithSequenceRetry(
          options.workoutSetRepository,
          stored,
          principal.accessToken,
        );
      } catch (cause) {
        // A keyed set waits in an offline queue that discards it on 409, so
        // only a real sequence conflict is a 409; anything else (a database
        // outage) stays a retryable server error.
        if (clientOperationId) {
          if (!(cause instanceof WorkoutSetSequenceCollisionError)) throw cause;
          // Other writers kept taking the next number: never saved, so ask
          // the queue to try again rather than discard the set.
          await sendApiError(
            reply,
            request,
            503,
            "SERVICE_UNAVAILABLE",
            "The set could not be numbered yet. Try again.",
          );
          return;
        }
        const message =
          cause instanceof Error ? cause.message : "Could not create set.";
        await sendApiError(reply, request, 409, "VALIDATION_ERROR", message);
        return;
      }
      // A concurrent insert can return the winner; compare its canonical payload too.
      if (clientOperationId && !matches(saved)) {
        await sendApiError(
          reply,
          request,
          409,
          "CONFLICT",
          OPERATION_CONFLICT_MESSAGE,
        );
        return;
      }
      return toWire(saved);
    },
  );

  // GET /v1/workouts/:workoutId/sets — list the workout's sets
  // in sequence order. Ownership is enforced via the workout
  // id; a missing workout is indistinguishable from a wrong
  // owner.
  app.get(
    "/workouts/:workoutId/sets",
    { preHandler: app.authenticate },
    async (request, reply): Promise<WorkoutSetListResponse | void> => {
      const principal = request.principal;
      if (!principal) {
        throw new Error("principal missing after authentication");
      }
      const { workoutId } = request.params as { workoutId?: string };
      if (typeof workoutId !== "string" || !GENERIC_UUID.test(workoutId)) {
        await sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "Workout id must be a UUID.",
        );
        return;
      }
      if (
        !(await assertOwnedWorkout(
          options.workoutRepository,
          principal.userId,
          workoutId,
          principal.accessToken,
        ))
      ) {
        await sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "No workout with that id exists for this user.",
        );
        return;
      }
      const sets = await options.workoutSetRepository.listForWorkout(
        workoutId,
        { accessToken: principal.accessToken },
      );
      return listToWire(sets);
    },
  );

  // DELETE /v1/workouts/:workoutId/sets/:setId — remove a single
  // set. The route enforces ownership via the parent workout
  // AND the set itself, so a cross-user id cannot delete a
  // set.
  app.delete(
    "/workouts/:workoutId/sets/:setId",
    { preHandler: app.authenticate },
    async (request, reply): Promise<void> => {
      const principal = request.principal;
      if (!principal) {
        throw new Error("principal missing after authentication");
      }
      const params = request.params as {
        workoutId?: string;
        setId?: string;
      };
      const { workoutId, setId } = params;
      if (typeof workoutId !== "string" || !GENERIC_UUID.test(workoutId)) {
        await sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "Workout id must be a UUID.",
        );
        return;
      }
      if (typeof setId !== "string" || !GENERIC_UUID.test(setId)) {
        await sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "Set id must be a UUID.",
        );
        return;
      }
      if (
        !(await assertOwnedWorkout(
          options.workoutRepository,
          principal.userId,
          workoutId,
          principal.accessToken,
        ))
      ) {
        await sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "No workout with that id exists for this user.",
        );
        return;
      }
      const existing = await options.workoutSetRepository.getById(setId, {
        accessToken: principal.accessToken,
      });
      if (
        existing === null ||
        existing.userId !== principal.userId ||
        existing.workoutId !== workoutId
      ) {
        await sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "No set with that id exists for this workout.",
        );
        return;
      }
      await options.workoutSetRepository.delete(setId, {
        accessToken: principal.accessToken,
      });
      void reply.status(204).send();
    },
  );

  // GET /v1/exercises/:exerciseId/recent-sets — previous-
  // performance view for an exercise. The route returns the
  // most-recent N sets and a summary (best load, last session
  // volume, total set count).
  app.get(
    "/exercises/:exerciseId/recent-sets",
    { preHandler: app.authenticate },
    async (request, reply): Promise<ExerciseRecentSetsResponse | void> => {
      const principal = request.principal;
      if (!principal) {
        throw new Error("principal missing after authentication");
      }
      const { exerciseId } = request.params as { exerciseId?: string };
      if (typeof exerciseId !== "string" || !GENERIC_UUID.test(exerciseId)) {
        await sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "Exercise id must be a UUID.",
        );
        return;
      }
      if (
        !(await assertOwnedExercise(
          options.exerciseRepository,
          principal.userId,
          exerciseId,
          principal.accessToken,
        ))
      ) {
        await sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "No exercise with that id exists for this user.",
        );
        return;
      }
      const parsed = exerciseRecentSetsQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        await sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          `Invalid recent-sets query: ${parsed.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; ")}`,
        );
        return;
      }
      const limit = parsed.data.limit ?? RECENT_SETS_DEFAULT_LIMIT;
      const cappedLimit = Math.min(RECENT_SETS_MAX_LIMIT, Math.max(1, limit));
      const requestedSets =
        await options.workoutSetRepository.recentForExercise(
          principal.userId,
          exerciseId,
          parsed.data.excludeWorkoutId === undefined
            ? cappedLimit
            : RECENT_SETS_MAX_LIMIT,
          { accessToken: principal.accessToken },
        );
      const sets = requestedSets
        .filter((set) => set.workoutId !== parsed.data.excludeWorkoutId)
        .slice(0, cappedLimit);
      const summary = summariseExerciseSets(sets);
      return exerciseRecentSetsResponseSchema.parse({
        sets: sets.map((s) => toWire(s).workoutSet),
        summary,
      });
    },
  );
};
