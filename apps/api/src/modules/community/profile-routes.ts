import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import {
  isAdultEligibleForCommunity,
  toPublicCommunityProfile,
  validateContentSafety,
  type CommunityRepository,
  type ProfileRepository,
  type StoredCommunityProfile,
  type StoredFollowRelationship,
  type UserId,
} from "@mizyun/core";
import {
  communityHandleSchema,
  communityProfileDtoSchema,
  createCommunityProfileSchema,
  handleAvailabilityResponseSchema,
  communityProfileViewDtoSchema,
  type CommunityProfileViewDto,
  updateCommunityProfileSchema,
  type CommunityProfileDto,
  type HandleAvailabilityResponse,
  type PublicCommunityProfileDto,
} from "@mizyun/contracts";
import { communityProfileActivityRoutes } from "./profile-activity-routes.js";
import { sendApiError } from "../../errors.js";
import { registerCommunityErrorHandler } from "./error-handler.js";

const GENERIC_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CommunityProfileRoutesOptions {
  readonly communityRepository: CommunityRepository;
  readonly profileRepository: ProfileRepository;
}

const toProfileWire = (p: StoredCommunityProfile): CommunityProfileDto =>
  communityProfileDtoSchema.parse({
    userId: p.userId,
    handle: p.handle,
    displayName: p.displayName,
    avatarSymbol: p.avatarSymbol,
    bio: p.bio,
    isSearchable: p.isSearchable,
    status: p.status,
    generation: p.generation,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  });

export const communityProfileRoutes: FastifyPluginAsync<
  CommunityProfileRoutesOptions
