import { describe, expect, it, vi } from "vitest";
import { CommunityMutationError, type UserId } from "@mizyun/core";
import type { RepositorySupabaseClient } from "./index.js";
import {
  SupabaseCommunityRepository,
  communityBlockFromRow,
  communityInvitationFromRow,
  communityProfileFromRow,
  communityReportFromRow,
  followRelationshipFromRow,
  sharedActivityFromRow,
  type CommunityBlockRow,
  type CommunityInvitationRow,
  type CommunityProfileRow,
  type CommunityRelationshipRow,
  type CommunityReportRow,
  type SharedActivityRow,
} from "./community-repository";

describe("Community repository row mappers", () => {
  it("maps CommunityProfileRow to StoredCommunityProfile", () => {
    const row: CommunityProfileRow = {
      user_id: "c0000000-0000-4000-8000-000000000001",
      handle: "alex_runner",
      display_name: "Alex Runner",
      avatar_symbol: "AR",
      bio: "Runner and lifter",
      is_searchable: true,
      status: "active",
      generation: 1,
      created_at: "2026-09-29T12:00:00.000Z",
      updated_at: "2026-09-29T12:00:00.000Z",
    };

    const entity = communityProfileFromRow(row);
    expect(entity.userId).toBe(row.user_id as UserId);
    expect(entity.handle).toBe("alex_runner");
    expect(entity.displayName).toBe("Alex Runner");
    expect(entity.avatarSymbol).toBe("AR");
    expect(entity.bio).toBe("Runner and lifter");
    expect(entity.isSearchable).toBe(true);
    expect(entity.status).toBe("active");
    expect(entity.generation).toBe(1);
    expect(entity.createdAt).toBeInstanceOf(Date);
  });

  it("maps CommunityRelationshipRow to StoredFollowRelationship", () => {
    const row: CommunityRelationshipRow = {
      id: "a0000000-0000-4000-8000-000000000001",
      follower_user_id: "c0000000-0000-4000-8000-000000000001",
      target_user_id: "c0000000-0000-4000-8000-000000000002",
      status: "approved",
      created_at: "2026-09-29T12:00:00.000Z",
      updated_at: "2026-09-29T12:05:00.000Z",
    };

    const entity = followRelationshipFromRow(row);
    expect(entity.id).toBe(row.id);
    expect(entity.followerUserId).toBe(row.follower_user_id as UserId);
    expect(entity.targetUserId).toBe(row.target_user_id as UserId);
    expect(entity.status).toBe("approved");
    expect(entity.createdAt).toBeInstanceOf(Date);
  });

  it("maps CommunityBlockRow to StoredCommunityBlock", () => {
    const row: CommunityBlockRow = {
      id: "b0000000-0000-4000-8000-000000000001",
      blocker_user_id: "c0000000-0000-4000-8000-000000000001",
      blocked_user_id: "c0000000-0000-4000-8000-000000000004",
      created_at: "2026-09-29T12:00:00.000Z",
    };

    const entity = communityBlockFromRow(row);
    expect(entity.id).toBe(row.id);
    expect(entity.blockerUserId).toBe(row.blocker_user_id as UserId);
    expect(entity.blockedUserId).toBe(row.blocked_user_id as UserId);
    expect(entity.createdAt).toBeInstanceOf(Date);
  });

  it("maps SharedActivityRow to StoredSharedActivity", () => {
    const row: SharedActivityRow = {
      id: "f0000000-0000-4000-8000-000000000001",
      user_id: "c0000000-0000-4000-8000-000000000001",
      source_workout_id: "d0000000-0000-4000-8000-000000000001",
      category: "strength",
      shared_day: "2026-09-29",
      duration_seconds: 3600,
      version: 1,
      published_at: "2026-09-29T14:00:00.000Z",
      revoked_at: null,
    };

    const entity = sharedActivityFromRow(row);
    expect(entity.id).toBe(row.id);
    expect(entity.category).toBe("strength");
    expect(entity.durationSeconds).toBe(3600);
    expect(entity.revokedAt).toBeNull();
  });

  it("maps CommunityReportRow to StoredCommunityReport", () => {
    const row: CommunityReportRow = {
      id: "r0000000-0000-4000-8000-000000000001",
      reporter_user_id: "c0000000-0000-4000-8000-000000000001",
      target_type: "profile",
      target_id: "c0000000-0000-4000-8000-000000000004",
      reason: "harassment",
      notes: "Unwanted contact",
      status: "submitted",
      created_at: "2026-09-29T15:00:00.000Z",
      updated_at: "2026-09-29T15:00:00.000Z",
    };

    const entity = communityReportFromRow(row);
    expect(entity.id).toBe(row.id);
    expect(entity.reason).toBe("harassment");
    expect(entity.status).toBe("submitted");
  });

  it("maps CommunityInvitationRow to StoredCommunityInvitation", () => {
    const row: CommunityInvitationRow = {
      id: "inv-0000-4000-8000-000000000001",
      token: "secure-token-123456",
      inviter_user_id: "c0000000-0000-4000-8000-000000000001",
      expires_at: "2026-10-06T12:00:00.000Z",
      revoked_at: null,
      created_at: "2026-09-29T12:00:00.000Z",
    };

    const entity = communityInvitationFromRow(row);
    expect(entity.id).toBe(row.id);
    expect(entity.token).toBe("secure-token-123456");
    expect(entity.inviterUserId).toBe(
      "c0000000-0000-4000-8000-000000000001" as UserId,
    );
    expect(entity.expiresAt).toBeInstanceOf(Date);
    expect(entity.revokedAt).toBeNull();
    expect(entity.createdAt).toBeInstanceOf(Date);
  });
});

