import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import {
  canApproveFollowRequest,
  canDeclineFollowRequest,
  canSendFollowRequest,
  toPublicCommunityProfile,
  type CommunityRepository,
  type StoredFollowRelationship,
  type UserId,
} from "@mizyun/core";
import {
  blockedUserListResponseSchema,
  communityListQuerySchema,
  setCommunityMuteSchema,
  mutedUserListResponseSchema,
  communityBlockDtoSchema,
  createBlockSchema,
  followRelationshipDtoSchema,
  publicCommunityProfileDtoSchema,
  relationshipListItemDtoSchema,
  relationshipListResponseSchema,
  sendFollowRequestSchema,
  updateFollowRequestSchema,
  type BlockedUserListResponse,
  type CommunityBlockDto,
  type FollowRelationshipDto,
  type RelationshipListResponse,
} from "@mizyun/contracts";
import { sendApiError } from "../../errors.js";
import { registerCommunityErrorHandler } from "./error-handler.js";

const GENERIC_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const listPage = (
  request: FastifyRequest,
  reply: FastifyReply,
  scope: string,
) => {
  const parsed = communityListQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    sendApiError(
      reply,
      request,
      422,
      "VALIDATION_ERROR",
      "Invalid list query.",
    );
    return null;
  }
  let afterId: string | undefined;
  if (parsed.data.cursor) {
    try {
      const cursor = JSON.parse(
        Buffer.from(parsed.data.cursor, "base64url").toString(),
      ) as { scope: string; userId: string; id: string };
      if (
        cursor.scope !== scope ||
        cursor.userId !== request.principal?.userId ||
        !GENERIC_UUID.test(cursor.id)
      )
        throw new Error("cursor");
      afterId = cursor.id;
    } catch {
      sendApiError(
        reply,
        request,
        422,
        "VALIDATION_ERROR",
        "Invalid list cursor.",
      );
      return null;
    }
  }
  return { limit: parsed.data.limit, ...(afterId ? { afterId } : {}) };
};
const nextListCursor = (
  request: FastifyRequest,
  scope: string,
  id: string | undefined,
) =>
  id
    ? Buffer.from(
        JSON.stringify({ scope, userId: request.principal?.userId, id }),
      ).toString("base64url")
    : null;

export interface CommunityRelationshipRoutesOptions {
  readonly communityRepository: CommunityRepository;
}

const toRelationshipWire = (
  r: StoredFollowRelationship,
): FollowRelationshipDto =>
  followRelationshipDtoSchema.parse({
    id: r.id,
    followerUserId: r.followerUserId,
    targetUserId: r.targetUserId,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  });

export const communityRelationshipRoutes: FastifyPluginAsync<
  CommunityRelationshipRoutesOptions
