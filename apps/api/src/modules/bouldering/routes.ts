import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import {
  BOULDER_PROGRESS_SESSION_LIMIT,
  BoulderRepositoryError,
  boulderGradePyramid,
  boulderHardestSendTimeline,
  boulderSessionAchievements,
  fontGradeFromRank,
  readBoulderSession,
  runningDate,
  summariseBoulderSession,
  type BoulderSessionCursor,
  type BoulderSessionHistoryEntry,
  type BoulderingRepository,
  type StoredBoulderAscent,
  type StoredWorkout,
} from "@mizyun/core";
import {
  boulderActiveSessionResponseSchema,
  boulderAscentCreateSchema,
  boulderAscentRecordSchema,
  boulderAscentResponseSchema,
  boulderAscentUpdateSchema,
  boulderFinishResponseSchema,
  boulderProgressQuerySchema,
  boulderProgressResponseSchema,
  boulderRemovedResponseSchema,
  boulderSessionFinishSchema,
  boulderSessionListQuerySchema,
  boulderSessionListResponseSchema,
  boulderSessionRecordSchema,
  boulderSessionResponseSchema,
  boulderSessionStartSchema,
  type BoulderAscentRecord,
  type BoulderSessionRecord,
} from "@mizyun/contracts";
import { sendApiError, type ApiErrorCode } from "../../errors.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

/** A route-level failure that is not a repository outcome. */
class FeatureDisabled extends Error {}

