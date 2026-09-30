import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type { CommunityRepository, StoredCommunityReport } from "@mizyun/core";
import {
  moderationActionSchema,
  type ModerationAppealDto,
  type ModerationQueueItem,
} from "@mizyun/contracts";
import { sendApiError } from "../../errors.js";
import { registerCommunityErrorHandler } from "./error-handler.js";

const GENERIC_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const reportDto = (report: StoredCommunityReport): ModerationQueueItem => ({
  ...(report.evidenceSnapshot
    ? { evidenceSnapshot: report.evidenceSnapshot }
    : {}),
  id: report.id,
  reporterUserId: report.reporterUserId,
  targetType: report.targetType,
  targetId: report.targetId,
  reason: report.reason,
  notes: report.notes,
  status: report.status,
  priority: report.priority,
  assignedTo: report.assignedTo ?? null,
  decision: report.decision ?? null,
  decisionReason: report.decisionReason ?? null,
  staffNotes: report.staffNotes ?? null,
  actionTakenAt: report.actionTakenAt?.toISOString() ?? null,
  createdAt: report.createdAt.toISOString(),
  updatedAt: report.updatedAt.toISOString(),
});

export interface ModerationRoutesOptions {
  readonly communityRepository: CommunityRepository;
  readonly moderatorUserIds?: readonly string[];
}

export const moderationRoutes: FastifyPluginAsync<
  ModerationRoutesOptions
