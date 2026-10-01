import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@mizyun/api-client";
import {
  blockUser,
  checkHandleAvailability,
  createCommunityInvitation,
  enrollCommunityProfile,
  fetchBlockedUsers,
  fetchCommunityFeed,
  fetchCommunityInvitations,
  fetchCommunityProfile,
  fetchFollowers,
  fetchFollowing,
  fetchIncomingFollowRequests,
  fetchMyCommunityReports,
  fetchOutgoingFollowRequests,
  fetchPublicCommunityProfile,
  fetchSafetyContact,
  fetchSharedActivity,
  fetchWorkoutSharePreview,
  getActivityReactions,
  humanizeCommunityError,
  publishWorkoutActivity,
  removeFollower,
  requestFollow,
  resolveCommunityInvitation,
  respondToFollowRequest,
  revokeCommunityInvitation,
  searchCommunityProfiles,
  setActivityReaction,
  submitCommunityReport,
  submitModerationAppeal,
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
        includeWorkoutDetails: false,
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

  describe("following feed (COMM-07)", () => {
    it("fetches community feed without query params via GET /v1/community/feed", async () => {
      const mockFeed = {
        items: [
          {
            id: "act-1",
            authorUserId: "u-1",
            authorHandle: "alex_runner",
            authorDisplayName: "Alex",
            authorAvatarSymbol: "AR",
            category: "running",
            sharedDay: "2026-09-30",
            durationSeconds: 1800,
            publishedAt: new Date().toISOString(),
            reactionCounts: { clap: 1 },
            viewerReaction: "clap",
          },
        ],
        nextCursor: null,
      };
      const request = vi.fn().mockResolvedValue({ ok: true, value: mockFeed });
      const client = { request } as unknown as ApiClient;

      const result = await fetchCommunityFeed(client);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.items).toHaveLength(1);
        expect(result.value.items[0].authorHandle).toBe("alex_runner");
        expect(result.value.nextCursor).toBeNull();
      }
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "GET",
          path: "/v1/community/feed",
        }),
      );
    });

    it("passes limit and cursor query params", async () => {
      const mockFeed = {
        items: [],
        nextCursor: "cursor-next",
      };
      const request = vi.fn().mockResolvedValue({ ok: true, value: mockFeed });
      const client = { request } as unknown as ApiClient;

      const result = await fetchCommunityFeed(client, {
        limit: 20,
        cursor: "cursor-token-123",
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.nextCursor).toBe("cursor-next");
      }
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "GET",
          path: "/v1/community/feed?limit=20&cursor=cursor-token-123",
        }),
      );
    });

    it("passes only limit query param when cursor is omitted", async () => {
      const request = vi.fn().mockResolvedValue({
        ok: true,
        value: { items: [], nextCursor: null },
      });
      const client = { request } as unknown as ApiClient;

      await fetchCommunityFeed(client, { limit: 10 });
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "GET",
          path: "/v1/community/feed?limit=10",
        }),
      );
    });
  });

  describe("reactions (COMM-08)", () => {
    it("sets activity reaction via PUT /v1/community/activities/:id/reaction", async () => {
      const mockResponse = {
        activityId: "act-1",
        reactionCounts: {
          clap: 1,
          fire: 0,
          high_five: 0,
          fist_bump: 0,
          thumbs_up: 0,
        },
        viewerReaction: "clap",
      };
      const request = vi
        .fn()
        .mockResolvedValue({ ok: true, value: mockResponse });
      const client = { request } as unknown as ApiClient;

      const result = await setActivityReaction(client, "act-1", "clap");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.viewerReaction).toBe("clap");
        expect(result.value.reactionCounts.clap).toBe(1);
      }
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "PUT",
          path: "/v1/community/activities/act-1/reaction",
          body: { reaction: "clap" },
        }),
      );
    });

    it("removes activity reaction by passing null", async () => {
      const mockResponse = {
        activityId: "act-1",
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
        .mockResolvedValue({ ok: true, value: mockResponse });
      const client = { request } as unknown as ApiClient;

      const result = await setActivityReaction(client, "act-1", null);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.viewerReaction).toBeNull();
        expect(result.value.reactionCounts.clap).toBe(0);
      }
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "PUT",
          path: "/v1/community/activities/act-1/reaction",
          body: { reaction: null },
        }),
      );
    });

    it("gets activity reactions via GET /v1/community/activities/:id/reactions", async () => {
      const mockResponse = {
        activityId: "act-1",
        reactionCounts: {
          clap: 2,
          fire: 1,
          high_five: 0,
          fist_bump: 0,
          thumbs_up: 0,
        },
        viewerReaction: "fire",
        reactors: [
          {
            userId: "u-2",
            handle: "maria_run",
            displayName: "Maria",
            avatarSymbol: "MR",
            reaction: "fire",
            createdAt: "2026-09-30T10:00:00.000Z",
          },
        ],
      };
      const request = vi
        .fn()
        .mockResolvedValue({ ok: true, value: mockResponse });
      const client = { request } as unknown as ApiClient;

      const result = await getActivityReactions(client, "act-1");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.activityId).toBe("act-1");
        expect(result.value.reactors).toHaveLength(1);
        expect(result.value.reactors?.[0].handle).toBe("maria_run");
      }
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "GET",
          path: "/v1/community/activities/act-1/reactions",
        }),
      );
    });
  });

  describe("safety & reporting (COMM-09)", () => {
    it("submits community report via POST /v1/community/reports", async () => {
      const mockResponse = {
        id: "rep-1",
        status: "submitted",
        createdAt: "2026-09-30T10:00:00.000Z",
        safetyContact: "safety@mizyun.com",
        message: "Report received.",
      };
      const request = vi
        .fn()
        .mockResolvedValue({ ok: true, value: mockResponse });
      const client = { request } as unknown as ApiClient;

      const result = await submitCommunityReport(client, {
        targetType: "activity",
        targetId: "act-1",
        reason: "harassment",
        notes: "Offensive comment in shared workout",
        alsoBlock: true,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBe("rep-1");
        expect(result.value.status).toBe("submitted");
      }
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "POST",
          path: "/v1/community/reports",
          body: {
            targetType: "activity",
            targetId: "act-1",
            reason: "harassment",
            notes: "Offensive comment in shared workout",
            alsoBlock: true,
          },
        }),
      );
    });

    it("fetches caller reports via GET /v1/community/reports", async () => {
      const mockReports = [
        {
          id: "rep-1",
          targetType: "profile",
          targetId: "user-bad",
          reason: "spam",
          status: "submitted",
          createdAt: "2026-09-30T10:00:00.000Z",
          updatedAt: "2026-09-30T10:00:00.000Z",
        },
      ];
      const request = vi
        .fn()
        .mockResolvedValue({ ok: true, value: mockReports });
      const client = { request } as unknown as ApiClient;

      const result = await fetchMyCommunityReports(client);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0].reason).toBe("spam");
      }
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "GET",
          path: "/v1/community/reports",
        }),
      );
    });

    it("fetches safety contact via GET /v1/community/safety/contact", async () => {
      const mockContact = {
        contactEmail: "safety@mizyun.com",
        emergencyAdvice:
          "If you or someone else is in immediate danger, contact local emergency services immediately.",
        standardsUrl: "https://mizyun.com/community/standards",
        ordinaryResponseHours: 24,
        urgentResponseHours: 4,
      };
      const request = vi
        .fn()
        .mockResolvedValue({ ok: true, value: mockContact });
      const client = { request } as unknown as ApiClient;

      const result = await fetchSafetyContact(client);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.contactEmail).toBe("safety@mizyun.com");
        expect(result.value.ordinaryResponseHours).toBe(24);
        expect(result.value.urgentResponseHours).toBe(4);
      }
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "GET",
          path: "/v1/community/safety/contact",
        }),
      );
    });

    it("submits moderation appeal via POST /v1/community/appeals", async () => {
      const mockAppeal = {
        id: "app-1",
        reportId: "rep-1",
        appellantUserId: "u-1",
        reason: "My bio was a harmless joke, not an attack",
        status: "pending",
        reviewedBy: null,
        reviewerNotes: null,
        resolvedAt: null,
        createdAt: "2026-09-30T10:00:00.000Z",
      };
      const request = vi
        .fn()
        .mockResolvedValue({ ok: true, value: mockAppeal });
      const client = { request } as unknown as ApiClient;

      const result = await submitModerationAppeal(client, {
        reportId: "rep-1",
        reason: "My bio was a harmless joke, not an attack",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBe("app-1");
        expect(result.value.status).toBe("pending");
      }
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "POST",
          path: "/v1/community/appeals",
          body: {
            reportId: "rep-1",
            reason: "My bio was a harmless joke, not an attack",
          },
        }),
      );
    });

    it("humanizes safety-specific error codes", () => {
      expect(
        humanizeCommunityError({
          kind: "http_error",
          status: 429,
          code: "DAILY_REPORT_LIMIT_EXCEEDED",
          message: "Daily report limit reached",
        }),
      ).toContain("daily reporting limit (10 per day)");

      expect(
        humanizeCommunityError({
          kind: "http_error",
          status: 400,
          code: "CONTENT_SAFETY_VIOLATION",
          message: "Prohibited content detected",
        }),
      ).toContain("violates our community safety standards");

      expect(
        humanizeCommunityError({
          kind: "http_error",
          status: 400,
          code: "INTERACTION_EXPIRED",
          message: "Interaction expired",
        }),
      ).toContain("older than 30 days");
    });
  });
});
