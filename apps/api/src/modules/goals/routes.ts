import type { FastifyPluginAsync } from "fastify";
import {
  applyGoalPatch,
  validateGoalCreate,
  validateGoalPatch,
  type GoalKind,
  type GoalPace,
  type GoalRepository,
  type GoalStatus,
  type GoalTarget,
  type GoalValidationError,
  type StoredGoal,
} from "@mizyun/core";
import {
  goalCreateSchema,
  goalHistoryResponseSchema,
  goalPatchSchema,
  goalResponseSchema,
  type GoalHistoryResponse,
  type GoalResponse,
} from "@mizyun/contracts";

import { sendApiError } from "../../errors.js";

interface GoalsRoutesOptions {
  readonly goalRepository: GoalRepository;
}

const GENERIC_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Map a domain validation failure to the wire contract. Each
 * `GoalValidationError` variant becomes a stable `code` and a
 * human-readable message. The route is the only place this mapping
 * lives; new error variants must be added here.
 */
const validationErrorToApi = (
  error: GoalValidationError,
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
        message: "At least one goal field must be present.",
        requestId,
      };
    case "target_date_before_start":
      return {
        status: 422,
        code: "VALIDATION_ERROR",
        message: "targetDate must be on or after startsOn.",
        requestId,
      };
    case "review_date_before_start":
      return {
        status: 422,
        code: "VALIDATION_ERROR",
        message: "reviewDate must be on or after startsOn.",
        requestId,
      };
    case "weight_out_of_range":
      return {
        status: 422,
        code: "VALIDATION_ERROR",
        message: `target.weightKg must be between ${error.min} and ${error.max} kg.`,
        requestId,
      };
    case "body_fat_out_of_range":
      return {
        status: 422,
        code: "VALIDATION_ERROR",
        message: `target.bodyFatPercent must be between ${error.min} and ${error.max}.`,
        requestId,
      };
    case "invalid_date_format":
      return {
        status: 422,
        code: "VALIDATION_ERROR",
        message: `'${error.value}' is not a valid YYYY-MM-DD date.`,
        requestId,
      };
    case "invalid_status_transition":
      return {
        status: 409,
        code: "VALIDATION_ERROR",
        message: `Cannot transition goal from '${error.from}' to '${error.to}'.`,
        requestId,
      };
  }
};

/**
 * Convert a `StoredGoal` (Date timestamps) into the wire shape. The
 * shape is parsed through the Zod contract at the producer side so
 * any future drift is caught at the boundary.
 */
const toWire = (stored: StoredGoal): GoalResponse =>
  goalResponseSchema.parse({
    goal: {
      id: stored.id,
      userId: stored.userId,
      kind: stored.kind,
      status: stored.status,
      pace: stored.pace,
      target: {
        weightKg: stored.target.weightKg,
        ...(stored.target.bodyFatPercent !== undefined
          ? { bodyFatPercent: stored.target.bodyFatPercent }
          : {}),
      },
      startsOn: stored.startsOn,
      targetDate: stored.targetDate,
      ...(stored.reviewDate !== undefined
        ? { reviewDate: stored.reviewDate }
        : {}),
      createdAt: stored.createdAt.toISOString(),
      updatedAt: stored.updatedAt.toISOString(),
    },
  });

const historyToWire = (goals: ReadonlyArray<StoredGoal>): GoalHistoryResponse =>
  goalHistoryResponseSchema.parse({
    goals: goals.map((g) => toWire(g).goal),
  });

