import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type { CommunityRepository } from "@mizyun/core";
import {
  activityReactionsResponseSchema,
  setCommunityReactionSchema,
  type ActivityReactionsResponse,
} from "@mizyun/contracts";
import { sendApiError } from "../../errors.js";
import { registerCommunityErrorHandler } from "./error-handler.js";

const GENERIC_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Rate limiter for reaction mutations: max 30 mutations per minute per actor */
export class CommunityReactionRateLimiter {
  readonly #attempts = new Map<string, number[]>();
  constructor(private readonly now: () => number = Date.now) {}

  readonly check = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> => {
    const principal = request.principal;
    if (!principal) return;
    const now = this.now();
    const oneMinuteAgo = now - 60_000;

    for (const [key, values] of this.#attempts) {
      const recent = values.filter((time) => time > oneMinuteAgo);
      if (recent.length) this.#attempts.set(key, recent);
      else this.#attempts.delete(key);
    }

    const keys = [`actor:${principal.userId}`, `source:${request.ip}`];
    const isRateLimited = keys.some((key) => {
      const attempts = this.#attempts.get(key) ?? [];
      const isActor = key.startsWith("actor:");
      // Max 30 mutations per minute for actor, max 60 per minute for IP
      return (
        attempts.filter((time) => time > oneMinuteAgo).length >=
        (isActor ? 30 : 60)
      );
    });

    if (isRateLimited) {
      sendApiError(
        reply,
        request,
        429,
        "RATE_LIMITED",
        "Please wait before making another reaction.",
      );
      return;
    }

    for (const key of keys) {
      const list = this.#attempts.get(key) ?? [];
      list.push(now);
      this.#attempts.set(key, list);
    }
  };
}

export interface CommunityReactionRoutesOptions {
  readonly communityRepository: CommunityRepository;
  readonly reactionRateLimiter?: CommunityReactionRateLimiter;
}

export const communityReactionRoutes: FastifyPluginAsync<
  CommunityReactionRoutesOptions
