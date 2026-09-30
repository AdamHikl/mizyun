import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type {
  CommunityRepository,
  StoredCommunityInvitation,
} from "@mizyun/core";
import {
  communityInvitationListResponseSchema,
  createInvitationResponseSchema,
  publicCommunityProfileDtoSchema,
  resolveInvitationResponseSchema,
  revokeInvitationResponseSchema,
  type CommunityInvitationDto,
  type CommunityInvitationListResponse,
  type CreateInvitationResponse,
  type ResolveInvitationResponse,
  type RevokeInvitationResponse,
} from "@mizyun/contracts";
import type { CommunityDiscoveryRateLimiter } from "./discovery-routes.js";
import { sendApiError } from "../../errors.js";
import { registerCommunityErrorHandler } from "./error-handler.js";

const GENERIC_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CommunityInvitationRoutesOptions {
  readonly communityRepository: CommunityRepository;
  readonly invitationScheme?: "mizyun" | "mizyun-dev";
  readonly discoveryRateLimiter: CommunityDiscoveryRateLimiter;
}

const toInvitationWire = (
  invitation: StoredCommunityInvitation,
): CommunityInvitationDto => ({
  id: invitation.id,
  token: invitation.token,
  inviterUserId: invitation.inviterUserId,
  expiresAt: invitation.expiresAt.toISOString(),
  revokedAt: invitation.revokedAt ? invitation.revokedAt.toISOString() : null,
  createdAt: invitation.createdAt.toISOString(),
});

export const communityInvitationRoutes: FastifyPluginAsync<
  CommunityInvitationRoutesOptions