export const goalsRoutes: FastifyPluginAsync<GoalsRoutesOptions> = async (
  app,
  options,
) => {
  // GET /v1/goals/active — return the verified user's currently-active
  // goal, or 404 when no active goal exists.
  app.get(
    "/active",
    { preHandler: app.authenticate },
    async (request, reply): Promise<GoalResponse | void> => {
      const principal = request.principal;
      if (!principal) {
        throw new Error("principal missing after authentication");
      }
      const active = await options.goalRepository.getActive(principal.userId, {
        accessToken: principal.accessToken,
      });
      if (active === null) {
        await sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "No active goal exists for this user.",
        );
        return;
      }
      return toWire(active);
    },
  );

  // GET /v1/goals/history — return every goal the user has ever
  // created, newest first.
  app.get(
    "/history",
    { preHandler: app.authenticate },
    async (request): Promise<GoalHistoryResponse> => {
      const principal = request.principal;
      if (!principal) {
        throw new Error("principal missing after authentication");
      }
      const history = await options.goalRepository.getHistory(
        principal.userId,
        { accessToken: principal.accessToken },
      );
      return historyToWire(history);
    },
  );

  // POST /v1/goals — create a new active goal. The route server-generates
  // the id, status, and audit timestamps. The repository enforces
  // the at-most-one-active invariant; the route translates a
  // repository violation into a 409.
  app.post(
    "/",
    { preHandler: app.authenticate },
    async (request, reply): Promise<GoalResponse | void> => {
      const principal = request.principal;
      if (!principal) {
        throw new Error("principal missing after authentication");
      }
      const body = request.body as unknown;
      const parsed = goalCreateSchema.safeParse(body);
      if (!parsed.success) {
        await sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          `Invalid goal create: ${parsed.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; ")}`,
        );
        return;
      }
      const validation = validateGoalCreate({
        kind: parsed.data.kind as GoalKind,
        pace: parsed.data.pace as GoalPace,
        target: parsed.data.target as GoalTarget,
        startsOn: parsed.data.startsOn,
        targetDate: parsed.data.targetDate,
        ...(parsed.data.reviewDate !== undefined
          ? { reviewDate: parsed.data.reviewDate }
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
      const stored: StoredGoal = {
        id,
        userId: principal.userId,
        kind: parsed.data.kind as GoalKind,
        status: "active" as GoalStatus,
        pace: parsed.data.pace as GoalPace,
        target: parsed.data.target as GoalTarget,
        startsOn: parsed.data.startsOn,
        targetDate: parsed.data.targetDate,
        ...(parsed.data.reviewDate !== undefined
          ? { reviewDate: parsed.data.reviewDate }
          : {}),
        createdAt: now,
        updatedAt: now,
      };
      try {
        const saved = await options.goalRepository.create(
          principal.userId,
          stored,
          { accessToken: principal.accessToken },
        );
        return toWire(saved);
      } catch (cause) {
        // Repository enforces the at-most-one-active invariant.
        const message =
          cause instanceof Error ? cause.message : "Could not create goal.";
        await sendApiError(reply, request, 409, "VALIDATION_ERROR", message);
        return;
      }
    },
  );

  // PUT /v1/goals/:id — apply a partial patch. The route loads the
  // stored goal first, runs domain validation against the patch,
  // applies it, and writes back through the repository.
  app.put(
    "/:id",
    { preHandler: app.authenticate },
    async (request, reply): Promise<GoalResponse | void> => {
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
          "Goal id must be a UUID.",
        );
        return;
      }
      const body = request.body as unknown;
      const parsed = goalPatchSchema.safeParse(body);
      if (!parsed.success) {
        await sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          `Invalid goal patch: ${parsed.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; ")}`,
        );
        return;
      }
      const history = await options.goalRepository.getHistory(
        principal.userId,
        { accessToken: principal.accessToken },
      );
      const stored = history.find((g) => g.id === id);
      if (stored === undefined) {
        await sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "No goal with that id exists for this user.",
        );
        return;
      }
      const validation = validateGoalPatch(stored, {
        ...(parsed.data.status !== undefined
          ? { status: parsed.data.status as GoalStatus }
          : {}),
        ...(parsed.data.pace !== undefined
          ? { pace: parsed.data.pace as GoalPace }
          : {}),
        ...(parsed.data.target !== undefined
          ? { target: parsed.data.target as GoalTarget }
          : {}),
        ...(parsed.data.targetDate !== undefined
          ? { targetDate: parsed.data.targetDate }
          : {}),
        ...(parsed.data.reviewDate !== undefined
          ? {
              reviewDate:
                parsed.data.reviewDate === null ? null : parsed.data.reviewDate,
            }
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
      const next = applyGoalPatch(stored, parsed.data, new Date());
      const saved = await options.goalRepository.update(principal.userId, next, {
        accessToken: principal.accessToken,
      });
      return toWire(saved);
    },
  );
};
