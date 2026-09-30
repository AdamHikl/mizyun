import { describe, expect, it, vi } from "vitest";
import fastify, { type FastifyInstance } from "fastify";
import type { UserId } from "@mizyun/core";
import { InMemoryCommunityRepository } from "../../community-repository.js";
import { reportRoutes } from "./report-routes.js";

const userA = "a0000000-0000-4000-8000-000000000001" as UserId;
const userB = "b0000000-0000-4000-8000-000000000002" as UserId;
const userC = "c0000000-0000-4000-8000-000000000003" as UserId;

const setupTestApp = async (options?: {
  repo?: InMemoryCommunityRepository;
  userId?: string;
}): Promise<{
  app: FastifyInstance;
  repo: InMemoryCommunityRepository;
  setPrincipal: (userId: string) => void;
}> => {
  const repo = options?.repo ?? new InMemoryCommunityRepository();
  let currentUserId = options?.userId ?? userA;
  await repo.saveProfile(userA, {
    handle: "reporter",
    displayName: "Reporter",
    enrollmentConsent: { adultDeclaration: true, termsVersion: "2026-09-30" },
  });

  const app = fastify();
  app.decorate("authenticate", async (req: any) => {
    req.principal = {
      userId: currentUserId,
      accessToken: `token-${currentUserId}`,
      role: "authenticated",
    };
  });

  await app.register(reportRoutes, {
    prefix: "/v1/community",
    communityRepository: repo,
    safetyContact: {
      verified: true,
      contactEmail: "safety@example.test",
      standardsUrl: "https://example.test/rules",
    },
  });

  await app.ready();

  return {
    app,
    repo,
    setPrincipal: (userId: string) => {
      currentUserId = userId;
    },
  };
};

