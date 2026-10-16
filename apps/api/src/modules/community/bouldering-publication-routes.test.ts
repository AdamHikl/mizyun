import { afterEach, describe, expect, it } from "vitest";
import type { UserId } from "@mizyun/core";
import { buildApp } from "../../app.js";
import { InMemoryBoulderingRepository } from "../../bouldering-repository.js";
import { InMemoryCommunityRepository } from "../../community-repository.js";
import { InMemoryMediaAssetRepository } from "../../media-asset-repository.js";
import { InMemoryWorkoutRepository } from "../../workout-repository.js";

const alice = "c2500000-0000-4000-8000-000000000001" as UserId;
const bob = "c2500000-0000-4000-8000-000000000002" as UserId;
const eve = "c2500000-0000-4000-8000-000000000003" as UserId;
const headers = (user: UserId) => ({
  authorization: `Bearer ${user}`,
  "x-mizyun-activity-kinds": "bouldering",
});
/** An installed build from before bouldering cards existed. */
const legacyHeaders = (user: UserId) => ({ authorization: `Bearer ${user}` });
const access = (user: UserId) => ({ accessToken: user });
const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

const setup = async (
  options: { boulderingEnabled?: boolean; finish?: boolean } = {},
) => {
  const communityRepository = new InMemoryCommunityRepository();
  const workouts = new InMemoryWorkoutRepository();
  const media = new InMemoryMediaAssetRepository();
  const bouldering = new InMemoryBoulderingRepository(workouts, media);
  for (const [user, handle] of [
    [alice, "bld_alice"],
    [bob, "bld_bob"],
    [eve, "bld_eve"],
  ] as const)
    await communityRepository.saveProfile(user, {
      handle,
      displayName: handle,
      isSearchable: true,
    });
  const rel = await communityRepository.sendFollowRequest(bob, alice);
  await communityRepository.updateRelationshipStatus(rel.id, alice, "approved");
  const session = await bouldering.startSession(
    alice,
    {
      clientOperationId: crypto.randomUUID(),
      recordingTimezone: "Europe/Bratislava",
      gymName: "Secret Gym",
    },
    access(alice),
  );
  const log = (
    grade: "6B" | "7A" | "7B" | "5",
    result: "flash" | "sent" | "not_yet",
    extra: { holdColour?: "blue" | null; note?: string | null } = {},
  ) =>
    bouldering.createAscent(
      alice,
      session.id,
      {
        clientOperationId: crypto.randomUUID(),
        grade,
        result,
        attempts: result === "flash" ? 1 : null,
        holdColour: extra.holdColour ?? null,
        note: extra.note ?? null,
        photoAssetId: null,
      },
      access(alice),
    );
  await log("6B", "flash", { holdColour: "blue", note: "private beta" });
  const top = await log("7A", "sent");
  await log("6B", "sent");
  const project = await log("7B", "not_yet", { note: "crimpy project" });
  if (options.finish !== false)
    await bouldering.finishSession(
      alice,
      session.id,
      { clientOperationId: crypto.randomUUID(), notes: "private notes" },
      access(alice),
    );
  const app = buildApp({
    communityRepository,
    workoutRepository: workouts,
    mediaAssetRepository: media,
    boulderingRepository: bouldering,
    boulderingEnabled: options.boulderingEnabled ?? true,
    communityOperations: {
      browsing: true,
      enrollment: true,
      discovery: true,
      publish: true,
      engagement: true,
      delivery: false,
    },
    tokenVerifier: {
      verify: async (token) =>
        [alice, bob, eve].includes(token as UserId)
          ? {
              userId: token as UserId,
              role: "authenticated",
              accessToken: token,
            }
          : null,
    },
  });
  apps.push(app);
  await app.ready();
  const preview = (user: UserId = alice, id = session.id) =>
    app.inject({
      method: "GET",
      url: `/v1/community/bouldering-sessions/${id}/preview`,
      headers: headers(user),
    });
  const publish = (
    overrides: Record<string, unknown> = {},
    user: UserId = alice,
  ) =>
    app.inject({
      method: "POST",
      url: "/v1/community/bouldering-activities",
      headers: headers(user),
      payload: {
        sessionId: session.id,
        enrollmentGeneration: 1,
        operationId: "e2500000-0000-4000-8000-000000000001",
        expectedVersion: 0,
        expectedRevoked: false,
        sharedDay: (session.details.boulderSession as { activityDate: string })
          .activityDate,
        includeGradeBreakdown: false,
        expectedBoulderingDetails: {
          activityDate: (
            session.details.boulderSession as { activityDate: string }
          ).activityDate,
          topGrade: "7A",
          sends: 3,
          flashes: 1,
          gradeBreakdown: null,
        },
        ...overrides,
      },
    });
  return {
    app,
    bouldering,
    communityRepository,
    session,
    top,
    project,
    preview,
    publish,
  };
};

