import {
  BOULDER_PROGRESS_SESSION_LIMIT,
  BOULDER_PROJECT_LIST_LIMIT,
  BoulderRepositoryError,
  type BoulderAscentInput,
  type BoulderingRepository,
  type BoulderProjectFilter,
  type BoulderProjectListing,
  type BoulderProjectStatus,
  type BoulderSessionCursor,
  type BoulderSessionStartInput,
  type BoulderResult,
  type FontGrade,
  type HoldColour,
  type StoredBoulderAscent,
  type StoredBoulderProject,
  type StoredWorkout,
  type UserId,
} from "@mizyun/core";
import type { RepositorySupabaseClient } from "./index.js";
import { workoutFromRow } from "./workout-repository.js";
import { RepositoryError } from "./repository-error.js";
import { fetchAllExportPages } from "./export-pagination.js";

type WorkoutRow = Parameters<typeof workoutFromRow>[0];
export interface BoulderAscentRow extends Record<string, unknown> {
  readonly id: string;
  readonly user_id: string;
  readonly workout_id: string;
  readonly client_operation_id: string;
  readonly sequence: number;
  readonly grade_scale: "font";
  readonly grade_code: string;
  readonly grade_rank: number;
  readonly result: string;
  readonly attempts: number | null;
  readonly hold_colour: string | null;
  readonly note: string | null;
  readonly photo_asset_id: string | null;
  readonly project_id?: string | null;
  readonly logged_at: string;
  readonly revision: number;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface BoulderProjectRow extends Record<string, unknown> {
  readonly id: string;
  readonly user_id: string;
  readonly grade_scale: "font";
  readonly grade_code: string;
  readonly grade_rank: number;
  readonly hold_colour: string | null;
  readonly status: string;
  readonly first_logged_at: string;
  readonly sent_at: string | null;
  readonly sent_ascent_id: string | null;
  readonly revision: number;
  readonly created_at: string;
  readonly updated_at: string;
}

const PAGE = 1000;
const ID_CHUNK = 100;

export const boulderAscentFromRow = (
  row: BoulderAscentRow,
): StoredBoulderAscent => ({
  id: row.id,
  userId: row.user_id as UserId,
  sessionId: row.workout_id,
  clientOperationId: row.client_operation_id,
  sequence: row.sequence,
  gradeScale: "font",
  grade: row.grade_code as FontGrade,
  gradeRank: row.grade_rank,
  result: row.result as BoulderResult,
  attempts: row.attempts,
  holdColour: row.hold_colour as HoldColour | null,
  note: row.note,
  photoAssetId: row.photo_asset_id,
  projectId: row.project_id ?? null,
  loggedAt: new Date(row.logged_at),
  revision: row.revision,
  createdAt: new Date(row.created_at),
  updatedAt: new Date(row.updated_at),
});

export const boulderProjectFromRow = (
  row: BoulderProjectRow,
): StoredBoulderProject => ({
  id: row.id,
  userId: row.user_id as UserId,
  gradeScale: "font",
  grade: row.grade_code as FontGrade,
  gradeRank: row.grade_rank,
  holdColour: row.hold_colour as HoldColour | null,
  status: row.status as BoulderProjectStatus,
  firstLoggedAt: new Date(row.first_logged_at),
  sentAt: row.sent_at === null ? null : new Date(row.sent_at),
  sentAscentId: row.sent_ascent_id,
  revision: row.revision,
  createdAt: new Date(row.created_at),
  updatedAt: new Date(row.updated_at),
});

/** RPC writes and RLS-scoped reads; the database owns every invariant. */
export class SupabaseBoulderingRepository implements BoulderingRepository {
  constructor(
    private readonly clientFor: (token: string) => RepositorySupabaseClient,
  ) {}

  private async call<T extends Record<string, unknown>>(
    token: string,
    name: string,
    args: Record<string, unknown>,
  ): Promise<ReadonlyArray<T>> {
    const { data, error } = await this.clientFor(token).rpc<T>(name, args);
    if (error) {
      if (error.message?.includes("boulder_session_active"))
        throw new BoulderRepositoryError("active_session");
      if (error.message?.includes("boulder_project_unavailable"))
        throw new BoulderRepositoryError("project_unavailable");
      if (error.code === "P0002" || error.code === "42501")
        throw new BoulderRepositoryError("not_found");
      if (error.code === "P0003") throw new BoulderRepositoryError("removed");
      if (["PT409", "40001", "23505"].includes(error.code ?? ""))
        throw new BoulderRepositoryError("conflict");
      if (
        ["22023", "22P02", "22007", "22008", "23514", "23503"].includes(
          error.code ?? "",
        )
      )
        throw new BoulderRepositoryError("invalid");
      throw new RepositoryError("Bouldering persistence unavailable");
    }
    return data;
  }

  private ownedSession(rows: ReadonlyArray<WorkoutRow>, userId: UserId) {
    const row = rows[0];
    if (!row || row.user_id !== userId)
      throw new BoulderRepositoryError("not_found");
    return workoutFromRow(row);
  }

