import type { FastifyPluginAsync } from "fastify";
import { CommunityMutationError, type CommunityRepository } from "@mizyun/core";
import {
  createCommunityReportSchema,
  createModerationAppealSchema,
  safetyContactInfoSchema,
} from "@mizyun/contracts";
import { sendApiError } from "../../errors.js";
import { registerCommunityErrorHandler } from "./error-handler.js";
import type {
  StoredCommunityReport,
  StoredModerationAppeal,
} from "@mizyun/core";

export interface ReportRoutesOptions {
  readonly communityRepository: CommunityRepository;
  readonly safetyContact?: {
    readonly contactEmail: string;
    readonly standardsUrl: string;
    readonly verified: boolean;
  };
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const receiptTargetSchema = createCommunityReportSchema.pick({
  targetType: true,
  targetId: true,
});
const summary = (r: StoredCommunityReport) => ({
  id: r.id,
  targetType: r.targetType,
  targetId: r.targetId,
  reason: r.reason,
  status: r.status,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});
const ownerAppeal = (a: StoredModerationAppeal) => ({
  id: a.id,
  reportId: a.reportId,
  appellantUserId: a.appellantUserId,
  reason: a.reason,
  status: a.status,
  reviewedBy: null,
  reviewerNotes: null,
  resolvedAt: a.resolvedAt?.toISOString() ?? null,
  createdAt: a.createdAt.toISOString(),
});

export const reportRoutes: FastifyPluginAsync<ReportRoutesOptions> = async (
  app,
  options,
) => {
  registerCommunityErrorHandler(app);
  const configured = options.safetyContact ?? {
    contactEmail: process.env.COMMUNITY_SAFETY_EMAIL ?? "",
    standardsUrl: process.env.COMMUNITY_STANDARDS_URL ?? "",
    verified: process.env.COMMUNITY_SAFETY_CONTACT_VERIFIED === "true",
  };
  const contact = safetyContactInfoSchema.safeParse({
    available: configured.verified,
    contactEmail: configured.verified ? configured.contactEmail : null,
    standardsUrl: configured.verified ? configured.standardsUrl : null,
    emergencyAdvice:
      "If someone is in immediate danger, contact local emergency services.",
    ordinaryResponseHours: 24,
    urgentResponseHours: 4,
  });
  const safety = contact.success
    ? contact.data
    : {
        available: false,
        contactEmail: null,
        standardsUrl: null,
        emergencyAdvice:
          "If someone is in immediate danger, contact local emergency services.",
        ordinaryResponseHours: 24,
        urgentResponseHours: 4,
      };
  app.get("/safety/contact", async () => safety);
  app.post(
    "/safety/receipts",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = request.principal!;
      const parsed = receiptTargetSchema.safeParse(request.body);
      if (!parsed.success || !UUID.test(parsed.data.targetId))
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          "Invalid report target.",
        );
      const id = await options.communityRepository.issueReportReceipt(
        principal.userId,
        parsed.data.targetType,
        parsed.data.targetId,
        { accessToken: principal.accessToken },
      );
      return { id };
    },
  );
  app.get(
    "/safety/receipts",
    { preHandler: app.authenticate },
    async (request) => {
      const p = request.principal!;
      return (
        await options.communityRepository.listReportReceipts(p.userId, {
          accessToken: p.accessToken,
        })
      ).map((r) => ({ ...r, expiresAt: r.expiresAt.toISOString() }));
    },
  );
  app.get(
    "/safety/notices",
    { preHandler: app.authenticate },
    async (request) => {
      const p = request.principal!;
      return (
        await options.communityRepository.getModerationNotices(p.userId, {
          accessToken: p.accessToken,
        })
      ).map((r) => ({
        ...summary(r),
        decision: r.decision ?? null,
        actionTakenAt: r.actionTakenAt?.toISOString() ?? null,
        suspensionExpiresAt: r.suspensionExpiresAt?.toISOString() ?? null,
      }));
    },
  );
  app.post(
    "/reports",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = request.principal!;
      const parsed = createCommunityReportSchema.safeParse(request.body);
      if (!parsed.success || !UUID.test(parsed.data.targetId))
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          "Use a valid target, reason and at most 1,000 characters of details.",
        );
      const {
        targetType,
        targetId,
        reason,
        notes,
        alsoBlock,
        interactionReceiptId,
      } = parsed.data;
      try {
        const report = await options.communityRepository.createReport(
          principal.userId,
          {
            targetType,
            targetId,
            reason,
            ...(notes !== undefined ? { notes } : {}),
            ...(interactionReceiptId ? { interactionReceiptId } : {}),
          },
          { accessToken: principal.accessToken },
        );
        let blocked = false;
        if (alsoBlock && targetType === "profile") {
          try {
            await options.communityRepository.blockUser(
              principal.userId,
              targetId as typeof principal.userId,
              { accessToken: principal.accessToken },
            );
            blocked = true;
          } catch {
            /* Report receipt remains valid even when block fails. */
          }
        }
        reply.status(201);
        return {
          id: report.id,
          status: report.status,
          createdAt: report.createdAt.toISOString(),
          safetyContact: safety.contactEmail,
          blocked,
          message:
            "Report received. Filing a report does not itself impose a sanction.",
        };
      } catch (err) {
        if (
          err instanceof CommunityMutationError &&
          err.code === "rate_limited"
        )
          return sendApiError(
            reply,
            request,
            429,
            "RATE_LIMITED",
            `Daily report limit reached (10 new cases). ${safety.contactEmail ? `Contact ${safety.contactEmail} for safety concerns.` : "Safety contact is awaiting verification."} For immediate danger contact local emergency services.`,
          );
        throw err;
      }
    },
  );
  app.get("/reports", { preHandler: app.authenticate }, async (request) => {
    const p = request.principal!;
    return (
      await options.communityRepository.getReportsByReporter(p.userId, {
        accessToken: p.accessToken,
      })
    ).map(summary);
  });
  app.get(
    "/reports/:id",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const p = request.principal!;
      const { id } = request.params as { id: string };
      if (!UUID.test(id))
        return sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "Report not found.",
        );
      const r = await options.communityRepository.getReportById(id, {
        accessToken: p.accessToken,
      });
      if (!r || r.reporterUserId !== p.userId)
        return sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "Report not found.",
        );
      return summary(r);
    },
  );
  app.post(
    "/appeals",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const p = request.principal!;
      const parsed = createModerationAppealSchema.safeParse(request.body);
      if (!parsed.success)
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          "Enter a decision reference and at most 1,000 characters of appeal details.",
        );
      const a = await options.communityRepository.createModerationAppeal(
        p.userId,
        parsed.data,
        { accessToken: p.accessToken },
      );
      reply.status(201);
      return ownerAppeal(a);
    },
  );
  app.get(
    "/appeals/:id",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const p = request.principal!;
      const { id } = request.params as { id: string };
      if (!UUID.test(id))
        return sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "Appeal not found.",
        );
      const a = await options.communityRepository.getAppealById(id, {
        accessToken: p.accessToken,
      });
      if (!a || a.appellantUserId !== p.userId)
        return sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "Appeal not found.",
        );
      return ownerAppeal(a);
    },
  );
};