> = async (app, options) => {
  registerCommunityErrorHandler(app);
  const invitationScheme = options.invitationScheme ?? "mizyun";

  // POST /v1/community/invitations — create an invitation link
  app.post(
    "/invitations",
    { preHandler: app.authenticate },
    async (
      request: FastifyRequest,
      reply: FastifyReply,
    ): Promise<CreateInvitationResponse | void> => {
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");

      const profile = await options.communityRepository.getProfile(
        principal.userId,
        { accessToken: principal.accessToken },
      );
      if (!profile || profile.status !== "active") {
        return sendApiError(
          reply,
          request,
          403,
          "COMMUNITY_NOT_ENROLLED",
          "You must be enrolled in Community to create an invitation.",
        );
      }

      // Quota: limit active invitations per user to prevent abuse
      const existing = await options.communityRepository.listInvitations(
        principal.userId,
        { accessToken: principal.accessToken },
      );
      const activeCount = existing.filter(
        (inv) => !inv.revokedAt && inv.expiresAt.getTime() > Date.now(),
      ).length;
      if (activeCount >= 20) {
        return sendApiError(
          reply,
          request,
          429,
          "RATE_LIMITED",
          "You have reached the maximum number of active invitations (20). Please revoke unused invitations before creating new ones.",
        );
      }

      const invitation = await options.communityRepository.createInvitation(
        principal.userId,
        { accessToken: principal.accessToken },
      );

      const inviteUrl = `${invitationScheme}://invite/${invitation.token}`;

      reply.status(201);
      return createInvitationResponseSchema.parse({
        invitation: toInvitationWire(invitation),
        inviteUrl,
      });
    },
  );

  // GET /v1/community/invitations — list user's invitations
  app.get(
    "/invitations",
    { preHandler: app.authenticate },
    async (
      request: FastifyRequest,
      reply: FastifyReply,
    ): Promise<CommunityInvitationListResponse | void> => {
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");

      const profile = await options.communityRepository.getProfile(
        principal.userId,
        { accessToken: principal.accessToken },
      );
      if (!profile || profile.status !== "active") {
        return sendApiError(
          reply,
          request,
          403,
          "COMMUNITY_NOT_ENROLLED",
          "You must be enrolled in Community to view invitations.",
        );
      }

      const list = await options.communityRepository.listInvitations(
        principal.userId,
        { accessToken: principal.accessToken },
      );

      return communityInvitationListResponseSchema.parse({
        items: list.map(toInvitationWire),
      });
    },
  );

  // GET /v1/community/invitations/:token — resolve an invitation link
  app.get(
    "/invitations/:token",
    { preHandler: [app.authenticate, options.discoveryRateLimiter.check] },
    async (
      request: FastifyRequest,
      reply: FastifyReply,
    ): Promise<ResolveInvitationResponse | void> => {
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
          "You must be enrolled in Community to view invitations.",
        );
      }

      const { token } = request.params as { token?: string };
      if (!token || !/^[A-Za-z0-9_-]{22}$/.test(token)) {
        return sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "Invitation not found or unavailable.",
        );
      }

      const resolved = await options.communityRepository.resolveInvitation(
        token,
        principal.userId,
        { accessToken: principal.accessToken },
      );

      if (!resolved) {
        return sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "Invitation not found or unavailable.",
        );
      }

      const { invitation, profile: inviterProfile } = resolved;

      // Check bilateral block
      const isBlocked = await options.communityRepository.isBlockedBilateral(
        principal.userId,
        invitation.inviterUserId,
        { accessToken: principal.accessToken },
      );
      if (isBlocked) {
        return sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "Invitation not found or unavailable.",
        );
      }

      // Check inviter profile status
      if (!inviterProfile || inviterProfile.status !== "active") {
        return sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "Invitation not found or unavailable.",
        );
      }

      const now = Date.now();
      const isExpired = invitation.expiresAt.getTime() <= now;
      const isRevoked = invitation.revokedAt !== null;

      if (isExpired || isRevoked) {
        return sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "Invitation not found or unavailable.",
        );
      }

      // Calculate relationship with viewer
      const outgoing = await options.communityRepository.getRelationship(
        principal.userId,
        invitation.inviterUserId,
        { accessToken: principal.accessToken },
      );
      const incoming = await options.communityRepository.getRelationship(
        invitation.inviterUserId,
        principal.userId,
        { accessToken: principal.accessToken },
      );

      let relationshipWithViewer:
        | "none"
        | "pending_outgoing"
        | "pending_incoming"
        | "following"
        | "follower"
        | "mutual"
        | "self" = "none";
      if (principal.userId === invitation.inviterUserId) {
        relationshipWithViewer = "self";
      } else if (
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

      const publicInviter = publicCommunityProfileDtoSchema.parse({
        userId: inviterProfile.userId,
        handle: inviterProfile.handle,
        displayName: inviterProfile.displayName,
        avatarSymbol: inviterProfile.avatarSymbol,
        bio: null,
        createdAt: inviterProfile.createdAt.toISOString(),
        relationshipWithViewer,
      });

      return resolveInvitationResponseSchema.parse({
        id: invitation.id,
        token: invitation.token,
        inviter: publicInviter,
        expiresAt: invitation.expiresAt.toISOString(),
        isExpired: false,
        isRevoked: false,
      });
    },
  );

  // DELETE /v1/community/invitations/:id — revoke an invitation
  app.delete(
    "/invitations/:id",
    { preHandler: app.authenticate },
    async (
      request: FastifyRequest,
      reply: FastifyReply,
    ): Promise<RevokeInvitationResponse | void> => {
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");

      const { id } = request.params as { id?: string };
      if (!id || !GENERIC_UUID.test(id)) {
        return sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "Invitation not found.",
        );
      }

      const invitation = await options.communityRepository.getInvitationById(
        id,
        { accessToken: principal.accessToken },
      );
      if (!invitation || invitation.inviterUserId !== principal.userId) {
        return sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "Invitation not found.",
        );
      }

      await options.communityRepository.revokeInvitation(id, principal.userId, {
        accessToken: principal.accessToken,
      });

      return revokeInvitationResponseSchema.parse({
        revoked: true,
      });
    },
  );
};