  private ownedAscent(rows: ReadonlyArray<BoulderAscentRow>, userId: UserId) {
    const row = rows[0];
    if (!row || row.user_id !== userId)
      throw new BoulderRepositoryError("not_found");
    return boulderAscentFromRow(row);
  }

  private sessions(token: string, userId: UserId) {
    return this.clientFor(token)
      .from<WorkoutRow>("workouts")
      .select("*")
      .eq("user_id", userId)
      .eq("details->>activityType", "bouldering");
  }

  async startSession(
    userId: UserId,
    input: BoulderSessionStartInput,
    options: { accessToken: string },
  ) {
    return this.ownedSession(
      await this.call<WorkoutRow>(
        options.accessToken,
        "boulder_session_start",
        {
          p_operation: input.clientOperationId,
          p_timezone: input.recordingTimezone,
          p_gym_name: input.gymName,
        },
      ),
      userId,
    );
  }

  async finishSession(
    userId: UserId,
    id: string,
    input: {
      readonly clientOperationId: string;
      readonly notes: string | null;
    },
    options: { accessToken: string },
  ) {
    return this.ownedSession(
      await this.call<WorkoutRow>(
        options.accessToken,
        "boulder_session_finish",
        {
          p_id: id,
          p_operation: input.clientOperationId,
          p_notes: input.notes,
        },
      ),
      userId,
    );
  }

  async removeSession(
    userId: UserId,
    id: string,
    options: { accessToken: string },
  ) {
    void userId;
    await this.call(options.accessToken, "boulder_session_remove", {
      p_id: id,
    });
  }

  private async readSessions(
    token: string,
    userId: UserId,
    build: (
      q: ReturnType<SupabaseBoulderingRepository["sessions"]>,
    ) => ReturnType<SupabaseBoulderingRepository["sessions"]>,
  ): Promise<StoredWorkout[]> {
    const { data, error } = await build(this.sessions(token, userId));
    if (error || !Array.isArray(data))
      throw new RepositoryError("Bouldering sessions unavailable");
    if (data.some((row) => row.user_id !== userId))
      throw new BoulderRepositoryError("not_found");
    return data.map(workoutFromRow);
  }

  async getSession(
    userId: UserId,
    id: string,
    options: { accessToken: string },
  ) {
    const rows = await this.readSessions(options.accessToken, userId, (q) =>
      q.eq("id", id).limit(1),
    );
    return rows[0] ?? null;
  }

  async getActiveSession(userId: UserId, options: { accessToken: string }) {
    const rows = await this.readSessions(options.accessToken, userId, (q) =>
      q
        .is("completed_at", null)
        .order("started_at", { ascending: false })
        .limit(1),
    );
    return rows[0] ?? null;
  }

