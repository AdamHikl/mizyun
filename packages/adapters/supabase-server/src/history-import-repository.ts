import {
  HistoryImportRepositoryError,
  type HistoryExerciseSpec,
  type HistoryImportChunkResult,
  type HistoryImportCheckItem,
  type HistoryImportFormat,
  type HistoryImportRemoval,
  type HistoryImportRepository,
  type HistoryImportWriteChunk,
  type StoredHistoryImportBatch,
  type UserId,
} from "@mizyun/core";

import type { RepositorySupabaseClient } from "./index.js";

interface BatchRow extends Record<string, unknown> {
  readonly id: string;
  readonly user_id: string;
  readonly format: HistoryImportFormat;
  readonly file_name: string | null;
  readonly status: "importing" | "complete";
  readonly chunks_done: number;
  readonly workout_count: number;
  readonly set_count: number;
  readonly run_count: number;
  readonly duplicate_count: number;
  readonly overlap_count: number;
  readonly first_started_at: string | null;
  readonly last_started_at: string | null;
  readonly created_at: string;
  readonly completed_at: string | null;
}

const date = (value: string | null): Date | null =>
  value === null ? null : new Date(value);

const fromRow = (row: BatchRow): StoredHistoryImportBatch => ({
  id: row.id,
  userId: row.user_id as UserId,
  format: row.format,
  fileName: row.file_name,
  status: row.status,
  chunksDone: row.chunks_done,
  workoutCount: row.workout_count,
  setCount: row.set_count,
  runCount: row.run_count,
  duplicateCount: row.duplicate_count,
  overlapCount: row.overlap_count,
  firstStartedAt: date(row.first_started_at),
  lastStartedAt: date(row.last_started_at),
  createdAt: new Date(row.created_at),
  completedAt: date(row.completed_at),
});

/** History imports go through the `history_import_*` RPCs (ADR-0083). */
export class SupabaseHistoryImportRepository implements HistoryImportRepository {
  constructor(
    private readonly clientFor: (token: string) => RepositorySupabaseClient,
  ) {}

  private async call<T extends Record<string, unknown>>(
    token: string,
    name: string,
    args: Record<string, unknown>,
  ): Promise<readonly T[]> {
    const { data, error } = await this.clientFor(token).rpc<T>(name, args);
    if (error) {
      const code = error.code ?? "";
      if (code === "P0002" || code === "42501")
        throw new HistoryImportRepositoryError("not_found");
      if (["PT409", "40001", "23505"].includes(code))
        throw new HistoryImportRepositoryError("conflict");
      if (
        [
          "22023",
          "22P02",
          "22P05",
          "22003",
          "22007",
          "22008",
          "23502",
          "23514",
          "23503",
        ].includes(code)
      )
        throw new HistoryImportRepositoryError("invalid");
      // Timeouts (57014) and anything else: retryable, never a 500.
      throw new HistoryImportRepositoryError("unavailable");
    }
    return data;
  }

  private owned(rows: readonly BatchRow[], userId: UserId) {
    const row = rows[0];
    if (!row || row.user_id !== userId)
      throw new HistoryImportRepositoryError("not_found");
    return fromRow(row);
  }

  async begin(
    userId: UserId,
    input: {
      readonly batchId: string;
      readonly format: HistoryImportFormat;
      readonly fileName: string | null;
      readonly digest: string;
    },
    options: { readonly accessToken: string },
  ) {
    return this.owned(
      await this.call<BatchRow>(options.accessToken, "history_import_begin", {
        p_batch: input.batchId,
        p_format: input.format,
        p_file_name: input.fileName,
        p_digest: input.digest,
      }),
      userId,
    );
  }

  async resolveExercises(
    _userId: UserId,
    batchId: string,
    specs: readonly HistoryExerciseSpec[],
    options: { readonly accessToken: string },
  ) {
    const rows = await this.call<{ spec_key: string; exercise_id: string }>(
      options.accessToken,
      "history_import_exercises",
      {
        p_batch: batchId,
        p_specs: specs.map((spec) => ({
          key: spec.key,
          kind: spec.kind,
          ...(spec.catalogId ? { catalogId: spec.catalogId } : {}),
          name: spec.name,
          trackingMode: spec.trackingMode,
        })),
      },
    );
    return new Map(rows.map((row) => [row.spec_key, row.exercise_id]));
  }

  async writeChunk(
    _userId: UserId,
    batchId: string,
    chunk: HistoryImportWriteChunk,
    options: { readonly accessToken: string },
  ): Promise<HistoryImportChunkResult> {
    const rows = await this.call<{
      workouts: number;
      sets: number;
      runs: number;
      duplicates: number;
      overlapping: number;
    }>(options.accessToken, "history_import_write", {
      p_batch: batchId,
      p_chunk: chunk.index,
      p_timezone: chunk.timezone,
      p_skip_overlaps: chunk.skipOverlaps,
      p_workouts: chunk.workouts,
      p_runs: chunk.runs.map((run) => ({
        externalId: run.externalId,
        name: run.name,
        startedAt: run.startedAt,
        durationSeconds: run.durationSeconds,
        distanceMeters: run.distanceMeters,
        environment: run.environment,
      })),
    });
    const row = rows[0];
    if (!row) throw new HistoryImportRepositoryError("unavailable");
    return {
      workouts: row.workouts,
      sets: row.sets,
      runs: row.runs,
      duplicates: row.duplicates,
      overlapping: row.overlapping,
    };
  }

  async finish(
    userId: UserId,
    batchId: string,
    chunks: number,
    options: { readonly accessToken: string },
  ) {
    return this.owned(
      await this.call<BatchRow>(options.accessToken, "history_import_finish", {
        p_batch: batchId,
        p_chunks: chunks,
      }),
      userId,
    );
  }

  async list(userId: UserId, options: { readonly accessToken: string }) {
    const { data, error } = await this.clientFor(options.accessToken)
      .from<BatchRow>("history_import_batches")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new HistoryImportRepositoryError("unavailable");
    return (data ?? []).map(fromRow);
  }

  async remove(
    _userId: UserId,
    batchId: string,
    options: { readonly accessToken: string },
  ): Promise<HistoryImportRemoval> {
    // Each call removes a bounded slice; the batch row goes with the last one.
    const total = { workouts: 0, runs: 0, exercises: 0 };
    for (let step = 0; step < 1_000; step++) {
      const rows = await this.call<{
        workouts: number;
        runs: number;
        exercises: number;
        remaining: number;
      }>(options.accessToken, "history_import_delete", { p_batch: batchId });
      const row = rows[0];
      if (!row) throw new HistoryImportRepositoryError("not_found");
      total.workouts += row.workouts;
      total.runs += row.runs;
      total.exercises += row.exercises;
      if (row.remaining === 0) return total;
    }
    throw new HistoryImportRepositoryError("unavailable");
  }

  async check(
    _userId: UserId,
    format: HistoryImportFormat,
    items: readonly HistoryImportCheckItem[],
    options: { readonly accessToken: string },
  ) {
    const rows = await this.call<{ existing: number; overlapping: number }>(
      options.accessToken,
      "history_import_check",
      { p_format: format, p_items: items },
    );
    const row = rows[0];
    return {
      existing: row?.existing ?? 0,
      overlapping: row?.overlapping ?? 0,
    };
  }
}
