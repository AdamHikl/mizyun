import type { FastifyPluginAsync } from "fastify";
import type { CommunityCommentsRepository } from "@mizyun/core";
import {
  communityCommentPageSchema,
  communityCommentMutationSchema,
  communityCommentDeleteSchema,
  communityCommentSettingsSchema,
  communityCommentPreferencesSchema,
  communityCommentCandidatesSchema,
  communityCommentMentionInboxSchema,
  communityCommentAckSchema,
  communityCommentReportSchema,
  communityCommentReportAckSchema,
  communityCommentIdSchema,
  communityCommentQuerySchema,
} from "@mizyun/contracts";
import { registerCommunityErrorHandler } from "./error-handler.js";
import { sendApiError } from "../../errors.js";

export const communityCommentRoutes: FastifyPluginAsync<{
  readonly comments: CommunityCommentsRepository;
}> = async (app, { comments }) => {
  registerCommunityErrorHandler(app);
  const execute = (
    request: Parameters<typeof app.authenticate>[0],
    operation: Parameters<CommunityCommentsRepository["execute"]>[0],
    args: Record<string, unknown>,
  ) => {
    if (!request.principal)
      throw new Error("principal missing after authentication");
    return comments.execute(operation, args, request.principal.accessToken);
  };
  app.get(
    "/comments/mentions",
    { preHandler: app.authenticate },
    async (request) =>
      communityCommentMentionInboxSchema.parse(
        await execute(request, "mentionsInbox", {}),
      ),
  );
  app.get(
    "/comments/preferences",
    { preHandler: app.authenticate },
    async (request) =>
      communityCommentPreferencesSchema.parse(
        await execute(request, "preferences", {}),
      ),
  );
  app.put(
    "/comments/preferences",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const body = communityCommentPreferencesSchema.safeParse(request.body);
      if (!body.success)
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          "Invalid comment preferences.",
        );
      return communityCommentPreferencesSchema.parse(
        await execute(request, "preferences", body.data),
      );
    },
  );
  app.get(
    "/activities/:activityId/comments",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const id = communityCommentIdSchema.safeParse(
        (request.params as { activityId: string }).activityId,
      );
      const query = communityCommentQuerySchema.safeParse(request.query);
      if (!id.success || !query.success)
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          "Invalid comment page.",
        );
      return communityCommentPageSchema.parse(
        await execute(request, "list", { activityId: id.data, ...query.data }),
      );
    },
  );
  app.get(
    "/activities/:activityId/comments/candidates",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const id = communityCommentIdSchema.safeParse(
        (request.params as { activityId: string }).activityId,
      );
      if (!id.success)
        return sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "Community activity unavailable.",
        );
      return communityCommentCandidatesSchema.parse(
        await execute(request, "candidates", { activityId: id.data }),
      );
    },
  );
  app.put(
    "/activities/:activityId/comments/settings",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const id = communityCommentIdSchema.safeParse(
        (request.params as { activityId: string }).activityId,
      );
      const body = communityCommentSettingsSchema.safeParse(request.body);
      if (!id.success || !body.success)
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          "Invalid comment settings.",
        );
      return communityCommentSettingsSchema.parse(
        await execute(request, "settings", {
          activityId: id.data,
          ...body.data,
        }),
      );
    },
  );
  app.post(
    "/activities/:activityId/comments",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const id = communityCommentIdSchema.safeParse(
        (request.params as { activityId: string }).activityId,
      );
      const body = communityCommentMutationSchema.safeParse(request.body);
      if (!id.success || !body.success)
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          "Use a short plain-text comment and deliberate mentions.",
        );
      return communityCommentAckSchema.parse(
        await execute(request, "upsert", { activityId: id.data, ...body.data }),
      );
    },
  );
  app.delete(
    "/comments/:id",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const id = communityCommentIdSchema.safeParse(
        (request.params as { id: string }).id,
      );
      const body = communityCommentDeleteSchema.safeParse(request.body);
      if (!id.success || !body.success)
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          "Invalid comment removal.",
        );
      return communityCommentAckSchema.parse(
        await execute(request, "delete", { id: id.data, ...body.data }),
      );
    },
  );
  app.post(
    "/comments/:id/report",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const id = communityCommentIdSchema.safeParse(
        (request.params as { id: string }).id,
      );
      const body = communityCommentReportSchema.safeParse(request.body);
      if (!id.success || !body.success)
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          "Invalid comment report.",
        );
      return communityCommentReportAckSchema.parse(
        await execute(request, "report", { id: id.data, ...body.data }),
      );
    },
  );
};
