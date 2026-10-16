import { createHash } from "node:crypto";
import {
  BOULDER_GYM_NAME_MAX,
  BOULDER_NOTE_MAX,
  BOULDER_PROGRESS_SESSION_LIMIT,
  BOULDER_PROJECT_LIST_LIMIT,
  BoulderRepositoryError,
  HOLD_COLOURS,
  fontGradeRank,
  hasBoulderingActivity,
  isFontGrade,
  runningDate,
  validBoulderAttempts,
  type BoulderAscentInput,
  type BoulderProjectFilter,
  type BoulderProjectListing,
  type BoulderSessionCursor,
  type BoulderSessionStartInput,
  type BoulderingRepository,
  type MediaAssetRepository,
  type StoredBoulderAscent,
  type StoredBoulderProject,
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

/** Database order for linked boulders: `logged_at`, then `sequence`. */
const linkedOrder = (a: StoredBoulderAscent, b: StoredBoulderAscent): number =>
  a.loggedAt.getTime() - b.loggedAt.getTime() || a.sequence - b.sequence;

const newestFirst = (a: StoredWorkout, b: StoredWorkout): number =>
  b.startedAt.getTime() - a.startedAt.getTime() ||
  (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

/**
 * In-memory `BoulderingRepository` for tests and Supabase-less runs. It mirrors
 * the RPC semantics in `20261016140000_indoor_bouldering.sql`: owner receipts
 * with payload digests, tombstones on delete, one active session, photo
 * ownership, per-session sequence, revision CAS and finish-once. Sessions are
 * stored through the shared in-memory workout repository like runs. Projects
 * mirror `20261016160000_bouldering_projects.sql`: explicit links, a new
 * project per unlinked `not_yet`, and `boulder_project_refresh` after every
 * boulder insert, update or delete.
 */
export class InMemoryBoulderingRepository implements BoulderingRepository {
  private readonly receipts = new Map<string, Receipt>();
  private readonly ascents = new Map<string, StoredBoulderAscent>();
  private readonly projects = new Map<string, StoredBoulderProject>();
  private tail: Promise<unknown> = Promise.resolve();
  private sourceChanged: (userId: UserId, sessionId: string) => void = () => {};

  constructor(
    private readonly workouts: WorkoutRepository,
    private readonly media?: Pick<MediaAssetRepository, "getById">,
  ) {}

  /**
   * Mirrors the ADR-0067 database triggers: any session change or delete and
   * any boulder insert, update or delete revokes that session's Community card.
   */
  setCommunitySourceChangeObserverForTest(
    observer: (userId: UserId, sessionId: string) => void,
  ): void {
    this.sourceChanged = observer;
  }

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

  /** Mirrors `boulder_project_refresh`: derive state, or delete when empty. */
  private refreshProject(projectId: string | null): void {
    if (projectId === null) return;
    const current = this.projects.get(projectId);
    if (!current) return;
    const linked = [...this.ascents.values()]
      .filter((a) => a.projectId === projectId)
      .sort(linkedOrder);
    const first = linked[0];
    if (!first) {
      this.projects.delete(projectId);
      return;
    }
    const firstSend = linked.find(
      (a) => a.result === "flash" || a.result === "sent",
    );
    this.projects.set(projectId, {
      ...current,
      grade: first.grade,
      gradeRank: first.gradeRank,
      holdColour: first.holdColour,
      firstLoggedAt: first.loggedAt,
      status: firstSend
        ? "sent"
        : current.status === "archived"
          ? "archived"
          : "open",
      sentAt: firstSend?.loggedAt ?? null,
      sentAscentId: firstSend?.id ?? null,
      revision: current.revision + 1,
      updatedAt: new Date(),
    });
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
      this.sourceChanged(userId, id);
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
          this.refreshProject(ascent.projectId);
        }
      this.tombstone(
        userId,
        (r) =>
          r.sessionId === id ||
          (r.ascentId !== null && removed.has(r.ascentId)),
      );
      this.sourceChanged(userId, id);
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
        // Added only when linked, as in SQL, so unlinked digests stay stable.
        ...(input.projectId != null ? { project: input.projectId } : {}),
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
      const now = new Date();
      let projectId: string | null = null;
      if (input.projectId != null) {
        // A flash is a first-try send, so it cannot continue a project.
        if (input.result === "flash")
          throw new BoulderRepositoryError("invalid");
        // "Try again" links only the caller's open or archived project.
        const project = this.projects.get(input.projectId);
        if (
          !project ||
          project.userId !== userId ||
          (project.status !== "open" && project.status !== "archived")
        )
          throw new BoulderRepositoryError("project_unavailable");
        projectId = project.id;
      } else if (input.result === "not_yet") {
        projectId = crypto.randomUUID();
        this.projects.set(projectId, {
          id: projectId,
          userId,
          gradeScale: "font",
          grade: input.grade,
          gradeRank: fontGradeRank(input.grade),
          holdColour: input.holdColour,
          status: "open",
          firstLoggedAt: now,
          sentAt: null,
          sentAscentId: null,
          revision: 1,
          createdAt: now,
          updatedAt: now,
        });
      }
      const sequence =
        Math.max(
          0,
          ...[...this.ascents.values()]
            .filter((a) => a.userId === userId && a.sessionId === sessionId)
            .map((a) => a.sequence),
        ) + 1;
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
        projectId,
        loggedAt: now,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      };
      this.ascents.set(row.id, row);
      this.refreshProject(projectId);
      this.sourceChanged(userId, sessionId);
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
      // The link never changes on edit; the project re-derives its state.
      this.refreshProject(existing.projectId);
      // Only grade or result reach a shared card (as the SQL trigger).
      if (existing.grade !== next.grade || existing.result !== next.result)
        this.sourceChanged(userId, existing.sessionId);
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
      this.refreshProject(row.projectId);
      this.tombstone(userId, (r) => r.ascentId === id);
      this.sourceChanged(userId, row.sessionId);
      return row;
    });
  }

  async listProjects(
    userId: UserId,
    options: Token & {
      readonly status: BoulderProjectFilter;
      readonly ids?: readonly string[] | undefined;
    },
  ): Promise<readonly BoulderProjectListing[]> {
    void options.accessToken;
    const ids = options.ids === undefined ? null : new Set(options.ids);
    return [...this.projects.values()]
      .filter(
        (p) =>
          p.userId === userId &&
          (options.status === "all" || p.status === options.status) &&
          (ids === null || ids.has(p.id)),
      )
      .sort(
        (a, b) =>
          b.firstLoggedAt.getTime() - a.firstLoggedAt.getTime() ||
          (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
      )
      .slice(0, BOULDER_PROJECT_LIST_LIMIT)
      .map((project) => ({
        project,
        ascents: [...this.ascents.values()]
          .filter((a) => a.userId === userId && a.projectId === project.id)
          .sort(linkedOrder),
      }));
  }

  setProjectArchived(
    userId: UserId,
    id: string,
    archived: boolean,
    options: Token,
  ): Promise<StoredBoulderProject> {
    void options.accessToken;
    return this.atomic(async () => {
      const existing = this.projects.get(id);
      if (!existing || existing.userId !== userId)
        throw new BoulderRepositoryError("not_found");
      if (existing.status === "sent")
        throw new BoulderRepositoryError("conflict");
      const status = archived ? "archived" : "open";
      if (existing.status === status) return existing;
      const next: StoredBoulderProject = {
        ...existing,
        status,
        revision: existing.revision + 1,
        updatedAt: new Date(),
      };
      this.projects.set(id, next);
      return next;
    });
  }

  async exportForUser(
    userId: UserId,
    options: Token,
  ): Promise<{
    readonly ascents: readonly Record<string, unknown>[];
    readonly receipts: readonly Record<string, unknown>[];
    readonly projects: readonly Record<string, unknown>[];
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
        project_id: a.projectId,
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
    const projects = [...this.projects.values()]
      .filter((p) => p.userId === userId)
      .sort(
        (a, b) =>
          a.firstLoggedAt.getTime() - b.firstLoggedAt.getTime() ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      )
      .map((p) => ({
        id: p.id,
        user_id: p.userId,
        grade_scale: p.gradeScale,
        grade_code: p.grade,
        grade_rank: p.gradeRank,
        hold_colour: p.holdColour,
        status: p.status,
        first_logged_at: p.firstLoggedAt.toISOString(),
        sent_at: p.sentAt?.toISOString() ?? null,
        sent_ascent_id: p.sentAscentId,
        revision: p.revision,
        created_at: p.createdAt.toISOString(),
        updated_at: p.updatedAt.toISOString(),
      }));
    return { ascents, receipts, projects };
  }

  /** Clears boulders, projects and receipts; session rows go with the user's workouts. */
  clearForUser(userId: UserId): Promise<void> {
    return this.atomic(async () => {
      for (const [id, project] of this.projects)
        if (project.userId === userId) this.projects.delete(id);
      for (const [id, ascent] of this.ascents)
        if (ascent.userId === userId) this.ascents.delete(id);
      for (const key of this.receipts.keys())
        if (key.startsWith(`${userId}:`)) this.receipts.delete(key);
    });
  }
}