const ascentWire = (row: StoredBoulderAscent): BoulderAscentRecord => {
  const parsed = boulderAscentRecordSchema.safeParse({
    id: row.id,
    sessionId: row.sessionId,
    sequence: row.sequence,
    gradeScale: row.gradeScale,
    grade: row.grade,
    gradeRank: row.gradeRank,
    result: row.result,
    attempts: row.attempts,
    holdColour: row.holdColour,
    note: row.note,
    photoAssetId: row.photoAssetId,
    projectId: row.projectId,
    loggedAt: row.loggedAt.toISOString(),
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
  // A stored row that no longer matches the contract is never coerced.
  if (!parsed.success || parsed.data.gradeRank !== row.gradeRank)
    throw new BoulderRepositoryError("unavailable");
  return parsed.data;
};

const sessionWire = (
  row: StoredWorkout,
  ascents: readonly StoredBoulderAscent[],
): BoulderSessionRecord => {
  const session = readBoulderSession(row.details);
  if (!session) throw new BoulderRepositoryError("unavailable");
  const summary = summariseBoulderSession(ascents);
  const parsed = boulderSessionRecordSchema.safeParse({
    id: row.id,
    clientOperationId: row.clientOperationId,
    name: row.name,
    notes: row.notes,
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    session,
    summary: {
      boulders: summary.boulders,
      sends: summary.sends,
      flashes: summary.flashes,
      attempts: summary.attempts,
      attemptsComplete: summary.attemptsComplete,
      topGrade:
        summary.topGradeRank === null
          ? null
          : fontGradeFromRank(summary.topGradeRank),
    },
  });
  if (!parsed.success) throw new BoulderRepositoryError("unavailable");
  return parsed.data;
};

/** Validates an outgoing body against its contract; drift is a 503, never a coercion. */
interface ResponseSchema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}
const respond = <T>(schema: ResponseSchema<T>, value: unknown): T => {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new BoulderRepositoryError("unavailable");
  return parsed.data;
};

const historyEntry = (
  row: StoredWorkout,
  ascents: readonly StoredBoulderAscent[],
): BoulderSessionHistoryEntry => {
  const session = readBoulderSession(row.details);
  if (!session) throw new BoulderRepositoryError("unavailable");
  return {
    sessionId: row.id,
    activityDate: session.activityDate,
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    ascents,
  };
};

/** Opaque keyset cursor: base64url of `<startedAt ISO>|<session uuid>`. */
export const encodeBoulderCursor = (cursor: BoulderSessionCursor): string =>
  Buffer.from(`${cursor.startedAt}|${cursor.id}`, "utf8").toString("base64url");
const decodeCursor = (value: string): BoulderSessionCursor => {
  if (!/^[A-Za-z0-9_-]+$/.test(value))
    throw new BoulderRepositoryError("invalid");
  const decoded = Buffer.from(value, "base64url").toString("utf8");
  const [startedAt, id, ...rest] = decoded.split("|");
  if (
    rest.length > 0 ||
    !startedAt ||
    !id ||
    !ISO.test(startedAt) ||
    !Number.isFinite(Date.parse(startedAt)) ||
    !UUID.test(id) ||
    encodeBoulderCursor({ startedAt, id }) !== value
  )
    throw new BoulderRepositoryError("invalid");
  return { startedAt, id };
};

const shiftDate = (date: string, days: number): string => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const WINDOW_DAYS = { "30d": 30, "90d": 90 } as const;
const TIMELINE_LIMIT = 20;

const failure = (
  error: BoulderRepositoryError,
): { status: number; code: ApiErrorCode; message: string } => {
  switch (error.kind) {
    case "unavailable":
      return {
        status: 503,
        code: "SERVICE_UNAVAILABLE",
        message:
          "This bouldering record is unavailable. Retry or export your records for recovery.",
      };
    case "not_found":
      return {
        status: 404,
        code: "NOT_FOUND",
        message: "Bouldering session or boulder was not found.",
      };
    case "invalid":
      return {
        status: 400,
        code: "VALIDATION_ERROR",
        message: "Enter a valid boulder or session.",
      };
    case "active_session":
      return {
        status: 409,
        code: "BOULDER_SESSION_ACTIVE",
        message: "Finish or resume your active bouldering session first.",
      };
    case "removed":
      return {
        status: 410,
        code: "BOULDER_REMOVED",
        message: "This was removed. Discard this pending operation.",
      };
    case "conflict":
      return {
        status: 409,
        code: "CONFLICT",
        message:
          "This changed or the operation was already used. Refresh before editing.",
      };
  }
};

export const boulderingRoutes: FastifyPluginAsync<{
  repository: BoulderingRepository;
  /** `MIZYUN_BOULDERING_ENABLED`; off answers every route with FEATURE_DISABLED. */
  enabled: boolean;
}> = async (app, { repository: repo, enabled }) => {
  const auth = { preHandler: app.authenticate };
  const handle = async <T>(
    request: FastifyRequest,
    reply: FastifyReply,
    action: () => Promise<T>,
  ): Promise<T | void> => {
    try {
      if (!enabled) throw new FeatureDisabled();
      return await action();
    } catch (error) {
      if (error instanceof FeatureDisabled) {
        await sendApiError(
          reply,
          request,
          503,
          "FEATURE_DISABLED",
          "Bouldering is not available yet.",
        );
        return;
      }
      if (!(error instanceof BoulderRepositoryError)) throw error;
      const { status, code, message } = failure(error);
      await sendApiError(reply, request, status, code, message);
    }
  };
  const token = (request: FastifyRequest) => ({
    accessToken: request.principal!.accessToken,
  });
  const owner = (request: FastifyRequest) => request.principal!.userId;
  const idParam = (request: FastifyRequest): string => {
    const { id } = request.params as { id: string };
    if (!UUID.test(id)) throw new BoulderRepositoryError("invalid");
    return id.toLowerCase();
  };
  const withAscents = async (request: FastifyRequest, row: StoredWorkout) => {
    const ascents = await repo.listAscents(
      owner(request),
      [row.id],
      token(request),
    );
    return {
      session: sessionWire(row, ascents),
      ascents: ascents.map(ascentWire),
      raw: ascents,
    };
  };

  app.post("/sessions", auth, async (request, reply) =>
    handle(request, reply, async () => {
      const parsed = boulderSessionStartSchema.safeParse(request.body);
      if (!parsed.success) throw new BoulderRepositoryError("invalid");
      const row = await repo.startSession(
        owner(request),
        parsed.data,
        token(request),
      );
      const { session, ascents } = await withAscents(request, row);
      void reply.code(201);
      return respond(boulderSessionResponseSchema, { session, ascents });
    }),
  );

  app.get("/sessions", auth, async (request, reply) =>
    handle(request, reply, async () => {
      const parsed = boulderSessionListQuerySchema.safeParse(request.query);
      if (!parsed.success) throw new BoulderRepositoryError("invalid");
      const { limit, cursor } = parsed.data;
      const rows = await repo.listSessions(owner(request), {
        ...token(request),
        cursor: cursor === undefined ? undefined : decodeCursor(cursor),
        limit: limit + 1,
      });
      const page = rows.slice(0, limit);
      const ascents = await repo.listAscents(
        owner(request),
        page.map((row) => row.id),
        token(request),
      );
      const sessions = page.map((row) =>
        sessionWire(
          row,
          ascents.filter((a) => a.sessionId === row.id),
        ),
      );
      const last = page.at(-1);
      return respond(boulderSessionListResponseSchema, {
        sessions,
        nextCursor:
          rows.length > limit && last
            ? encodeBoulderCursor({
                startedAt: last.startedAt.toISOString(),
                id: last.id,
              })
            : null,
      });
    }),
  );

  app.get("/sessions/active", auth, async (request, reply) =>
    handle(request, reply, async () => {
      const row = await repo.getActiveSession(owner(request), token(request));
      if (!row)
        return respond(boulderActiveSessionResponseSchema, {
          session: null,
          ascents: [],
        });
      const { session, ascents } = await withAscents(request, row);
      return respond(boulderActiveSessionResponseSchema, { session, ascents });
    }),
  );

  app.get("/sessions/:id", auth, async (request, reply) =>
    handle(request, reply, async () => {
      const id = idParam(request);
      const row = await repo.getSession(owner(request), id, token(request));
      if (!row) throw new BoulderRepositoryError("not_found");
      const { session, ascents } = await withAscents(request, row);
      return respond(boulderSessionResponseSchema, { session, ascents });
    }),
  );

  app.post("/sessions/:id/finish", auth, async (request, reply) =>
    handle(request, reply, async () => {
      const id = idParam(request);
      const parsed = boulderSessionFinishSchema.safeParse(request.body);
      if (!parsed.success) throw new BoulderRepositoryError("invalid");
      const row = await repo.finishSession(
        owner(request),
        id,
        {
          clientOperationId: parsed.data.clientOperationId,
          notes: parsed.data.notes,
        },
        token(request),
      );
      const { session, ascents, raw } = await withAscents(request, row);
      const all = await repo.listAllSessions(owner(request), token(request));
      const allAscents = await repo.listAscents(
        owner(request),
        all.map((s) => s.id),
        token(request),
      );
      const history = all.map((s) =>
        historyEntry(
          s,
          allAscents.filter((a) => a.sessionId === s.id),
        ),
      );
      const achievements = boulderSessionAchievements(
        historyEntry(row, raw),
        history,
      );
      return respond(boulderFinishResponseSchema, {
        session,
        ascents,
        achievements,
      });
    }),
  );

  app.delete("/sessions/:id", auth, async (request, reply) =>
    handle(request, reply, async () => {
      const id = idParam(request);
      await repo.removeSession(owner(request), id, token(request));
      return respond(boulderRemovedResponseSchema, { removed: true });
    }),
  );

  app.post("/sessions/:id/ascents", auth, async (request, reply) =>
    handle(request, reply, async () => {
      const id = idParam(request);
      const parsed = boulderAscentCreateSchema.safeParse(request.body);
      if (!parsed.success) throw new BoulderRepositoryError("invalid");
      const ascent = await repo.createAscent(
        owner(request),
        id,
        parsed.data,
        token(request),
      );
      void reply.code(201);
      return respond(boulderAscentResponseSchema, {
        ascent: ascentWire(ascent),
      });
    }),
  );

  app.put("/ascents/:id", auth, async (request, reply) =>
    handle(request, reply, async () => {
      const id = idParam(request);
      const parsed = boulderAscentUpdateSchema.safeParse(request.body);
      if (!parsed.success) throw new BoulderRepositoryError("invalid");
      const ascent = await repo.updateAscent(
        owner(request),
        id,
        parsed.data,
        token(request),
      );
      return respond(boulderAscentResponseSchema, {
        ascent: ascentWire(ascent),
      });
    }),
  );

  app.delete("/ascents/:id", auth, async (request, reply) =>
    handle(request, reply, async () => {
      const id = idParam(request);
      await repo.removeAscent(owner(request), id, token(request));
      return respond(boulderRemovedResponseSchema, { removed: true });
    }),
  );

  app.get("/progress", auth, async (request, reply) =>
    handle(request, reply, async () => {
      const parsed = boulderProgressQuerySchema.safeParse(request.query);
      if (!parsed.success) throw new BoulderRepositoryError("invalid");
      const { window } = parsed.data;
      const rows = await repo.listAllSessions(owner(request), token(request));
      const ascents = await repo.listAscents(
        owner(request),
        rows.map((row) => row.id),
        token(request),
      );
      const history = rows.map((row) =>
        historyEntry(
          row,
          ascents.filter((a) => a.sessionId === row.id),
        ),
      );
      // "Today" is the current local date in the newest session's recorded
      // timezone (the climber's most recent known zone), else the UTC date.
      const newest = rows[0] ? readBoulderSession(rows[0].details) : null;
      const today = runningDate(new Date(), newest?.recordingTimezone ?? "UTC");
      const cutoff =
        window === "all" ? null : shiftDate(today, -WINDOW_DAYS[window]);
      const inWindow = (date: string) => cutoff === null || date > cutoff;
      const windowed = history.filter((entry) => inWindow(entry.activityDate));
      // Personal-best flags are computed over all history, then windowed.
      const timeline = boulderHardestSendTimeline(
        history,
        BOULDER_PROGRESS_SESSION_LIMIT,
      )
        .filter((entry) => inWindow(entry.activityDate))
        .slice(-TIMELINE_LIMIT)
        .map((entry) => ({
          sessionId: entry.sessionId,
          activityDate: entry.activityDate,
          topGrade: entry.topGrade,
          personalBest: entry.personalBest,
        }));
      const pyramid = boulderGradePyramid(history, window, today);
      const all = windowed.flatMap((entry) => entry.ascents);
      return respond(boulderProgressResponseSchema, {
        window,
        pyramid,
        timeline,
        totals: {
          sessions: windowed.length,
          sends: all.filter((a) => a.result !== "not_yet").length,
          flashes: all.filter((a) => a.result === "flash").length,
        },
      });
    }),
  );
};