const callerId = "c0000000-0000-4000-8000-000000000001" as UserId;
const otherId = "c0000000-0000-4000-8000-000000000002" as UserId;
const callerToken = "verified-caller-token";
const profileRow: CommunityProfileRow = {
  user_id: callerId,
  handle: "alex_runner",
  display_name: "Alex Runner",
  avatar_symbol: "AR",
  bio: null,
  is_searchable: true,
  status: "active",
  generation: 3,
  created_at: "2026-09-30T10:00:00.000Z",
  updated_at: "2026-09-30T10:00:00.000Z",
};
const activityRow: SharedActivityRow = {
  id: "f0000000-0000-4000-8000-000000000001",
  user_id: callerId,
  source_workout_id: "d0000000-0000-4000-8000-000000000001",
  category: "strength",
  shared_day: "2026-09-30",
  duration_seconds: 1800,
  version: 2,
  published_at: "2026-09-30T10:00:00.000Z",
  revoked_at: null,
};

const rpcRepository = (
  responses: Record<
    string,
    {
      data: readonly Record<string, unknown>[] | null;
      error: { code?: string; message: string } | null;
    }
  >,
) => {
  const rpc = vi.fn(async (name: string, _args: Record<string, unknown>) => {
    if (!(name in responses)) throw new Error(`Unexpected RPC ${name}`);
    return responses[name];
  });
  const from = vi.fn(() => {
    throw new Error("This operation must not use direct table access");
  });
  const client = { rpc, from } as unknown as RepositorySupabaseClient;
  const clientFor = vi.fn(() => client);
  const repository = new SupabaseCommunityRepository({ clientFor });
  return { repository, clientFor, rpc, from };
};

