import { describe, expect, it } from "vitest";
import fastify, { type FastifyInstance } from "fastify";
import type { UserId } from "@mizyun/core";
import { InMemoryCommunityRepository } from "../../community-repository.js";
import {
  communityReactionRoutes,
  CommunityReactionRateLimiter,
} from "./reaction-routes.js";
import { communityFeedRoutes } from "./feed-routes.js";
import { communityPublicationRoutes } from "./publication-routes.js";
import { InMemoryProfileRepository } from "../../profile-repository.js";
import { InMemoryWorkoutRepository } from "../../workout-repository.js";

const setupTestApp = async (options?: {
  repo?: InMemoryCommunityRepository;
  rateLimiter?: CommunityReactionRateLimiter;
  userId?: string;
}): Promise<{
  app: FastifyInstance;
  repo: InMemoryCommunityRepository;
  setPrincipal: (userId: string) => void;
}> => {
  const repo = options?.repo ?? new InMemoryCommunityRepository();
  let currentUserId = options?.userId ?? "u-bob";

  const app = fastify();
  app.decorate("authenticate", async (req: any) => {
    req.principal = {
      userId: currentUserId,
      accessToken: `token-${currentUserId}`,
      role: "authenticated",
    };
  });

  await app.register(communityReactionRoutes, {
    prefix: "/v1/community",
    communityRepository: repo,
    ...(options?.rateLimiter
      ? { reactionRateLimiter: options.rateLimiter }
      : {}),
  });

  await app.register(communityFeedRoutes, {
    prefix: "/v1/community",
    communityRepository: repo,
  });

  const profileRepo = new InMemoryProfileRepository({
    defaultTimezone: "UTC",
    defaultUnitSystem: "metric",
  });
  const workoutRepo = new InMemoryWorkoutRepository();
  await app.register(communityPublicationRoutes, {
    prefix: "/v1/community",
    communityRepository: repo,
    profileRepository: profileRepo,
    workoutRepository: workoutRepo,
  });

  await app.ready();

  return {
    app,
    repo,
    setPrincipal: (newUserId: string) => {
      currentUserId = newUserId;
    },
  };
};

