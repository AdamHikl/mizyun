import type { FastifyPluginAsync } from "fastify";
import {
  applyWorkoutPatch,
  isRoutineDetails,
  readWorkoutLifecycle,
  validateWorkoutCreate,
  validateWorkoutPatch,
  withWorkoutLifecycle,
  type CommunityRepository,
  type StoredWorkout,
  type WorkoutPatch,
  type WorkoutRepository,
  type WorkoutSource,
  type WorkoutValidationError,
} from "@mizyun/core";
import {
  workoutCreateSchema,
  workoutListQuerySchema,
  workoutListResponseSchema,
  workoutPatchSchema,
  workoutResponseSchema,
  type WorkoutListResponse,
  type WorkoutResponse,
} from "@mizyun/contracts";

import { sendApiError } from "../../errors.js";

interface WorkoutsRoutesOptions {
  readonly workoutRepository: WorkoutRepository;
  readonly communityRepository?: CommunityRepository;
}

const GENERIC_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Translate an ISO `YYYY-MM-DD` (UTC midnight) date filter into the
 * inclusive instant bounds the repository expects. Matches the
 * pattern used by the food-entries route so the wire contract
 * reads the same way to the client.
 */
const isoDateToStartOfDay = (iso: string): Date => {
  const parts = iso.split("-").map((part) => Number.parseInt(part, 10));
  const [year, month, day] = parts as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
};

const isoDateToEndOfDay = (iso: string): Date => {
  const parts = iso.split("-").map((part) => Number.parseInt(part, 10));
  const [year, month, day] = parts as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
};

/**
 * Map a domain validation failure to the wire contract. Each
 * `WorkoutValidationError` variant becomes a stable `code` and a
 * human-readable message. The route is the only place this mapping
 * lives; new error variants must be added here.
 */
const validationErrorToApi = (
  error: WorkoutValidationError,
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
        message: "At least one workout field must be present.",
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
    case "notes_too_long":
      return {
        status: 422,
        code: "VALIDATION_ERROR",
        message: `notes must be at most ${error.max} characters.`,
        requestId,
      };
    case "details_must_be_object":
      return {
        status: 422,
        code: "VALIDATION_ERROR",
        message: "details must be a JSON object.",
        requestId,
      };
    case "started_at_required":
      return {
        status: 422,
        code: "VALIDATION_ERROR",
        message: "startedAt must be a valid ISO 8601 instant.",
        requestId,
      };
    case "completed_at_before_started_at":
      return {
        status: 422,
        code: "VALIDATION_ERROR",
        message: "completedAt must be on or after startedAt.",
        requestId,
      };
  }
};

/**
 * Convert a `StoredWorkout` (`Date` timestamps, branded UserId,
 * default-empty `details`) into the wire shape. The shape is
 * parsed through the Zod contract at the producer side so any
 * future drift is caught at the boundary.
 */
const toWire = (workout: StoredWorkout): WorkoutResponse =>
  workoutResponseSchema.parse({
    workout: {
      id: workout.id,
      userId: workout.userId,
      clientOperationId: workout.clientOperationId ?? null,
      name: workout.name,
      startedAt: workout.startedAt.toISOString(),
      completedAt:
        workout.completedAt === null ? null : workout.completedAt.toISOString(),
      notes: workout.notes,
      source: workout.source,
      details: { ...workout.details },
      createdAt: workout.createdAt.toISOString(),
      updatedAt: workout.updatedAt.toISOString(),
    },
  });

const listToWire = (
  workouts: ReadonlyArray<StoredWorkout>,
): WorkoutListResponse =>
  workoutListResponseSchema.parse({
    workouts: workouts.map((w) => toWire(w).workout),
  });