> = async (app, options) => {
  registerCommunityErrorHandler(app);
  const rateLimiter =
    options.reactionRateLimiter ?? new CommunityReactionRateLimiter();

  // Helper for checking enrollment and activity access
  const resolveActivityAndAccess = async (
    request: FastifyRequest,
    reply: FastifyReply,
    activityId: string | undefined,
  ) => {
    const principal = request.principal;
    if (!principal) throw new Error("principal missing after authentication");

    const viewerProfile = await options.communityRepository.getProfile(
      principal.userId,
      { accessToken: principal.accessToken },
    );
    if (!viewerProfile || viewerProfile.status !== "active") {
      sendApiError(
        reply,
        request,
        403,
        "COMMUNITY_NOT_ENROLLED",
        "You must be enrolled in Community to interact with reactions.",
      );
      return null;
    }

    if (!activityId || !GENERIC_UUID.test(activityId)) {
      sendApiError(
        reply,
        request,
        404,
        "NOT_FOUND",
        "Activity not found or unavailable.",
      );
      return null;
    }

    const activity = await options.communityRepository.getActivityById(
      activityId,
      { accessToken: principal.accessToken },
    );
    if (!activity || activity.revokedAt !== null) {
      sendApiError(
        reply,
        request,
        404,
        "NOT_FOUND",
        "Activity not found or unavailable.",
      );
      return null;
    }

    const authorProfile = await options.communityRepository.getProfile(
      activity.userId,
      { accessToken: principal.accessToken },
    );
    if (!authorProfile || authorProfile.status !== "active") {
      sendApiError(
        reply,
        request,
        404,
        "NOT_FOUND",
        "Activity not found or unavailable.",
      );
      return null;
    }

    if (activity.userId !== principal.userId) {
      const isBlocked = await options.communityRepository.isBlockedBilateral(
        principal.userId,
        activity.userId,
        { accessToken: principal.accessToken },
      );
      if (isBlocked) {
        sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "Activity not found or unavailable.",
        );
        return null;
      }

      const relationship = await options.communityRepository.getRelationship(
        principal.userId,
        activity.userId,
        { accessToken: principal.accessToken },
      );
      if (!relationship || relationship.status !== "approved") {
        sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "Activity not found or unavailable.",
        );
        return null;
      }
    }

    return { principal, viewerProfile, activity, authorProfile };
  };

  // PUT /v1/community/activities/:id/reaction — set or remove encouragement reaction
  const handleSetReaction = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<ActivityReactionsResponse | void> => {
    const { id } = request.params as { id?: string };
    const bodyParse = setCommunityReactionSchema.safeParse(request.body);
    if (
      bodyParse.success &&
      bodyParse.data.reaction === null &&
      id &&
      GENERIC_UUID.test(id)
    ) {
      const principal = request.principal!;
      await options.communityRepository.setReaction(
        id,
        principal.userId,
        null,
        {
          accessToken: principal.accessToken,
        },
      );
      // Removal requires only the caller's row, including after lost browsing authority.
      // Return no other participant's counts; authorized screens refresh them separately.
      return {
        activityId: id,
        viewerReaction: null,
        reactionCounts: {
          clap: 0,
          fire: 0,
          high_five: 0,
          fist_bump: 0,
          thumbs_up: 0,
        },
      };
    }
    const access = await resolveActivityAndAccess(request, reply, id);
    if (!access) return;

    const { principal, activity } = access;

    // Authors cannot react to their own cards
    if (activity.userId === principal.userId) {
      return sendApiError(
        reply,
        request,
        403,
        "FORBIDDEN",
        "Authors cannot react to their own shared activities.",
      );
    }

    if (!bodyParse.success) {
      return sendApiError(
        reply,
        request,
        422,
        "VALIDATION_ERROR",
        "Invalid reaction body.",
      );
    }

    const { reaction } = bodyParse.data;

    await options.communityRepository.setReaction(
      activity.id,
      principal.userId,
      reaction,
      { accessToken: principal.accessToken },
    );

    const updated = await options.communityRepository.getReactionsForActivity(
      activity.id,
      principal.userId,
      { accessToken: principal.accessToken },
    );

    return activityReactionsResponseSchema.parse({
      activityId: activity.id,
      reactionCounts: updated.reactionCounts,
      viewerReaction: updated.viewerReaction,
    });
  };

  app.put(
    "/activities/:id/reaction",
    { preHandler: [app.authenticate, rateLimiter.check] },
    handleSetReaction,
  );

  // POST /v1/community/activities/:id/reactions alias
  app.post(
    "/activities/:id/reactions",
    { preHandler: [app.authenticate, rateLimiter.check] },
    handleSetReaction,
  );

  // GET /v1/community/activities/:id/reactions — retrieve reaction counts and viewer reaction (plus permitted reactor identities if author)
  app.get(
    "/activities/:id/reactions",
    { preHandler: app.authenticate },
    async (
      request: FastifyRequest,
      reply: FastifyReply,
    ): Promise<ActivityReactionsResponse | void> => {
      const { id } = request.params as { id?: string };
      const access = await resolveActivityAndAccess(request, reply, id);
      if (!access) return;

      const { principal, activity } = access;

      const reactionsData =
        await options.communityRepository.getReactionsForActivity(
          activity.id,
          principal.userId,
          { accessToken: principal.accessToken },
        );

      const isAuthor = activity.userId === principal.userId;

      return activityReactionsResponseSchema.parse({
        activityId: activity.id,
        reactionCounts: reactionsData.reactionCounts,
        viewerReaction: reactionsData.viewerReaction,
        ...(isAuthor && reactionsData.reactors
          ? {
              reactors: reactionsData.reactors.map((r) => ({
                userId: r.userId,
                handle: r.handle,
                displayName: r.displayName,
                avatarSymbol: r.avatarSymbol,
                reaction: r.reaction,
                createdAt: r.createdAt.toISOString(),
              })),
            }
          : {}),
      });
    },
  );
};