const privateValues = (sessionId: string) => [
  sessionId,
  "Secret Gym",
  "private notes",
  "private beta",
  "crimpy project",
  "blue",
  "attempts",
  "startedAt",
  "completedAt",
];

describe("Community bouldering publication (ADR-0067)", () => {
  it("previews the exact server projections with and without breakdown", async () => {
    const { preview, session } = await setup();
    const response = await preview();
    expect(response.statusCode).toBe(200);
    const body = response.json();
    const day = (session.details.boulderSession as { activityDate: string })
      .activityDate;
    expect(body.sharedDay).toBe(day);
    expect(body.boulderingDetails).toEqual({
      activityDate: day,
      topGrade: "7A",
      sends: 3,
      flashes: 1,
      gradeBreakdown: null,
    });
    expect(body.boulderingDetailsWithBreakdown.gradeBreakdown).toEqual([
      { grade: "7A", sends: 1 },
      { grade: "6B", sends: 2 },
    ]);
    expect(body.followerCount).toBe(1);
    expect(body.existingActivity).toBeNull();
    for (const value of ["Secret Gym", "private notes", "crimpy", "blue"])
      expect(response.body).not.toContain(value);
  });

  it("publishes the previewed snapshot to followers only", async () => {
    const { app, publish, session } = await setup();
    const response = await publish();
    expect(response.statusCode).toBe(201);
    const card = response.json();
    expect(card.activityKind).toBe("bouldering");
    expect(card.sourceWorkoutId).toBe(session.id);
    expect(card.boulderingDetails.topGrade).toBe("7A");
    for (const url of [
      `/v1/community/activities/${card.id}`,
      "/v1/community/feed",
      `/v1/community/profiles/${alice}/activities`,
    ]) {
      const read = await app.inject({
        method: "GET",
        url,
        headers: headers(bob),
      });
      expect(read.statusCode, url).toBe(200);
      expect(read.body).toContain('"activityKind":"bouldering"');
      expect(read.body).toContain('"topGrade":"7A"');
      for (const value of privateValues(session.id))
        expect(read.body, `${url} ${value}`).not.toContain(value);
    }
    const outsider = await app.inject({
      method: "GET",
      url: `/v1/community/activities/${card.id}`,
      headers: headers(eve),
    });
    expect(outsider.statusCode).toBe(404);
    const outsiderFeed = await app.inject({
      method: "GET",
      url: "/v1/community/feed",
      headers: headers(eve),
    });
    expect(outsiderFeed.body).not.toContain(card.id);
    const manage = await app.inject({
      method: "GET",
      url: `/v1/community/activities/${card.id}/manage`,
      headers: headers(alice),
    });
    expect(manage.statusCode).toBe(200);
    expect(manage.json().sourceWorkoutId).toBe(session.id);
  });

  it("hides bouldering cards from clients that do not declare the kind", async () => {
    const { app, publish } = await setup();
    const card = (await publish()).json();
    for (const url of [
      "/v1/community/feed",
      `/v1/community/profiles/${alice}/activities`,
    ]) {
      const legacy = await app.inject({
        method: "GET",
        url,
        headers: legacyHeaders(bob),
      });
      expect(legacy.statusCode, url).toBe(200);
      expect(legacy.body, url).not.toContain(card.id);
      expect(legacy.body, url).not.toContain('"activityKind":"bouldering"');
    }
  });

  it("replays a lost response and conflicts on a changed payload", async () => {
    const { publish, preview } = await setup();
    const first = await publish();
    expect(first.statusCode).toBe(201);
    const retry = await publish();
    expect(retry.statusCode).toBe(201);
    expect(retry.json()).toEqual(first.json());
    const withBreakdown = (await preview()).json()
      .boulderingDetailsWithBreakdown;
    expect(
      (
        await publish({
          includeGradeBreakdown: true,
          expectedBoulderingDetails: withBreakdown,
        })
      ).statusCode,
    ).toBe(409);
    const replaced = await publish({
      operationId: "e2500000-0000-4000-8000-000000000002",
      expectedVersion: 1,
      includeGradeBreakdown: true,
      expectedBoulderingDetails: withBreakdown,
    });
    expect(replaced.statusCode).toBe(201);
    expect(replaced.json().version).toBe(2);
    expect(replaced.json().boulderingDetails.gradeBreakdown).toHaveLength(2);
  });

  it("rejects tampered details, unfinished and foreign sessions", async () => {
    const tampered = await setup();
    const base = (await tampered.preview()).json().boulderingDetails;
    expect(
      (
        await tampered.publish({
          expectedBoulderingDetails: { ...base, gymName: "Secret Gym" },
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await tampered.publish({
          expectedBoulderingDetails: { ...base, sends: 4 },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await tampered.publish({
          includeGradeBreakdown: true,
          expectedBoulderingDetails: base,
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (await tampered.publish({ sharedDay: "2026-01-01" })).statusCode,
    ).toBe(409);
    expect((await tampered.preview(bob)).statusCode).toBe(404);
    expect((await tampered.publish({}, bob)).statusCode).toBe(404);
    expect((await tampered.preview(alice, "-".repeat(36))).statusCode).toBe(
      404,
    );

    const active = await setup({ finish: false });
    expect((await active.preview()).statusCode).toBe(422);
    expect((await active.publish()).statusCode).toBe(422);
  });

  it("revokes on boulder edit, boulder add, and session delete", async () => {
    const { app, bouldering, communityRepository, publish, session, top } =
      await setup();
    const card = (await publish()).json();
    await bouldering.updateAscent(
      alice,
      top.id,
      {
        clientOperationId: crypto.randomUUID(),
        expectedRevision: 1,
        grade: "7A",
        result: "sent",
        attempts: null,
        holdColour: null,
        note: "edited",
        photoAssetId: null,
      },
      access(alice),
    );
    // A note never reaches the card, so it does not revoke it.
    expect(
      (await communityRepository.getActivityById(card.id))?.revokedAt ?? null,
    ).toBeNull();
    await bouldering.updateAscent(
      alice,
      top.id,
      {
        clientOperationId: crypto.randomUUID(),
        expectedRevision: 2,
        grade: "7A+",
        result: "sent",
        attempts: null,
        holdColour: null,
        note: "edited",
        photoAssetId: null,
      },
      access(alice),
    );
    expect(
      (await communityRepository.getActivityById(card.id))?.revokedAt,
    ).not.toBeNull();
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/community/activities/${card.id}`,
          headers: headers(bob),
        })
      ).statusCode,
    ).toBe(404);
    expect((await publish()).statusCode).toBe(409);
    const republished = await publish({
      operationId: "e2500000-0000-4000-8000-000000000003",
      expectedVersion: 1,
      expectedRevoked: true,
      expectedBoulderingDetails: (
        await app.inject({
          method: "GET",
          url: `/v1/community/bouldering-sessions/${session.id}/preview`,
          headers: headers(alice),
        })
      ).json().boulderingDetails,
    });
    expect(republished.json().boulderingDetails.topGrade).toBe("7A+");
    expect(republished.statusCode).toBe(201);
    await bouldering.createAscent(
      alice,
      session.id,
      {
        clientOperationId: crypto.randomUUID(),
        grade: "5",
        result: "sent",
        attempts: null,
        holdColour: null,
        note: null,
        photoAssetId: null,
      },
      access(alice),
    );
    expect(
      (await communityRepository.getActivityById(card.id))?.revokedAt,
    ).not.toBeNull();
    const fresh = await publish({
      operationId: "e2500000-0000-4000-8000-000000000004",
      expectedVersion: 2,
      expectedRevoked: true,
      expectedBoulderingDetails: (
        await app.inject({
          method: "GET",
          url: `/v1/community/bouldering-sessions/${session.id}/preview`,
          headers: headers(alice),
        })
      ).json().boulderingDetails,
    });
    expect(fresh.statusCode).toBe(201);
    expect(fresh.json().boulderingDetails.sends).toBe(4);
    const removed = await app.inject({
      method: "DELETE",
      url: `/v1/bouldering/sessions/${session.id}`,
      headers: headers(alice),
    });
    expect(removed.statusCode).toBe(200);
    expect(
      (await communityRepository.getActivityById(card.id))?.revokedAt,
    ).not.toBeNull();
    const feed = await app.inject({
      method: "GET",
      url: "/v1/community/feed",
      headers: headers(bob),
    });
    expect(feed.body).not.toContain(card.id);
  });

  it("keeps the strength paths away from bouldering cards", async () => {
    const { app, publish, session } = await setup();
    const card = (await publish()).json();
    const generic = await app.inject({
      method: "POST",
      url: "/v1/community/activities",
      headers: headers(alice),
      payload: {
        workoutId: session.id,
        enrollmentGeneration: 1,
        operationId: "e2500000-0000-4000-8000-000000000009",
        expectedVersion: 1,
        sharedDay: card.sharedDay,
      },
    });
    expect(generic.statusCode).toBe(422);
    const patch = await app.inject({
      method: "PATCH",
      url: `/v1/community/activities/${card.id}`,
      headers: headers(alice),
      payload: { includeDuration: true, expectedVersion: 1 },
    });
    expect(patch.statusCode).toBe(422);
  });

  it("answers FEATURE_DISABLED when bouldering is off", async () => {
    const { preview, publish } = await setup({ boulderingEnabled: false });
    expect((await preview()).statusCode).toBe(503);
    expect((await publish()).statusCode).toBe(503);
  });
});
