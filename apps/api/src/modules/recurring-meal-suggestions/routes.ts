import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import {
  RecurringMealSuggestionRepositoryError,
  type RecurringMealSuggestionRepository,
} from "@mizyun/core";
import {
  recurringMealSuggestionListResponseSchema,
  recurringMealSuggestionAcceptSchema,
  recurringMealSuggestionAcceptResponseSchema,
  recurringMealSuggestionDecisionSchema,
  recurringMealSuggestionPreferencesSchema,
} from "@mizyun/contracts";
import { sendApiError } from "../../errors.js";
interface Options {
  readonly recurringMealSuggestionRepository: RecurringMealSuggestionRepository;
  readonly available?: boolean;
}
export const recurringMealSuggestionsRoutes: FastifyPluginAsync<
  Options
> = async (app, options) => {
  const repo = options.recurringMealSuggestionRepository;
  const auth = { preHandler: app.authenticate };
  const handle = async <T>(
    request: FastifyRequest,
    reply: FastifyReply,
    action: () => Promise<T>,
  ) => {
    if (options.available === false)
      return sendApiError(
        reply,
        request,
        503,
        "SERVICE_UNAVAILABLE",
        "Meal suggestions are temporarily unavailable.",
      );
    try {
      return await action();
    } catch (error) {
      if (!(error instanceof RecurringMealSuggestionRepositoryError))
        throw error;
      if (error.kind === "not_found")
        return sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "Meal suggestion was not found.",
        );
      if (error.kind === "conflict")
        return sendApiError(
          reply,
          request,
          409,
          "CONFLICT",
          "This suggestion changed. Refresh it or manage your existing schedule.",
        );
      if (error.kind === "unavailable")
        return sendApiError(
          reply,
          request,
          503,
          "SERVICE_UNAVAILABLE",
          "Meal suggestions are temporarily unavailable.",
        );
      return sendApiError(
        reply,
        request,
        422,
        "VALIDATION_ERROR",
        "Choose a current suggestion and a valid schedule.",
      );
    }
  };
  const invalid = (request: FastifyRequest, reply: FastifyReply) =>
    sendApiError(
      reply,
      request,
      422,
      "VALIDATION_ERROR",
      "Provide a valid meal suggestion request.",
    );
  app.get("/", auth, async (request, reply) =>
    handle(request, reply, async () => {
      const query = request.query as { timeZone?: unknown };
      if (typeof query.timeZone !== "string") return invalid(request, reply);
      const p = request.principal!;
      return recurringMealSuggestionListResponseSchema.parse(
        await repo.getForUser(
          p.userId,
          { timeZone: query.timeZone },
          { accessToken: p.accessToken },
        ),
      );
    }),
  );
  app.get("/preferences", auth, async (request, reply) =>
    handle(request, reply, async () => {
      const p = request.principal!;
      return recurringMealSuggestionPreferencesSchema.parse(
        await repo.getPreferences(p.userId, { accessToken: p.accessToken }),
      );
    }),
  );
  app.patch("/preferences", auth, async (request, reply) => {
    const parsed = recurringMealSuggestionPreferencesSchema.safeParse(
      request.body,
    );
    if (!parsed.success) return invalid(request, reply);
    return handle(request, reply, async () => {
      const p = request.principal!;
      return recurringMealSuggestionPreferencesSchema.parse(
        await repo.setPreferences(p.userId, parsed.data, {
          accessToken: p.accessToken,
        }),
      );
    });
  });
  app.post("/reset", auth, async (request, reply) =>
    handle(request, reply, async () => {
      const p = request.principal!;
      await repo.resetDecisions(p.userId, { accessToken: p.accessToken });
      return { ok: true };
    }),
  );
  app.post("/:candidateId/decision", auth, async (request, reply) => {
    const parsed = recurringMealSuggestionDecisionSchema.safeParse(
      request.body,
    );
    if (
      !parsed.success ||
      parsed.data.proposal.candidateId !==
        (request.params as { candidateId: string }).candidateId
    )
      return invalid(request, reply);
    return handle(request, reply, async () => {
      const p = request.principal!;
      await repo.decide(p.userId, parsed.data, { accessToken: p.accessToken });
      return { ok: true };
    });
  });
  app.post("/:candidateId/accept", auth, async (request, reply) => {
    const parsed = recurringMealSuggestionAcceptSchema.safeParse(request.body);
    if (
      !parsed.success ||
      parsed.data.proposal.candidateId !==
        (request.params as { candidateId: string }).candidateId
    )
      return invalid(request, reply);
    return handle(request, reply, async () => {
      const p = request.principal!;
      const result = await repo.accept(p.userId, parsed.data, {
        accessToken: p.accessToken,
      });
      if (result.recurringMeal.userId !== p.userId)
        throw new RecurringMealSuggestionRepositoryError("not_found");
      return recurringMealSuggestionAcceptResponseSchema.parse({
        ...result,
        recurringMeal: {
          ...result.recurringMeal,
          createdAt: result.recurringMeal.createdAt.toISOString(),
          updatedAt: result.recurringMeal.updatedAt.toISOString(),
        },
      });
    });
  });
};
