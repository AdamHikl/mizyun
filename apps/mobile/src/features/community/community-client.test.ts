import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@mizyun/api-client";
import {
  blockUser,
  checkHandleAvailability,
  createCommunityInvitation,
  enrollCommunityProfile,
  fetchBlockedUsers,
  fetchCommunityInvitations,
  fetchCommunityProfile,
  fetchFollowers,
  fetchFollowing,
  fetchIncomingFollowRequests,
  fetchOutgoingFollowRequests,
  fetchPublicCommunityProfile,
  fetchSharedActivity,
  fetchWorkoutSharePreview,
  humanizeCommunityError,
  publishWorkoutActivity,
  removeFollower,
  requestFollow,
  resolveCommunityInvitation,
  respondToFollowRequest,
  revokeCommunityInvitation,
  searchCommunityProfiles,
  unblockUser,
  unfollowUser,
  unpublishActivity,
  updateCommunityProfile,
  updateSharedActivity,
  withdrawCommunityProfile,
} from "./community-client";

describe("community-client", () => {
  describe("profile operations", () => {
    it("fetches community profile via GET /v1/community/profile", async () => {
      const mockProfile = {
        userId: "u-1",
        handle: "alex_runner",
        displayName: "Alex",
        avatarSymbol: "AR",
        bio: "Running fast",
        isSearchable: true,
        status: "active",
        generation: 1,
        enrolledAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const request = vi
        .fn()
        .mockResolvedValue({ ok: true, value: mockProfile });
      const client = { request } as unknown as ApiClient;

      const result = await fetchCommunityProfile(client);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.handle).toBe("alex_runner");
      }
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "GET",
          path: "/v1/community/profile",
        }),
      );
    });

    it("enrolls profile via POST /v1/community/profile", async () => {
      const request = vi.fn().mockResolvedValue({
        ok: true,
        value: {
          userId: "u-1",
          handle: "dan_runner",
          displayName: "Dan Runner",
          avatarSymbol: "DR",
          bio: null,
          isSearchable: true,
          status: "active",
          generation: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      });
      const client = { request } as unknown as ApiClient;

      const result = await enrollCommunityProfile(client, {
        handle: "dan_runner",
        displayName: "Dan Runner",
        isSearchable: true,
        acceptedTerms: true,
        adultDeclaration: true,
        termsVersion: "2026-09-30",
      });

      expect(result.ok).toBe(true);
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "POST",
          path: "/v1/community/profile",
          body: {
            handle: "dan_runner",
            displayName: "Dan Runner",
            isSearchable: true,
            acceptedTerms: true,
            adultDeclaration: true,
            termsVersion: "2026-09-30",
          },
        }),
      );
    });

    it("updates profile via PATCH /v1/community/profile", async () => {
      const request = vi.fn().mockResolvedValue({ ok: true, value: {} });
      const client = { request } as unknown as ApiClient;

      await updateCommunityProfile(client, { bio: "Updated bio" });
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "PATCH",
          path: "/v1/community/profile",
          body: { bio: "Updated bio" },
        }),
      );
    });

    it("withdraws profile via DELETE /v1/community/profile", async () => {
      const request = vi
        .fn()
        .mockResolvedValue({ ok: true, value: { withdrawn: true } });
      const client = { request } as unknown as ApiClient;

      const result = await withdrawCommunityProfile(client);
      expect(result.ok).toBe(true);
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "DELETE",
          path: "/v1/community/profile",
        }),
      );
    });

    it("checks handle availability via GET /v1/community/handles/check", async () => {
      const request = vi.fn().mockResolvedValue({
        ok: true,
        value: { handle: "alex_fit", available: true, reason: null },
      });
      const client = { request } as unknown as ApiClient;

      const result = await checkHandleAvailability(client, "alex_fit");
      expect(result.ok).toBe(true);
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "GET",
          path: "/v1/community/handles/check?handle=alex_fit",
        }),
      );
    });

    it("searches community profiles via GET /v1/community/search", async () => {
      const request = vi.fn().mockResolvedValue({
        ok: true,
        value: { profiles: [] },
      });
      const client = { request } as unknown as ApiClient;

      const result = await searchCommunityProfiles(client, "marcus", 10);
      expect(result.ok).toBe(true);
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "GET",
          path: "/v1/community/search?q=marcus&limit=10",
        }),
      );
    });

    it("fetches public profile by target user ID", async () => {
      const request = vi.fn().mockResolvedValue({
        ok: true,
        value: {
          userId: "u-2",
          handle: "marcus_lifts",
          displayName: "Marcus K.",
          avatarSymbol: "MK",
          bio: "Lifting heavy",
          createdAt: new Date().toISOString(),
        },
      });
      const client = { request } as unknown as ApiClient;

      const result = await fetchPublicCommunityProfile(client, "u-2");
      expect(result.ok).toBe(true);
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "GET",
          path: "/v1/community/profiles/u-2",
        }),
      );
    });
  });

  describe("relationship operations", () => {
    it("requests follow via POST /v1/community/relationships/follow", async () => {
      const request = vi.fn().mockResolvedValue({
        ok: true,
        value: {
          id: "rel-1",
          followerUserId: "u-1",
          targetUserId: "u-2",
          status: "pending",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      });
      const client = { request } as unknown as ApiClient;

      const result = await requestFollow(client, "u-2", undefined, "op-1");
      expect(result.ok).toBe(true);
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "POST",
          path: "/v1/community/relationships/follow",
          body: { targetUserId: "u-2", operationId: "op-1" },
        }),
      );
    });

    it("responds to follow request with approve/decline/cancel", async () => {
      const request = vi.fn().mockResolvedValue({
        ok: true,
        value: {
          id: "rel-1",
          followerUserId: "u-1",
          targetUserId: "u-2",
          status: "approved",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      });
      const client = { request } as unknown as ApiClient;

      const result = await respondToFollowRequest(client, "rel-1", "approve");
      expect(result.ok).toBe(true);
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "PUT",
          path: "/v1/community/relationships/rel-1",
          body: { action: "approve" },
        }),
      );
    });

    it("unfollows user via DELETE /v1/community/relationships/following/:id", async () => {
      const request = vi
        .fn()
        .mockResolvedValue({ ok: true, value: { unfollowed: true } });
      const client = { request } as unknown as ApiClient;

      const result = await unfollowUser(client, "u-2");
      expect(result.ok).toBe(true);
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "DELETE",
          path: "/v1/community/relationships/following/u-2",
        }),
      );
    });

    it("removes follower via DELETE /v1/community/relationships/followers/:id", async () => {
      const request = vi
        .fn()
        .mockResolvedValue({ ok: true, value: { removed: true } });
      const client = { request } as unknown as ApiClient;

      const result = await removeFollower(client, "u-1");
      expect(result.ok).toBe(true);
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "DELETE",
          path: "/v1/community/relationships/followers/u-1",
        }),
      );
    });

    it("fetches followers, following, incoming, and outgoing lists", async () => {
      const request = vi.fn().mockResolvedValue({
        ok: true,
        value: { items: [] },
      });
      const client = { request } as unknown as ApiClient;

      await fetchFollowers(client);
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "GET",
          path: "/v1/community/relationships/followers",
        }),
      );

      await fetchFollowing(client);
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "GET",
          path: "/v1/community/relationships/following",
        }),
      );

      await fetchIncomingFollowRequests(client);
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "GET",
          path: "/v1/community/relationships/incoming",
        }),
      );

      await fetchOutgoingFollowRequests(client);
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "GET",
          path: "/v1/community/relationships/outgoing",
        }),
      );
    });
  });

  describe("blocking operations", () => {
    it("blocks a user via POST /v1/community/blocks", async () => {
      const request = vi.fn().mockResolvedValue({
        ok: true,
        value: {
          id: "block-1",
          blockerUserId: "u-1",
          blockedUserId: "u-2",
          createdAt: new Date().toISOString(),
        },
      });
      const client = { request } as unknown as ApiClient;

      const result = await blockUser(client, "u-2");
      expect(result.ok).toBe(true);
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "POST",
          path: "/v1/community/blocks",
          body: { blockedUserId: "u-2" },
        }),
      );
    });

    it("unblocks a user via DELETE /v1/community/blocks/:blockedUserId", async () => {
      const request = vi
        .fn()
        .mockResolvedValue({ ok: true, value: { unblocked: true } });
      const client = { request } as unknown as ApiClient;

      const result = await unblockUser(client, "u-2");
      expect(result.ok).toBe(true);
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "DELETE",
          path: "/v1/community/blocks/u-2",
        }),
      );
    });

    it("fetches blocked users via GET /v1/community/blocks", async () => {
      const request = vi.fn().mockResolvedValue({
        ok: true,
        value: { items: [] },
      });
      const client = { request } as unknown as ApiClient;

      const result = await fetchBlockedUsers(client);
      expect(result.ok).toBe(true);
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "GET",
          path: "/v1/community/blocks",
        }),
      );
    });
  });

  describe("humanizeCommunityError", () => {
    it("humanizes age restriction, handle taken, and blocked errors", () => {
      expect(
        humanizeCommunityError({
          kind: "http_error",
          status: 403,
          code: "COMMUNITY_AGE_RESTRICTED",
          message: "Forbidden",
        }),
      ).toBe(
        "We cannot confirm Community eligibility from your birth year. Your private tracking stays available.",
      );

      expect(
        humanizeCommunityError({
          kind: "http_error",
          status: 409,
          code: "HANDLE_TAKEN",
          message: "Conflict",
        }),
      ).toBe("This handle is already taken or unavailable.");

      expect(
        humanizeCommunityError({
          kind: "http_error",
          status: 403,
          code: "COMMUNITY_BLOCKED",
          message: "Forbidden",
        }),
      ).toBe("User unavailable.");

      expect(
        humanizeCommunityError({
          kind: "http_error",
          status: 404,
          code: "COMMUNITY_NOT_ENROLLED",
          message: "Not found",
        }),
      ).toBe("You must join Mizyun Friends to view community features.");

      expect(
        humanizeCommunityError({
          kind: "http_error",
          status: 429,
          code: "RATE_LIMITED",
          message: "Rate limit exceeded",
        }),
      ).toBe("Too many requests. Please try again later.");

      expect(
        humanizeCommunityError({
          kind: "network_error",
          cause: new Error("offline"),
        }),
      ).toBe("Unable to connect. Please check your internet connection.");
    });
  });

  describe("invitations (COMM-05)", () => {
    it("creates an invitation token via POST /v1/community/invitations", async () => {
      const mockRes = {
        invitation: {
          id: "inv-1",
          token: "tok-abc",
          inviterUserId: "u-1",
          expiresAt: new Date().toISOString(),
          revokedAt: null,
          createdAt: new Date().toISOString(),
        },
        inviteUrl: "https://mizyun.app/invite/tok-abc",
      };
      const request = vi.fn().mockResolvedValue({ ok: true, value: mockRes });
      const client = { request } as unknown as ApiClient;

      const result = await createCommunityInvitation(client);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.inviteUrl).toBe(
          "https://mizyun.app/invite/tok-abc",
        );
      }
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "POST",
          path: "/v1/community/invitations",
        }),
      );
    });

    it("resolves an invitation token via GET /v1/community/invitations/:token", async () => {
      const mockRes = {
        id: "inv-1",
        token: "tok-abc",
        inviter: {
          userId: "u-1",
          handle: "alex_runner",
          displayName: "Alex",
          avatarSymbol: "AR",
          bio: null,
          createdAt: new Date().toISOString(),
          relationshipWithViewer: "none",
        },
        expiresAt: new Date().toISOString(),
        isExpired: false,
        isRevoked: false,
      };
      const request = vi.fn().mockResolvedValue({ ok: true, value: mockRes });
      const client = { request } as unknown as ApiClient;

      const result = await resolveCommunityInvitation(client, "tok-abc");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.inviter.handle).toBe("alex_runner");
      }
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "GET",
          path: "/v1/community/invitations/tok-abc",
        }),
      );
    });

    it("revokes an invitation via DELETE /v1/community/invitations/:id", async () => {
      const request = vi.fn().mockResolvedValue({
        ok: true,
        value: { revoked: true },
      });
      const client = { request } as unknown as ApiClient;

      const result = await revokeCommunityInvitation(client, "inv-1");
      expect(result.ok).toBe(true);
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "DELETE",
          path: "/v1/community/invitations/inv-1",
        }),
      );
    });
  });

  describe("workout publication (COMM-06)", () => {
    it("fetches workout share preview via GET /v1/community/workouts/:id/preview", async () => {
      const mockPreview = {
        workoutId: "w-1",
        category: "strength",
        sharedDay: "2026-09-29",
        durationSeconds: 3600,
        followerCount: 3,
        enrollmentGeneration: 1,
      };
      const request = vi
        .fn()
        .mockResolvedValue({ ok: true, value: mockPreview });
      const client = { request } as unknown as ApiClient;

      const result = await fetchWorkoutSharePreview(client, "w-1");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.durationSeconds).toBe(3600);
        expect(result.value.followerCount).toBe(3);
      }
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "GET",
          path: "/v1/community/workouts/w-1/preview",
        }),
      );
    });

    it("publishes workout activity via POST /v1/community/activities", async () => {
      const mockActivity = {
        id: "act-1",
        authorUserId: "u-1",
        authorHandle: "alex_runner",
        authorDisplayName: "Alex",
        authorAvatarSymbol: "AR",
        category: "strength",
        sharedDay: "2026-09-29",
        durationSeconds: 3600,
        publishedAt: new Date().toISOString(),
        sourceWorkoutId: "w-1",
        version: 1,
        revokedAt: null,
        reactionCounts: {
          clap: 0,
          fire: 0,
          high_five: 0,
          fist_bump: 0,
          thumbs_up: 0,
        },
        viewerReaction: null,
      };
      const request = vi
        .fn()
        .mockResolvedValue({ ok: true, value: mockActivity });
      const client = { request } as unknown as ApiClient;

      const result = await publishWorkoutActivity(client, {
        operationId: "00000000-0000-4000-8000-000000000001",
        enrollmentGeneration: 1,
        workoutId: "w-1",
        category: "strength",
        sharedDay: "2026-09-29",
        includeDuration: true,
        expectedDurationSeconds: 2700,
        expectedVersion: 0,
        expectedRevoked: false,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.category).toBe("strength");
      }
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "POST",
          path: "/v1/community/activities",
        }),
      );
    });

    it("unpublishes activity via DELETE /v1/community/activities/:id", async () => {
      const request = vi.fn().mockResolvedValue({
        ok: true,
        value: { revoked: true },
      });
      const client = { request } as unknown as ApiClient;

      const result = await unpublishActivity(client, "act-1");
      expect(result.ok).toBe(true);
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "DELETE",
          path: "/v1/community/activities/act-1",
        }),
      );
    });
  });
});
