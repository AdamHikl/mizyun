import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type { CommunityRepository } from "@mizyun/core";
import {
  communityFeedResponseSchema,
  sharedWorkoutDetailsSchema,
  communityListQuerySchema,
  type CommunityFeedResponse,
  type SharedActivityFeedItemDto,
} from "@mizyun/contracts";
import { sendApiError } from "../../errors.js";
import { registerCommunityErrorHandler } from "./error-handler.js";

import {
  decodeActivityCursor,
  encodeActivityCursor,
} from "./activity-cursor.js";

const defaultReactionCounts = {
  clap: 0,
  fire: 0,
  high_five: 0,
  fist_bump: 0,
  thumbs_up: 0,
};

export interface CommunityFeedRoutesOptions {
  readonly communityRepository: CommunityRepository;
}

export const communityFeedRoutes: FastifyPluginAsync<
  CommunityFeedRoutesOptions
> = async (app, options) => {
  registerCommunityErrorHandler(app);

  // GET /v1/community/feed — chronological following feed
  app.get(
    "/feed",
    { preHandler: app.authenticate },
    async (
      request: FastifyRequest,
      reply: FastifyReply,
    ): Promise<CommunityFeedResponse | void> => {
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");

      const viewerProfile = await options.communityRepository.getProfile(
        principal.userId,
        { accessToken: principal.accessToken },
      );
      if (!viewerProfile || viewerProfile.status !== "active") {
        return sendApiError(
          reply,
          request,
          403,
          "COMMUNITY_NOT_ENROLLED",
          "You must be enrolled in Community to view the feed.",
        );
      }

      const queryParse = communityListQuerySchema.safeParse(request.query);
      if (!queryParse.success) {
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          "Invalid feed query parameters.",
        );
      }

      const { limit, cursor } = queryParse.data;

      const boundary = cursor
        ? decodeActivityCursor(cursor, principal.userId)
        : null;
      if (cursor && !boundary) {
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          "Invalid community feed cursor.",
        );
      }

      const feedResult = await options.communityRepository.getFeed(
        principal.userId,
        {
          accessToken: principal.accessToken,
          limit,
          ...(boundary ? { beforeCursor: boundary } : {}),
        },
      );

      const authorUserIds = [...new Set(feedResult.items.map((i) => i.userId))];
      const profileMap = new Map<
        string,
        Awaited<ReturnType<CommunityRepository["getProfile"]>>
      >();
      for (let offset = 0; offset < authorUserIds.length; offset += 5) {
        const profiles = await Promise.all(
          authorUserIds.slice(offset, offset + 5).map(async (authorId) => {
            const profile = await options.communityRepository.getProfile(
              authorId,
              {
                accessToken: principal.accessToken,
              },
            );
            return [authorId, profile] as const;
          }),
        );
        for (const [authorId, profile] of profiles)
          profileMap.set(authorId, profile);
      }

      const validItems: SharedActivityFeedItemDto[] = [];

      // Keep every current-authority check, but cap independent I/O at five
      // cards. Promise.all preserves chronological order within each batch.
      for (let offset = 0; offset < feedResult.items.length; offset += 5) {
        const batch = await Promise.all(
          feedResult.items
            .slice(offset, offset + 5)
            .map(async (item): Promise<SharedActivityFeedItemDto | null> => {
              if (item.revokedAt !== null) return null;
              const author = profileMap.get(item.userId);
              if (!author || author.status !== "active") return null;

              if (item.userId !== principal.userId) {
                const isBlocked =
                  await options.communityRepository.isBlockedBilateral(
                    principal.userId,
                    item.userId,
                    { accessToken: principal.accessToken },
                  );
                if (isBlocked) return null;

                const rel = await options.communityRepository.getRelationship(
                  principal.userId,
                  item.userId,
                  { accessToken: principal.accessToken },
                );
                if (!rel || rel.status !== "approved") return null;
              }

              return {
                id: item.id,
                authorUserId: item.userId,
                authorHandle: author.handle,
                authorDisplayName: author.displayName,
                authorAvatarSymbol: author.avatarSymbol,
                category: item.category,
                sharedDay: item.sharedDay,
                durationSeconds: item.durationSeconds,
                activityKind: item.activityKind ?? "workout",
                mealDetails: item.mealDetails ?? null,
                workoutDetails: sharedWorkoutDetailsSchema
                  .nullable()
                  .parse(item.workoutDetails ?? null),
                publishedAt: item.publishedAt.toISOString(),
                reactionCounts: defaultReactionCounts,
                viewerReaction: null,
              };
            }),
        );
        for (const item of batch) if (item) validItems.push(item);
      }

      const activityIds = validItems.map((i) => i.id);
      const reactionsMap =
        await options.communityRepository.getReactionsForActivities(
          activityIds,
          principal.userId,
          { accessToken: principal.accessToken },
        );

      const itemsWithReactions = validItems.map((item) => {
        const reactions = reactionsMap.get(item.id);
        return {
          ...item,
          reactionCounts: reactions?.reactionCounts ?? defaultReactionCounts,
          viewerReaction: reactions?.viewerReaction ?? null,
        };
      });

      return communityFeedResponseSchema.parse({
        items: itemsWithReactions,
        nextCursor: encodeActivityCursor(
          feedResult.nextCursor,
          principal.userId,
        ),
      });
    },
  );
};
