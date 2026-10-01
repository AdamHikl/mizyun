import type { FastifyPluginAsync } from "fastify";
import {
  communityMessagingCommandSchema,
  communityMessagingResponseSchema,
} from "@mizyun/contracts";
import {
  isPermittedMessageText,
  type CommunityMessagingRepository,
} from "@mizyun/core";
import { sendApiError } from "../../errors.js";
import { registerCommunityErrorHandler } from "./error-handler.js";
export const communityMessagingRoutes: FastifyPluginAsync<{
  repository: CommunityMessagingRepository | null;
}> = async (app, { repository }) => {
  registerCommunityErrorHandler(app);
  app.post(
    "/messaging",
    { preHandler: app.authenticate },
    async (request, reply) => {
      if (!request.principal)
        return sendApiError(
          reply,
          request,
          401,
          "AUTHENTICATION_REQUIRED",
          "Sign in to continue.",
        );
      const input = communityMessagingCommandSchema.safeParse(request.body);
      if (
        !input.success ||
        ("text" in input.data && !isPermittedMessageText(input.data.text))
      )
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          "Use short plain text without links.",
        );
      if (!repository)
        return sendApiError(
          reply,
          request,
          503,
          "SERVICE_UNAVAILABLE",
          "Messages are unavailable.",
        );
      const { operation, ...args } = input.data;
      return communityMessagingResponseSchema.parse(
        await repository.execute(
          operation,
          args,
          request.principal.accessToken,
        ),
      );
    },
  );
};
