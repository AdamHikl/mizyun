import crypto from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { UserId } from "@mizyun/core";
import type { AccessTokenVerifier } from "@mizyun/identity";

import { buildApp } from "../../app.js";
import { InMemoryProfileRepository } from "../../profile-repository.js";
import { InMemoryCommunityRepository } from "../../community-repository.js";

const userAlice: UserId = "00000000-0000-4000-8000-000000000001" as UserId;
const userBob: UserId = "00000000-0000-4000-8000-000000000002" as UserId;
const userEve: UserId = "00000000-0000-4000-8000-000000000003" as UserId;

const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

const tokenVerifierFor = (): AccessTokenVerifier => ({
  verify: async (token) => {
    if (token === "token-alice") {
      return {
        userId: userAlice,
        role: "authenticated",
        accessToken: "token-alice",
      };
    }
    if (token === "token-bob") {
      return {
        userId: userBob,
        role: "authenticated",
        accessToken: "token-bob",
      };
    }
    if (token === "token-eve") {
      return {
        userId: userEve,
        role: "authenticated",
        accessToken: "token-eve",
      };
    }
    return null;
  },
});

const setupTestApp = async () => {
  const profileRepository = new InMemoryProfileRepository({
    defaultTimezone: "UTC",
    defaultUnitSystem: "metric",
    defaultBirthYear: 1990,
  });

  const now = new Date();
  await profileRepository.getOrCreate(userAlice, {
    now,
    accessToken: "token-alice",
  });
  await profileRepository.getOrCreate(userBob, {
    now,
    accessToken: "token-bob",
  });
  await profileRepository.getOrCreate(userEve, {
    now,
    accessToken: "token-eve",
  });

  const communityRepository = new InMemoryCommunityRepository();

  // Enroll Alice and Bob
  await communityRepository.saveProfile(
    userAlice,
    { handle: "alice_fit", displayName: "Alice", isSearchable: true },
    { accessToken: "token-alice" },
  );

  await communityRepository.saveProfile(
    userBob,
    { handle: "bob_lift", displayName: "Bob", isSearchable: true },
    { accessToken: "token-bob" },
  );

  const app = buildApp({
    communityOperations: {
      browsing: true,
      enrollment: true,
      discovery: true,
      publish: true,
      engagement: true,
      delivery: false,
    },
    tokenVerifier: tokenVerifierFor(),
    profileRepository,
    communityRepository,
  });

  apps.push(app);
  return { app, profileRepository, communityRepository };
};