> = async (app, options) => {
  registerCommunityErrorHandler(app);

  const moderatorUserIds =
    options.moderatorUserIds ??
    (process.env.COMMUNITY_MODERATOR_USER_IDS ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
  const configured =
    moderatorUserIds.length > 0 &&
    moderatorUserIds.every((id) => GENERIC_UUID.test(id));

  // Only the verified session identifies the operator; client headers are ignored.
  const requireStaffAuth = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<boolean> => {
    const principal = request.principal;
    let hasMfa = false;
    if (principal) {
      try {
        const payload = principal.accessToken.split(".")[1];
        hasMfa =
          payload !== undefined &&
          JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).aal ===
            "aal2";
      } catch {
        /* malformed/non-JWT tokens fail closed */
      }
    }
    if (
      !configured ||
      !principal ||
      !moderatorUserIds.includes(principal.userId) ||
      !hasMfa
    ) {
      sendApiError(
        reply,
        request,
        403,
        "FORBIDDEN",
        "A configured staff account with MFA is required.",
      );
      return false;
    }
    return true;
  };

  // GET /v1/community/staff/queue — list moderation queue items
  app.get(
    "/staff/queue",
    { preHandler: app.authenticate },
    async (request, reply): Promise<readonly ModerationQueueItem[] | void> => {
      if (!(await requireStaffAuth(request, reply))) return;

      const query = request.query as Record<string, unknown>;
      if (
        Object.keys(query).some(
          (key) => !["status", "limit", "offset"].includes(key),
        ) ||
        (query.status !== undefined &&
          !["submitted", "under_review", "resolved", "dismissed"].includes(
            String(query.status),
          ))
      ) {
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          "Invalid moderation queue filter.",
        );
      }
      const limit = query.limit === undefined ? 50 : Number(query.limit);
      const offset = query.offset === undefined ? 0 : Number(query.offset);
      if (
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 100 ||
        !Number.isInteger(offset) ||
        offset < 0 ||
        offset > 10000
      ) {
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          "Use limit 1..100 and offset 0..10000.",
        );
      }
      const status = query.status as
        "submitted" | "under_review" | "resolved" | "dismissed" | undefined;
      const reports = await options.communityRepository.getModerationQueue({
        accessToken: request.principal!.accessToken,
        limit,
        offset,
        ...(status ? { status } : {}),
      });

      return reports.map(reportDto);
    },
  );

  app.get(
    "/staff/reports/:id",
    { preHandler: app.authenticate },
    async (request, reply) => {
      if (!(await requireStaffAuth(request, reply))) return;
      const { id } = request.params as { id: string };
      if (!GENERIC_UUID.test(id))
        return sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "Report not found.",
        );
      const report = await options.communityRepository.getReportById(id, {
        accessToken: request.principal!.accessToken,
      });
      if (!report)
        return sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "Report not found.",
        );
      return reportDto(report);
    },
  );

  app.post(
    "/staff/reports/:id/claim",
    { preHandler: app.authenticate },
    async (request, reply) => {
      if (!(await requireStaffAuth(request, reply))) return;
      const { id } = request.params as { id: string };
      if (!GENERIC_UUID.test(id))
        return sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "Report not found.",
        );
      if (request.body !== undefined && request.body !== null)
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          "Claim identity is derived from the authenticated staff session; no body is accepted.",
        );
      return reportDto(
        await options.communityRepository.claimModerationReport(id, {
          accessToken: request.principal!.accessToken,
          staffOperator: request.principal!.userId,
        }),
      );
    },
  );

  app.get(
    "/staff/appeals",
    { preHandler: app.authenticate },
    async (request, reply): Promise<readonly ModerationAppealDto[] | void> => {
      if (!(await requireStaffAuth(request, reply))) return;
      const query = request.query as Record<string, unknown>;
      const limit = query.limit === undefined ? 50 : Number(query.limit);
      const offset = query.offset === undefined ? 0 : Number(query.offset);
      if (
        Object.keys(query).some((key) => !["limit", "offset"].includes(key)) ||
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 100 ||
        !Number.isInteger(offset) ||
        offset < 0 ||
        offset > 10000
      )
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          "Use limit 1..100 and offset 0..10000.",
        );
      const appeals = await options.communityRepository.getModerationAppeals({
        accessToken: request.principal!.accessToken,
        limit,
        offset,
      });
      return appeals.map((appeal) => ({
        id: appeal.id,
        reportId: appeal.reportId,
        appellantUserId: appeal.appellantUserId,
        reason: appeal.reason,
        status: appeal.status,
        reviewedBy: appeal.reviewedBy,
        reviewerNotes: appeal.reviewerNotes,
        resolvedAt: appeal.resolvedAt?.toISOString() ?? null,
        createdAt: appeal.createdAt.toISOString(),
      }));
    },
  );

  // POST /v1/community/staff/reports/:id/action — execute moderation decision
  app.post(
    "/staff/reports/:id/action",
    { preHandler: app.authenticate },
    async (request, reply): Promise<ModerationQueueItem | void> => {
      if (!(await requireStaffAuth(request, reply))) return;

      const { id } = request.params as { id: string };
      if (!GENERIC_UUID.test(id)) {
        return sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "Report not found.",
        );
      }

      const parsed = moderationActionSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          parsed.error.issues.map((i) => i.message).join("; "),
        );
      }

      const staffOperator = request.principal!.userId;

      const { action, reason, staffNotes, suspensionDurationDays } =
        parsed.data;

      const report = await options.communityRepository.applyModerationAction(
        id,
        {
          decision: action,
          decisionReason: reason,
          staffOperator,
          ...(staffNotes !== undefined ? { staffNotes } : {}),
          ...(suspensionDurationDays !== undefined
            ? { suspensionDurationDays }
            : {}),
        },
        { accessToken: request.principal!.accessToken },
      );

      return reportDto(report);
    },
  );

  // POST /v1/community/staff/appeals/:id/review — independent second review of appeal
  app.post(
    "/staff/appeals/:id/review",
    { preHandler: app.authenticate },
    async (request, reply): Promise<ModerationAppealDto | void> => {
      if (!(await requireStaffAuth(request, reply))) return;

      const { id } = request.params as { id: string };
      if (!GENERIC_UUID.test(id)) {
        return sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "Appeal not found.",
        );
      }

      const body = request.body;
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          "Appeal review body is required.",
        );
      }
      const input = body as Record<string, unknown>;
      if (
        Object.keys(input).some(
          (key) => !["decision", "reviewerNotes"].includes(key),
        ) ||
        !["approved", "rejected"].includes(String(input.decision)) ||
        (input.reviewerNotes !== undefined &&
          (typeof input.reviewerNotes !== "string" ||
            input.reviewerNotes.trim().length > 1000))
      ) {
        return sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          "Provide approved/rejected decision and at most 1000 characters of reviewer notes.",
        );
      }
      const staffOperator = request.principal!.userId;
      const repoOptions = { accessToken: request.principal!.accessToken };
      const pendingAppeal = await options.communityRepository.getAppealById(
        id,
        repoOptions,
      );
      if (!pendingAppeal)
        return sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "Appeal not found.",
        );
      const decidedReport = await options.communityRepository.getReportById(
        pendingAppeal.reportId,
        repoOptions,
      );
      if (
        pendingAppeal.status !== "pending" ||
        !decidedReport ||
        decidedReport.assignedTo === staffOperator
      ) {
        return sendApiError(
          reply,
          request,
          409,
          "CONFLICT",
          "Appeal requires an independent staff reviewer and pending decision.",
        );
      }

      const appeal = await options.communityRepository.resolveModerationAppeal(
        id,
        {
          status: input.decision as "approved" | "rejected",
          reviewerNotes:
            typeof input.reviewerNotes === "string"
              ? input.reviewerNotes.trim()
              : null,
          reviewedBy: staffOperator,
        },
        { accessToken: request.principal!.accessToken },
      );

      return {
        id: appeal.id,
        reportId: appeal.reportId,
        appellantUserId: appeal.appellantUserId,
        reason: appeal.reason,
        status: appeal.status,
        reviewedBy: appeal.reviewedBy,
        reviewerNotes: appeal.reviewerNotes,
        resolvedAt: appeal.resolvedAt ? appeal.resolvedAt.toISOString() : null,
        createdAt: appeal.createdAt.toISOString(),
      };
    },
  );
};