describe("Community database operation boundaries", () => {
  it.each([true, false])(
    "returns handle availability %s without resolving a hidden profile",
    async (available) => {
      const { repository, rpc, from, clientFor } = rpcRepository({
        community_handle_available: { data: [{ available }], error: null },
      });
      expect(
        await repository.isHandleAvailable(" ALEX_RUNNER ", callerId, {
          accessToken: callerToken,
        }),
      ).toBe(available);
      expect(rpc).toHaveBeenCalledExactlyOnceWith(
        "community_handle_available",
        { p_handle: "alex_runner" },
      );
      expect(clientFor).toHaveBeenCalledWith(callerToken);
      expect(from).not.toHaveBeenCalled();
    },
  );

  it("does not report a handle available when database returns no decision", async () => {
    const { repository } = rpcRepository({
      community_handle_available: { data: [], error: null },
    });
    await expect(
      repository.isHandleAvailable("alex_runner", callerId, {
        accessToken: callerToken,
      }),
    ).rejects.toThrow("Failed to check community handle availability");
  });

  it.each(["pending", "approved", "declined", "canceled", null] as const)(
    "unfollow preserves the cooldown boundary for %s relationships",
    async (status) => {
      const relationship: CommunityRelationshipRow = {
        id: "a0000000-0000-4000-8000-000000000001",
        follower_user_id: callerId,
        target_user_id: otherId,
        status: status ?? "pending",
        created_at: "2026-09-30T10:00:00.000Z",
        updated_at: "2026-09-30T10:00:00.000Z",
      };
      const builder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        delete: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: status === null ? null : relationship,
          error: null,
        }),
        single: vi.fn().mockResolvedValue({
          data: { ...relationship, status: "canceled" },
          error: null,
        }),
        then: (resolve: (result: { data: unknown[]; error: null }) => void) =>
          resolve({ data: [], error: null }),
      };
      const from = vi.fn(() => builder);
      const repository = new SupabaseCommunityRepository({
        clientFor: () => ({ from }) as unknown as RepositorySupabaseClient,
      });
      await repository.unfollow(callerId, otherId, {
        accessToken: callerToken,
      });
      if (status === "pending") {
        expect(builder.update).toHaveBeenCalledOnce();
        expect(builder.update.mock.calls[0]?.[0]).toMatchObject({
          status: "canceled",
        });
        expect(builder.delete).not.toHaveBeenCalled();
      } else if (status === "approved") {
        expect(builder.delete).toHaveBeenCalledOnce();
        expect(builder.update).not.toHaveBeenCalled();
      } else {
        expect(builder.delete).not.toHaveBeenCalled();
        expect(builder.update).not.toHaveBeenCalled();
      }
      expect(builder.eq).toHaveBeenCalledWith("follower_user_id", callerId);
      expect(builder.eq).toHaveBeenCalledWith("target_user_id", otherId);
    },
  );

  it("forwards an explicitly shared invitation when requesting a hidden profile", async () => {
    const relationship: CommunityRelationshipRow = {
      id: "a0000000-0000-4000-8000-000000000001",
      follower_user_id: callerId,
      target_user_id: otherId,
      status: "pending",
      created_at: "2026-09-30T10:00:00.000Z",
      updated_at: "2026-09-30T10:00:00.000Z",
    };
    const { repository, rpc, from } = rpcRepository({
      community_request_follow: { data: [relationship], error: null },
    });
    await repository.sendFollowRequest(callerId, otherId, {
      accessToken: callerToken,
      operationId: "e1430000-0000-4000-8000-000000000001",
      invitationToken: "deliberately-shared-profile-token",
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("community_request_follow", {
      p_target_user_id: otherId,
      p_operation_id: "e1430000-0000-4000-8000-000000000001",
      p_invitation_token: "deliberately-shared-profile-token",
    });
    expect(from).not.toHaveBeenCalled();
  });

  it("does not infer an invitation capability for normal follow requests", async () => {
    const relationship: CommunityRelationshipRow = {
      id: "a0000000-0000-4000-8000-000000000001",
      follower_user_id: callerId,
      target_user_id: otherId,
      status: "pending",
      created_at: "2026-09-30T10:00:00.000Z",
      updated_at: "2026-09-30T10:00:00.000Z",
    };
    const { repository, rpc } = rpcRepository({
      community_request_follow: { data: [relationship], error: null },
    });
    await repository.sendFollowRequest(callerId, otherId, {
      accessToken: callerToken,
      operationId: "e1430000-0000-4000-8000-000000000001",
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("community_request_follow", {
      p_target_user_id: otherId,
      p_operation_id: "e1430000-0000-4000-8000-000000000001",
      p_invitation_token: null,
    });
  });

  it("propagates atomic withdrawal failure instead of reporting partial cleanup as success", async () => {
    const { repository, rpc, from, clientFor } = rpcRepository({
      community_withdraw_profile: {
        data: null,
        error: { message: "Cleanup transaction failed" },
      },
    });
    await expect(
      repository.withdrawProfile(callerId, { accessToken: callerToken }),
    ).rejects.toThrow("Community data operation failed");
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "community_withdraw_profile",
      {},
    );
    expect(clientFor).toHaveBeenCalledWith(callerToken);
    expect(from).not.toHaveBeenCalled();
  });

  it("leaves enrollment generation and sanction transitions to the database", async () => {
    const { repository, rpc, from } = rpcRepository({
      community_save_profile: { data: [profileRow], error: null },
    });
    const profile = await repository.saveProfile(
      callerId,
      { handle: " ALEX_RUNNER ", displayName: " Alex Runner " },
      { accessToken: callerToken },
    );
    expect(profile.generation).toBe(3);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("community_save_profile", {
      p_handle: "alex_runner",
      p_display_name: "Alex Runner",
      p_avatar_symbol: "AR",
      p_bio: null,
      p_is_searchable: false,
      p_adult_declaration: null,
      p_terms_version: null,
    });
    expect(from).not.toHaveBeenCalled();
  });

  it("detects an incoming block without a caller-filtered raw table lookup", async () => {
    const { repository, rpc, from } = rpcRepository({
      community_is_unavailable: {
        data: [{ is_unavailable: true }],
        error: null,
      },
    });
    expect(
      await repository.isBlockedBilateral(callerId, otherId, {
        accessToken: callerToken,
      }),
    ).toBe(true);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("community_is_unavailable", {
      p_other_user_id: otherId,
    });
    expect(from).not.toHaveBeenCalled();
  });

  it("fails closed when the block RPC does not return a decision", async () => {
    const { repository } = rpcRepository({
      community_is_unavailable: { data: [], error: null },
    });
    await expect(
      repository.isBlockedBilateral(callerId, otherId, {
        accessToken: callerToken,
      }),
    ).rejects.toThrow("Failed to check community availability");
  });

  it("resolves a non-searchable invitation through its token authorization boundary", async () => {
    const invitation: CommunityInvitationRow = {
      id: "e0000000-0000-4000-8000-000000000001",
      token: "known-owner-shared-token",
      inviter_user_id: otherId,
      expires_at: "2026-10-01T10:00:00.000Z",
      revoked_at: null,
      created_at: "2026-09-30T10:00:00.000Z",
    };
    const inviter = {
      ...profileRow,
      user_id: otherId,
      is_searchable: false,
      bio: null,
    };
    const { repository, rpc, from } = rpcRepository({
      community_resolve_invitation: {
        data: [{ invitation, inviter }],
        error: null,
      },
    });
    const resolved = await repository.getInvitationByToken(invitation.token, {
      accessToken: callerToken,
    });
    const profile = await repository.getInvitationProfile(invitation.token, {
      accessToken: callerToken,
    });
    expect(resolved?.inviterUserId).toBe(otherId);
    expect(profile?.userId).toBe(otherId);
    expect(profile?.isSearchable).toBe(false);
    expect(profile?.bio).toBeNull();
    expect(rpc).toHaveBeenCalledWith("community_resolve_invitation", {
      p_token: invitation.token,
    });
    expect(from).not.toHaveBeenCalled();
  });

  it("does not recover a revoked invitation by falling back to raw token rows", async () => {
    const { repository, from } = rpcRepository({
      community_resolve_invitation: { data: [], error: null },
    });
    expect(
      await repository.getInvitationByToken("revoked-token", {
        accessToken: callerToken,
      }),
    ).toBeNull();
    expect(
      await repository.getInvitationProfile("revoked-token", {
        accessToken: callerToken,
      }),
    ).toBeNull();
    expect(from).not.toHaveBeenCalled();
  });

  it("uses exact handle lookup instead of exposing a raw searchable directory", async () => {
    const { repository, rpc, from } = rpcRepository({
      community_profile_by_handle: {
        data: [{ ...profileRow, user_id: otherId }],
        error: null,
      },
    });
    const profiles = await repository.searchProfiles(
      " @ALEX_RUNNER ",
      callerId,
      {
        accessToken: callerToken,
      },
    );
    expect(profiles).toHaveLength(1);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("community_profile_by_handle", {
      p_handle: "alex_runner",
    });
    expect(from).not.toHaveBeenCalled();
  });

  it("publishes using the preview generation and stable operation ID in one atomic call", async () => {
    const { repository, rpc, from } = rpcRepository({
      community_publish_activity: { data: [activityRow], error: null },
    });
    const publication = {
      sourceWorkoutId: activityRow.source_workout_id,
      category: "strength" as const,
      sharedDay: activityRow.shared_day,
      durationSeconds: activityRow.duration_seconds,
      enrollmentGeneration: 3,
      expectedVersion: 4,
      expectedRevoked: true,
      operationId: "a0000000-0000-4000-8000-000000000001",
    };
    await repository.publishActivity(callerId, publication, {
      accessToken: callerToken,
    });
    await repository.publishActivity(callerId, publication, {
      accessToken: callerToken,
    });
    expect(rpc).toHaveBeenNthCalledWith(1, "community_publish_activity", {
      p_source_workout_id: activityRow.source_workout_id,
      p_category: "strength",
      p_shared_day: activityRow.shared_day,
      p_duration_seconds: activityRow.duration_seconds,
      p_enrollment_generation: 3,
      p_operation_id: publication.operationId,
      p_expected_version: publication.expectedVersion,
      p_expected_revoked: publication.expectedRevoked,
    });
    expect(rpc.mock.calls[1]).toEqual(rpc.mock.calls[0]);
    expect(from).not.toHaveBeenCalled();
  });

  it("does not delete reactions before a failed atomic publication", async () => {
    const { repository, from } = rpcRepository({
      community_publish_activity: {
        data: [],
        error: { code: "P0001", message: "community_conflict" },
      },
    });
    await expect(
      repository.publishActivity(
        callerId,
        {
          sourceWorkoutId: activityRow.source_workout_id,
          category: "strength",
          sharedDay: activityRow.shared_day,
          durationSeconds: null,
          enrollmentGeneration: 2,
          operationId: "a0000000-0000-4000-8000-000000000001",
        },
        { accessToken: callerToken },
      ),
    ).rejects.toMatchObject({
      name: "CommunityMutationError",
      code: "conflict",
    });
    expect(from).not.toHaveBeenCalled();
  });

  it.each([
    ["community_conflict", "conflict"],
    ["community_rate_limited", "rate_limited"],
    ["community_unavailable", "unavailable"],
    ["community_handle_taken", "handle_taken"],
  ] as const)(
    "maps trusted SQL rejection %s to a shared neutral error",
    async (message, code) => {
      const { repository } = rpcRepository({
        community_save_profile: { data: [], error: { code: "P0001", message } },
      });
      await expect(
        repository.saveProfile(
          callerId,
          { handle: "alex_runner", displayName: "Alex Runner" },
          { accessToken: callerToken },
        ),
      ).rejects.toEqual(new CommunityMutationError(code));
    },
  );

  it.each([
    { code: "23505", message: "private-user-row: sensitive value" },
    { code: "P0001", message: "community_conflict: private-user-row" },
    { code: "42501", message: "community_conflict" },
  ])(
    "sanitizes unknown database errors instead of leaking backend details",
    async (error) => {
      const { repository } = rpcRepository({
        community_save_profile: { data: [], error },
      });
      await expect(
        repository.saveProfile(
          callerId,
          { handle: "alex_runner", displayName: "Alex Runner" },
          { accessToken: callerToken },
        ),
      ).rejects.toMatchObject({
        name: "RepositoryError",
        message: "Community data operation failed",
      });
    },
  );

  it("retains blocked identities when targets are no longer discoverable", async () => {
    const block: CommunityBlockRow = {
      id: "b0000000-0000-4000-8000-000000000001",
      blocker_user_id: callerId,
      blocked_user_id: otherId,
      created_at: "2026-09-30T10:00:00.000Z",
    };
    const response = Promise.resolve({ data: [block], error: null });
    const builder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnValue(response),
    };
    const rpc = vi.fn(() => {
      throw new Error("Blocked list must not request hidden live profile");
    });
    const from = vi.fn(() => builder);
    const repository = new SupabaseCommunityRepository({
      clientFor: () => ({ from, rpc }) as unknown as RepositorySupabaseClient,
    });
    const blocks = await repository.getBlockedUsers(callerId, {
      accessToken: callerToken,
    });
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.block.blockedUserId).toBe(otherId);
    expect(blocks[0]?.profile.userId).toBe(otherId);
    expect(blocks[0]?.profile.displayName).toBe("User unavailable");
    expect(blocks[0]?.profile.bio).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("recovers a committed block after a lost response without repeating cleanup or overwriting it", async () => {
    const block: CommunityBlockRow = {
      id: "b0000000-0000-4000-8000-000000000001",
      blocker_user_id: callerId,
      blocked_user_id: otherId,
      created_at: "2026-09-30T10:00:00.000Z",
    };
    const builder = {
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: null,
        error: { code: "23505", message: "private constraint details" },
      }),
      maybeSingle: vi.fn().mockResolvedValue({ data: block, error: null }),
    };
    const from = vi.fn(() => builder);
    const repository = new SupabaseCommunityRepository({
      clientFor: () => ({ from }) as unknown as RepositorySupabaseClient,
    });
    const result = await repository.blockUser(callerId, otherId, {
      accessToken: callerToken,
    });
    expect(result.id).toBe(block.id);
    expect(result.createdAt.toISOString()).toBe(block.created_at);
    expect(builder.insert).toHaveBeenCalledTimes(1);
    expect(builder.eq).toHaveBeenCalledWith("blocker_user_id", callerId);
    expect(builder.eq).toHaveBeenCalledWith("blocked_user_id", otherId);
    expect(from.mock.calls).toEqual([
      ["community_blocks"],
      ["community_blocks"],
    ]);
  });

  it("passes both time and identity when paging equal-time feed records", async () => {
    const { repository, rpc } = rpcRepository({
      community_feed: { data: [activityRow], error: null },
    });
    const page = await repository.getFeed(callerId, {
      accessToken: callerToken,
      limit: 1,
    });
    if (!page.nextCursor) throw new Error("Expected a full-page cursor");
    await repository.getFeed(callerId, {
      accessToken: callerToken,
      limit: 1,
      beforeCursor: page.nextCursor,
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "community_feed", {
      p_limit: 1,
      p_before_time: activityRow.published_at,
      p_before_id: activityRow.id,
    });
  });

  it("rejects malformed feed cursor before database access", async () => {
    const { repository, rpc } = rpcRepository({});
    await expect(
      repository.getFeed(callerId, {
        accessToken: callerToken,
        beforeCursor: "2026-09-30T10:00:00Z|not-a-uuid",
      }),
    ).rejects.toThrow("Invalid community feed cursor");
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("Moderation transport authority", () => {
  it("uses an atomic RPC and never forwards caller-supplied staff identity", async () => {
    const row = {
      id: "report",
      reporter_user_id: callerId,
      target_type: "profile",
      target_id: otherId,
      reason: "harassment",
      notes: null,
      status: "resolved",
      created_at: "2026-09-30T00:00:00Z",
      updated_at: "2026-09-30T00:00:00Z",
    };
    const { repository, rpc, from } = rpcRepository({
      community_apply_moderation_action: { data: [row], error: null },
    });
    await repository.applyModerationAction(
      "report",
      {
        decision: "suspend",
        decisionReason: "Harassment",
        staffOperator: "forged",
        suspensionDurationDays: 3,
      },
      { accessToken: callerToken },
    );
    expect(rpc).toHaveBeenCalledWith("community_apply_moderation_action", {
      p_report_id: "report",
      p_decision: "suspend",
      p_decision_reason: "Harassment",
      p_staff_notes: null,
      p_suspension_duration_days: 3,
    });
    expect(from).not.toHaveBeenCalled();
  });
  it("forwards an opaque receipt and keeps urgency authoritative in SQL", async () => {
    const row = {
      id: "report",
      reporter_user_id: callerId,
      target_type: "profile",
      target_id: otherId,
      reason: "harassment",
      notes: "quoted evidence",
      status: "submitted",
      created_at: "2026-09-30T00:00:00Z",
      updated_at: "2026-09-30T00:00:00Z",
    };
    const { repository, rpc } = rpcRepository({
      community_submit_report: { data: [row], error: null },
    });
    await repository.createReport(
      callerId,
      {
        targetType: "profile",
        targetId: otherId,
        reason: "harassment",
        notes: "quoted evidence",
        priority: "urgent",
        interactionReceiptId: "receipt",
      },
      { accessToken: callerToken },
    );
    expect(rpc).toHaveBeenCalledWith("community_submit_report", {
      p_target_type: "profile",
      p_target_id: otherId,
      p_reason: "harassment",
      p_notes: "quoted evidence",
      p_interaction_receipt_id: "receipt",
    });
  });
});
