import { afterEach, describe, expect, it, vi } from "vitest";
import type { UserId } from "@mizyun/core";
import { InMemoryCommunityRepository } from "./community-repository.js";

const alice = "00000000-0000-4000-8000-000000000001" as UserId;
const bob = "00000000-0000-4000-8000-000000000002" as UserId;
const publication = {
  sourceWorkoutId: "10000000-0000-4000-8000-000000000001",
  category: "strength" as const,
  sharedDay: "2026-09-29",
  durationSeconds: null,
  enrollmentGeneration: 1,
  operationId: "20000000-0000-4000-8000-000000000001",
};
const enrolled = async () => {
  const repo = new InMemoryCommunityRepository();
  await repo.saveProfile(alice, {
    handle: "alice",
    displayName: "Alice",
    isSearchable: true,
  });
  await repo.saveProfile(bob, {
    handle: "bob",
    displayName: "Bob",
    isSearchable: true,
  });
  return repo;
};

describe("community mutation regressions", () => {
  it("preserves version and timestamp on lost-response publication retry", async () => {
    const repo = await enrolled();
    const first = await repo.publishActivity(alice, publication);
    expect(await repo.publishActivity(alice, publication)).toEqual(first);
  });
  it("cannot resurrect revoked publication by retrying an old operation", async () => {
    const repo = await enrolled();
    const first = await repo.publishActivity(alice, publication);
    await repo.revokeActivity(first.id, alice);
    await expect(repo.publishActivity(alice, publication)).rejects.toThrow();
    expect((await repo.getActivityById(first.id))?.revokedAt).not.toBeNull();
  });
  it("rejects a stale sharing confirmation after withdrawal and re-enrollment", async () => {
    const repo = await enrolled();
    await repo.withdrawProfile(alice);
    await repo.saveProfile(alice, {
      handle: "alice",
      displayName: "Alice",
      isSearchable: true,
    });
    await expect(repo.publishActivity(alice, publication)).rejects.toThrow();
  });
  it("makes duplicate concurrent follow requests one edge", async () => {
    const repo = await enrolled();
    const [first, retry] = await Promise.all([
      repo.sendFollowRequest(alice, bob),
      repo.sendFollowRequest(alice, bob),
    ]);
    expect(first.id).toBe(retry.id);
    expect(await repo.getOutgoingFollowRequests(alice)).toHaveLength(1);
  });
  it("enforces cooldown after cancellation at repository boundary", async () => {
    const repo = await enrolled();
    const relationship = await repo.sendFollowRequest(alice, bob);
    await repo.updateRelationshipStatus(relationship.id, alice, "canceled");
    await expect(repo.sendFollowRequest(alice, bob)).rejects.toThrow();
  });
  it("invalidates old invites across withdrawal and re-enrollment", async () => {
    const repo = await enrolled();
    const invitation = await repo.createInvitation(alice);
    await repo.withdrawProfile(alice);
    await repo.saveProfile(alice, {
      handle: "alice",
      displayName: "Alice",
      isSearchable: true,
    });
    expect(
      (await repo.getInvitationByToken(invitation.token))?.revokedAt,
    ).not.toBeNull();
  });
  it("does not allow the sender to approve their own request", async () => {
    const repo = await enrolled();
    const relationship = await repo.sendFollowRequest(alice, bob);
    await expect(
      repo.updateRelationshipStatus(relationship.id, alice, "approved"),
    ).rejects.toThrow();
  });

  it("enforces invitation quotas when concurrent requests bypass route prechecks", async () => {
    const repo = await enrolled();
    const results = await Promise.allSettled(
      Array.from({ length: 21 }, () => repo.createInvitation(alice)),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(20);
    expect(await repo.listInvitations(alice)).toHaveLength(20);
  });
  it("does not reuse an operation ID for a changed sharing payload", async () => {
    const repo = await enrolled();
    await repo.publishActivity(alice, publication);
    await expect(
      repo.publishActivity(alice, { ...publication, category: "running" }),
    ).rejects.toThrow();
  });
  it("blocking is idempotent and cannot restore edges when unblocked", async () => {
    const repo = await enrolled();
    const relationship = await repo.sendFollowRequest(alice, bob);
    await repo.updateRelationshipStatus(relationship.id, bob, "approved");
    const block = await repo.blockUser(alice, bob);
    expect((await repo.blockUser(alice, bob)).id).toBe(block.id);
    await repo.withdrawProfile(alice);
    await repo.saveProfile(alice, {
      handle: "alice",
      displayName: "Alice",
      isSearchable: true,
    });
    expect(await repo.isBlockedBilateral(alice, bob)).toBe(true);
    await repo.unblockUser(alice, bob);
    expect(await repo.getRelationship(alice, bob)).toBeNull();
  });

  it("invalidates a prior operation after editing its confirmed publication snapshot", async () => {
    const repo = await enrolled();
    const first = await repo.publishActivity(alice, {
      ...publication,
      durationSeconds: 1200,
    });
    const unchanged = await repo.updateActivity(first.id, alice, {
      durationSeconds: 1200,
    });
    expect(unchanged.version).toBe(1);
    const edited = await repo.updateActivity(first.id, alice, {
      durationSeconds: null,
    });
    expect(edited.version).toBe(2);
    await expect(
      repo.publishActivity(alice, { ...publication, durationSeconds: 1200 }),
    ).rejects.toThrow();
  });

  it("requires a live invitation from the exact hidden follow target", async () => {
    const repo = await enrolled();
    await repo.saveProfile(bob, {
      handle: "bob",
      displayName: "Bob",
      isSearchable: false,
    });
    await expect(repo.sendFollowRequest(alice, bob)).rejects.toThrow();
    const foreign = await repo.createInvitation(alice);
    await expect(
      repo.sendFollowRequest(alice, bob, { invitationToken: foreign.token }),
    ).rejects.toThrow();
    const invitation = await repo.createInvitation(bob);
    const requested = await repo.sendFollowRequest(alice, bob, {
      invitationToken: invitation.token,
    });
    expect(requested.status).toBe("pending");
    expect(requested.targetUserId).toBe(bob);
  });
  it("limits rolling daily invitation creation even after links are revoked", async () => {
    const repo = await enrolled();
    for (let index = 0; index < 20; index += 1) {
      const invitation = await repo.createInvitation(alice);
      await repo.revokeInvitation(invitation.id, alice);
    }
    await expect(repo.createInvitation(alice)).rejects.toThrow();
  });

  it("keeps an existing handle reserved across withdrawal", async () => {
    const repo = await enrolled();
    await repo.withdrawProfile(alice);
    await expect(
      repo.saveProfile(alice, {
        handle: "different_handle",
        displayName: "Alice",
        isSearchable: true,
      }),
    ).rejects.toThrow();
    await expect(
      repo.saveProfile(bob, {
        handle: "alice",
        displayName: "Bob",
        isSearchable: true,
      }),
    ).rejects.toThrow();
  });

  it("reports own existing handle as available but reserves others after withdrawal", async () => {
    const repo = await enrolled();
    expect(await repo.isHandleAvailable(" ALICE ", alice)).toBe(true);
    expect(await repo.isHandleAvailable("alice", bob)).toBe(false);
    await repo.withdrawProfile(alice);
    expect(await repo.isHandleAvailable("alice", bob)).toBe(false);
    expect(await repo.isHandleAvailable("unused", bob)).toBe(true);
  });
});

describe("COMM-04 relationship operations", () => {
  afterEach(() => vi.useRealTimers());
  it("keeps an old request retry terminal after cancellation and a new request incarnation", async () => {
    vi.useFakeTimers();
    const repo = await enrolled();
    const options = {
      accessToken: "test",
      operationId: "e1430000-0000-4000-8000-000000000001",
    };
    const first = await repo.sendFollowRequest(alice, bob, options);
    await repo.updateRelationshipStatus(first.id, alice, "canceled");
    expect((await repo.sendFollowRequest(alice, bob, options)).status).toBe(
      "canceled",
    );
    await expect(
      repo.sendFollowRequest(alice, bob, {
        ...options,
        operationId: "e1430000-0000-4000-8000-000000000002",
      }),
    ).rejects.toThrow();
    vi.setSystemTime(Date.now() + 49 * 3600000);
    const renewed = await repo.sendFollowRequest(alice, bob, {
      ...options,
      operationId: "e1430000-0000-4000-8000-000000000002",
    });
    expect(renewed.id).not.toBe(first.id);
    await expect(
      repo.updateRelationshipStatus(first.id, bob, "approved"),
    ).rejects.toThrow();
    await expect(repo.sendFollowRequest(alice, bob, options)).rejects.toThrow();
    await repo.updateRelationshipStatus(renewed.id, bob, "approved");
    await repo.unfollow(alice, bob, {
      accessToken: "test",
      relationshipId: first.id,
    });
    await repo.removeFollower(bob, alice, {
      accessToken: "test",
      relationshipId: first.id,
    });
    expect((await repo.getRelationship(alice, bob))?.id).toBe(renewed.id);
  });
  it("keeps follow-request rate history after unfollow", async () => {
    const repo = await enrolled();
    for (let i = 0; i < 10; i++) {
      const user =
        `c1430000-0000-4000-8000-${String(i).padStart(12, "0")}` as UserId;
      await repo.saveProfile(user, {
        handle: `friend_${i}`,
        displayName: "Friend",
        isSearchable: true,
      });
      const request = await repo.sendFollowRequest(alice, user);
      await repo.updateRelationshipStatus(request.id, user, "approved");
      await repo.unfollow(alice, user);
    }
    await expect(repo.sendFollowRequest(alice, bob)).rejects.toThrow(
      "rate_limited",
    );
  });
  it("mute suppresses feed cards while preserving the approved audience", async () => {
    const repo = await enrolled();
    const request = await repo.sendFollowRequest(bob, alice);
    await repo.updateRelationshipStatus(request.id, alice, "approved");
    const card = await repo.publishActivity(alice, publication);
    expect((await repo.getFeed(bob)).items).toHaveLength(1);
    await repo.setMuted(bob, alice, true);
    expect((await repo.getFeed(bob)).items).toHaveLength(0);
    expect((await repo.getActivityById(card.id))?.id).toBe(card.id);
    expect((await repo.getRelationship(bob, alice))?.status).toBe("approved");
    expect(await repo.getMutedUsers(alice)).toHaveLength(0);
    await repo.setMuted(bob, alice, false);
    expect((await repo.getFeed(bob)).items).toHaveLength(1);
  });
});

describe("COMM-04 UTC daily limits and durable cooldown", () => {
  afterEach(() => vi.useRealTimers());
  it("starts a fresh daily allowance at UTC midnight while preserving rolling minute limits", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-29T23:40:00Z"));
    const repo = await enrolled();
    for (let i = 0; i < 50; i++) {
      if (i % 10 === 0) vi.setSystemTime(Date.now() + 120000);
      const friend =
        `c1430000-0000-4000-8000-${String(i + 100).padStart(12, "0")}` as UserId;
      await repo.saveProfile(friend, {
        handle: `rollover_${i}`,
        displayName: "Synthetic friend",
        isSearchable: true,
      });
      const rel = await repo.sendFollowRequest(alice, friend);
      await repo.updateRelationshipStatus(rel.id, friend, "approved");
      await repo.unfollow(alice, friend);
    }
    vi.setSystemTime(new Date("2026-09-29T23:59:00Z"));
    await expect(repo.sendFollowRequest(alice, bob)).rejects.toThrow(
      "rate_limited",
    );
    vi.setSystemTime(new Date("2026-09-30T00:00:00Z"));
    expect((await repo.sendFollowRequest(alice, bob)).status).toBe("pending");
  });
  it("keeps declined/canceled cooldown after block removes the live request", async () => {
    const repo = await enrolled();
    const rel = await repo.sendFollowRequest(alice, bob);
    await repo.updateRelationshipStatus(rel.id, alice, "canceled");
    await repo.blockUser(alice, bob);
    await repo.unblockUser(alice, bob);
    expect(await repo.getRelationship(alice, bob)).toBeNull();
    await expect(repo.sendFollowRequest(alice, bob)).rejects.toThrow(
      "rate_limited",
    );
  });
});
