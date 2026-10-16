import { createHash } from "node:crypto";
import {
  BOULDER_GYM_NAME_MAX,
  BOULDER_NOTE_MAX,
  BOULDER_PROGRESS_SESSION_LIMIT,
  BoulderRepositoryError,
  HOLD_COLOURS,
  fontGradeRank,
  hasBoulderingActivity,
  isFontGrade,
  runningDate,
  validBoulderAttempts,
  type BoulderAscentInput,
  type BoulderSessionCursor,
  type BoulderSessionStartInput,
  type BoulderingRepository,
  type MediaAssetRepository,
  type StoredBoulderAscent,
  type StoredWorkout,
  type UserId,
  type WorkoutRepository,
} from "@mizyun/core";

/** Mirrors `boulder_operation_receipts`: identity, digest, revision, tombstone. */
interface Receipt {
  readonly kind:
    "session_start" | "session_finish" | "ascent_create" | "ascent_update";
  readonly sessionId: string | null;
  readonly ascentId: string | null;
  readonly digest: string;
  readonly revision: number;
  deleted: boolean;
  readonly createdAt: Date;
}

type Token = { readonly accessToken: string };

const canonical = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(",")}}`;
};
const digest = (value: Record<string, unknown>): string =>
  createHash("sha256").update(canonical(value)).digest("hex");

const isBouldering = (row: StoredWorkout): boolean =>
  hasBoulderingActivity(row.details);

/** Mirrors `boulder_valid_timezone`: a named IANA zone the runtime knows. */
const validTimezone = (zone: string): boolean => {
  if (
    zone.length < 1 ||
    zone.length > 100 ||
    !/^[A-Za-z_]+(\/[A-Za-z0-9_+.-]+)*$/.test(zone) ||
    ["Factory", "localtime"].includes(zone) ||
    /^(posix|right)\//.test(zone)
  )
    return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone }).format(0);
    return true;
  } catch {
    return false;
  }
};

/** Mirrors `boulder_validate_ascent`; values are never coerced here. */
const validAscent = (input: BoulderAscentInput): boolean =>
  isFontGrade(input.grade) &&
  ["flash", "sent", "not_yet"].includes(input.result) &&
  validBoulderAttempts(input.result, input.attempts) &&
  (input.holdColour === null ||
    (HOLD_COLOURS as readonly string[]).includes(input.holdColour)) &&
  (input.note === null ||
    (input.note.length >= 1 &&
      input.note.length <= BOULDER_NOTE_MAX &&
      input.note === input.note.trim()));

const cursorBefore = (
  row: StoredWorkout,
  cursor: BoulderSessionCursor,
): boolean => {
  const rowMs = row.startedAt.getTime();
  const cursorMs = Date.parse(cursor.startedAt);
  return rowMs < cursorMs || (rowMs === cursorMs && row.id < cursor.id);
};

const newestFirst = (a: StoredWorkout, b: StoredWorkout): number =>
  b.startedAt.getTime() - a.startedAt.getTime() ||
  (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

/**
 * In-memory `BoulderingRepository` for tests and Supabase-less runs. It mirrors
 * the RPC semantics in `20261016140000_indoor_bouldering.sql`: owner receipts
 * with payload digests, tombstones on delete, one active session, photo
 * ownership, per-session sequence, revision CAS and finish-once. Sessions are
 * stored through the shared in-memory workout repository like runs.
 */
export class InMemoryBoulderingRepository implements BoulderingRepository {
  private readonly receipts = new Map<string, Receipt>();
  private readonly ascents = new Map<string, StoredBoulderAscent>();
  private tail: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly workouts: WorkoutRepository,
    private readonly media?: Pick<MediaAssetRepository, "getById">,
  ) {}

  private atomic<T>(action: () => Promise<T>): Promise<T> {
    const result = this.tail.then(action);
    this.tail = result.catch(() => undefined);
    return result;
  }

  private key(userId: UserId, op: string): string {
    return `${userId}:${op}`;
  }

  private userReceipts(userId: UserId): Receipt[] {
    return [...this.receipts.entries()]
      .filter(([key]) => key.startsWith(`${userId}:`))
      .map(([, receipt]) => receipt);
  }

  private async allRows(userId: UserId, options: Token) {
    // Test adapter has bounded fixture size; production filters and pages in SQL.
    const rows = await this.workouts.list(userId, {
      from: null,
      to: null,
      limit: Number.MAX_SAFE_INTEGER,
      accessToken: options.accessToken,
    });
    return rows.filter((row) => row.userId === userId && isBouldering(row));
  }

  private async checkPhoto(
    userId: UserId,
    photoAssetId: string | null,
    options: Token,
  ): Promise<void> {
    if (photoAssetId === null) return;
    const asset = this.media
      ? await this.media.getById(photoAssetId, options)
      : null;
    if (
      !asset ||
      asset.userId !== userId ||
      asset.purpose !== "workout" ||
      asset.deletedAt !== null
    )
      throw new BoulderRepositoryError("invalid");
  }

  private tombstone(
    userId: UserId,
    match: (receipt: Receipt) => boolean,
  ): void {
    for (const receipt of this.userReceipts(userId))
      if (match(receipt)) receipt.deleted = true;
  }

  startSession(
    userId: UserId,
    input: BoulderSessionStartInput,
    options: Token,
  ): Promise<StoredWorkout> {
    return this.atomic(async () => {
      if (!validTimezone(input.recordingTimezone))
        throw new BoulderRepositoryError("invalid");
      const gym = input.gymName?.trim() || null;
      if (gym !== null && gym.length > BOULDER_GYM_NAME_MAX)
        throw new BoulderRepositoryError("invalid");
      const hash = digest({ timezone: input.recordingTimezone, gym });
      const key = this.key(userId, input.clientOperationId);
      const receipt = this.receipts.get(key);
      if (receipt) {
        if (receipt.deleted) throw new BoulderRepositoryError("removed");
        if (receipt.kind !== "session_start" || receipt.digest !== hash)
          throw new BoulderRepositoryError("conflict");
        const row = receipt.sessionId
          ? await this.getSession(userId, receipt.sessionId, options)
          : null;
        if (!row) throw new BoulderRepositoryError("removed");
        return row;
      }
      const rows = await this.allRows(userId, options);
      if (rows.some((row) => row.completedAt === null))
        throw new BoulderRepositoryError("active_session");
      const now = new Date();
      const rowId = crypto.randomUUID();
      const row = await this.workouts.create(
        userId,
        {
          id: rowId,
          userId,
          clientOperationId: input.clientOperationId,
          name: "Bouldering",
          notes: null,
          source: "manual",
          startedAt: now,
          completedAt: null,
          details: {
            activityType: "bouldering",
            workoutLifecycle: { kind: "session" },
            boulderSession: {
              version: 1,
              gradeScale: "font",
              recordingTimezone: input.recordingTimezone,
              activityDate: runningDate(now, input.recordingTimezone),
              gymName: gym,
            },
          },
          createdAt: now,
          updatedAt: now,
        },
        options,
      );
      // The workouts client-operation key is shared with strength workouts.
      if (row.id !== rowId) throw new BoulderRepositoryError("conflict");
      this.receipts.set(key, {
        kind: "session_start",
        sessionId: rowId,
        ascentId: null,
        digest: hash,
        revision: 1,
        deleted: false,
        createdAt: now,
      });
      return row;
    });
  }

  finishSession(
    userId: UserId,
    id: string,
    input: {
      readonly clientOperationId: string;
      readonly notes: string | null;
    },
    options: Token,
  ): Promise<StoredWorkout> {
    return this.atomic(async () => {
      const notes = input.notes?.trim() || null;
      if (notes !== null && notes.length > 4000)
        throw new BoulderRepositoryError("invalid");
      const hash = digest({ session: id, notes });
      const key = this.key(userId, input.clientOperationId);
      const receipt = this.receipts.get(key);
      if (receipt) {
        if (receipt.deleted) throw new BoulderRepositoryError("removed");
        if (
          receipt.kind !== "session_finish" ||
          receipt.sessionId !== id ||
          receipt.digest !== hash
        )
          throw new BoulderRepositoryError("conflict");
        const row = await this.getSession(userId, id, options);
        if (!row) throw new BoulderRepositoryError("removed");
        return row;
      }
      if (
        this.userReceipts(userId).some(
          (r) => r.sessionId === id && r.kind === "session_start" && r.deleted,
        )
      )
        throw new BoulderRepositoryError("removed");
      const existing = await this.getSession(userId, id, options);
      if (!existing) throw new BoulderRepositoryError("not_found");
      if (existing.completedAt !== null)
        throw new BoulderRepositoryError("conflict");
      const now = new Date();
      const next = await this.workouts.update(
        {
          ...existing,
          completedAt:
            now.getTime() < existing.startedAt.getTime()
              ? existing.startedAt
              : now,
          notes,
          updatedAt: now,
        },
        options,
      );
      this.receipts.set(key, {
        kind: "session_finish",
        sessionId: id,
        ascentId: null,
        digest: hash,
        revision: 1,
        deleted: false,
        createdAt: now,
      });
      return next;
    });
  }

  removeSession(userId: UserId, id: string, options: Token): Promise<void> {
    return this.atomic(async () => {
      const row = await this.getSession(userId, id, options);
      if (!row) return;
      const removed = new Set<string>();
      for (const ascent of this.ascents.values())
        if (ascent.userId === userId && ascent.sessionId === id) {
          removed.add(ascent.id);
          this.ascents.delete(ascent.id);
        }
      this.tombstone(
        userId,
        (r) =>
          r.sessionId === id ||
          (r.ascentId !== null && removed.has(r.ascentId)),
      );
      await this.workouts.delete(id, options);
    });
  }

  async getSession(
    userId: UserId,
    id: string,
    options: Token,
  ): Promise<StoredWorkout | null> {
    const row = await this.workouts.getById(id, options);
    return row?.userId === userId && isBouldering(row) ? row : null;
  }

  async getActiveSession(
    userId: UserId,
    options: Token,
  ): Promise<StoredWorkout | null> {
    const rows = await this.allRows(userId, options);
    return (
      rows.filter((row) => row.completedAt === null).sort(newestFirst)[0] ??
      null
    );
  }

  async listSessions(
    userId: UserId,
    options: Token & {
      readonly cursor?: BoulderSessionCursor | undefined;
      readonly limit: number;
    },
  ): Promise<readonly StoredWorkout[]> {
    const cursor = options.cursor;
    return (await this.allRows(userId, options))
      .filter((row) => !cursor || cursorBefore(row, cursor))
      .sort(newestFirst)
      .slice(0, Math.max(0, options.limit));
  }

  async listAllSessions(
    userId: UserId,
    options: Token,
  ): Promise<readonly StoredWorkout[]> {
    return (await this.allRows(userId, options))
      .sort(newestFirst)
      .slice(0, BOULDER_PROGRESS_SESSION_LIMIT);
  }

  async listAscents(
    userId: UserId,
    sessionIds: readonly string[],
    options: Token,
  ): Promise<readonly StoredBoulderAscent[]> {
    void options.accessToken;
    const order = new Map(sessionIds.map((id, index) => [id, index]));
    return [...this.ascents.values()]
      .filter((a) => a.userId === userId && order.has(a.sessionId))
      .sort(
        (a, b) =>
          order.get(a.sessionId)! - order.get(b.sessionId)! ||
          a.sequence - b.sequence,
      );
  }

  createAscent(
    userId: UserId,
    sessionId: string,
    input: BoulderAscentInput,
    options: Token,
  ): Promise<StoredBoulderAscent> {
    return this.atomic(async () => {
      const hash = digest({
        session: sessionId,
        grade: input.grade,
        result: input.result,
        attempts: input.attempts,
        colour: input.holdColour,
        note: input.note,
        photo: input.photoAssetId,
      });
      const key = this.key(userId, input.clientOperationId);
      const receipt = this.receipts.get(key);
      if (receipt) {
        if (receipt.deleted) throw new BoulderRepositoryError("removed");
        if (receipt.kind !== "ascent_create" || receipt.digest !== hash)
          throw new BoulderRepositoryError("conflict");
        const row = receipt.ascentId
          ? this.ascents.get(receipt.ascentId)
          : undefined;
        if (!row || row.userId !== userId)
          throw new BoulderRepositoryError("removed");
        return row;
      }
      if (
        this.userReceipts(userId).some(
          (r) =>
            r.sessionId === sessionId &&
            r.kind === "session_start" &&
            r.deleted,
        )
      )
        throw new BoulderRepositoryError("removed");
      if (!(await this.getSession(userId, sessionId, options)))
        throw new BoulderRepositoryError("not_found");
      if (!validAscent(input)) throw new BoulderRepositoryError("invalid");
      await this.checkPhoto(userId, input.photoAssetId, options);
      const sequence =
        Math.max(
          0,
          ...[...this.ascents.values()]
            .filter((a) => a.userId === userId && a.sessionId === sessionId)
            .map((a) => a.sequence),
        ) + 1;
      const now = new Date();
      const row: StoredBoulderAscent = {
        id: crypto.randomUUID(),
        userId,
        sessionId,
        clientOperationId: input.clientOperationId,
        sequence,
        gradeScale: "font",
        grade: input.grade,
        gradeRank: fontGradeRank(input.grade),
        result: input.result,
        attempts: input.attempts,
        holdColour: input.holdColour,
        note: input.note,
        photoAssetId: input.photoAssetId,
        projectId: null,
        loggedAt: now,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      };
      this.ascents.set(row.id, row);
      this.receipts.set(key, {
        kind: "ascent_create",
        sessionId,
        ascentId: row.id,
        digest: hash,
        revision: 1,
        deleted: false,
        createdAt: now,
      });
      return row;
    });
  }

  updateAscent(
    userId: UserId,
    id: string,
    input: BoulderAscentInput & { readonly expectedRevision: number },
    options: Token,
  ): Promise<StoredBoulderAscent> {
    return this.atomic(async () => {
      if (
        !Number.isInteger(input.expectedRevision) ||
        input.expectedRevision < 1
      )
        throw new BoulderRepositoryError("invalid");
      const hash = digest({
        ascent: id,
        expectedRevision: input.expectedRevision,
        grade: input.grade,
        result: input.result,
        attempts: input.attempts,
        colour: input.holdColour,
        note: input.note,
        photo: input.photoAssetId,
      });
      const key = this.key(userId, input.clientOperationId);
      const receipt = this.receipts.get(key);
      if (receipt) {
        if (receipt.deleted) throw new BoulderRepositoryError("removed");
        if (
          receipt.kind !== "ascent_update" ||
          receipt.ascentId !== id ||
          receipt.digest !== hash
        )
          throw new BoulderRepositoryError("conflict");
        const row = this.ascents.get(id);
        if (!row || row.userId !== userId)
          throw new BoulderRepositoryError("removed");
        return row;
      }
      if (this.userReceipts(userId).some((r) => r.ascentId === id && r.deleted))
        throw new BoulderRepositoryError("removed");
      const existing = this.ascents.get(id);
      if (!existing || existing.userId !== userId)
        throw new BoulderRepositoryError("not_found");
      if (existing.revision !== input.expectedRevision)
        throw new BoulderRepositoryError("conflict");
      if (!validAscent(input)) throw new BoulderRepositoryError("invalid");
      if (input.photoAssetId !== existing.photoAssetId)
        await this.checkPhoto(userId, input.photoAssetId, options);
      const now = new Date();
      const next: StoredBoulderAscent = {
        ...existing,
        grade: input.grade,
        gradeRank: fontGradeRank(input.grade),
        result: input.result,
        attempts: input.attempts,
        holdColour: input.holdColour,
        note: input.note,
        photoAssetId: input.photoAssetId,
        revision: existing.revision + 1,
        updatedAt: now,
      };
      this.ascents.set(id, next);
      this.receipts.set(key, {
        kind: "ascent_update",
        sessionId: existing.sessionId,
        ascentId: id,
        digest: hash,
        revision: next.revision,
        deleted: false,
        createdAt: now,
      });
      return next;
    });
  }

  removeAscent(
    userId: UserId,
    id: string,
    options: Token,
  ): Promise<StoredBoulderAscent | null> {
    void options.accessToken;
    return this.atomic(async () => {
      const row = this.ascents.get(id);
      if (!row || row.userId !== userId) return null;
      this.ascents.delete(id);
      this.tombstone(userId, (r) => r.ascentId === id);
      return row;
    });
  }

  async exportForUser(
    userId: UserId,
    options: Token,
  ): Promise<{
    readonly ascents: readonly Record<string, unknown>[];
    readonly receipts: readonly Record<string, unknown>[];
  }> {
    void options.accessToken;
    const ascents = [...this.ascents.values()]
      .filter((a) => a.userId === userId)
      .map((a) => ({
        id: a.id,
        user_id: a.userId,
        workout_id: a.sessionId,
        client_operation_id: a.clientOperationId,
        sequence: a.sequence,
        grade_scale: a.gradeScale,
        grade_code: a.grade,
        grade_rank: a.gradeRank,
        result: a.result,
        attempts: a.attempts,
        hold_colour: a.holdColour,
        note: a.note,
        photo_asset_id: a.photoAssetId,
        logged_at: a.loggedAt.toISOString(),
        revision: a.revision,
        created_at: a.createdAt.toISOString(),
        updated_at: a.updatedAt.toISOString(),
      }));
    const receipts = [...this.receipts.entries()]
      .filter(([key]) => key.startsWith(`${userId}:`))
      .map(([key, r]) => ({
        user_id: userId,
        operation_id: key.slice(userId.length + 1),
        kind: r.kind,
        session_id: r.sessionId,
        ascent_id: r.ascentId,
        payload_digest: r.digest,
        accepted_revision: r.revision,
        deleted: r.deleted,
        created_at: r.createdAt.toISOString(),
      }));
    return { ascents, receipts };
  }

  /** Clears boulders and receipts; session rows go with the user's workouts. */
  clearForUser(userId: UserId): Promise<void> {
    return this.atomic(async () => {
      for (const [id, ascent] of this.ascents)
        if (ascent.userId === userId) this.ascents.delete(id);
      for (const key of this.receipts.keys())
        if (key.startsWith(`${userId}:`)) this.receipts.delete(key);
    });
  }
}
