import type { FastifyPluginAsync } from "fastify";
import {
  communityChallengeCommandSchema,
  communityChallengeResponseSchema,
} from "@mizyun/contracts";
import type { CommunityChallengesRepository } from "@mizyun/core";
import { sendApiError } from "../../errors.js";
import { registerCommunityErrorHandler } from "./error-handler.js";
export const communityChallengeRoutes: FastifyPluginAsync<{
  repository: CommunityChallengesRepository | null;
}> = async (app, { repository }) => {
  registerCommunityErrorHandler(app);
  app.post(
    "/challenges",
    { preHandler: app.authenticate },
    async (request, reply) => {
      if (!request.principal) throw new Error("principal missing");
      const input = communityChallengeCommandSchema.safeParse(request.body);
      if (!input.success)
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          "Invalid challenge action.",
        );
      if (!repository)
        return sendApiError(
          reply,
          request,
          503,
          "SERVICE_UNAVAILABLE",
          "Challenges unavailable.",
        );
      const { operation, ...args } = input.data;
      return communityChallengeResponseSchema.parse(
        await repository.execute(
          operation,
          args,
          request.principal.accessToken,
        ),
      );
    },
  );
};
