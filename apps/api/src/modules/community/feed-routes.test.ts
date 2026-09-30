import { afterEach, describe, expect, it } from "vitest";
import type { UserId } from "@mizyun/core";
import type { AccessTokenVerifier } from "@mizyun/identity";

import { buildApp } from "../../app.js";
import { InMemoryProfileRepository } from "../../profile-repository.js";
import { InMemoryWorkoutRepository } from "../../workout-repository.js";
import { InMemoryCommunityRepository } from "../../community-repository.js";

const userAlice: UserId = "00000000-0000-4000-8000-000000000001" as UserId;
const userBob: UserId = "00000000-0000-4000-8000-000000000002" as UserId;
const userCharlie: UserId = "00000000-0000-4000-8000-000000000003" as UserId;

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
    if (token === "token-charlie") {
      return {
        userId: userCharlie,
        role: "authenticated",
        accessToken: "token-charlie",
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
  await profileRepository.getOrCreate(userCharlie, {
    now,
    accessToken: "token-charlie",
  });

  const workoutRepository = new InMemoryWorkoutRepository();
  const communityRepository = new InMemoryCommunityRepository();

  const app = buildApp({
    communityOperations: {
      browsing: true,
      enrollment: true,
      discovery: true,
      publish: true,
      engagement: true,
      delivery: false,
    },
    profileRepository,
    workoutRepository,
    communityRepository,
    tokenVerifier: tokenVerifierFor(),
  });
  apps.push(app);
  await app.ready();

  return { app, communityRepository, workoutRepository };
};

describe("GET /v1/community/feed", () => {
  it("requires authentication", async () => {
    const { app } = await setupTestApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/community/feed",
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 COMMUNITY_NOT_ENROLLED if viewer is not enrolled", async () => {
    const { app } = await setupTestApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/community/feed",
      headers: { authorization: "Bearer token-alice" },
    });
    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.error.code).toBe("COMMUNITY_NOT_ENROLLED");
  });

  it("returns empty feed when enrolled but no shared activities exist", async () => {
    const { app, communityRepository } = await setupTestApp();
    await communityRepository.saveProfile(userAlice, {
      handle: "alice",
      displayName: "Alice",
      isSearchable: true,
    });

    const res = await app.inject({
      method: "GET",
      url: "/v1/community/feed",
      headers: { authorization: "Bearer token-alice" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toEqual([]);
    expect(body.nextCursor).toBeNull();
  });

  it("returns author own activities and followed approved friends activities", async () => {
    const { app, communityRepository } = await setupTestApp();
    await communityRepository.saveProfile(userAlice, {
      handle: "alice",
      displayName: "Alice",
      isSearchable: true,
    });
    await communityRepository.saveProfile(userBob, {
      handle: "bob",
      displayName: "Bob",
      isSearchable: true,
    });

    // Bob follows Alice and Alice approves
    const req = await communityRepository.sendFollowRequest(userBob, userAlice);
    await communityRepository.updateRelationshipStatus(
      req.id,
      userAlice,
      "approved",
    );

    // Alice publishes a workout
    await communityRepository.publishActivity(userAlice, {
      sourceWorkoutId: "10000000-0000-4000-8000-000000000001",
      category: "strength",
      sharedDay: "2026-09-29",
      durationSeconds: 3600,
      enrollmentGeneration: 1,
      operationId: "20000000-0000-4000-8000-000000000001",
    });

    // Bob queries feed
    const bobRes = await app.inject({
      method: "GET",
      url: "/v1/community/feed",
      headers: { authorization: "Bearer token-bob" },
    });
    expect(bobRes.statusCode).toBe(200);
    const bobBody = bobRes.json();
    expect(bobBody.items).toHaveLength(1);
    expect(bobBody.items[0].authorHandle).toBe("alice");
    expect(bobBody.items[0].authorDisplayName).toBe("Alice");
    expect(bobBody.items[0].category).toBe("strength");
    expect(bobBody.items[0].sharedDay).toBe("2026-09-29");
    expect(bobBody.items[0].durationSeconds).toBe(3600);
    expect(bobBody.items[0].reactionCounts).toEqual({
      clap: 0,
      fire: 0,
      high_five: 0,
      fist_bump: 0,
      thumbs_up: 0,
    });
    expect(bobBody.items[0].viewerReaction).toBeNull();
    // Privacy invariant: sourceWorkoutId is never present in feed items
    expect(bobBody.items[0].sourceWorkoutId).toBeUndefined();

    // Alice also sees her own activity
    const aliceRes = await app.inject({
      method: "GET",
      url: "/v1/community/feed",
      headers: { authorization: "Bearer token-alice" },
    });
    expect(aliceRes.statusCode).toBe(200);
    expect(aliceRes.json().items).toHaveLength(1);
  });

  it("does not show activities from pending or unapproved relationships", async () => {
    const { app, communityRepository } = await setupTestApp();
    await communityRepository.saveProfile(userAlice, {
      handle: "alice",
      displayName: "Alice",
      isSearchable: true,
    });
    await communityRepository.saveProfile(userCharlie, {
      handle: "charlie",
      displayName: "Charlie",
      isSearchable: true,
    });

    // Charlie sends follow request to Alice but it is not approved
    await communityRepository.sendFollowRequest(userCharlie, userAlice);

    // Alice publishes a workout
    await communityRepository.publishActivity(userAlice, {
      sourceWorkoutId: "10000000-0000-4000-8000-000000000001",
      category: "running",
      sharedDay: "2026-09-30",
      durationSeconds: null,
      enrollmentGeneration: 1,
      operationId: "20000000-0000-4000-8000-000000000001",
    });

    // Charlie checks feed
    const res = await app.inject({
      method: "GET",
      url: "/v1/community/feed",
      headers: { authorization: "Bearer token-charlie" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toHaveLength(0);
  });

  it("does not show activities from blocked or muted authors", async () => {
    const { app, communityRepository } = await setupTestApp();
    await communityRepository.saveProfile(userAlice, {
      handle: "alice",
      displayName: "Alice",
      isSearchable: true,
    });
    await communityRepository.saveProfile(userBob, {
      handle: "bob",
      displayName: "Bob",
      isSearchable: true,
    });

    const rel = await communityRepository.sendFollowRequest(userBob, userAlice);
    await communityRepository.updateRelationshipStatus(
      rel.id,
      userAlice,
      "approved",
    );
    await communityRepository.publishActivity(userAlice, {
      sourceWorkoutId: "10000000-0000-4000-8000-000000000001",
      category: "strength",
      sharedDay: "2026-09-29",
      durationSeconds: null,
      enrollmentGeneration: 1,
      operationId: "20000000-0000-4000-8000-000000000001",
    });

    // Bob mutes Alice
    await communityRepository.setMuted(userBob, userAlice, true);
    const mutedRes = await app.inject({
      method: "GET",
      url: "/v1/community/feed",
      headers: { authorization: "Bearer token-bob" },
    });
    expect(mutedRes.json().items).toHaveLength(0);

    // Bob unmutes Alice
    await communityRepository.setMuted(userBob, userAlice, false);
    const unmutedRes = await app.inject({
      method: "GET",
      url: "/v1/community/feed",
      headers: { authorization: "Bearer token-bob" },
    });
    expect(unmutedRes.json().items).toHaveLength(1);

    // Bob blocks Alice
    await communityRepository.blockUser(userBob, userAlice);
    const blockedRes = await app.inject({
      method: "GET",
      url: "/v1/community/feed",
      headers: { authorization: "Bearer token-bob" },
    });
    expect(blockedRes.json().items).toHaveLength(0);
  });

  it("handles pagination with limit and cursor, rejecting invalid cursor", async () => {
    const { app, communityRepository } = await setupTestApp();
    await communityRepository.saveProfile(userAlice, {
      handle: "alice",
      displayName: "Alice",
      isSearchable: true,
    });

    // Alice publishes 3 activities
    for (let i = 1; i <= 3; i++) {
      await communityRepository.publishActivity(userAlice, {
        sourceWorkoutId: `10000000-0000-4000-8000-00000000000${i}`,
        category: "strength",
        sharedDay: `2026-09-2${i}`,
        durationSeconds: 1800,
        enrollmentGeneration: 1,
        operationId: `20000000-0000-4000-8000-00000000000${i}`,
      });
    }

    // Page 1 with limit 2
    const page1Res = await app.inject({
      method: "GET",
      url: "/v1/community/feed?limit=2",
      headers: { authorization: "Bearer token-alice" },
    });
    expect(page1Res.statusCode).toBe(200);
    const page1 = page1Res.json();
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).toBeDefined();

    // Page 2 using cursor
    const page2Res = await app.inject({
      method: "GET",
      url: `/v1/community/feed?limit=2&cursor=${encodeURIComponent(page1.nextCursor)}`,
      headers: { authorization: "Bearer token-alice" },
    });
    expect(page2Res.statusCode).toBe(200);
    const page2 = page2Res.json();
    expect(page2.items).toHaveLength(1);
    expect(page2.nextCursor).toBeNull();

    // Ensure all 3 were returned uniquely
    const allIds = [
      ...page1.items.map((i: any) => i.id),
      ...page2.items.map((i: any) => i.id),
    ];
    expect(new Set(allIds).size).toBe(3);

    // Invalid cursor returns 422
    const invalidRes = await app.inject({
      method: "GET",
      url: "/v1/community/feed?cursor=not-a-valid-cursor",
      headers: { authorization: "Bearer token-alice" },
    });
    expect(invalidRes.statusCode).toBe(422);
    expect(invalidRes.json().error.code).toBe("VALIDATION_ERROR");
  });
});
