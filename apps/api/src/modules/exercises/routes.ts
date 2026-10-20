import type { FastifyPluginAsync } from "fastify";
import {
  ExerciseInUseError,
  applyExercisePatch,
  resolveExerciseTrackingMode,
  searchExerciseCatalog,
  validateExerciseCreate,
  validateExercisePatch,
  type ExercisePatch,
  type ExerciseRepository,
  type ExerciseValidationError,
  type StoredExercise,
  type WorkoutSetRepository,
} from "@mizyun/core";
import {
  exerciseCatalogQuerySchema,
  exerciseCatalogResponseSchema,
  exerciseCreateSchema,
  exerciseListQuerySchema,
  exerciseListResponseSchema,
  exercisePatchSchema,
  exerciseResponseSchema,
  type ExerciseCatalogResponse,
  type ExerciseListResponse,
  type ExerciseResponse,
} from "@mizyun/contracts";

import { sendApiError } from "../../errors.js";

interface ExercisesRoutesOptions {
  readonly exerciseRepository: ExerciseRepository;
  readonly workoutSetRepository: WorkoutSetRepository;
}

const GENERIC_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Map a domain validation failure to the wire contract. Each
 * `ExerciseValidationError` variant becomes a stable `code` and a
 * human-readable message. The route is the only place this mapping
 * lives; new error variants must be added here.
 */
const validationErrorToApi = (
  error: ExerciseValidationError,
  requestId: string,
): {
  status: number;
  code: "VALIDATION_ERROR";
  message: string;
  requestId: string;
} => {
  switch (error.kind) {
    case "empty_patch":
      return {
        status: 400,
        code: "VALIDATION_ERROR",
        message: "At least one exercise field must be present.",
        requestId,
      };
    case "name_empty":
      return {
        status: 422,
        code: "VALIDATION_ERROR",
        message: "name cannot be blank.",
        requestId,
      };
    case "name_too_long":
      return {
        status: 422,
        code: "VALIDATION_ERROR",
        message: `name must be at most ${error.max} characters.`,
        requestId,
      };
    case "instructions_too_long":
      return {
        status: 422,
        code: "VALIDATION_ERROR",
        message: `instructions must be at most ${error.max} characters.`,
        requestId,
      };
    case "metadata_must_be_object":
      return {
        status: 422,
        code: "VALIDATION_ERROR",
        message: "metadata must be a JSON object.",
        requestId,
      };
  }
};

/**
 * Convert a `StoredExercise` (`Date` timestamps, branded UserId,
 * default-empty `metadata`) into the wire shape. The shape is parsed
 * through the Zod contract at the producer side so any future drift
 * is caught at the boundary.
 */
const toWire = (exercise: StoredExercise): ExerciseResponse =>
  exerciseResponseSchema.parse({
    exercise: {
      id: exercise.id,
      userId: exercise.userId,
      name: exercise.name,
      instructions: exercise.instructions,
      metadata: { ...exercise.metadata },
      createdAt: exercise.createdAt.toISOString(),
      updatedAt: exercise.updatedAt.toISOString(),
    },
  });

const listToWire = (
  exercises: ReadonlyArray<StoredExercise>,
): ExerciseListResponse =>
  exerciseListResponseSchema.parse({
    exercises: exercises.map((e) => toWire(e).exercise),
  });

export const exercisesRoutes: FastifyPluginAsync<
  ExercisesRoutesOptions