describe("Community Relationship Routes", () => {
  it("allows sending follow request and prevents duplicate/self requests", async () => {
    const { app } = await setupTestApp();

    // Self-follow rejected
    const selfRes = await app.inject({
      method: "POST",
      url: "/v1/community/relationships/follow",
      headers: { authorization: "Bearer token-alice" },
      payload: { operationId: crypto.randomUUID(), targetUserId: userAlice },
    });
    expect(selfRes.statusCode).toBe(400);

    // Valid follow request from Alice to Bob
    const followRes = await app.inject({
      method: "POST",
      url: "/v1/community/relationships/follow",
      headers: { authorization: "Bearer token-alice" },
      payload: { operationId: crypto.randomUUID(), targetUserId: userBob },
    });
    expect(followRes.statusCode).toBe(201);
    const body = followRes.json();
    expect(body.followerUserId).toBe(userAlice);
    expect(body.targetUserId).toBe(userBob);
    expect(body.status).toBe("pending");

    // Lost-response retry returns the same pending edge
    const dupRes = await app.inject({
      method: "POST",
      url: "/v1/community/relationships/follow",
      headers: { authorization: "Bearer token-alice" },
      payload: { operationId: crypto.randomUUID(), targetUserId: userBob },
    });
    expect(dupRes.statusCode).toBe(200);
    expect(dupRes.json().id).toBe(followRes.json().id);
  });

  it("lets approved followers receive a separate request while hidden; pending followers do not qualify", async () => {
    const { app, communityRepository } = await setupTestApp();
    await communityRepository.saveProfile(
      userBob,
      { handle: "bob_lift", displayName: "Bob", isSearchable: false },
      { accessToken: "token-bob" },
    );
    const incoming = await communityRepository.sendFollowRequest(
      userBob,
      userAlice,
      { accessToken: "token-bob", operationId: crypto.randomUUID() },
    );
    const followBack = () =>
      app.inject({
        method: "POST",
        url: "/v1/community/relationships/follow",
        headers: { authorization: "Bearer token-alice" },
        payload: { targetUserId: userBob, operationId: crypto.randomUUID() },
      });
    expect((await followBack()).statusCode).toBe(404);
    await communityRepository.updateRelationshipStatus(
      incoming.id,
      userAlice,
      "approved",
      { accessToken: "token-alice" },
    );
    const response = await followBack();
    expect(response.statusCode).toBe(201);
    expect(response.json().status).toBe("pending");
    expect(response.json().followerUserId).toBe(userAlice);
    expect(
      (
        await communityRepository.getRelationship(userBob, userAlice, {
          accessToken: "token-alice",
        })
      )?.status,
    ).toBe("approved");
  });
  it("handles follow request lifecycle: approve, decline, and forgery prevention", async () => {
    const { app } = await setupTestApp();

    // Alice requests to follow Bob
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/community/relationships/follow",
      headers: { authorization: "Bearer token-alice" },
      payload: { operationId: crypto.randomUUID(), targetUserId: userBob },
    });
    const relId = createRes.json().id;

    // Bob sees incoming request
    const incomingRes = await app.inject({
      method: "GET",
      url: "/v1/community/relationships/incoming",
      headers: { authorization: "Bearer token-bob" },
    });
    expect(incomingRes.statusCode).toBe(200);
    expect(incomingRes.json().items.length).toBe(1);
    expect(incomingRes.json().items[0].relationshipId).toBe(relId);

    // Alice (requester) cannot forge approval (must be target user Bob)
    const forgeryRes = await app.inject({
      method: "PUT",
      url: `/v1/community/relationships/${relId}`,
      headers: { authorization: "Bearer token-alice" },
      payload: { action: "approve" },
    });
    expect(forgeryRes.statusCode).toBe(403);

    // Eve (unrelated user) cannot approve either
    const eveRes = await app.inject({
      method: "PUT",
      url: `/v1/community/relationships/${relId}`,
      headers: { authorization: "Bearer token-eve" },
      payload: { action: "approve" },
    });
    expect(eveRes.statusCode).toBe(403);

    // Bob approves request
    const approveRes = await app.inject({
      method: "PUT",
      url: `/v1/community/relationships/${relId}`,
      headers: { authorization: "Bearer token-bob" },
      payload: { action: "approve" },
    });
    expect(approveRes.statusCode).toBe(200);
    expect(approveRes.json().status).toBe("approved");

    // Alice is now following Bob
    const followingRes = await app.inject({
      method: "GET",
      url: "/v1/community/relationships/following",
      headers: { authorization: "Bearer token-alice" },
    });
    expect(followingRes.json().items.length).toBe(1);
    expect(followingRes.json().items[0].user.handle).toBe("bob_lift");

    // Bob has Alice as follower
    const followersRes = await app.inject({
      method: "GET",
      url: "/v1/community/relationships/followers",
      headers: { authorization: "Bearer token-bob" },
    });
    expect(followersRes.json().items.length).toBe(1);
    expect(followersRes.json().items[0].user.handle).toBe("alice_fit");
  });

  it("handles cancellation by sender", async () => {
    const { app } = await setupTestApp();

    // Alice requests to follow Bob
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/community/relationships/follow",
      headers: { authorization: "Bearer token-alice" },
      payload: { operationId: crypto.randomUUID(), targetUserId: userBob },
    });
    const relId = createRes.json().id;

    // Bob cannot cancel Alice's request (he can decline it)
    const bobCancel = await app.inject({
      method: "PUT",
      url: `/v1/community/relationships/${relId}`,
      headers: { authorization: "Bearer token-bob" },
      payload: { action: "cancel" },
    });
    expect(bobCancel.statusCode).toBe(403);

    // Alice cancels her own request
    const aliceCancel = await app.inject({
      method: "PUT",
      url: `/v1/community/relationships/${relId}`,
      headers: { authorization: "Bearer token-alice" },
      payload: { action: "cancel" },
    });
    expect(aliceCancel.statusCode).toBe(200);
    expect(aliceCancel.json().status).toBe("canceled");
  });

  it("handles unfollow and remove-follower", async () => {
    const { app, communityRepository } = await setupTestApp();

    // Establish approved follow: Alice follows Bob
    const rel = await communityRepository.sendFollowRequest(userAlice, userBob);
    await communityRepository.updateRelationshipStatus(
      rel.id,
      userBob,
      "approved",
    );

    // Alice unfollows Bob
    const unfollowRes = await app.inject({
      method: "DELETE",
      url: `/v1/community/relationships/following/${userBob}?relationshipId=${rel.id}`,
      headers: { authorization: "Bearer token-alice" },
    });
    expect(unfollowRes.statusCode).toBe(200);
    expect(unfollowRes.json().unfollowed).toBe(true);

    const followingCheck = await app.inject({
      method: "GET",
      url: "/v1/community/relationships/following",
      headers: { authorization: "Bearer token-alice" },
    });
    expect(followingCheck.json().items.length).toBe(0);

    // Establish approved follow again, then Bob removes Alice as follower
    const rel2 = await communityRepository.sendFollowRequest(
      userAlice,
      userBob,
    );
    await communityRepository.updateRelationshipStatus(
      rel2.id,
      userBob,
      "approved",
    );

    const removeRes = await app.inject({
      method: "DELETE",
      url: `/v1/community/relationships/followers/${userAlice}?relationshipId=${rel2.id}`,
      headers: { authorization: "Bearer token-bob" },
    });
    expect(removeRes.statusCode).toBe(200);
    expect(removeRes.json().removed).toBe(true);

    const followersCheck = await app.inject({
      method: "GET",
      url: "/v1/community/relationships/followers",
      headers: { authorization: "Bearer token-bob" },
    });
    expect(followersCheck.json().items.length).toBe(0);
  });

  it("blocks and unblocks users, severing follow edges transactionally", async () => {
    const { app, communityRepository } = await setupTestApp();

    // Alice follows Bob
    const rel = await communityRepository.sendFollowRequest(userAlice, userBob);
    await communityRepository.updateRelationshipStatus(
      rel.id,
      userBob,
      "approved",
    );

    // Bob follows Alice (mutual)
    const relBack = await communityRepository.sendFollowRequest(
      userBob,
      userAlice,
    );
    await communityRepository.updateRelationshipStatus(
      relBack.id,
      userAlice,
      "approved",
    );

    // Self-block fails
    const selfBlock = await app.inject({
      method: "POST",
      url: "/v1/community/blocks",
      headers: { authorization: "Bearer token-alice" },
      payload: { blockedUserId: userAlice },
    });
    expect(selfBlock.statusCode).toBe(400);

    // Alice blocks Bob
    const blockRes = await app.inject({
      method: "POST",
      url: "/v1/community/blocks",
      headers: { authorization: "Bearer token-alice" },
      payload: { blockedUserId: userBob },
    });
    expect(blockRes.statusCode).toBe(201);
    expect(blockRes.json().blockerUserId).toBe(userAlice);
    expect(blockRes.json().blockedUserId).toBe(userBob);

    // Check blocked users list
    const listRes = await app.inject({
      method: "GET",
      url: "/v1/community/blocks",
      headers: { authorization: "Bearer token-alice" },
    });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().items.length).toBe(1);
    expect(listRes.json().items[0].blockedUser.handle).toBe("bob_lift");

    // Relationships in both directions were severed
    const aliceFollowing = await app.inject({
      method: "GET",
      url: "/v1/community/relationships/following",
      headers: { authorization: "Bearer token-alice" },
    });
    expect(aliceFollowing.json().items.length).toBe(0);

    const bobFollowing = await app.inject({
      method: "GET",
      url: "/v1/community/relationships/following",
      headers: { authorization: "Bearer token-bob" },
    });
    expect(bobFollowing.json().items.length).toBe(0);

    // Blocked user receives neutral 404 NOT_FOUND rather than leaking block status
    const followBlocked = await app.inject({
      method: "POST",
      url: "/v1/community/relationships/follow",
      headers: { authorization: "Bearer token-bob" },
      payload: { operationId: crypto.randomUUID(), targetUserId: userAlice },
    });
    expect(followBlocked.statusCode).toBe(404);
    expect(followBlocked.json().error.code).toBe("NOT_FOUND");

    // Alice unblocks Bob
    const unblockRes = await app.inject({
      method: "DELETE",
      url: `/v1/community/blocks/${userBob}`,
      headers: { authorization: "Bearer token-alice" },
    });
    expect(unblockRes.statusCode).toBe(200);
    expect(unblockRes.json().unblocked).toBe(true);

    // After unblock, former follow relationship is NOT automatically restored
    const aliceFollowingPost = await app.inject({
      method: "GET",
      url: "/v1/community/relationships/following",
      headers: { authorization: "Bearer token-alice" },
    });
    expect(aliceFollowingPost.json().items.length).toBe(0);
  });
});

