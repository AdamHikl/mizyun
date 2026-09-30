import type { FastifyPluginAsync } from "fastify";
import type { CommunityNotificationRepository } from "@mizyun/core";
import {
  communityInboxResponseSchema,
  communityNotificationPreferencesSchema,
  communityNotificationTokenSchema,
  communityNotificationDestinationSchema,
} from "@mizyun/contracts";
import { registerCommunityErrorHandler } from "./error-handler.js";
import { sendApiError } from "../../errors.js";
export const communityNotificationRoutes: FastifyPluginAsync<{
  readonly notifications: CommunityNotificationRepository;
}> = async (app, { notifications }) => {
  registerCommunityErrorHandler(app);
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const execute = (
    request: Parameters<typeof app.authenticate>[0],
    operation: Parameters<CommunityNotificationRepository["execute"]>[0],
    args: Record<string, unknown>,
  ) => {
    if (!request.principal)
      throw new Error("principal missing after authentication");
    return notifications.execute(
      operation,
      args,
      request.principal.accessToken,
    );
  };
  app.get(
    "/notifications/inbox",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const query = request.query as { limit?: string; cursor?: string };
      const limit = query.limit === undefined ? 20 : Number(query.limit);
      if (
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 50 ||
        (query.cursor &&
          (!/^\d{4}-\d{2}-\d{2}T[^|]{1,40}\|[a-f0-9-]{36}$/i.test(
            query.cursor,
          ) ||
            !uuid.test(query.cursor.split("|")[1] ?? "") ||
            !Number.isFinite(Date.parse(query.cursor.split("|")[0] ?? ""))))
      )
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          "Invalid inbox page.",
        );
      return communityInboxResponseSchema.parse(
        await execute(request, "inbox", {
          limit,
          cursor: query.cursor ?? null,
        }),
      );
    },
  );
  app.get(
    "/notifications/preferences",
    { preHandler: app.authenticate },
    async (request) =>
      communityNotificationPreferencesSchema.parse(
        await execute(request, "preferences", {}),
      ),
  );
  app.put(
    "/notifications/preferences",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const parsed = communityNotificationPreferencesSchema.safeParse(
        request.body,
      );
      if (!parsed.success)
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          "Invalid notification preferences.",
        );
      return communityNotificationPreferencesSchema.parse(
        await execute(request, "savePreferences", parsed.data),
      );
    },
  );
  for (const action of ["read", "resolve"] as const) {
    const handler = async (
      request: Parameters<typeof app.authenticate>[0],
      reply: Parameters<typeof app.authenticate>[1],
    ) => {
      const { id } = request.params as { id: string };
      if (!uuid.test(id))
        return sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "Notification unavailable.",
        );
      const result = await execute(request, action, { id });
      if (!result)
        return sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "Notification unavailable.",
        );
      return action === "resolve"
        ? communityNotificationDestinationSchema.parse(result)
        : result;
    };
    if (action === "read")
      app.post(
        "/notifications/inbox/:id/read",
        { preHandler: app.authenticate },
        handler,
      );
    else
      app.get(
        "/notifications/inbox/:id",
        { preHandler: app.authenticate },
        handler,
      );
  }
  app.put(
    "/notifications/token",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const parsed = communityNotificationTokenSchema.safeParse(request.body);
      if (!parsed.success)
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          "Invalid device registration.",
        );
      await execute(request, "registerToken", parsed.data);
      return reply.code(204).send();
    },
  );
  app.delete(
    "/notifications/token/:installationId",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { installationId } = request.params as { installationId: string };
      if (!uuid.test(installationId))
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          "Invalid device registration.",
        );
      await execute(request, "removeToken", { installationId });
      return reply.code(204).send();
    },
  );
};
