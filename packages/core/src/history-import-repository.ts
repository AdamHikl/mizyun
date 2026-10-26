/**
 * History import persistence port (#333, ADR-0083). The Supabase adapter
 * calls the `history_import_*` security-definer RPCs; tests use an in-memory
 * adapter over the workout, set and exercise repositories.
 */
import type { UserId } from "./index.js";
import type {
  HistoryImportFormat,
  ImportedRun,
  ImportedSet,
} from "./history-import";
import type {
  HistoryExerciseSpec,
  HistoryImportCheckItem,
} from "./history-import-plan";

export interface StoredHistoryImportBatch {
  readonly id: string;
  readonly userId: UserId;
  readonly format: HistoryImportFormat;
  readonly fileName: string | null;
  readonly status: "importing" | "complete";
  /** Chunks already written; the next chunk to write has this index. */
  readonly chunksDone: number;
  readonly workoutCount: number;
  readonly setCount: number;
  readonly runCount: number;
  readonly duplicateCount: number;
  readonly overlapCount: number;
  readonly firstStartedAt: Date | null;
  readonly lastStartedAt: Date | null;
  readonly createdAt: Date;
  readonly completedAt: Date | null;
}

export type HistoryImportRepositoryErrorKind =
  "not_found" | "conflict" | "invalid" | "unavailable";

export class HistoryImportRepositoryError extends Error {
  constructor(readonly kind: HistoryImportRepositoryErrorKind) {
    super(`history_import_${kind}`);
    this.name = "HistoryImportRepositoryError";
  }
}

export interface HistoryImportWriteSet extends ImportedSet {
  readonly exerciseId: string;
}

export interface HistoryImportWriteWorkout {
  /** Full import key, `<format>:<externalId>`. */
  readonly key: string;
  readonly name: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly notes: string | null;
  readonly sets: readonly HistoryImportWriteSet[];
}

export interface HistoryImportWriteChunk {
  /** 0-based; chunks are written in order and replays are no-ops. */
  readonly index: number;
  /** Named zone that dates imported runs. */
  readonly timezone: string;
  readonly skipOverlaps: boolean;
  readonly workouts: readonly HistoryImportWriteWorkout[];
  readonly runs: readonly ImportedRun[];
}

export interface HistoryImportChunkResult {
  readonly workouts: number;
  readonly sets: number;
  readonly runs: number;
  readonly duplicates: number;
  readonly overlapping: number;
}

export interface HistoryImportRemoval {
  readonly workouts: number;
  readonly runs: number;
  readonly exercises: number;
}

type Options = { readonly accessToken: string };

export interface HistoryImportRepository {
  /** Create the batch or return it when the same request digest replays; a different digest conflicts. */
  begin(
    userId: UserId,
    input: {
      readonly batchId: string;
      readonly format: HistoryImportFormat;
      readonly fileName: string | null;
      readonly digest: string;
    },
    options: Options,
  ): Promise<StoredHistoryImportBatch>;
  /** Saved exercise id for every spec key, creating missing records. */
  resolveExercises(
    userId: UserId,
    batchId: string,
    specs: readonly HistoryExerciseSpec[],
    options: Options,
  ): Promise<ReadonlyMap<string, string>>;
  writeChunk(
    userId: UserId,
    batchId: string,
    chunk: HistoryImportWriteChunk,
    options: Options,
  ): Promise<HistoryImportChunkResult>;
  finish(
    userId: UserId,
    batchId: string,
    chunks: number,
    options: Options,
  ): Promise<StoredHistoryImportBatch>;
  /** Newest first. */
  list(
    userId: UserId,
    options: Options,
  ): Promise<readonly StoredHistoryImportBatch[]>;
  remove(
    userId: UserId,
    batchId: string,
    options: Options,
  ): Promise<HistoryImportRemoval>;
  /** Preview counts of records already imported or overlapping existing ones. */
  check(
    userId: UserId,
    format: HistoryImportFormat,
    items: readonly HistoryImportCheckItem[],
    options: Options,
  ): Promise<{ readonly existing: number; readonly overlapping: number }>;
  /** In-memory composition only; SQL rows are exported and erased by the account adapter. */
  exportForUser?(userId: UserId): Promise<{
    readonly batches: readonly Record<string, unknown>[];
    readonly records: readonly Record<string, unknown>[];
  }>;
  clearForUser?(userId: UserId): Promise<void>;
}