> = async (app, options) => {
  // GET /v1/exercises — return the verified user's exercises,
  // sorted by name (case-insensitive) for a stable picker
  // experience. `limit` caps the page size.
  app.get(
    "/",
    { preHandler: app.authenticate },
    async (request, reply): Promise<ExerciseListResponse | void> => {
      const principal = request.principal;
      if (!principal) {
        throw new Error("principal missing after authentication");
      }
      const parsed = exerciseListQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        await sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          `Invalid exercise query: ${parsed.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; ")}`,
        );
        return;
      }
      const limit = parsed.data.limit ?? DEFAULT_LIMIT;
      const cappedLimit = Math.min(MAX_LIMIT, Math.max(1, limit));
      const exercises = await options.exerciseRepository.list(
        principal.userId,
        { limit: cappedLimit, accessToken: principal.accessToken },
      );
      return listToWire(exercises);
    },
  );

  // POST /v1/exercises — create a new exercise. The route
  // server-generates `id`, `userId`, and audit timestamps.
  app.post(
    "/",
    { preHandler: app.authenticate },
    async (request, reply): Promise<ExerciseResponse | void> => {
      const principal = request.principal;
      if (!principal) {
        throw new Error("principal missing after authentication");
      }
      const body = request.body as unknown;
      const parsed = exerciseCreateSchema.safeParse(body);
      if (!parsed.success) {
        await sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          `Invalid exercise create: ${parsed.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; ")}`,
        );
        return;
      }
      const validation = validateExerciseCreate({
        name: parsed.data.name,
        ...(parsed.data.instructions !== undefined
          ? { instructions: parsed.data.instructions }
          : {}),
        ...(parsed.data.metadata !== undefined
          ? { metadata: parsed.data.metadata }
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
      const id = crypto.randomUUID();
      const stored: StoredExercise = {
        id,
        userId: principal.userId,
        name: parsed.data.name,
        instructions: parsed.data.instructions ?? null,
        metadata: parsed.data.metadata ? { ...parsed.data.metadata } : {},
        createdAt: now,
        updatedAt: now,
      };
      const saved = await options.exerciseRepository.create(
        principal.userId,
        stored,
        { accessToken: principal.accessToken },
      );
      return toWire(saved);
    },
  );

  // GET /v1/exercises/catalog — search the prefilled exercise catalog
  // by query string, movement pattern, or category.
  app.get(
    "/catalog",
    { preHandler: app.authenticate },
    async (request, reply): Promise<ExerciseCatalogResponse | void> => {
      const parsed = exerciseCatalogQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        await sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          `Invalid catalog query: ${parsed.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; ")}`,
        );
        return;
      }
      const results = searchExerciseCatalog({
        query: parsed.data.query,
        movementPattern: parsed.data.movementPattern,
        category: parsed.data.category,
        limit: parsed.data.limit ?? DEFAULT_LIMIT,
        offset: parsed.data.offset,
      });
      return exerciseCatalogResponseSchema.parse({
        total: searchExerciseCatalog({
          query: parsed.data.query,
          movementPattern: parsed.data.movementPattern,
          category: parsed.data.category,
          limit: Number.MAX_SAFE_INTEGER,
        }).length,
        exercises: results.map((ex) => ({
          id: ex.id,
          name: ex.name,
          movementPattern: ex.movementPattern,
          equipment: [...ex.equipment],
          blockedBy: [...ex.blockedBy],
          focusFit: [...ex.focusFit],
          primaryMuscles: [...ex.primaryMuscles],
          secondaryMuscles: [...ex.secondaryMuscles],
          instructions: [...ex.instructions],
          category: ex.category,
          level: ex.level,
          mechanic: ex.mechanic,
          description: ex.description,
          aliases: ex.aliases,
          tips: ex.tips,
          commonMistakes: ex.commonMistakes,
          requiredEquipment: ex.requiredEquipment,
          source: ex.source,
          contentReview: ex.contentReview,
          demonstration: ex.demonstration,
        })),
      });
    },
  );

  // GET /v1/exercises/:id — fetch a single exercise by id. The
  // route enforces the ownership check after the repository
  // returns so a missing id is indistinguishable from a wrong
  // owner (no enumeration).
  app.get(
    "/:id",
    { preHandler: app.authenticate },
    async (request, reply): Promise<ExerciseResponse | void> => {
      const principal = request.principal;
      if (!principal) {
        throw new Error("principal missing after authentication");
      }
      const { id } = request.params as { id?: string };
      if (typeof id !== "string" || !GENERIC_UUID.test(id)) {
        await sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "Exercise id must be a UUID.",
        );
        return;
      }
      const stored = await options.exerciseRepository.getById(id, {
        accessToken: principal.accessToken,
      });
      if (stored === null || stored.userId !== principal.userId) {
        await sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "No exercise with that id exists for this user.",
        );
        return;
      }
      return toWire(stored);
    },
  );

  // PUT /v1/exercises/:id — partial update. Body is parsed by
  // Zod; domain validation runs after parsing so the rejection
  // reason carries the typed `ExerciseValidationError` shape,
  // not a Zod issue list.
  app.put(
    "/:id",
    { preHandler: app.authenticate },
    async (request, reply): Promise<ExerciseResponse | void> => {
      const principal = request.principal;
      if (!principal) {
        throw new Error("principal missing after authentication");
      }
      const { id } = request.params as { id?: string };
      if (typeof id !== "string" || !GENERIC_UUID.test(id)) {
        await sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "Exercise id must be a UUID.",
        );
        return;
      }
      const body = request.body as unknown;
      const parsed = exercisePatchSchema.safeParse(body);
      if (!parsed.success) {
        await sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          `Invalid exercise patch: ${parsed.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; ")}`,
        );
        return;
      }
      const stored = await options.exerciseRepository.getById(id, {
        accessToken: principal.accessToken,
      });
      if (stored === null || stored.userId !== principal.userId) {
        await sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "No exercise with that id exists for this user.",
        );
        return;
      }
      const patch: ExercisePatch = {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.instructions !== undefined
          ? {
              instructions:
                parsed.data.instructions === null
                  ? null
                  : parsed.data.instructions,
            }
          : {}),
        ...(parsed.data.metadata !== undefined
          ? { metadata: parsed.data.metadata }
          : {}),
      };
      const validation = validateExercisePatch(patch);
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
      const next = applyExercisePatch(stored, patch, new Date());
      // Existing sets are read under the exercise's tracking mode, so the
      // mode is frozen once any set references the exercise. Only query
      // sets when the resolved mode actually changes; a lookup failure
      // propagates (500) rather than letting the change through.
      if (
        resolveExerciseTrackingMode(stored) !==
        resolveExerciseTrackingMode(next)
      ) {
        const existingSets =
          await options.workoutSetRepository.recentForExercise(
            principal.userId,
            id,
            1,
            { accessToken: principal.accessToken },
          );
        if (existingSets.length > 0) {
          await sendApiError(
            reply,
            request,
            409,
            "CONFLICT",
            "This exercise has logged sets, so its tracking type can't change.",
          );
          return;
        }
      }
      const saved = await options.exerciseRepository.update(next, {
        accessToken: principal.accessToken,
      });
      return toWire(saved);
    },
  );

  // DELETE /v1/exercises/:id — remove the exercise. The route
  // enforces the ownership check before deleting so a missing id
  // is indistinguishable from a wrong owner (no enumeration).
  app.delete(
    "/:id",
    { preHandler: app.authenticate },
    async (request, reply): Promise<void> => {
      const principal = request.principal;
      if (!principal) {
        throw new Error("principal missing after authentication");
      }
      const { id } = request.params as { id?: string };
      if (typeof id !== "string" || !GENERIC_UUID.test(id)) {
        await sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "Exercise id must be a UUID.",
        );
        return;
      }
      const stored = await options.exerciseRepository.getById(id, {
        accessToken: principal.accessToken,
      });
      if (stored === null || stored.userId !== principal.userId) {
        await sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "No exercise with that id exists for this user.",
        );
        return;
      }
      try {
        await options.exerciseRepository.delete(id, {
          accessToken: principal.accessToken,
        });
      } catch (error) {
        if (error instanceof ExerciseInUseError) {
          await sendApiError(
            reply,
            request,
            409,
            "CONFLICT",
            "This exercise has logged sets and cannot be deleted.",
          );
          return;
        }
        throw error;
      }
      void reply.status(204).send();
    },
  );
};
