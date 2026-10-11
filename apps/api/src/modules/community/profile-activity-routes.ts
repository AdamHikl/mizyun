import type { FastifyPluginAsync } from "fastify";
import type { CommunityRepository, UserId } from "@mizyun/core";
import {
  communityFeedResponseSchema,
  communityListQuerySchema,
  sharedWorkoutDetailsSchema,
} from "@mizyun/contracts";
import { sendApiError } from "../../errors.js";
import { registerCommunityErrorHandler } from "./error-handler.js";

import {
  decodeActivityCursor,
  encodeActivityCursor,
} from "./activity-cursor.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const emptyCounts = {
  clap: 0,
  fire: 0,
  high_five: 0,
  fist_bump: 0,
  thumbs_up: 0,
};

export const communityProfileActivityRoutes: FastifyPluginAsync<{
  communityRepository: CommunityRepository;
}> = async (app, { communityRepository: repository }) => {
  registerCommunityErrorHandler(app);
  app.get(
    "/profiles/:targetUserId/activities",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = request.principal!;
      const targetUserId = (request.params as { targetUserId: string })
        .targetUserId as UserId;
      const unavailable = () =>
        sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "Profile activities unavailable.",
        );
      if (!UUID.test(targetUserId)) return unavailable();
      const options = { accessToken: principal.accessToken };
      const caller = await repository.getProfile(principal.userId, options);
      if (!caller || caller.status !== "active") return unavailable();
      if (
        await repository.isBlockedBilateral(
          principal.userId,
          targetUserId,
          options,
        )
      )
        return unavailable();
      const author = await repository.getProfile(targetUserId, options);
      if (!author || author.status !== "active") return unavailable();
      if (targetUserId !== principal.userId) {
        const edge = await repository.getRelationship(
          principal.userId,
          targetUserId,
          options,
        );
        if (edge?.status !== "approved") return unavailable();
      }
      const parsed = communityListQuerySchema.safeParse(request.query);
      if (!parsed.success)
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          "Invalid profile activity query.",
        );
      const { limit, cursor } = parsed.data;
      const boundary = cursor
        ? decodeActivityCursor(cursor, principal.userId, targetUserId)
        : null;
      if (cursor && !boundary)
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          "Invalid profile activity cursor.",
        );
      const page = await repository.getFeed(principal.userId, {
        ...options,
        authorUserId: targetUserId,
        limit,
        ...(boundary ? { beforeCursor: boundary } : {}),
      });
      // Recipient projection is shared by self and peers, with no source/version fields.
      const items = page.items
        .filter((item) => item.userId === targetUserId && !item.revokedAt)
        .map((item) => ({
          id: item.id,
          authorUserId: item.userId,
          authorHandle: author.handle,
          authorDisplayName: author.displayName,
          authorAvatarSymbol: author.avatarSymbol,
          category: item.category,
          sharedDay: item.sharedDay,
          durationSeconds: item.durationSeconds,
          workoutDetails: sharedWorkoutDetailsSchema
            .nullable()
            .parse(item.workoutDetails ?? null),
          publishedAt: item.publishedAt.toISOString(),
          reactionCounts: emptyCounts,
          viewerReaction: null,
        }));
      const reactions = await repository.getReactionsForActivities(
        items.map((item) => item.id),
        principal.userId,
        options,
      );
      return communityFeedResponseSchema.parse({
        items: items.map((item) => ({
          ...item,
          reactionCounts: reactions.get(item.id)?.reactionCounts ?? emptyCounts,
          viewerReaction: reactions.get(item.id)?.viewerReaction ?? null,
        })),
        nextCursor: encodeActivityCursor(
          page.nextCursor,
          principal.userId,
          targetUserId,
        ),
      });
    },
  );
};