describe("COMM-04 owner lists and mute transport", () => {
  it("requires operation IDs for requests and incarnation IDs for removals", async () => {
    const { app } = await setupTestApp();
    const headers = { authorization: "Bearer token-alice" };
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/community/relationships/follow",
          headers,
          payload: { targetUserId: userBob },
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/v1/community/relationships/following/${userBob}`,
          headers,
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/v1/community/relationships/followers/${userBob}`,
          headers,
        })
      ).statusCode,
    ).toBe(422);
  });

  it("paginates lists and rejects cross-list/cross-account cursors", async () => {
    const { app, communityRepository: repo } = await setupTestApp();
    await repo.sendFollowRequest(userAlice, userBob);
    await repo.saveProfile(userEve, {
      handle: "eve",
      displayName: "Eve",
      isSearchable: true,
    });
    await repo.sendFollowRequest(userAlice, userEve);
    const headers = { authorization: "Bearer token-alice" };
    const first = await app.inject({
      method: "GET",
      url: "/v1/community/relationships/outgoing?limit=1",
      headers,
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().items).toHaveLength(1);
    const cursor = first.json().nextCursor as string;
    expect(cursor).toBeTruthy();
    const second = await app.inject({
      method: "GET",
      url: `/v1/community/relationships/outgoing?limit=1&cursor=${cursor}`,
      headers,
    });
    expect(second.json().items).toHaveLength(1);
    expect(second.json().items[0].relationshipId).not.toBe(
      first.json().items[0].relationshipId,
    );
    expect(second.json().nextCursor).toBeNull();
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/community/relationships/incoming?cursor=${cursor}`,
          headers,
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/community/relationships/outgoing?cursor=${cursor}`,
          headers: { authorization: "Bearer token-bob" },
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/community/relationships/outgoing?limit=51",
          headers,
        })
      ).statusCode,
    ).toBe(422);
  });
  it("acknowledges mute changes privately without changing either follow direction", async () => {
    const { app, communityRepository: repo } = await setupTestApp();
    const rel = await repo.sendFollowRequest(userAlice, userBob);
    await repo.updateRelationshipStatus(rel.id, userBob, "approved");
    const headers = { authorization: "Bearer token-alice" };
    const muted = await app.inject({
      method: "PUT",
      url: `/v1/community/mutes/${userBob}`,
      headers,
      payload: { muted: true },
    });
    expect(muted.statusCode).toBe(200);
    expect(muted.json()).toEqual({ muted: true });
    const list = await app.inject({
      method: "GET",
      url: "/v1/community/mutes",
      headers,
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().items[0].user.userId).toBe(userBob);
    const reverse = await app.inject({
      method: "GET",
      url: "/v1/community/mutes",
      headers: { authorization: "Bearer token-bob" },
    });
    expect(reverse.json().items).toHaveLength(0);
    expect((await repo.getRelationship(userAlice, userBob))?.status).toBe(
      "approved",
    );
    expect(await repo.getRelationship(userBob, userAlice)).toBeNull();
    expect(
      (
        await app.inject({
          method: "PUT",
          url: `/v1/community/mutes/${userBob}`,
          headers,
          payload: { muted: false },
        })
      ).json(),
    ).toEqual({ muted: false });
  });
});
