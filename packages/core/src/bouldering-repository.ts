import type { UserId } from "./index";
import type { StoredWorkout } from "./workout";
import type { FontGrade } from "./bouldering-grades";
import type {
  BoulderProjectStatus,
  BoulderResult,
  HoldColour,
} from "./bouldering";

/** One logged boulder (ADR-0066). The server derives `gradeRank` from `grade`. */
export interface StoredBoulderAscent {
  readonly id: string;
  readonly userId: UserId;
  readonly sessionId: string;
  readonly clientOperationId: string;
  readonly sequence: number;
  readonly gradeScale: "font";
  readonly grade: FontGrade;
  readonly gradeRank: number;
  readonly result: BoulderResult;
  readonly attempts: number | null;
  readonly holdColour: HoldColour | null;
  readonly note: string | null;
  readonly photoAssetId: string | null;
  readonly projectId: string | null;
  readonly loggedAt: Date;
  readonly revision: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface BoulderAscentInput {
  readonly clientOperationId: string;
  readonly grade: FontGrade;
  readonly result: BoulderResult;
  readonly attempts: number | null;
  readonly holdColour: HoldColour | null;
  readonly note: string | null;
  readonly photoAssetId: string | null;
  /**
   * Create only: "Try again" on an open or archived project. Without it a
   * `not_yet` boulder opens a new project. Edits never change the link.
   */
  readonly projectId?: string | null;
}

/** A climb tried across sessions (ADR-0066 §6); state derives from its boulders. */
export interface StoredBoulderProject {
  readonly id: string;
  readonly userId: UserId;
  readonly gradeScale: "font";
  readonly grade: FontGrade;
  readonly gradeRank: number;
  readonly holdColour: HoldColour | null;
  readonly status: BoulderProjectStatus;
  readonly firstLoggedAt: Date;
  readonly sentAt: Date | null;
  readonly sentAscentId: string | null;
  readonly revision: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** A project with its linked boulders (logged_at, sequence order). */
export interface BoulderProjectListing {
  readonly project: StoredBoulderProject;
  readonly ascents: readonly StoredBoulderAscent[];
}

export type BoulderProjectFilter = BoulderProjectStatus | "all";

export interface BoulderSessionStartInput {
  readonly clientOperationId: string;
  readonly recordingTimezone: string;
  readonly gymName: string | null;
}

/** Keyset position for session history, newest first. */
export interface BoulderSessionCursor {
  readonly startedAt: string;
  readonly id: string;
}

export class BoulderRepositoryError extends Error {
  constructor(
    readonly kind:
      | "not_found"
      | "conflict"
      | "removed"
      | "invalid"
      | "active_session"
      | "project_unavailable"
      | "unavailable",
  ) {
    super(`Bouldering mutation ${kind}`);
    this.name = "BoulderRepositoryError";
  }
}

interface Token {
  readonly accessToken: string;
}

/** Mutations and their minimal receipts commit atomically. */
export interface BoulderingRepository {
  startSession(
    userId: UserId,
    input: BoulderSessionStartInput,
    options: Token,
  ): Promise<StoredWorkout>;
  finishSession(
    userId: UserId,
    id: string,
    input: {
      readonly clientOperationId: string;
      readonly notes: string | null;
    },
    options: Token,
  ): Promise<StoredWorkout>;
  /** Deletes the session and its boulders. Idempotent. */
  removeSession(userId: UserId, id: string, options: Token): Promise<void>;
  getSession(
    userId: UserId,
    id: string,
    options: Token,
  ): Promise<StoredWorkout | null>;
  getActiveSession(
    userId: UserId,
    options: Token,
  ): Promise<StoredWorkout | null>;
  listSessions(
    userId: UserId,
    options: Token & {
      readonly cursor?: BoulderSessionCursor | undefined;
      readonly limit: number;
    },
  ): Promise<readonly StoredWorkout[]>;
  /** Every session (newest first), capped; used for summaries and progress. */
  listAllSessions(
    userId: UserId,
    options: Token,
  ): Promise<readonly StoredWorkout[]>;
  /** Boulders for the given sessions, ordered by session then sequence. */
  listAscents(
    userId: UserId,
    sessionIds: readonly string[],
    options: Token,
  ): Promise<readonly StoredBoulderAscent[]>;
  createAscent(
    userId: UserId,
    sessionId: string,
    input: BoulderAscentInput,
    options: Token,
  ): Promise<StoredBoulderAscent>;
  updateAscent(
    userId: UserId,
    id: string,
    input: BoulderAscentInput & { readonly expectedRevision: number },
    options: Token,
  ): Promise<StoredBoulderAscent>;
  /** Returns the removed row, or null when it was already gone. */
  removeAscent(
    userId: UserId,
    id: string,
    options: Token,
  ): Promise<StoredBoulderAscent | null>;
  /**
   * Owner projects, newest first and capped at BOULDER_PROJECT_LIST_LIMIT,
   * each with its linked boulders. `ids` narrows to specific projects.
   */
  listProjects(
    userId: UserId,
    options: Token & {
      readonly status: BoulderProjectFilter;
      readonly ids?: readonly string[] | undefined;
    },
  ): Promise<readonly BoulderProjectListing[]>;
  /** Archive or reopen; a sent project is a conflict. */
  setProjectArchived(
    userId: UserId,
    id: string,
    archived: boolean,
    options: Token,
  ): Promise<StoredBoulderProject>;
  /** Owner receipts and boulders for account export (sessions export as workouts). */
  exportForUser?(
    userId: UserId,
    options: Token,
  ): Promise<{
    readonly ascents: readonly Record<string, unknown>[];
    readonly receipts: readonly Record<string, unknown>[];
    readonly projects?: readonly Record<string, unknown>[];
  }>;
  clearForUser?(userId: UserId): Promise<void>;
}

/** Upper bound for progress reads; far above a founder-cohort history. */
export const BOULDER_PROGRESS_SESSION_LIMIT = 1000;

/** Upper bound for one projects read. */
export const BOULDER_PROJECT_LIST_LIMIT = 500;