> = async (app, options) => {
  registerCommunityErrorHandler(app);
  await app.register(communityProfileActivityRoutes, {
    communityRepository: options.communityRepository,
  });
  // GET /v1/community/profile — get current user's profile
  app.get(
    "/profile",
    { preHandler: app.authenticate },
    async (request, reply): Promise<CommunityProfileDto | void> => {
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");

      const profile = await options.communityRepository.getProfile(
        principal.userId,
        { accessToken: principal.accessToken },
      );

      if (!profile) {
        return sendApiError(
          reply,
          request,
          404,
          "COMMUNITY_NOT_ENROLLED",
          "You are not enrolled in community features.",
        );
      }

      return toProfileWire(profile);
    },
  );

  // POST /v1/community/profile — enroll/create profile
  app.post(
    "/profile",
    { preHandler: app.authenticate },
    async (request, reply): Promise<CommunityProfileDto | void> => {
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");

      const parsed = createCommunityProfileSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          parsed.error.issues.map((i) => i.message).join("; "),
        );
      }

      for (const field of [
        parsed.data.handle,
        parsed.data.displayName,
        parsed.data.bio,
      ]) {
        const safety = validateContentSafety(field);
        if (!safety.ok) {
          return sendApiError(
            reply,
            request,
            422,
            "VALIDATION_ERROR",
            safety.reason ?? "Content violates community standards",
          );
        }
      }

      // Verify adult age eligibility from user's base account profile
      const accountProfile = await options.profileRepository.getOrCreate(
        principal.userId,
        { now: new Date(), accessToken: principal.accessToken },
      );

      if (!isAdultEligibleForCommunity(accountProfile?.birthYear)) {
        return sendApiError(
          reply,
          request,
          403,
          "COMMUNITY_AGE_RESTRICTED",
          "We cannot confirm Community eligibility from your birth year. Private tracking stays available.",
        );
      }

      const current = await options.communityRepository.getProfile(
        principal.userId,
        { accessToken: principal.accessToken },
      );
      if (current?.status === "suspended")
        return sendApiError(
          reply,
          request,
          403,
          "FORBIDDEN",
          "Community is unavailable for this account.",
        );
      if (current?.status === "active" && current.handle !== parsed.data.handle)
        return sendApiError(
          reply,
          request,
          409,
          "CONFLICT",
          "Your existing Community handle cannot be changed.",
        );

      // The save transaction reserves the handle atomically. Discovery requires
      // active enrollment and cannot be a prerequisite for joining or returning.
      const saved = await options.communityRepository.saveProfile(
        principal.userId,
        {
          handle: parsed.data.handle,
          enrollmentConsent: {
            adultDeclaration: parsed.data.adultDeclaration,
            termsVersion: parsed.data.termsVersion,
          },
          displayName: parsed.data.displayName,
          ...(parsed.data.avatarSymbol !== undefined
            ? { avatarSymbol: parsed.data.avatarSymbol }
            : {}),
          ...(parsed.data.bio !== undefined ? { bio: parsed.data.bio } : {}),
          ...(parsed.data.isSearchable !== undefined
            ? { isSearchable: parsed.data.isSearchable }
            : {}),
        },
        { accessToken: principal.accessToken },
      );

      reply.status(201);
      return toProfileWire(saved);
    },
  );

  // PATCH /v1/community/profile — update profile
  app.patch(
    "/profile",
    { preHandler: app.authenticate },
    async (request, reply): Promise<CommunityProfileDto | void> => {
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");

      const existing = await options.communityRepository.getProfile(
        principal.userId,
        { accessToken: principal.accessToken },
      );

      if (!existing || existing.status !== "active") {
        return sendApiError(
          reply,
          request,
          404,
          "COMMUNITY_NOT_ENROLLED",
          "You must be enrolled in Community to update your profile.",
        );
      }

      const accountProfile = await options.profileRepository.getOrCreate(
        principal.userId,
        { now: new Date(), accessToken: principal.accessToken },
      );
      if (!isAdultEligibleForCommunity(accountProfile.birthYear)) {
        await options.communityRepository.withdrawProfile(principal.userId, {
          accessToken: principal.accessToken,
        });
        return sendApiError(
          reply,
          request,
          403,
          "COMMUNITY_AGE_RESTRICTED",
          "We cannot confirm Community eligibility from your birth year. Private tracking stays available.",
        );
      }

      const parsed = updateCommunityProfileSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          parsed.error.issues.map((i) => i.message).join("; "),
        );
      }

      for (const field of [parsed.data.displayName, parsed.data.bio]) {
        if (field !== undefined) {
          const safety = validateContentSafety(field);
          if (!safety.ok) {
            return sendApiError(
              reply,
              request,
              422,
              "VALIDATION_ERROR",
              safety.reason ?? "Content violates community standards",
            );
          }
        }
      }

      const saved = await options.communityRepository.saveProfile(
        principal.userId,
        {
          handle: existing.handle,
          displayName: parsed.data.displayName ?? existing.displayName,
          avatarSymbol: parsed.data.avatarSymbol ?? existing.avatarSymbol,
          bio: parsed.data.bio !== undefined ? parsed.data.bio : existing.bio,
          isSearchable:
            parsed.data.isSearchable !== undefined
              ? parsed.data.isSearchable
              : existing.isSearchable,
        },
        { accessToken: principal.accessToken },
      );

      return toProfileWire(saved);
    },
  );

  // DELETE /v1/community/profile and POST /v1/community/profile/withdraw
  const withdrawHandler = async (
    request: FastifyRequest,
    _reply: FastifyReply,
  ): Promise<{ withdrawn: boolean } | void> => {
    const principal = request.principal;
    if (!principal) throw new Error("principal missing after authentication");

    await options.communityRepository.withdrawProfile(principal.userId, {
      accessToken: principal.accessToken,
    });

    return { withdrawn: true };
  };

  app.delete("/profile", { preHandler: app.authenticate }, withdrawHandler);
  app.post(
    "/profile/withdraw",
    { preHandler: app.authenticate },
    withdrawHandler,
  );

  // GET /v1/community/handles/check (and /v1/community/profile/handle-availability)
  const handleCheckHandler = async (
    request: FastifyRequest,
    _reply: FastifyReply,
  ): Promise<HandleAvailabilityResponse> => {
    const principal = request.principal;
    const query = request.query as { handle?: string };
    const rawHandle = query.handle ?? "";
    const parsed = communityHandleSchema.safeParse(rawHandle);

    if (!parsed.success) {
      return handleAvailabilityResponseSchema.parse({
        handle: rawHandle,
        available: false,
        reason: parsed.error.issues[0]?.message ?? "Invalid handle format",
      });
    }

    if (!principal) throw new Error("principal missing after authentication");
    const available = await options.communityRepository.isHandleAvailable(
      parsed.data,
      principal.userId,
      { accessToken: principal.accessToken },
    );

    if (!available) {
      return handleAvailabilityResponseSchema.parse({
        handle: parsed.data,
        available: false,
        reason: "This handle is already taken",
      });
    }

    return handleAvailabilityResponseSchema.parse({
      handle: parsed.data,
      available: true,
    });
  };

  app.get(
    "/handles/check",
    { preHandler: app.authenticate },
    handleCheckHandler,
  );
  app.get(
    "/profile/handle-availability",
    { preHandler: app.authenticate },
    handleCheckHandler,
  );

  // GET /v1/community/profiles/:targetUserId — get single public profile
  app.get(
    "/profiles/:targetUserId",
    { preHandler: app.authenticate },
    async (request, reply): Promise<CommunityProfileViewDto | void> => {
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");

      const params = request.params as { targetUserId: string };
      if (!GENERIC_UUID.test(params.targetUserId))
        return sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "User unavailable",
        );
      const targetUserId = params.targetUserId as UserId;

      // Caller must be enrolled in community to view profiles
      const callerProfile = await options.communityRepository.getProfile(
        principal.userId,
        { accessToken: principal.accessToken },
      );
      if (!callerProfile || callerProfile.status !== "active") {
        return sendApiError(
          reply,
          request,
          403,
          "COMMUNITY_NOT_ENROLLED",
          "You must be enrolled in Community to view profiles.",
        );
      }

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
          "User unavailable",
        );
      }

      const target = await options.communityRepository.getProfile(
        targetUserId,
        {
          accessToken: principal.accessToken,
        },
      );

      if (!target || target.status !== "active") {
        return sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "User unavailable",
        );
      }

      const publicTarget = toPublicCommunityProfile(target);

      let relationshipWithViewer: PublicCommunityProfileDto["relationshipWithViewer"] =
        "none";

      let outgoing: StoredFollowRelationship | null = null;
      let incoming: StoredFollowRelationship | null = null;
      if (principal.userId === targetUserId) {
        relationshipWithViewer = "self";
      } else {
        outgoing = await options.communityRepository.getRelationship(
          principal.userId,
          targetUserId,
          { accessToken: principal.accessToken },
        );
        incoming = await options.communityRepository.getRelationship(
          targetUserId,
          principal.userId,
          { accessToken: principal.accessToken },
        );

        if (
          outgoing?.status === "approved" &&
          incoming?.status === "approved"
        ) {
          relationshipWithViewer = "mutual";
        } else if (outgoing?.status === "approved") {
          relationshipWithViewer = "following";
        } else if (incoming?.status === "approved") {
          relationshipWithViewer = "follower";
        } else if (outgoing?.status === "pending") {
          relationshipWithViewer = "pending_outgoing";
        } else if (incoming?.status === "pending") {
          relationshipWithViewer = "pending_incoming";
        }
      }

      if (!target.isSearchable && relationshipWithViewer === "none")
        return sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "User unavailable",
        );
      const canReadBio =
        relationshipWithViewer === "self" ||
        relationshipWithViewer === "following" ||
        relationshipWithViewer === "mutual";
      const edge = (relationship: StoredFollowRelationship | null) =>
        relationship &&
        (relationship.status === "approved" ||
          relationship.status === "pending")
          ? { id: relationship.id, status: relationship.status }
          : null;
      return communityProfileViewDtoSchema.parse({
        userId: publicTarget.userId,
        handle: publicTarget.handle,
        displayName: publicTarget.displayName,
        avatarSymbol: publicTarget.avatarSymbol,
        bio: canReadBio ? publicTarget.bio : null,
        createdAt: publicTarget.createdAt.toISOString(),
        relationshipWithViewer,
        relationshipContext: {
          outgoing: edge(outgoing),
          incoming: edge(incoming),
        },
      });
    },
  );
};