describe("report-routes", () => {
  it("GET /v1/community/safety/contact returns configured verified contact and guidelines", async () => {
    const { app } = await setupTestApp();

    const res = await app.inject({
      method: "GET",
      url: "/v1/community/safety/contact",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.contactEmail).toBe("safety@example.test");
    expect(body.emergencyAdvice).toContain("local emergency services");
    expect(body.ordinaryResponseHours).toBe(24);
    expect(body.urgentResponseHours).toBe(4);
  });

  it("POST /v1/community/reports files confidential report successfully", async () => {
    const { app, repo } = await setupTestApp({ userId: userA });

    // Enroll userB
    await repo.saveProfile(userB, {
      handle: "bad_user",
      displayName: "Bad User",
      isSearchable: true,
      enrollmentConsent: { adultDeclaration: true, termsVersion: "2026-09-30" },
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/community/reports",
      payload: {
        targetType: "profile",
        targetId: userB,
        reason: "harassment",
        notes: "Target sent unwanted messages",
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.status).toBe("submitted");
    expect(body.safetyContact).toBe("safety@example.test");
  });

  it("POST /v1/community/reports sets priority to urgent for unsafe_or_sexual_content", async () => {
    const { app, repo } = await setupTestApp({ userId: userA });

    await repo.saveProfile(userB, {
      handle: "unsafe_user",
      displayName: "Unsafe User",
      isSearchable: true,
      enrollmentConsent: { adultDeclaration: true, termsVersion: "2026-09-30" },
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/community/reports",
      payload: {
        targetType: "profile",
        targetId: userB,
        reason: "unsafe_or_sexual_content",
        notes: "Severe prohibited content",
      },
    });

    expect(res.statusCode).toBe(201);
    const reportId = res.json().id;
    const report = await repo.getReportById(reportId);
    expect(report?.priority).toBe("urgent");
  });

  it("POST /v1/community/reports blocks target if alsoBlock is true", async () => {
    const { app, repo } = await setupTestApp({ userId: userA });

    await repo.saveProfile(userA, {
      handle: "reporter",
      displayName: "Reporter A",
      isSearchable: true,
      enrollmentConsent: { adultDeclaration: true, termsVersion: "2026-09-30" },
    });

    await repo.saveProfile(userB, {
      handle: "target_block",
      displayName: "Target Block",
      isSearchable: true,
      enrollmentConsent: { adultDeclaration: true, termsVersion: "2026-09-30" },
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/community/reports",
      payload: {
        targetType: "profile",
        targetId: userB,
        reason: "harassment",
        alsoBlock: true,
      },
    });

    expect(res.statusCode).toBe(201);
    const blocks = await repo.getBlockedUsers(userA);
    expect(blocks.some((b) => b.block.blockedUserId === userB)).toBe(true);
  });

  it("POST /v1/community/reports accepts bounded confidential evidence quoting prohibited content", async () => {
    const { app, repo } = await setupTestApp({ userId: userA });

    await repo.saveProfile(userB, {
      handle: "user_b",
      displayName: "User B",
      isSearchable: true,
      enrollmentConsent: { adultDeclaration: true, termsVersion: "2026-09-30" },
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/community/reports",
      payload: {
        targetType: "profile",
        targetId: userB,
        reason: "harassment",
        notes: "You should kill yourself",
      },
    });

    expect(res.statusCode).toBe(201);
  });

  it("enforces 10 reports/day rate limit with safety contact in error message", async () => {
    const { app, repo } = await setupTestApp({ userId: userA });

    await repo.saveProfile(userB, {
      handle: "spam_target",
      displayName: "Spam Target",
      isSearchable: true,
      enrollmentConsent: { adultDeclaration: true, termsVersion: "2026-09-30" },
    });

    // Ten distinct targets consume quota; retries of the same case do not.
    // File 10 reports
    for (let i = 0; i < 10; i++) {
      const target =
        `d0000000-0000-4000-8000-${String(i).padStart(12, "0")}` as UserId;
      await repo.saveProfile(target, {
        handle: `quota_${i}`,
        displayName: "Quota",
        isSearchable: true,
        enrollmentConsent: {
          adultDeclaration: true,
          termsVersion: "2026-09-30",
        },
      });
      const res = await app.inject({
        method: "POST",
        url: "/v1/community/reports",
        payload: {
          targetType: "profile",
          targetId: target,
          reason: "spam",
        },
      });
      expect(res.statusCode).toBe(201);
    }

    // 11th report is rate limited
    const res11 = await app.inject({
      method: "POST",
      url: "/v1/community/reports",
      payload: {
        targetType: "profile",
        targetId: userB,
        reason: "spam",
      },
    });

    expect(res11.statusCode).toBe(429);
    expect(res11.json().error.message).toContain("Daily report limit reached");
    expect(res11.json().error.message).toContain("safety@example.test");
  });

  it("GET /v1/community/reports lists caller's own submitted reports only", async () => {
    const { app, repo, setPrincipal } = await setupTestApp({ userId: userA });

    await repo.saveProfile(userB, {
      handle: "target_b",
      displayName: "Target B",
      isSearchable: true,
      enrollmentConsent: { adultDeclaration: true, termsVersion: "2026-09-30" },
    });
    await repo.saveProfile(userC, {
      handle: "target_c",
      displayName: "Target C",
      isSearchable: true,
      enrollmentConsent: { adultDeclaration: true, termsVersion: "2026-09-30" },
    });

    // userA reports userB
    await app.inject({
      method: "POST",
      url: "/v1/community/reports",
      payload: { targetType: "profile", targetId: userB, reason: "harassment" },
    });

    // userC reports userB
    setPrincipal(userC);
    await app.inject({
      method: "POST",
      url: "/v1/community/reports",
      payload: {
        targetType: "profile",
        targetId: userB,
        reason: "impersonation",
      },
    });

    // userA views their reports
    setPrincipal(userA);
    const resA = await app.inject({
      method: "GET",
      url: "/v1/community/reports",
    });

    expect(resA.statusCode).toBe(200);
    const listA = resA.json();
    expect(listA.length).toBe(1);
    expect(listA[0].reason).toBe("harassment");

    // userB (reported target) cannot see reports filed against them
    setPrincipal(userB);
    const resB = await app.inject({
      method: "GET",
      url: "/v1/community/reports",
    });
    expect(resB.statusCode).toBe(200);
    expect(resB.json().length).toBe(0);
  });

  it("GET /v1/community/reports/:id forbids arbitrary report inspection", async () => {
    const { app, repo, setPrincipal } = await setupTestApp({ userId: userA });

    await repo.saveProfile(userB, {
      handle: "target_user",
      displayName: "Target User",
      isSearchable: true,
      enrollmentConsent: { adultDeclaration: true, termsVersion: "2026-09-30" },
    });

    const createRes = await app.inject({
      method: "POST",
      url: "/v1/community/reports",
      payload: { targetType: "profile", targetId: userB, reason: "spam" },
    });
    const reportId = createRes.json().id;

    // Reporter userA can view report
    const resA = await app.inject({
      method: "GET",
      url: `/v1/community/reports/${reportId}`,
    });
    expect(resA.statusCode).toBe(200);
    expect(resA.json().id).toBe(reportId);

    // Other user userC receives 404 (no enumeration)
    setPrincipal(userC);
    const resC = await app.inject({
      method: "GET",
      url: `/v1/community/reports/${reportId}`,
    });
    expect(resC.statusCode).toBe(404);

    // Reported subject userB receives 404
    setPrincipal(userB);
    const resB = await app.inject({
      method: "GET",
      url: `/v1/community/reports/${reportId}`,
    });
    expect(resB.statusCode).toBe(404);
  });

  it("POST /v1/community/appeals allows filing an appeal", async () => {
    const { app, repo, setPrincipal } = await setupTestApp({ userId: userA });

    await repo.saveProfile(userB, {
      handle: "appellant_user",
      displayName: "Appellant User",
      isSearchable: true,
      enrollmentConsent: { adultDeclaration: true, termsVersion: "2026-09-30" },
    });

    const createRes = await app.inject({
      method: "POST",
      url: "/v1/community/reports",
      payload: { targetType: "profile", targetId: userB, reason: "harassment" },
    });
    const reportId = createRes.json().id;

    await repo.applyModerationAction(reportId, {
      decision: "warn",
      decisionReason: "Harassment",
      staffOperator: "staff-a",
    });
    // userB appeals
    setPrincipal(userB);
    const appealRes = await app.inject({
      method: "POST",
      url: "/v1/community/appeals",
      payload: {
        reportId,
        reason: "The interaction was friendly, not harassment.",
      },
    });

    expect(appealRes.statusCode).toBe(201);
    const appealBody = appealRes.json();
    expect(appealBody.reportId).toBe(reportId);
    expect(appealBody.status).toBe("pending");
  });
  it("rejects fabricated, mismatched and wrong-owner receipts while preserving reporting after withdrawal", async () => {
    const { app, repo, setPrincipal } = await setupTestApp();
    await repo.saveProfile(userB, {
      handle: "subject",
      displayName: "Subject",
      isSearchable: true,
      enrollmentConsent: { adultDeclaration: true, termsVersion: "2026-09-30" },
    });
    const id = await repo.issueReportReceipt(userA, "profile", userB);
    await repo.withdrawProfile(userA);
    await repo.withdrawProfile(userB);
    const payload = {
      targetType: "profile",
      targetId: userB,
      reason: "harassment",
      interactionReceiptId: id,
    };
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/community/reports",
          payload: {
            ...payload,
            interactionReceiptId: "e0000000-0000-4000-8000-000000000001",
          },
        })
      ).statusCode,
    ).toBe(404);
    setPrincipal(userC);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/community/reports",
          payload,
        })
      ).statusCode,
    ).toBe(404);
    setPrincipal(userA);
    const res = await app.inject({
      method: "POST",
      url: "/v1/community/reports",
      payload,
    });
    expect(res.statusCode).toBe(201);
    const retry = await app.inject({
      method: "POST",
      url: "/v1/community/reports",
      payload: { ...payload, notes: "Quoted CSAM threat" },
    });
    expect(retry.json().id).toBe(res.json().id);
    expect((await repo.getReportsByReporter(userA)).length).toBe(1);
    expect(await repo.getProfile(userB)).toMatchObject({ status: "withdrawn" });
  });
  it("allows only the sanctioned subject to appeal and withholds staff identity and notes", async () => {
    const { app, repo, setPrincipal } = await setupTestApp();
    await repo.saveProfile(userB, {
      handle: "subject",
      displayName: "Subject",
      isSearchable: true,
      enrollmentConsent: { adultDeclaration: true, termsVersion: "2026-09-30" },
    });
    const report = await repo.createReport(userA, {
      targetType: "profile",
      targetId: userB,
      reason: "harassment",
    });
    await expect(
      repo.claimModerationReport(report.id, { staffOperator: userA }),
    ).rejects.toMatchObject({ code: "access_denied" });
    await expect(
      repo.claimModerationReport(report.id, { staffOperator: userB }),
    ).rejects.toMatchObject({ code: "access_denied" });
    await expect(
      repo.applyModerationAction(report.id, {
        decision: "warn",
        decisionReason: "Self review",
        staffOperator: userA,
      }),
    ).rejects.toMatchObject({ code: "access_denied" });
    await repo.applyModerationAction(report.id, {
      decision: "warn",
      decisionReason: "Policy",
      staffOperator: "staff-a",
      staffNotes: "Internal",
    });
    setPrincipal(userC);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/community/appeals",
          payload: { reportId: report.id, reason: "Appeal" },
        })
      ).statusCode,
    ).toBe(404);
    setPrincipal(userB);
    const res = await app.inject({
      method: "POST",
      url: "/v1/community/appeals",
      payload: { reportId: report.id, reason: "Quote: kill yourself" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().reviewedBy).toBeNull();
    expect(res.json().reviewerNotes).toBeNull();
    const appealId = res.json().id;
    await expect(
      repo.resolveModerationAppeal(appealId, {
        status: "approved",
        reviewedBy: userA,
      }),
    ).rejects.toBeInstanceOf(Error);
    await expect(
      repo.resolveModerationAppeal(appealId, {
        status: "approved",
        reviewedBy: userB,
      }),
    ).rejects.toBeInstanceOf(Error);
    await expect(
      repo.resolveModerationAppeal(appealId, {
        status: "approved",
        reviewedBy: "staff-a",
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    await repo.resolveModerationAppeal(appealId, {
      status: "rejected",
      reviewedBy: "staff-b",
      reviewerNotes: "Confidential",
    });
    const detail = await app.inject({
      method: "GET",
      url: `/v1/community/appeals/${appealId}`,
    });
    expect(detail.json().reviewerNotes).toBeNull();
  });
  it("checks exact receipt subject, type and 30-day expiry boundary", async () => {
    const { app, repo } = await setupTestApp();
    await repo.saveProfile(userB, {
      handle: "boundary_subject",
      displayName: "Subject",
      isSearchable: true,
      enrollmentConsent: { adultDeclaration: true, termsVersion: "2026-09-30" },
    });
    const id = await repo.issueReportReceipt(userA, "profile", userB);
    const expiresAt = (
      await repo.listReportReceipts(userA)
    )[0]!.expiresAt.getTime();
    const payload = {
      targetType: "profile",
      targetId: userB,
      reason: "harassment",
      interactionReceiptId: id,
    };
    for (const wrong of [
      { ...payload, targetId: userC },
      { ...payload, targetType: "activity" },
    ])
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/v1/community/reports",
            payload: wrong,
          })
        ).statusCode,
      ).toBe(404);
    const clock = vi.spyOn(Date, "now").mockReturnValue(expiresAt);
    try {
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/v1/community/reports",
            payload,
          })
        ).statusCode,
      ).toBe(404);
    } finally {
      clock.mockRestore();
    }
  });
  it("keeps a removed activity reportable without republishing after appeal or reenrollment", async () => {
    const { app, repo } = await setupTestApp();
    const subject = await repo.saveProfile(userB, {
      handle: "author",
      displayName: "Author",
      isSearchable: true,
      enrollmentConsent: { adultDeclaration: true, termsVersion: "2026-09-30" },
    });
    const edge = await repo.sendFollowRequest(userA, userB);
    await repo.updateRelationshipStatus(edge.id, userB, "approved");
    const card = await repo.publishActivity(userB, {
      sourceWorkoutId: "synthetic",
      durationSeconds: null,
      category: "running",
      sharedDay: "2026-09-30",
      enrollmentGeneration: subject.generation,
      operationId: "synthetic",
    });
    const activeCard = await repo.publishActivity(userB, {
      sourceWorkoutId: "synthetic2",
      durationSeconds: null,
      category: "running",
      sharedDay: "2026-09-30",
      enrollmentGeneration: subject.generation,
      operationId: "synthetic2",
    });
    const id = await repo.issueReportReceipt(userA, "activity", card.id);
    await repo.revokeActivity(card.id, userB);
    const res = await app.inject({
      method: "POST",
      url: "/v1/community/reports",
      payload: {
        targetType: "activity",
        targetId: card.id,
        reason: "harassment",
        interactionReceiptId: id,
      },
    });
    expect(res.statusCode).toBe(201);
    await repo.applyModerationAction(res.json().id, {
      decision: "suspend",
      decisionReason: "Policy",
      staffOperator: "staff-a",
      suspensionDurationDays: 7,
    });
    const appeal = await repo.createModerationAppeal(userB, {
      reportId: res.json().id,
      reason: "Context",
    });
    await repo.resolveModerationAppeal(appeal.id, {
      status: "approved",
      reviewedBy: "staff-b",
    });
    await repo.saveProfile(userB, {
      handle: "author",
      displayName: "Author",
      enrollmentConsent: { adultDeclaration: true, termsVersion: "2026-09-30" },
    });
    expect((await repo.getActivityById(card.id))?.revokedAt).not.toBeNull();
    expect(
      (await repo.getActivityById(activeCard.id))?.revokedAt,
    ).not.toBeNull();
  });
});
