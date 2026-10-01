import type { FastifyPluginAsync } from "fastify";
import type { CommunityGroupsRepository } from "@mizyun/core";
import {
  communityGroupRequestSchema,
  communityGroupResultSchema,
} from "@mizyun/contracts";
import { registerCommunityErrorHandler } from "./error-handler.js";
import { sendApiError } from "../../errors.js";
export const communityGroupRoutes: FastifyPluginAsync<{
  groups: CommunityGroupsRepository;
}> = async (app, { groups }) => {
  registerCommunityErrorHandler(app);
  app.post(
    "/groups/operations",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const parsed = communityGroupRequestSchema.safeParse(request.body);
      if (!parsed.success)
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          "Invalid group action.",
        );
      if (!request.principal)
        throw new Error("principal missing after authentication");
      const { operation, ...args } = parsed.data;
      return communityGroupResultSchema.parse(
        await groups.execute(operation, args, request.principal.accessToken),
      );
    },
  );
};