> = async (app, options) => {
  registerCommunityErrorHandler(app);
  // POST /v1/community/relationships/follow (and /v1/community/relationships/requests)
  const sendRequestHandler = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<FollowRelationshipDto | void> => {
    const principal = request.principal;
    if (!principal) throw new Error("principal missing after authentication");

    const parsed = sendFollowRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendApiError(
        reply,
        request,
        422,
        "VALIDATION_ERROR",
        parsed.error.issues.map((i) => i.message).join("; "),
      );
    }

    const targetUserId = parsed.data.targetUserId as UserId;
    if (principal.userId === targetUserId) {
      return sendApiError(
        reply,
        request,
        400,
        "VALIDATION_ERROR",
        "You cannot follow yourself.",
      );
    }

    // Check bilateral block
    const isBlocked = await options.communityRepository.isBlockedBilateral(
      principal.userId,
      targetUserId,
      { accessToken: principal.accessToken },
    );
    if (isBlocked) {
      return sendApiError(
        reply,
        request,
        404,
        "NOT_FOUND",
        "User unavailable.",
      );
    }

    // Check sender is enrolled
    const senderProfile = await options.communityRepository.getProfile(
      principal.userId,
      { accessToken: principal.accessToken },
    );
    if (!senderProfile || senderProfile.status !== "active") {
      return sendApiError(
        reply,
        request,
        403,
        "COMMUNITY_NOT_ENROLLED",
        "You must be enrolled in Community to follow friends.",
      );
    }

    // Check target exists and is active
    let targetProfile = await options.communityRepository.getProfile(
      targetUserId,
      { accessToken: principal.accessToken },
    );
    if (
      (!targetProfile || !targetProfile.isSearchable) &&
      parsed.data.invitationToken
    ) {
      const invitedProfile =
        await options.communityRepository.getInvitationProfile(
          parsed.data.invitationToken,
          { accessToken: principal.accessToken },
        );
      if (invitedProfile?.userId === targetUserId)
        targetProfile = invitedProfile;
    }
    if (!targetProfile || targetProfile.status !== "active") {
      return sendApiError(
        reply,
        request,
        404,
        "NOT_FOUND",
        "User unavailable.",
      );
    }

    // Check existing relationship
    const existing = await options.communityRepository.getRelationship(
      principal.userId,
      targetUserId,
      { accessToken: principal.accessToken },
    );

    if (
      !targetProfile.isSearchable &&
      existing?.status !== "pending" &&
      existing?.status !== "approved"
    ) {
      if (!parsed.data.invitationToken)
        return sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "User unavailable.",
        );
      const invited = await options.communityRepository.getInvitationProfile(
        parsed.data.invitationToken,
        { accessToken: principal.accessToken },
      );
      if (invited?.userId !== targetUserId)
        return sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "User unavailable.",
        );
    }
    const canSend = canSendFollowRequest({
      followerUserId: principal.userId,
      targetUserId,
      existingStatus: existing?.status ?? null,
      isBlocked,
    });

    if (!canSend) {
      if (existing?.status !== "approved" && existing?.status !== "pending")
        return sendApiError(
          reply,
          request,
          400,
          "VALIDATION_ERROR",
          "Cannot send follow request.",
        );
    }

    const created = await options.communityRepository.sendFollowRequest(
      principal.userId,
      targetUserId,
      {
        accessToken: principal.accessToken,
        ...(parsed.data.operationId
          ? { operationId: parsed.data.operationId }
          : {}),
        ...(parsed.data.invitationToken
          ? { invitationToken: parsed.data.invitationToken }
          : {}),
      },
    );

    reply.status(
      existing?.status === "pending" || existing?.status === "approved"
        ? 200
        : 201,
    );
    return toRelationshipWire(created);
  };

  app.post(
    "/relationships/follow",
    { preHandler: app.authenticate },
    sendRequestHandler,
  );
  app.post(
    "/relationships/requests",
    { preHandler: app.authenticate },
    sendRequestHandler,
  );

  // PUT /v1/community/relationships/:id and PATCH /v1/community/relationships/requests/:id
  const respondRequestHandler = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<FollowRelationshipDto | void> => {
    const principal = request.principal;
    if (!principal) throw new Error("principal missing after authentication");

    const params = request.params as { id: string };
    if (!GENERIC_UUID.test(params.id))
      return sendApiError(
        reply,
        request,
        404,
        "NOT_FOUND",
        "Follow request not found.",
      );
    const caller = await options.communityRepository.getProfile(
      principal.userId,
      { accessToken: principal.accessToken },
    );
    if (!caller || caller.status !== "active")
      return sendApiError(
        reply,
        request,
        403,
        "COMMUNITY_NOT_ENROLLED",
        "You must be enrolled in Community.",
      );
    const parsed = updateFollowRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendApiError(
        reply,
        request,
        422,
        "VALIDATION_ERROR",
        parsed.error.issues.map((i) => i.message).join("; "),
      );
    }

    const rel = await options.communityRepository.getRelationshipById(
      params.id,
      { accessToken: principal.accessToken },
    );

    if (!rel) {
      return sendApiError(
        reply,
        request,
        404,
        "NOT_FOUND",
        "Follow request not found.",
      );
    }

    const action = parsed.data.action;
    const desiredStatus =
      action === "approve"
        ? "approved"
        : action === "decline"
          ? "declined"
          : "canceled";
    const authorizedActor =
      action === "cancel" ? rel.followerUserId : rel.targetUserId;
    if (rel.status === desiredStatus && principal.userId === authorizedActor)
      return toRelationshipWire(rel);

    if (action === "cancel") {
      if (rel.followerUserId !== principal.userId) {
        return sendApiError(
          reply,
          request,
          403,
          "FORBIDDEN",
          "Only the sender can cancel a follow request.",
        );
      }
      if (rel.status !== "pending") {
        return sendApiError(
          reply,
          request,
          400,
          "VALIDATION_ERROR",
          "Can only cancel a pending request.",
        );
      }
      const updated =
        await options.communityRepository.updateRelationshipStatus(
          rel.id,
          principal.userId,
          "canceled",
          { accessToken: principal.accessToken },
        );
      return toRelationshipWire(updated);
    }

    // Approve or decline: actor must be target user
    if (action === "approve") {
      const isBlocked = await options.communityRepository.isBlockedBilateral(
        principal.userId,
        rel.followerUserId,
        { accessToken: principal.accessToken },
      );

      const canApprove = canApproveFollowRequest({
        existingStatus: rel.status,
        actorUserId: principal.userId,
        targetUserId: rel.targetUserId,
        isBlocked,
      });

      if (!canApprove) {
        return sendApiError(
          reply,
          request,
          403,
          "FORBIDDEN",
          "Cannot approve this follow request.",
        );
      }

      const updated =
        await options.communityRepository.updateRelationshipStatus(
          rel.id,
          principal.userId,
          "approved",
          { accessToken: principal.accessToken },
        );
      return toRelationshipWire(updated);
    }

    if (action === "decline") {
      const canDecline = canDeclineFollowRequest({
        existingStatus: rel.status,
        actorUserId: principal.userId,
        targetUserId: rel.targetUserId,
      });

      if (!canDecline) {
        return sendApiError(
          reply,
          request,
          403,
          "FORBIDDEN",
          "Cannot decline this follow request.",
        );
      }

      const updated =
        await options.communityRepository.updateRelationshipStatus(
          rel.id,
          principal.userId,
          "declined",
          { accessToken: principal.accessToken },
        );
      return toRelationshipWire(updated);
    }
  };

  app.put(
    "/relationships/:id",
    { preHandler: app.authenticate },
    respondRequestHandler,
  );
  app.patch(
    "/relationships/requests/:id",
    { preHandler: app.authenticate },
    respondRequestHandler,
  );

  // DELETE /v1/community/relationships/following/:targetUserId — unfollow
  app.delete(
    "/relationships/following/:targetUserId",
    { preHandler: app.authenticate },
    async (request, reply): Promise<{ unfollowed: boolean } | void> => {
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");

      const params = request.params as { targetUserId: string };
      if (!GENERIC_UUID.test(params.targetUserId))
        return sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "User unavailable.",
        );
      const { relationshipId } = request.query as { relationshipId?: string };
      if (!relationshipId || !GENERIC_UUID.test(relationshipId))
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          "Invalid relationship ID.",
        );
      await options.communityRepository.unfollow(
        principal.userId,
        params.targetUserId as UserId,
        {
          accessToken: principal.accessToken,
          ...(relationshipId ? { relationshipId } : {}),
        },
      );

      return { unfollowed: true };
    },
  );

  // DELETE /v1/community/relationships/followers/:followerUserId — remove follower
  app.delete(
    "/relationships/followers/:followerUserId",
    { preHandler: app.authenticate },
    async (request, reply): Promise<{ removed: boolean } | void> => {
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");

      const params = request.params as { followerUserId: string };
      if (!GENERIC_UUID.test(params.followerUserId))
        return sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "User unavailable.",
        );
      const { relationshipId } = request.query as { relationshipId?: string };
      if (!relationshipId || !GENERIC_UUID.test(relationshipId))
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          "Invalid relationship ID.",
        );
      await options.communityRepository.removeFollower(
        principal.userId,
        params.followerUserId as UserId,
        {
          accessToken: principal.accessToken,
          ...(relationshipId ? { relationshipId } : {}),
        },
      );

      return { removed: true };
    },
  );

  // GET /v1/community/relationships/followers
  app.get(
    "/relationships/followers",
    { preHandler: app.authenticate },
    async (request, reply): Promise<RelationshipListResponse | void> => {
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");

      const caller = await options.communityRepository.getProfile(
        principal.userId,
        { accessToken: principal.accessToken },
      );
      if (!caller || caller.status !== "active")
        return sendApiError(
          reply,
          request,
          403,
          "COMMUNITY_NOT_ENROLLED",
          "You must be enrolled in Community.",
        );
      const page = listPage(request, reply, "followers");
      if (!page) return;
      const list = await options.communityRepository.getFollowers(
        principal.userId,
        { accessToken: principal.accessToken, ...page, limit: page.limit + 1 },
      );

      return relationshipListResponseSchema.parse({
        nextCursor: nextListCursor(
          request,
          "followers",
          list.length > page.limit
            ? list[page.limit - 1]?.relationship.id
            : undefined,
        ),
        items: list.slice(0, page.limit).map((item) => {
          const publicP = toPublicCommunityProfile(item.profile);
          return relationshipListItemDtoSchema.parse({
            relationshipId: item.relationship.id,
            user: publicCommunityProfileDtoSchema.parse({
              userId: publicP.userId,
              handle: publicP.handle,
              displayName: publicP.displayName,
              avatarSymbol: publicP.avatarSymbol,
              bio: null,
              createdAt: publicP.createdAt.toISOString(),
              relationshipWithViewer: "follower",
            }),
            status: item.relationship.status,
            createdAt: item.relationship.createdAt.toISOString(),
          });
        }),
      });
    },
  );

  // GET /v1/community/relationships/following
  app.get(
    "/relationships/following",
    { preHandler: app.authenticate },
    async (request, reply): Promise<RelationshipListResponse | void> => {
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");

      const caller = await options.communityRepository.getProfile(
        principal.userId,
        { accessToken: principal.accessToken },
      );
      if (!caller || caller.status !== "active")
        return sendApiError(
          reply,
          request,
          403,
          "COMMUNITY_NOT_ENROLLED",
          "You must be enrolled in Community.",
        );
      const page = listPage(request, reply, "following");
      if (!page) return;
      const list = await options.communityRepository.getFollowing(
        principal.userId,
        { accessToken: principal.accessToken, ...page, limit: page.limit + 1 },
      );

      return relationshipListResponseSchema.parse({
        nextCursor: nextListCursor(
          request,
          "following",
          list.length > page.limit
            ? list[page.limit - 1]?.relationship.id
            : undefined,
        ),
        items: list.slice(0, page.limit).map((item) => {
          const publicP = toPublicCommunityProfile(item.profile);
          return relationshipListItemDtoSchema.parse({
            relationshipId: item.relationship.id,
            user: publicCommunityProfileDtoSchema.parse({
              userId: publicP.userId,
              handle: publicP.handle,
              displayName: publicP.displayName,
              avatarSymbol: publicP.avatarSymbol,
              bio: publicP.bio,
              createdAt: publicP.createdAt.toISOString(),
              relationshipWithViewer: "following",
            }),
            status: item.relationship.status,
            createdAt: item.relationship.createdAt.toISOString(),
          });
        }),
      });
    },
  );

  // GET /v1/community/relationships/incoming
  app.get(
    "/relationships/incoming",
    { preHandler: app.authenticate },
    async (request, reply): Promise<RelationshipListResponse | void> => {
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");

      const caller = await options.communityRepository.getProfile(
        principal.userId,
        { accessToken: principal.accessToken },
      );
      if (!caller || caller.status !== "active")
        return sendApiError(
          reply,
          request,
          403,
          "COMMUNITY_NOT_ENROLLED",
          "You must be enrolled in Community.",
        );
      const page = listPage(request, reply, "incoming");
      if (!page) return;
      const list = await options.communityRepository.getIncomingFollowRequests(
        principal.userId,
        { accessToken: principal.accessToken, ...page, limit: page.limit + 1 },
      );

      return relationshipListResponseSchema.parse({
        nextCursor: nextListCursor(
          request,
          "incoming",
          list.length > page.limit
            ? list[page.limit - 1]?.relationship.id
            : undefined,
        ),
        items: list.slice(0, page.limit).map((item) => {
          const publicP = toPublicCommunityProfile(item.profile);
          return relationshipListItemDtoSchema.parse({
            relationshipId: item.relationship.id,
            user: publicCommunityProfileDtoSchema.parse({
              userId: publicP.userId,
              handle: publicP.handle,
              displayName: publicP.displayName,
              avatarSymbol: publicP.avatarSymbol,
              bio: null,
              createdAt: publicP.createdAt.toISOString(),
              relationshipWithViewer: "pending_incoming",
            }),
            status: item.relationship.status,
            createdAt: item.relationship.createdAt.toISOString(),
          });
        }),
      });
    },
  );

  // GET /v1/community/relationships/outgoing
  app.get(
    "/relationships/outgoing",
    { preHandler: app.authenticate },
    async (request, reply): Promise<RelationshipListResponse | void> => {
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");

      const caller = await options.communityRepository.getProfile(
        principal.userId,
        { accessToken: principal.accessToken },
      );
      if (!caller || caller.status !== "active")
        return sendApiError(
          reply,
          request,
          403,
          "COMMUNITY_NOT_ENROLLED",
          "You must be enrolled in Community.",
        );
      const page = listPage(request, reply, "outgoing");
      if (!page) return;
      const list = await options.communityRepository.getOutgoingFollowRequests(
        principal.userId,
        { accessToken: principal.accessToken, ...page, limit: page.limit + 1 },
      );

      return relationshipListResponseSchema.parse({
        nextCursor: nextListCursor(
          request,
          "outgoing",
          list.length > page.limit
            ? list[page.limit - 1]?.relationship.id
            : undefined,
        ),
        items: list.slice(0, page.limit).map((item) => {
          const publicP = toPublicCommunityProfile(item.profile);
          return relationshipListItemDtoSchema.parse({
            relationshipId: item.relationship.id,
            user: publicCommunityProfileDtoSchema.parse({
              userId: publicP.userId,
              handle: publicP.handle,
              displayName: publicP.displayName,
              avatarSymbol: publicP.avatarSymbol,
              bio: null,
              createdAt: publicP.createdAt.toISOString(),
              relationshipWithViewer: "pending_outgoing",
            }),
            status: item.relationship.status,
            createdAt: item.relationship.createdAt.toISOString(),
          });
        }),
      });
    },
  );

  // POST /v1/community/blocks
  app.post(
    "/blocks",
    { preHandler: app.authenticate },
    async (request, reply): Promise<CommunityBlockDto | void> => {
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");

      const parsed = createBlockSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          parsed.error.issues.map((i) => i.message).join("; "),
        );
      }

      const blockedUserId = parsed.data.blockedUserId as UserId;
      if (principal.userId === blockedUserId) {
        return sendApiError(
          reply,
          request,
          400,
          "VALIDATION_ERROR",
          "You cannot block yourself.",
        );
      }

      const block = await options.communityRepository.blockUser(
        principal.userId,
        blockedUserId,
        { accessToken: principal.accessToken },
      );

      reply.status(201);
      return communityBlockDtoSchema.parse({
        id: block.id,
        blockerUserId: block.blockerUserId,
        blockedUserId: block.blockedUserId,
        createdAt: block.createdAt.toISOString(),
      });
    },
  );

  // DELETE /v1/community/blocks/:blockedUserId
  app.delete(
    "/blocks/:blockedUserId",
    { preHandler: app.authenticate },
    async (request, reply): Promise<{ unblocked: boolean } | void> => {
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");

      const params = request.params as { blockedUserId: string };
      if (!GENERIC_UUID.test(params.blockedUserId))
        return sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "User unavailable.",
        );
      await options.communityRepository.unblockUser(
        principal.userId,
        params.blockedUserId as UserId,
        { accessToken: principal.accessToken },
      );

      return { unblocked: true };
    },
  );

  // GET /v1/community/blocks
  app.get(
    "/blocks",
    { preHandler: app.authenticate },
    async (request, reply): Promise<BlockedUserListResponse | void> => {
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");

      const page = listPage(request, reply, "blocks");
      if (!page) return;
      const blocks = await options.communityRepository.getBlockedUsers(
        principal.userId,
        { accessToken: principal.accessToken, ...page, limit: page.limit + 1 },
      );

      return blockedUserListResponseSchema.parse({
        nextCursor: nextListCursor(
          request,
          "blocks",
          blocks.length > page.limit
            ? blocks[page.limit - 1]?.block.id
            : undefined,
        ),
        items: blocks.slice(0, page.limit).map((b) => {
          const publicP = toPublicCommunityProfile(b.profile);
          return {
            blockId: b.block.id,
            blockedUser: publicCommunityProfileDtoSchema.parse({
              userId: publicP.userId,
              handle: publicP.handle,
              displayName: publicP.displayName,
              avatarSymbol: publicP.avatarSymbol,
              bio: null,
              createdAt: publicP.createdAt.toISOString(),
            }),
            createdAt: b.block.createdAt.toISOString(),
          };
        }),
      });
    },
  );
  app.put(
    "/mutes/:targetUserId",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = request.principal!;
      const { targetUserId } = request.params as { targetUserId: string };
      const parsed = setCommunityMuteSchema.safeParse(request.body);
      if (!GENERIC_UUID.test(targetUserId) || !parsed.success)
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          "Invalid mute preference.",
        );
      await options.communityRepository.setMuted(
        principal.userId,
        targetUserId as UserId,
        parsed.data.muted,
        { accessToken: principal.accessToken },
      );
      return { muted: parsed.data.muted };
    },
  );
  app.get(
    "/mutes",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = request.principal!;
      const page = listPage(request, reply, "mutes");
      if (!page) return;
      const items = await options.communityRepository.getMutedUsers(
        principal.userId,
        { accessToken: principal.accessToken, ...page, limit: page.limit + 1 },
      );
      return mutedUserListResponseSchema.parse({
        nextCursor: nextListCursor(
          request,
          "mutes",
          items.length > page.limit
            ? items[page.limit - 1]?.profile.userId
            : undefined,
        ),
        items: items.slice(0, page.limit).map((item) => ({
          user: {
            ...toPublicCommunityProfile(item.profile),
            bio: null,
            createdAt: item.profile.createdAt.toISOString(),
          },
          createdAt: item.createdAt.toISOString(),
        })),
      });
    },
  );
};
