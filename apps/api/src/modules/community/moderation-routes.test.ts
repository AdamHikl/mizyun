import { afterEach, describe, expect, it, vi } from "vitest";
import fastify, { type FastifyInstance } from "fastify";
import type { UserId } from "@mizyun/core";
import { InMemoryCommunityRepository } from "../../community-repository.js";
import { authenticationPlugin } from "../../plugins/authentication.js";
import { moderationRoutes } from "./moderation-routes.js";

const userA = "a0000000-0000-4000-8000-000000000001" as UserId;
const userB = "b0000000-0000-4000-8000-000000000002" as UserId;
const staffPrimary = "c0000000-0000-4000-8000-000000000003" as UserId;
const staffBackup = "d0000000-0000-4000-8000-000000000004" as UserId;
const jwt = (id: UserId, aal = "aal2") =>
  `verified.${Buffer.from(JSON.stringify({ sub: id, aal })).toString("base64url")}.signature`;
const STAFF_TOKEN = jwt(staffPrimary);
const BACKUP_TOKEN = jwt(staffBackup);
const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

const setupModerationApp = async (options?: {
  repo?: InMemoryCommunityRepository;
  moderatorUserIds?: readonly string[];
}): Promise<{
  app: FastifyInstance;
  repo: InMemoryCommunityRepository;
}> => {
  const repo = options?.repo ?? new InMemoryCommunityRepository();
  await repo.saveProfile(userA, {
    handle: "reporter_a",
    displayName: "Reporter",
    enrollmentConsent: { adultDeclaration: true, termsVersion: "2026-09-30" },
  });

  const app = fastify();
  apps.push(app);
  await app.register(authenticationPlugin, {
    tokenVerifier: {
      verify: async (token) => {
        if (token === STAFF_TOKEN || token === jwt(staffPrimary, "aal1"))
          return { userId: staffPrimary, accessToken: token };
        if (token === BACKUP_TOKEN)
          return { userId: staffBackup, accessToken: token };
        if (token === jwt(userA)) return { userId: userA, accessToken: token };
        return null;
      },
    },
  });
  await app.register(moderationRoutes, {
    prefix: "/v1/community",
    communityRepository: repo,
    moderatorUserIds: options?.moderatorUserIds ?? [staffPrimary, staffBackup],
  });

  await app.ready();

  return { app, repo };
};

