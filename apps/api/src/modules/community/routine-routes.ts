import type { FastifyPluginAsync } from "fastify";
import type { CommunityRoutineRepository } from "@mizyun/core";
import {
  communityRoutinePreviewSchema,
  communityRoutinePublishSchema,
  communityRoutineListSchema,
  communityRoutineShareSchema,
  communityRoutineImportSchema,
  communityRoutineImportResultSchema,
  communityRoutineIdSchema,
  communityRoutinePreviewInputSchema,
  communityRoutineQuerySchema,
  communityRoutineUnshareResultSchema,
} from "@mizyun/contracts";
import { registerCommunityErrorHandler } from "./error-handler.js";
import { sendApiError } from "../../errors.js";
export const communityRoutineRoutes: FastifyPluginAsync<{
  readonly routines: CommunityRoutineRepository;
}> = async (app, { routines }) => {
  registerCommunityErrorHandler(app);
  const params = communityRoutineIdSchema;
  const definitions = [
    {
      method: "POST",
      path: "/routines/preview",
      operation: "preview",
      body: communityRoutinePreviewInputSchema,
      response: communityRoutinePreviewSchema,
    },
    {
      method: "POST",
      path: "/routines",
      operation: "publish",
      body: communityRoutinePublishSchema,
      response: communityRoutineShareSchema,
    },
    {
      method: "GET",
      path: "/routines",
      operation: "list",
      query: communityRoutineQuerySchema,
      response: communityRoutineListSchema,
    },
    {
      method: "GET",
      path: "/routines/:id",
      operation: "get",
      response: communityRoutineShareSchema,
    },
    {
      method: "POST",
      path: "/routines/:id/import",
      operation: "import",
      body: communityRoutineImportSchema,
      response: communityRoutineImportResultSchema,
      communityRoutineIdSchema,
      communityRoutinePreviewInputSchema,
      communityRoutineQuerySchema,
      communityRoutineUnshareResultSchema,
    },
    {
      method: "DELETE",
      path: "/routines/:id",
      operation: "unshare",
      response: communityRoutineUnshareResultSchema,
    },
  ] as const;
  for (const d of definitions)
    app.route({
      method: d.method,
      url: d.path,
      preHandler: app.authenticate,
      handler: async (request, reply) => {
        if (!request.principal)
          throw new Error("principal missing after authentication");
        const input = (
          "body" in d ? d.body : "query" in d ? d.query : params
        ).safeParse(
          "body" in d
            ? request.body
            : "query" in d
              ? request.query
              : request.params,
        );
        const routeParams = d.path.includes(":id")
          ? params.safeParse(request.params)
          : null;
        if (!input.success || (routeParams && !routeParams.success))
          return sendApiError(
            reply,
            request,
            422,
            "VALIDATION_ERROR",
            "Invalid routine request.",
          );
        return d.response.parse(
          await routines.execute(
            d.operation,
            {
              ...input.data,
              ...(routeParams?.success ? routeParams.data : {}),
            },
            request.principal.accessToken,
          ),
        );
      },
    });
};
