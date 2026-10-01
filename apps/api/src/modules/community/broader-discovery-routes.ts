import type { FastifyPluginAsync } from "fastify";
import {
  communityBroaderDiscoveryCommandSchema,
  communityBroaderDiscoveryResponseSchema,
} from "@mizyun/contracts";
import type { CommunityBroaderDiscoveryRepository } from "@mizyun/core";
import { sendApiError } from "../../errors.js";
import { registerCommunityErrorHandler } from "./error-handler.js";
export const communityBroaderDiscoveryRoutes: FastifyPluginAsync<{
  repository: CommunityBroaderDiscoveryRepository | null;
}> = async (app, { repository }) => {
  registerCommunityErrorHandler(app);
  app.post(
    "/broader-discovery",
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
      const parsed = communityBroaderDiscoveryCommandSchema.safeParse(
        request.body,
      );
      if (!parsed.success)
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          "Enter at least three handle characters.",
        );
      if (!repository)
        return sendApiError(
          reply,
          request,
          503,
          "SERVICE_UNAVAILABLE",
          "Discovery unavailable.",
        );
      const { operation, ...args } = parsed.data;
      return communityBroaderDiscoveryResponseSchema.parse(
        await repository.execute(
          operation,
          args,
          request.principal.accessToken,
        ),
      );
    },
  );
};