describe("moderation-routes", () => {
  it("rejects unauthorized access without a verified staff bearer", async () => {
    const { app } = await setupModerationApp();

    const res = await app.inject({
      method: "GET",
      url: "/v1/community/staff/queue",
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("AUTHENTICATION_REQUIRED");
  });

  it("rejects default/shared secrets, ordinary accounts, missing MFA, and unconfigured staff", async () => {
    const { app } = await setupModerationApp();
    for (const headers of [
      { "x-staff-token": "dev_staff_secret", "x-staff-operator": "adam_hikl" },
      { authorization: "Bearer invalid", "x-staff-token": "dev_staff_secret" },
    ]) {
      expect(
        (await app.inject({ url: "/v1/community/staff/queue", headers }))
          .statusCode,
      ).toBe(401);
    }
    for (const token of [jwt(userA), jwt(staffPrimary, "aal1")]) {
      expect(
        (
          await app.inject({
            url: "/v1/community/staff/queue",
            headers: { authorization: `Bearer ${token}` },
          })
        ).statusCode,
      ).toBe(403);
    }
    const unconfigured = await setupModerationApp({ moderatorUserIds: [] });
    expect(
      (
        await unconfigured.app.inject({
          url: "/v1/community/staff/queue",
          headers: { authorization: `Bearer ${STAFF_TOKEN}` },
        })
      ).statusCode,
    ).toBe(403);
  });

  it("validates queue filters and pagination and forwards the verified RLS token", async () => {
    const { app, repo } = await setupModerationApp();
    const spy = vi.spyOn(repo, "getModerationQueue");
    const headers = { authorization: `Bearer ${STAFF_TOKEN}` };
    for (const query of [
      "status=bogus",
      "limit=0",
      "limit=101",
      "offset=-1",
      "offset=10001",
      "unknown=foo",
    ]) {
      expect(
        (
          await app.inject({
            url: `/v1/community/staff/queue?${query}`,
            headers,
          })
        ).statusCode,
      ).toBe(422);
    }
    expect(spy).not.toHaveBeenCalled();
    expect(
      (
        await app.inject({
          url: "/v1/community/staff/queue?limit=20&offset=5",
          headers,
        })
      ).statusCode,
    ).toBe(200);
    expect(spy).toHaveBeenCalledWith({
      accessToken: STAFF_TOKEN,
      limit: 20,
      offset: 5,
    });
  });

  it("rejects absent, scalar and oversized appeal review bodies", async () => {
    const { app, repo } = await setupModerationApp();
    const spy = vi.spyOn(repo, "resolveModerationAppeal");
    for (const payload of [
      undefined,
      7,
      { decision: "approved", reviewerNotes: "x".repeat(1001) },
      { decision: "approved", reviewedBy: staffBackup },
    ]) {
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/v1/community/staff/appeals/${userA}/review`,
            headers: {
              authorization: `Bearer ${STAFF_TOKEN}`,
              ...(payload === undefined
                ? {}
                : { "content-type": "application/json" }),
            },
            ...(payload === undefined
              ? {}
              : { payload: JSON.stringify(payload) }),
          })
        ).statusCode,
      ).toBe(422);
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it("uses a staff RLS token for inspection and preserves infrastructure errors", async () => {
    const { app, repo } = await setupModerationApp();
    const getSpy = vi.spyOn(repo, "getReportById");
    const headers = { authorization: `Bearer ${STAFF_TOKEN}` };
    expect(
      (
        await app.inject({
          url: `/v1/community/staff/reports/${userA}`,
          headers,
        })
      ).statusCode,
    ).toBe(404);
    expect(getSpy).toHaveBeenCalledWith(userA, { accessToken: STAFF_TOKEN });
    const actionSpy = vi
      .spyOn(repo, "applyModerationAction")
      .mockRejectedValue(new Error("database unavailable"));
    const result = await app.inject({
      method: "POST",
      url: `/v1/community/staff/reports/${userA}/action`,
      headers,
      payload: { action: "dismiss", reason: "test" },
    });
    expect(result.statusCode).toBe(500);
    expect(actionSpy).toHaveBeenCalledWith(
      userA,
      expect.objectContaining({ staffOperator: staffPrimary }),
      { accessToken: STAFF_TOKEN },
    );
  });

  it("requires staff auth to claim cases and list pending appeals", async () => {
    const { app } = await setupModerationApp();
    for (const request of [
      { method: "GET" as const, url: "/v1/community/staff/appeals" },
      {
        method: "POST" as const,
        url: `/v1/community/staff/reports/${userA}/claim`,
      },
    ]) {
      expect((await app.inject(request)).statusCode).toBe(401);
      expect(
        (
          await app.inject({
            ...request,
            headers: {
              authorization: `Bearer ${jwt(userA)}`,
              "x-staff-operator": staffPrimary,
            },
          })
        ).statusCode,
      ).toBe(403);
    }
  });

  it("claims with principal identity, rejects supplied operators and forwards bounded appeal paging", async () => {
    const { app, repo } = await setupModerationApp();
    await repo.saveProfile(userB, {
      handle: "claim_target",
      displayName: "Target",
      isSearchable: true,
      enrollmentConsent: { adultDeclaration: true, termsVersion: "2026-09-30" },
    });
    const report = await repo.createReport(userA, {
      targetType: "profile",
      targetId: userB,
      reason: "harassment",
    });
    const headers = {
      authorization: `Bearer ${STAFF_TOKEN}`,
      "x-staff-operator": staffBackup,
    };
    const claimSpy = vi.spyOn(repo, "claimModerationReport");
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/community/staff/reports/${report.id}/claim`,
          headers,
          payload: { staffOperator: staffBackup },
        })
      ).statusCode,
    ).toBe(422);
    expect(claimSpy).not.toHaveBeenCalled();
    const result = await app.inject({
      method: "POST",
      url: `/v1/community/staff/reports/${report.id}/claim`,
      headers,
    });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toMatchObject({
      status: "under_review",
      assignedTo: staffPrimary,
    });
    expect(claimSpy).toHaveBeenCalledWith(report.id, {
      accessToken: STAFF_TOKEN,
      staffOperator: staffPrimary,
    });
    const listSpy = vi.spyOn(repo, "getModerationAppeals");
    expect(
      (
        await app.inject({
          url: "/v1/community/staff/appeals?limit=101",
          headers,
        })
      ).statusCode,
    ).toBe(422);
    expect(listSpy).not.toHaveBeenCalled();
    expect(
      (
        await app.inject({
          url: "/v1/community/staff/appeals?limit=25&offset=3",
          headers,
        })
      ).statusCode,
    ).toBe(200);
    expect(listSpy).toHaveBeenCalledWith({
      accessToken: STAFF_TOKEN,
      limit: 25,
      offset: 3,
    });
  });

  it("GET /v1/community/staff/queue returns queue sorted with urgent reports first", async () => {
    const { app, repo } = await setupModerationApp();

    await repo.saveProfile(userB, {
      handle: "target_user",
      displayName: "Target User",
      isSearchable: true,
      enrollmentConsent: { adultDeclaration: true, termsVersion: "2026-09-30" },
    });

    // Create normal report
    const repNormal = await repo.createReport(userA, {
      targetType: "profile",
      targetId: userB,
      reason: "spam",
      notes: "Spammy profile",
      priority: "normal",
    });

    // Create urgent report after normal report
    const repUrgent = await repo.createReport(userA, {
      targetType: "profile",
      targetId: userB,
      reason: "unsafe_or_sexual_content",
      notes: "Severe violation",
      priority: "urgent",
    });

    const res = await app.inject({
      method: "GET",
      url: "/v1/community/staff/queue",
      headers: {
        authorization: `Bearer ${STAFF_TOKEN}`,
      },
    });

    expect(res.statusCode).toBe(200);
    const queue = res.json();
    expect(queue.length).toBe(2);
    // Urgent item must be first despite being created later
    expect(queue[0].id).toBe(repUrgent.id);
    expect(queue[0].priority).toBe("urgent");
    expect(queue[1].id).toBe(repNormal.id);
    expect(queue[1].priority).toBe("normal");
  });

  it("POST /v1/community/staff/reports/:id/action executes remove action on shared activity", async () => {
    const { app, repo } = await setupModerationApp();

    const profB = await repo.saveProfile(userB, {
      handle: "author_b",
      displayName: "Author B",
      isSearchable: true,
      enrollmentConsent: { adultDeclaration: true, termsVersion: "2026-09-30" },
    });

    const published = await repo.publishActivity(userB, {
      sourceWorkoutId: "w-1",
      category: "running",
      sharedDay: "2026-09-30",
      durationSeconds: 1800,
      enrollmentGeneration: profB.generation,
      operationId: "op-1",
    });

    const relationship = await repo.sendFollowRequest(userA, userB);
    await repo.updateRelationshipStatus(relationship.id, userB, "approved");
    const report = await repo.createReport(userA, {
      targetType: "activity",
      targetId: published.id,
      reason: "harassment",
      notes: "Contains abusive workout title",
    });

    const res = await app.inject({
      method: "POST",
      url: `/v1/community/staff/reports/${report.id}/action`,
      headers: {
        authorization: `Bearer ${STAFF_TOKEN}`,
        "x-staff-operator": "adam_hikl",
      },
      payload: {
        action: "remove",
        reason: "Violates Community Standards on harassment",
        staffNotes: "Verified abusive text in card metadata. Removed.",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("resolved");
    expect(body.decision).toBe("remove");
    expect(body.assignedTo).toBe(staffPrimary);

    // Verify activity revoked
    const act = await repo.getActivityById(published.id);
    expect(act?.revokedAt).toBeDefined();
  });

  it("POST /v1/community/staff/reports/:id/action executes suspend action on user profile", async () => {
    const { app, repo } = await setupModerationApp();

    await repo.saveProfile(userB, {
      handle: "harasser_user",
      displayName: "Harasser",
      isSearchable: true,
      enrollmentConsent: { adultDeclaration: true, termsVersion: "2026-09-30" },
    });

    const report = await repo.createReport(userA, {
      targetType: "profile",
      targetId: userB,
      reason: "harassment",
    });

    const res = await app.inject({
      method: "POST",
      url: `/v1/community/staff/reports/${report.id}/action`,
      headers: {
        authorization: `Bearer ${STAFF_TOKEN}`,
        "x-staff-operator": "adam_hikl",
      },
      payload: {
        action: "suspend",
        reason: "Persistent harassment violations",
        suspensionDurationDays: 14,
        staffNotes: "14-day temporary social suspension issued",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().decision).toBe("suspend");

    // Verify profile is suspended
    const prof = await repo.getProfile(userB);
    expect(prof?.status).toBe("withdrawn");
  });

  it("POST /v1/community/staff/appeals/:id/review performs independent second review without resurrecting enrollment", async () => {
    const { app, repo } = await setupModerationApp();

    await repo.saveProfile(userB, {
      handle: "appellant",
      displayName: "Appellant",
      isSearchable: true,
      enrollmentConsent: { adultDeclaration: true, termsVersion: "2026-09-30" },
    });

    const report = await repo.createReport(userA, {
      targetType: "profile",
      targetId: userB,
      reason: "harassment",
    });

    // Primary operator suspends userB
    await repo.applyModerationAction(report.id, {
      decision: "suspend",
      decisionReason: "Suspected harassment",
      staffOperator: staffPrimary,
      suspensionDurationDays: 7,
    });
    expect((await repo.getProfile(userB))?.status).toBe("withdrawn");

    // userB appeals
    const appeal = await repo.createModerationAppeal(userB, {
      reportId: report.id,
      reason: "Context was misunderstood, banter between real life friends.",
    });

    const sameReviewer = await app.inject({
      method: "POST",
      url: `/v1/community/staff/appeals/${appeal.id}/review`,
      headers: {
        authorization: `Bearer ${STAFF_TOKEN}`,
        "x-staff-operator": staffBackup,
      },
      payload: { decision: "approved" },
    });
    expect(sameReviewer.statusCode).toBe(409);
    const resolveSpy = vi.spyOn(repo, "resolveModerationAppeal");

    // Backup operator reviews appeal
    const res = await app.inject({
      method: "POST",
      url: `/v1/community/staff/appeals/${appeal.id}/review`,
      headers: {
        authorization: `Bearer ${BACKUP_TOKEN}`,
        "x-staff-operator": "spoofed_primary",
      },
      payload: {
        decision: "approved",
        reviewerNotes:
          "Verified mutual relationship and benign context. Reversing suspension.",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("approved");
    expect(res.json().reviewedBy).toBe(staffBackup);
    expect(resolveSpy).toHaveBeenCalledWith(
      appeal.id,
      expect.objectContaining({ reviewedBy: staffBackup }),
      { accessToken: BACKUP_TOKEN },
    );
    const repeat = await app.inject({
      method: "POST",
      url: `/v1/community/staff/appeals/${appeal.id}/review`,
      headers: { authorization: `Bearer ${BACKUP_TOKEN}` },
      payload: { decision: "approved" },
    });
    expect(repeat.statusCode).toBe(409);

    // Approval reverses the sanction; social enrollment needs fresh explicit consent.
    const restoredProf = await repo.getProfile(userB);
    expect(restoredProf?.status).toBe("withdrawn");
  });
});