describe("COMM-08 community reaction routes", () => {
  const aliceId = "c0000000-0000-4000-8000-000000000001" as UserId;
  const bobId = "c0000000-0000-4000-8000-000000000002" as UserId;
  const charlieId = "c0000000-0000-4000-8000-000000000003" as UserId;
  const unenrolledId = "c0000000-0000-4000-8000-000000000004" as UserId;

  const seedFixture = async (repo: InMemoryCommunityRepository) => {
    await repo.saveProfile(
      aliceId,
      {
        handle: "alice",
        displayName: "Alice Runner",
        isSearchable: true,
        enrollmentConsent: {
          adultDeclaration: true,
          termsVersion: "2026-09-30",
        },
      },
      { accessToken: "t-alice" },
    );

    await repo.saveProfile(
      bobId,
      {
        handle: "bob",
        displayName: "Bob Lifter",
        isSearchable: true,
        enrollmentConsent: {
          adultDeclaration: true,
          termsVersion: "2026-09-30",
        },
      },
      { accessToken: "t-bob" },
    );

    await repo.saveProfile(
      charlieId,
      {
        handle: "charlie",
        displayName: "Charlie Cyclist",
        isSearchable: true,
        enrollmentConsent: {
          adultDeclaration: true,
          termsVersion: "2026-09-30",
        },
      },
      { accessToken: "t-charlie" },
    );

    // Bob and Charlie follow Alice
    await repo.sendFollowRequest(bobId, aliceId, { operationId: "op-b1" });
    const bobRel = (await repo.getIncomingFollowRequests(aliceId))[0]!;
    await repo.updateRelationshipStatus(
      bobRel.relationship.id,
      aliceId,
      "approved",
    );

    await repo.sendFollowRequest(charlieId, aliceId, { operationId: "op-c1" });
    const charlieRel = (await repo.getIncomingFollowRequests(aliceId))[0]!;
    await repo.updateRelationshipStatus(
      charlieRel.relationship.id,
      aliceId,
      "approved",
    );

    // Alice publishes an activity
    const activity = await repo.publishActivity(
      aliceId,
      {
        enrollmentGeneration: 1,
        operationId: "op-pub1",
        sourceWorkoutId: "b0000000-0000-4000-8000-000000000001",
        category: "running",
        sharedDay: "2026-09-30",
        durationSeconds: 2400,
      },
      { accessToken: "t-alice" },
    );

    return { activity };
  };

  it("sets, updates, and removes reactions reversibly for an approved follower", async () => {
    const { app, repo, setPrincipal } = await setupTestApp();
    const { activity } = await seedFixture(repo);

    setPrincipal(bobId);

    // 1. Bob sets 'clap'
    const res1 = await app.inject({
      method: "PUT",
      url: `/v1/community/activities/${activity.id}/reaction`,
      payload: { reaction: "clap" },
    });
    expect(res1.statusCode).toBe(200);
    const body1 = res1.json();
    expect(body1.activityId).toBe(activity.id);
    expect(body1.viewerReaction).toBe("clap");
    expect(body1.reactionCounts.clap).toBe(1);
    expect(body1.reactionCounts.fire).toBe(0);

    // 2. Bob changes reaction to 'fire'
    const res2 = await app.inject({
      method: "PUT",
      url: `/v1/community/activities/${activity.id}/reaction`,
      payload: { reaction: "fire" },
    });
    expect(res2.statusCode).toBe(200);
    const body2 = res2.json();
    expect(body2.viewerReaction).toBe("fire");
    expect(body2.reactionCounts.clap).toBe(0);
    expect(body2.reactionCounts.fire).toBe(1);

    // 3. Bob removes reaction with null
    const res3 = await app.inject({
      method: "PUT",
      url: `/v1/community/activities/${activity.id}/reaction`,
      payload: { reaction: null },
    });
    expect(res3.statusCode).toBe(200);
    const body3 = res3.json();
    expect(body3.viewerReaction).toBeNull();
    expect(body3.reactionCounts.fire).toBe(0);
  });

  it("rejects non-predefined or invalid reaction values", async () => {
    const { app, repo, setPrincipal } = await setupTestApp();
    const { activity } = await seedFixture(repo);

    setPrincipal(bobId);

    const res = await app.inject({
      method: "PUT",
      url: `/v1/community/activities/${activity.id}/reaction`,
      payload: { reaction: "laugh" },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("prevents author from reacting to their own card", async () => {
    const { app, repo, setPrincipal } = await setupTestApp();
    const { activity } = await seedFixture(repo);

    setPrincipal(aliceId);

    const res = await app.inject({
      method: "PUT",
      url: `/v1/community/activities/${activity.id}/reaction`,
      payload: { reaction: "clap" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
  });

  it("prevents unenrolled or non-follower users from reacting", async () => {
    const { app, repo, setPrincipal } = await setupTestApp();
    const { activity } = await seedFixture(repo);

    // Unenrolled user
    setPrincipal(unenrolledId);
    const resUnenrolled = await app.inject({
      method: "PUT",
      url: `/v1/community/activities/${activity.id}/reaction`,
      payload: { reaction: "clap" },
    });
    expect(resUnenrolled.statusCode).toBe(403);
    expect(resUnenrolled.json().error.code).toBe("COMMUNITY_NOT_ENROLLED");

    // Non-follower enrolled user (Dave)
    const daveId = "c0000000-0000-4000-8000-000000000005" as UserId;
    await repo.saveProfile(
      daveId,
      {
        handle: "dave",
        displayName: "Dave",
        enrollmentConsent: {
          adultDeclaration: true,
          termsVersion: "2026-09-30",
        },
      },
      { accessToken: "t-dave" },
    );
    setPrincipal(daveId);

    const resDave = await app.inject({
      method: "PUT",
      url: `/v1/community/activities/${activity.id}/reaction`,
      payload: { reaction: "clap" },
    });
    expect(resDave.statusCode).toBe(404);
  });

  it("enforces max 30 mutations per minute rate limit", async () => {
    let fakeTime = 1_000_000;
    const limiter = new CommunityReactionRateLimiter(() => fakeTime);
    const { app, repo, setPrincipal } = await setupTestApp({
      rateLimiter: limiter,
    });
    const { activity } = await seedFixture(repo);

    setPrincipal(bobId);

    // Perform 30 mutations within 1 minute
    for (let i = 0; i < 30; i++) {
      fakeTime += 1000;
      const res = await app.inject({
        method: "PUT",
        url: `/v1/community/activities/${activity.id}/reaction`,
        payload: { reaction: i % 2 === 0 ? "clap" : "fire" },
      });
      expect(res.statusCode).toBe(200);
    }

    // 31st mutation within the same minute is rate-limited
    fakeTime += 1000;
    const resOver = await app.inject({
      method: "PUT",
      url: `/v1/community/activities/${activity.id}/reaction`,
      payload: { reaction: "high_five" },
    });
    expect(resOver.statusCode).toBe(429);
    expect(resOver.json().error.code).toBe("RATE_LIMITED");

    // After 60 seconds expire, mutations succeed again
    fakeTime += 61_000;
    const resAfterWait = await app.inject({
      method: "PUT",
      url: `/v1/community/activities/${activity.id}/reaction`,
      payload: { reaction: "high_five" },
    });
    expect(resAfterWait.statusCode).toBe(200);
  });

  it("isolates reactor identities: author sees permitted identities, followers see aggregate only", async () => {
    const { app, repo, setPrincipal } = await setupTestApp();
    const { activity } = await seedFixture(repo);

    // Bob reacts with clap
    setPrincipal(bobId);
    await app.inject({
      method: "PUT",
      url: `/v1/community/activities/${activity.id}/reaction`,
      payload: { reaction: "clap" },
    });

    // Charlie reacts with fire
    setPrincipal(charlieId);
    await app.inject({
      method: "PUT",
      url: `/v1/community/activities/${activity.id}/reaction`,
      payload: { reaction: "fire" },
    });

    // Follower Bob reads reactions: sees aggregate counts only, no reactors list
    setPrincipal(bobId);
    const bobRead = await app.inject({
      method: "GET",
      url: `/v1/community/activities/${activity.id}/reactions`,
    });
    expect(bobRead.statusCode).toBe(200);
    const bobBody = bobRead.json();
    expect(bobBody.reactionCounts.clap).toBe(1);
    expect(bobBody.reactionCounts.fire).toBe(1);
    expect(bobBody.viewerReaction).toBe("clap");
    expect(bobBody.reactors).toBeUndefined();

    // Author Alice reads reactions: sees permitted reactor identities
    setPrincipal(aliceId);
    const aliceRead = await app.inject({
      method: "GET",
      url: `/v1/community/activities/${activity.id}/reactions`,
    });
    expect(aliceRead.statusCode).toBe(200);
    const aliceBody = aliceRead.json();
    expect(aliceBody.reactionCounts.clap).toBe(1);
    expect(aliceBody.reactionCounts.fire).toBe(1);
    expect(aliceBody.viewerReaction).toBeNull();
    expect(aliceBody.reactors).toHaveLength(2);
    expect(aliceBody.reactors.map((r: any) => r.handle).sort()).toEqual([
      "bob",
      "charlie",
    ]);

    // Bilateral block suppression: Bob blocks Charlie
    await repo.blockUser(bobId, charlieId);
    setPrincipal(bobId);
    const bobReadBlocked = await app.inject({
      method: "GET",
      url: `/v1/community/activities/${activity.id}/reactions`,
    });
    // Charlie's fire reaction is suppressed for Bob!
    expect(bobReadBlocked.json().reactionCounts.fire).toBe(0);
    expect(bobReadBlocked.json().reactionCounts.clap).toBe(1);
  });

  it("reflects real reactions in feed items and activity detail", async () => {
    const { app, repo, setPrincipal } = await setupTestApp();
    const { activity } = await seedFixture(repo);

    // Bob reacts with 'thumbs_up'
    setPrincipal(bobId);
    await app.inject({
      method: "PUT",
      url: `/v1/community/activities/${activity.id}/reaction`,
      payload: { reaction: "thumbs_up" },
    });

    // Bob views feed: sees thumbs_up = 1 and viewerReaction = thumbs_up
    const feedRes = await app.inject({
      method: "GET",
      url: "/v1/community/feed",
    });
    expect(feedRes.statusCode).toBe(200);
    const feedItem = feedRes
      .json()
      .items.find((i: any) => i.id === activity.id);
    expect(feedItem).toBeDefined();
    expect(feedItem.reactionCounts.thumbs_up).toBe(1);
    expect(feedItem.viewerReaction).toBe("thumbs_up");

    // Bob views activity detail: sees thumbs_up = 1 and viewerReaction = thumbs_up
    const detailRes = await app.inject({
      method: "GET",
      url: `/v1/community/activities/${activity.id}`,
    });
    expect(detailRes.statusCode).toBe(200);
    const detail = detailRes.json();
    expect(detail.reactionCounts.thumbs_up).toBe(1);
    expect(detail.viewerReaction).toBe("thumbs_up");
  });
});
