import type { FastifyPluginAsync } from "fastify";
import type { CommunityMediaService } from "@mizyun/core";
import {
  communityMediaUploadSchema,
  communityMediaItemSchema,
  communityMediaListQuerySchema,
  communityMediaListSchema,
  communityMediaIdSchema,
  communityMediaContentQuerySchema,
  communityMediaContentSchema,
  communityMediaReviewSchema,
  communityMediaDeletedSchema,
} from "@mizyun/contracts";
import { registerCommunityErrorHandler } from "./error-handler.js";
import { sendApiError } from "../../errors.js";
export const communityMediaRoutes: FastifyPluginAsync<{
  readonly media: CommunityMediaService;
}> = async (app, { media }) => {
  registerCommunityErrorHandler(app);
  app.post(
    "/media",
    { preHandler: app.authenticate, bodyLimit: 4_300_000 },
    async (request, reply) => {
      if (!request.principal)
        throw new Error("principal missing after authentication");
      const parsed = communityMediaUploadSchema.safeParse(request.body);
      if (!parsed.success)
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          "Choose a supported bounded image and confirm your rights.",
        );
      const { base64, mimeType, operationId, altText } = parsed.data;
      return communityMediaItemSchema.parse(
        await media.upload({
          userId: request.principal.userId,
          accessToken: request.principal.accessToken,
          bytes: Buffer.from(base64, "base64"),
          mimeType,
          operationId,
          altText,
        }),
      );
    },
  );
  app.get(
    "/media",
    { preHandler: app.authenticate },
    async (request, reply) => {
      if (!request.principal)
        throw new Error("principal missing after authentication");
      const parsed = communityMediaListQuerySchema.safeParse(request.query);
      if (!parsed.success)
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          "Invalid image page.",
        );
      reply.header("Cache-Control", "no-store");
      return communityMediaListSchema.parse(
        await media.execute("list", parsed.data, request.principal.accessToken),
      );
    },
  );
  app.get(
    "/media/moderation",
    { preHandler: app.authenticate },
    async (request, reply) => {
      if (!request.principal)
        throw new Error("principal missing after authentication");
      const parsed = communityMediaListQuerySchema.safeParse(request.query);
      if (!parsed.success)
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          "Invalid review page.",
        );
      reply.header("Cache-Control", "no-store");
      return communityMediaListSchema.parse(
        await media.execute(
          "queue",
          parsed.data,
          request.principal.accessToken,
        ),
      );
    },
  );
  app.post(
    "/media/:id/content",
    { preHandler: app.authenticate },
    async (request, reply) => {
      if (!request.principal)
        throw new Error("principal missing after authentication");
      const params = communityMediaIdSchema.safeParse(request.params);
      const query = communityMediaContentQuerySchema.safeParse(
        request.body ?? {},
      );
      if (!params.success || !query.success)
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          "Invalid image request.",
        );
      reply
        .header("Cache-Control", "no-store, max-age=0")
        .header("Pragma", "no-cache");
      return communityMediaContentSchema.parse({
        mimeType: "image/jpeg",
        base64: Buffer.from(
          await media.content(
            params.data.id,
            query.data.variant,
            request.principal.accessToken,
          ),
        ).toString("base64"),
      });
    },
  );
  app.post(
    "/media/reports/:id/content",
    { preHandler: app.authenticate },
    async (request, reply) => {
      if (!request.principal)
        throw new Error("principal missing after authentication");
      const params = communityMediaIdSchema.safeParse(request.params);
      const query = communityMediaContentQuerySchema.safeParse(
        request.body ?? {},
      );
      if (!params.success || !query.success)
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          "Invalid evidence request.",
        );
      reply
        .header("Cache-Control", "no-store, max-age=0")
        .header("Pragma", "no-cache");
      return communityMediaContentSchema.parse({
        mimeType: "image/jpeg",
        base64: Buffer.from(
          await media.evidence(
            params.data.id,
            query.data.variant,
            request.principal.accessToken,
          ),
        ).toString("base64"),
      });
    },
  );
  app.post(
    "/media/:id/review",
    { preHandler: app.authenticate },
    async (request, reply) => {
      if (!request.principal)
        throw new Error("principal missing after authentication");
      const params = communityMediaIdSchema.safeParse(request.params);
      const input = communityMediaReviewSchema.safeParse(request.body);
      if (!params.success || !input.success)
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          "Invalid review decision.",
        );
      return communityMediaItemSchema.parse(
        await media.execute(
          "review",
          { ...params.data, ...input.data },
          request.principal.accessToken,
        ),
      );
    },
  );
  app.delete(
    "/media/:id",
    { preHandler: app.authenticate },
    async (request, reply) => {
      if (!request.principal)
        throw new Error("principal missing after authentication");
      const params = communityMediaIdSchema.safeParse(request.params);
      if (!params.success)
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          "Invalid image request.",
        );
      return communityMediaDeletedSchema.parse(
        await media.execute(
          "delete",
          params.data,
          request.principal.accessToken,
        ),
      );
    },
  );
};
