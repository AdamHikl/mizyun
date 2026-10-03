import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import {
  RecurringMealRepositoryError,
  type RecurringMealRepository,
  type StoredRecurringMeal,
} from "@mizyun/core";
import {
  recurringMealCreateSchema,
  recurringMealPatchSchema,
  recurringMealSkipSchema,
  recurringMealResponseSchema,
  recurringMealListResponseSchema,
} from "@mizyun/contracts";
import { sendApiError } from "../../errors.js";

interface RecurringMealsRoutesOptions {
  readonly recurringMealRepository: RecurringMealRepository;
  readonly available?: boolean;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const toWire = (meal: StoredRecurringMeal) => ({
  ...meal,
  createdAt: meal.createdAt.toISOString(),
  updatedAt: meal.updatedAt.toISOString(),
});
const notFound = (reply: FastifyReply, request: FastifyRequest) =>
  sendApiError(
    reply,
    request,
    404,
    "NOT_FOUND",
    "Recurring meal was not found.",
  );
const handle = async <T>(
  request: FastifyRequest,
  reply: FastifyReply,
  action: () => Promise<T>,
): Promise<T | void> => {
  try {
    return await action();
  } catch (error) {
    if (!(error instanceof RecurringMealRepositoryError)) throw error;
    if (error.kind === "not_found") {
      await notFound(reply, request);
      return;
    }
    if (error.kind === "conflict") {
      await sendApiError(
        reply,
        request,
        409,
        "CONFLICT",
        "This recurring meal request has already been used or stopped.",
      );
      return;
    }
    await sendApiError(
      reply,
      request,
      422,
      "VALIDATION_ERROR",
      "Choose a confirmed meal and a valid schedule.",
    );
  }
};

export const recurringMealsRoutes: FastifyPluginAsync<
  RecurringMealsRoutesOptions
> = async (app, options) => {
  const repo = options.recurringMealRepository;
  const auth = { preHandler: app.authenticate };
  const unavailable = (request: FastifyRequest, reply: FastifyReply) => {
    if (options.available !== false) return false;
    void sendApiError(
      reply,
      request,
      503,
      "SERVICE_UNAVAILABLE",
      "Recurring meal logging is temporarily unavailable.",
    );
    return true;
  };
  app.get("/", auth, async (request, reply) =>
    handle(request, reply, async () => {
      const principal = request.principal!;
      const rows = await repo.list(principal.userId, {
        accessToken: principal.accessToken,
      });
      // Defense in depth for incorrectly implemented repository adapters.
      if (rows.some((row) => row.userId !== principal.userId))
        throw new Error("Recurring meal repository owner mismatch");
      return recurringMealListResponseSchema.parse({
        recurringMeals: rows.map(toWire),
      });
    }),
  );
  app.post("/", auth, async (request, reply) => {
    if (unavailable(request, reply)) return;
    const parsed = recurringMealCreateSchema.safeParse(request.body);
    if (!parsed.success)
      return sendApiError(
        reply,
        request,
        422,
        "VALIDATION_ERROR",
        "Choose a saved meal, time, time zone and unique weekdays.",
      );
    return handle(request, reply, async () => {
      const principal = request.principal!;
      const row = await repo.create(principal.userId, parsed.data, {
        accessToken: principal.accessToken,
      });
      if (row.userId !== principal.userId)
        throw new Error("Recurring meal repository owner mismatch");
      return recurringMealResponseSchema.parse({ recurringMeal: toWire(row) });
    });
  });
  app.patch("/:id", auth, async (request, reply) => {
    if (unavailable(request, reply)) return;
    const { id } = request.params as { id: string };
    if (!UUID.test(id)) return notFound(reply, request);
    const parsed = recurringMealPatchSchema.safeParse(request.body);
    if (!parsed.success)
      return sendApiError(
        reply,
        request,
        422,
        "VALIDATION_ERROR",
        "Provide a valid recurring meal change.",
      );
    return handle(request, reply, async () => {
      const principal = request.principal!;
      const row = await repo.update(principal.userId, id, parsed.data, {
        accessToken: principal.accessToken,
      });
      if (!row || row.userId !== principal.userId)
        return notFound(reply, request);
      return recurringMealResponseSchema.parse({ recurringMeal: toWire(row) });
    });
  });
  app.delete("/:id", auth, async (request, reply) => {
    if (unavailable(request, reply)) return;
    const { id } = request.params as { id: string };
    if (!UUID.test(id)) return notFound(reply, request);
    return handle(request, reply, async () => {
      const principal = request.principal!;
      if (
        !(await repo.stop(principal.userId, id, {
          accessToken: principal.accessToken,
        }))
      )
        return notFound(reply, request);
      return reply.status(204).send();
    });
  });
  app.post("/:id/skip", auth, async (request, reply) => {
    if (unavailable(request, reply)) return;
    const { id } = request.params as { id: string };
    if (!UUID.test(id)) return notFound(reply, request);
    const parsed = recurringMealSkipSchema.safeParse(request.body);
    if (!parsed.success)
      return sendApiError(
        reply,
        request,
        422,
        "VALIDATION_ERROR",
        "Choose a real local date in YYYY-MM-DD form.",
      );
    return handle(request, reply, async () => {
      const principal = request.principal!;
      if (
        !(await repo.skip(principal.userId, id, parsed.data.localDate, {
          accessToken: principal.accessToken,
        }))
      )
        return notFound(reply, request);
      return reply.status(204).send();
    });
  });
};