  async listSessions(
    userId: UserId,
    options: {
      readonly accessToken: string;
      readonly cursor?: BoulderSessionCursor | undefined;
      readonly limit: number;
    },
  ) {
    const cursor = options.cursor;
    return this.readSessions(options.accessToken, userId, (q) => {
      let query = q;
      if (cursor)
        query = query.or(
          `started_at.lt.${cursor.startedAt},and(started_at.eq.${cursor.startedAt},id.lt.${cursor.id})`,
        );
      return query
        .order("started_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(options.limit);
    });
  }

  async listAllSessions(userId: UserId, options: { accessToken: string }) {
    return this.readSessions(options.accessToken, userId, (q) =>
      q
        .order("started_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(BOULDER_PROGRESS_SESSION_LIMIT),
    );
  }

  async listAscents(
    userId: UserId,
    sessionIds: readonly string[],
    options: { accessToken: string },
  ) {
    const client = this.clientFor(options.accessToken);
    const out: StoredBoulderAscent[] = [];
    for (let i = 0; i < sessionIds.length; i += ID_CHUNK) {
      const chunk = sessionIds.slice(i, i + ID_CHUNK);
      for (let offset = 0; ; offset += PAGE) {
        const { data, error } = await client
          .from<BoulderAscentRow>("boulder_ascents")
          .select("*")
          .eq("user_id", userId)
          .in("workout_id", chunk)
          .order("workout_id", { ascending: true })
          .order("sequence", { ascending: true })
          .range(offset, offset + PAGE - 1);
        if (error || !Array.isArray(data))
          throw new RepositoryError("Bouldering ascents unavailable");
        if (data.some((row) => row.user_id !== userId))
          throw new BoulderRepositoryError("not_found");
        out.push(...data.map(boulderAscentFromRow));
        if (data.length < PAGE) break;
      }
    }
    const order = new Map(sessionIds.map((id, index) => [id, index]));
    return out.sort(
      (a, b) =>
        (order.get(a.sessionId) ?? 0) - (order.get(b.sessionId) ?? 0) ||
        a.sequence - b.sequence,
    );
  }

  async createAscent(
    userId: UserId,
    sessionId: string,
    input: BoulderAscentInput,
    options: { accessToken: string },
  ) {
    return this.ownedAscent(
      await this.call<BoulderAscentRow>(
        options.accessToken,
        "boulder_ascent_create",
        {
          p_session: sessionId,
          p_operation: input.clientOperationId,
          p_grade: input.grade,
          p_result: input.result,
          p_attempts: input.attempts,
          p_colour: input.holdColour,
          p_note: input.note,
          p_photo: input.photoAssetId,
          p_project: input.projectId ?? null,
        },
      ),
      userId,
    );
  }

  async updateAscent(
    userId: UserId,
    id: string,
    input: BoulderAscentInput & { readonly expectedRevision: number },
    options: { accessToken: string },
  ) {
    return this.ownedAscent(
      await this.call<BoulderAscentRow>(
        options.accessToken,
        "boulder_ascent_update",
        {
          p_id: id,
          p_operation: input.clientOperationId,
          p_expected_revision: input.expectedRevision,
          p_grade: input.grade,
          p_result: input.result,
          p_attempts: input.attempts,
          p_colour: input.holdColour,
          p_note: input.note,
          p_photo: input.photoAssetId,
        },
      ),
      userId,
    );
  }

  async removeAscent(
    userId: UserId,
    id: string,
    options: { accessToken: string },
  ) {
    const rows = await this.call<BoulderAscentRow>(
      options.accessToken,
      "boulder_ascent_remove",
      { p_id: id },
    );
    return rows[0] ? this.ownedAscent(rows, userId) : null;
  }

  async listProjects(
    userId: UserId,
    options: {
      readonly accessToken: string;
      readonly status: BoulderProjectFilter;
      readonly ids?: readonly string[] | undefined;
    },
  ): Promise<readonly BoulderProjectListing[]> {
    const client = this.clientFor(options.accessToken);
    if (options.ids !== undefined && options.ids.length === 0) return [];
    let query = client
      .from<BoulderProjectRow>("boulder_projects")
      .select("*")
      .eq("user_id", userId);
    if (options.status !== "all") query = query.eq("status", options.status);
    if (options.ids !== undefined) query = query.in("id", [...options.ids]);
    const { data, error } = await query
      .order("first_logged_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(BOULDER_PROJECT_LIST_LIMIT);
    if (error || !Array.isArray(data))
      throw new RepositoryError("Bouldering projects unavailable");
    if (data.some((row) => row.user_id !== userId))
      throw new BoulderRepositoryError("not_found");
    const projects = data.map(boulderProjectFromRow);
    const linked = new Map<string, StoredBoulderAscent[]>(
      projects.map((project) => [project.id, []]),
    );
    const ids = projects.map((project) => project.id);
    for (let i = 0; i < ids.length; i += ID_CHUNK) {
      const chunk = ids.slice(i, i + ID_CHUNK);
      for (let offset = 0; ; offset += PAGE) {
        const page = await client
          .from<BoulderAscentRow>("boulder_ascents")
          .select("*")
          .eq("user_id", userId)
          .in("project_id", chunk)
          .order("project_id", { ascending: true })
          .order("logged_at", { ascending: true })
          .order("sequence", { ascending: true })
          .order("id", { ascending: true })
          .range(offset, offset + PAGE - 1);
        if (page.error || !Array.isArray(page.data))
          throw new RepositoryError("Bouldering ascents unavailable");
        if (page.data.some((row) => row.user_id !== userId))
          throw new BoulderRepositoryError("not_found");
        for (const row of page.data) {
          const ascent = boulderAscentFromRow(row);
          if (ascent.projectId !== null)
            linked.get(ascent.projectId)?.push(ascent);
        }
        if (page.data.length < PAGE) break;
      }
    }
    return projects.map((project) => ({
      project,
      ascents: linked.get(project.id) ?? [],
    }));
  }

  async setProjectArchived(
    userId: UserId,
    id: string,
    archived: boolean,
    options: { accessToken: string },
  ): Promise<StoredBoulderProject> {
    const rows = await this.call<BoulderProjectRow>(
      options.accessToken,
      "boulder_project_set_archived",
      { p_id: id, p_archived: archived },
    );
    const row = rows[0];
    if (!row || row.user_id !== userId)
      throw new BoulderRepositoryError("not_found");
    return boulderProjectFromRow(row);
  }

  async exportForUser(userId: UserId, options: { accessToken: string }) {
    const client = this.clientFor(options.accessToken);
    return {
      ascents: await fetchAllExportPages(
        client,
        "boulder_ascents",
        "user_id",
        userId,
        "logged_at",
      ),
      receipts: await fetchAllExportPages(
        client,
        "boulder_operation_receipts",
        "user_id",
        userId,
        "created_at",
        true,
        "operation_id",
      ),
      projects: await fetchAllExportPages(
        client,
        "boulder_projects",
        "user_id",
        userId,
        "first_logged_at",
      ),
    };
  }
}