export const workoutsRoutes: FastifyPluginAsync<WorkoutsRoutesOptions> = async (
  app,
  options,
) => {
  // GET /v1/workouts — return the verified user's workouts,
  // newest-first. `from` and `to` are optional inclusive date
  // filters in `YYYY-MM-DD` (UTC); `limit` caps the page size.
  app.get(
    "/",
    { preHandler: app.authenticate },
    async (request, reply): Promise<WorkoutListResponse | void> => {
      const principal = request.principal;
      if (!principal) {
        throw new Error("principal missing after authentication");
      }
      const parsed = workoutListQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        await sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          `Invalid workout query: ${parsed.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; ")}`,
        );
        return;
      }
      const from = parsed.data.from
        ? isoDateToStartOfDay(parsed.data.from)
        : null;
      const to = parsed.data.to ? isoDateToEndOfDay(parsed.data.to) : null;
      const limit = parsed.data.limit ?? DEFAULT_LIMIT;
      const cappedLimit = Math.min(MAX_LIMIT, Math.max(1, limit));
      const workouts = await options.workoutRepository.list(principal.userId, {
        from,
        to,
        limit: cappedLimit,
        ...(parsed.data.kind !== undefined ? { kind: parsed.data.kind } : {}),
        accessToken: principal.accessToken,
      });
      return listToWire(workouts);
    },
  );

  // POST /v1/workouts — create a new manual workout. Supports
  // idempotency via `clientOperationId` (in body or `Idempotency-Key`
  // header). Replays on identical payload; 409 CONFLICT on mismatch.
  // Validates referenced `routineId` in `workoutLifecycle` if starting
  // from a routine.
  app.post(
    "/",
    { preHandler: app.authenticate },
    async (request, reply): Promise<WorkoutResponse | void> => {
      const principal = request.principal;
      if (!principal) {
        throw new Error("principal missing after authentication");
      }
      const body = request.body as unknown;
      const parsed = workoutCreateSchema.safeParse(body);
      if (!parsed.success) {
        await sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          `Invalid workout create: ${parsed.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; ")}`,
        );
        return;
      }

      const clientOpHeader = request.headers["idempotency-key"];
      const clientOperationId =
        parsed.data.clientOperationId ??
        (typeof clientOpHeader === "string" && clientOpHeader.trim().length > 0
          ? clientOpHeader.trim()
          : undefined);

      if (
        clientOperationId !== undefined &&
        !GENERIC_UUID.test(clientOperationId)
      ) {
        await sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          "Idempotency key must be a valid UUID.",
        );
        return;
      }

      const canonicalJson = (val: unknown): string => {
        if (val === null || typeof val !== "object") {
          return JSON.stringify(val);
        }
        if (Array.isArray(val)) {
          return "[" + val.map(canonicalJson).join(",") + "]";
        }
        const record = val as Record<string, unknown>;
        const sortedKeys = Object.keys(record).sort();
        const entries: string[] = [];
        for (const key of sortedKeys) {
          if (record[key] !== undefined) {
            entries.push(
              `${JSON.stringify(key)}:${canonicalJson(record[key])}`,
            );
          }
        }
        return "{" + entries.join(",") + "}";
      };

      const matchesCanonicalWorkoutPayload = (
        existing: StoredWorkout,
        incoming: typeof parsed.data,
      ): boolean => {
        if (existing.name.trim() !== incoming.name.trim()) return false;
        if ((existing.notes ?? null) !== (incoming.notes ?? null)) return false;

        if (incoming.startedAt !== undefined) {
          const incomingTime = new Date(incoming.startedAt).getTime();
          const existingTime = existing.startedAt.getTime();
          if (isNaN(incomingTime) || incomingTime !== existingTime)
            return false;
        }

        if (incoming.completedAt !== undefined) {
          const incomingComp =
            incoming.completedAt === null
              ? null
              : new Date(incoming.completedAt).getTime();
          const existingComp =
            existing.completedAt === null
              ? null
              : existing.completedAt.getTime();
          if (incomingComp !== existingComp) return false;
        }

        const expectedLifecycle = readWorkoutLifecycle(incoming.details) ?? {
          kind: "session",
        };
        const incomingNormalizedDetails = withWorkoutLifecycle(
          incoming.details ?? {},
          expectedLifecycle,
        );
        const existingNormalizedDetails = withWorkoutLifecycle(
          existing.details ?? {},
          readWorkoutLifecycle(existing.details) ?? { kind: "session" },
        );
        if (
          canonicalJson(existingNormalizedDetails) !==
          canonicalJson(incomingNormalizedDetails)
        ) {
          return false;
        }

        return true;
      };

      if (
        clientOperationId &&
        options.workoutRepository.findByClientOperationId
      ) {
        const existing =
          await options.workoutRepository.findByClientOperationId(
            principal.userId,
            clientOperationId,
            { accessToken: principal.accessToken },
          );
        if (existing !== null) {
          if (!matchesCanonicalWorkoutPayload(existing, parsed.data)) {
            await sendApiError(
              reply,
              request,
              409,
              "CONFLICT",
              "The specified operation ID was already used with a different workout payload.",
            );
            return;
          }
          return toWire(existing);
        }
      }

      const startedAt = parsed.data.startedAt
        ? new Date(parsed.data.startedAt)
        : new Date();
      const completedAt =
        parsed.data.completedAt === null ||
        parsed.data.completedAt === undefined
          ? null
          : new Date(parsed.data.completedAt);
      const validation = validateWorkoutCreate({
        name: parsed.data.name,
        startedAt,
        ...(completedAt !== null ? { completedAt } : {}),
        ...(parsed.data.notes !== undefined
          ? { notes: parsed.data.notes }
          : {}),
        ...(parsed.data.details !== undefined
          ? { details: parsed.data.details }
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

      const incomingDetails = parsed.data.details
        ? { ...parsed.data.details }
        : {};
      const lifecycle = readWorkoutLifecycle(incomingDetails);

      if (lifecycle?.kind === "session" && lifecycle.routineId) {
        const routineId = lifecycle.routineId;
        if (!GENERIC_UUID.test(routineId)) {
          await sendApiError(
            reply,
            request,
            422,
            "VALIDATION_ERROR",
            "Referenced routine id must be a valid UUID.",
          );
          return;
        }
        const routine = await options.workoutRepository.getById(routineId, {
          accessToken: principal.accessToken,
        });
        if (routine === null || routine.userId !== principal.userId) {
          await sendApiError(
            reply,
            request,
            404,
            "NOT_FOUND",
            "Referenced routine not found.",
          );
          return;
        }
        if (!isRoutineDetails(routine.details)) {
          await sendApiError(
            reply,
            request,
            422,
            "VALIDATION_ERROR",
            "Referenced workout is not a routine template.",
          );
          return;
        }
      }

      const finalDetails =
        lifecycle === null
          ? withWorkoutLifecycle(incomingDetails, { kind: "session" })
          : incomingDetails;

      const now = new Date();
      const id = crypto.randomUUID();
      const stored: StoredWorkout = {
        id,
        userId: principal.userId,
        clientOperationId: clientOperationId ?? null,
        source: "manual" as WorkoutSource,
        name: parsed.data.name,
        startedAt,
        completedAt,
        notes: parsed.data.notes ?? null,
        details: finalDetails,
        createdAt: now,
        updatedAt: now,
      };
      const saved = await options.workoutRepository.create(
        principal.userId,
        stored,
        { accessToken: principal.accessToken },
      );
      if (
        clientOperationId &&
        saved.clientOperationId === clientOperationId &&
        saved.id !== stored.id &&
        !matchesCanonicalWorkoutPayload(saved, parsed.data)
      ) {
        await sendApiError(
          reply,
          request,
          409,
          "CONFLICT",
          "The specified operation ID was already used with a different workout payload.",
        );
        return;
      }
      return toWire(saved);
    },
  );

  // GET /v1/workouts/:id — fetch a single workout by id. The
  // route enforces the ownership check after the repository
  // returns so a missing id is indistinguishable from a wrong
  // owner (no enumeration).
  app.get(
    "/:id",
    { preHandler: app.authenticate },
    async (request, reply): Promise<WorkoutResponse | void> => {
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
          "Workout id must be a UUID.",
        );
        return;
      }
      const stored = await options.workoutRepository.getById(id, {
        accessToken: principal.accessToken,
      });
      if (stored === null || stored.userId !== principal.userId) {
        await sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "No workout with that id exists for this user.",
        );
        return;
      }
      return toWire(stored);
    },
  );

  // PUT /v1/workouts/:id — partial update. Body is parsed by
  // Zod; domain validation runs after parsing so the rejection
  // reason carries the typed `WorkoutValidationError` shape.
  app.put(
    "/:id",
    { preHandler: app.authenticate },
    async (request, reply): Promise<WorkoutResponse | void> => {
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
          "Workout id must be a UUID.",
        );
        return;
      }
      const body = request.body as unknown;
      const parsed = workoutPatchSchema.safeParse(body);
      if (!parsed.success) {
        await sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          `Invalid workout patch: ${parsed.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; ")}`,
        );
        return;
      }
      const stored = await options.workoutRepository.getById(id, {
        accessToken: principal.accessToken,
      });
      if (stored === null || stored.userId !== principal.userId) {
        await sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "No workout with that id exists for this user.",
        );
        return;
      }
      const patch: WorkoutPatch = {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.startedAt !== undefined
          ? { startedAt: new Date(parsed.data.startedAt) }
          : {}),
        ...(parsed.data.completedAt !== undefined
          ? {
              completedAt:
                parsed.data.completedAt === null
                  ? null
                  : new Date(parsed.data.completedAt),
            }
          : {}),
        ...(parsed.data.notes !== undefined
          ? { notes: parsed.data.notes === null ? null : parsed.data.notes }
          : {}),
        ...(parsed.data.details !== undefined
          ? { details: parsed.data.details }
          : {}),
      };
      const validation = validateWorkoutPatch(stored, patch);
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
      const next = applyWorkoutPatch(stored, patch, new Date());
      if (
        stored.completedAt !== null &&
        next.completedAt === null &&
        options.communityRepository
      ) {
        await options.communityRepository.revokeActivitiesForWorkout(
          id,
          principal.userId,
          { accessToken: principal.accessToken },
        );
      }
      const saved = await options.workoutRepository.update(next, {
        accessToken: principal.accessToken,
      });
      return toWire(saved);
    },
  );

  // DELETE /v1/workouts/:id — remove the workout. The route
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
          "Workout id must be a UUID.",
        );
        return;
      }
      const stored = await options.workoutRepository.getById(id, {
        accessToken: principal.accessToken,
      });
      if (stored === null || stored.userId !== principal.userId) {
        await sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "No workout with that id exists for this user.",
        );
        return;
      }
      if (options.communityRepository) {
        await options.communityRepository.revokeActivitiesForWorkout(
          id,
          principal.userId,
          { accessToken: principal.accessToken },
        );
      }
      await options.workoutRepository.delete(id, {
        accessToken: principal.accessToken,
      });
      void reply.status(204).send();
    },
  );
};
