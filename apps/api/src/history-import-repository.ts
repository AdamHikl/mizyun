import {
  HistoryImportRepositoryError,
  createFileImportedRunSummary,
  isNonStrengthWorkoutDetails,
  readRunSummary,
  readWorkoutLifecycle,
  runTimestampEnvelope,
  type ExerciseRepository,
  type HistoryExerciseSpec,
  type HistoryImportChunkResult,
  type HistoryImportCheckItem,
  type HistoryImportFormat,
  type HistoryImportRemoval,
  type HistoryImportRepository,
  type HistoryImportWriteChunk,
  type StoredHistoryImportBatch,
  type StoredWorkout,
  type UserId,
  type WorkoutRepository,
  type WorkoutSetRepository,
} from "@mizyun/core";

interface BatchState {
  batch: StoredHistoryImportBatch;
  digest: string;
  createdExerciseIds: string[];
}

type Options = { readonly accessToken: string };

/**
 * In-memory adapter mirroring the `history_import_*` RPCs (ADR-0083) for
 * route tests: per-user import keys, ordered idempotent chunks, overlap
 * skips and batch removal. Import provenance lives here because
 * `StoredWorkout` does not carry the SQL import columns.
 */
export class InMemoryHistoryImportRepository implements HistoryImportRepository {
  readonly #batches = new Map<string, BatchState>();
  /** `${userId}:${importKey}` -> workout id and batch. */
  readonly #records = new Map<string, { workoutId: string; batchId: string }>();
  #tail: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly workouts: WorkoutRepository,
    private readonly sets: WorkoutSetRepository,
    private readonly exercises: ExerciseRepository,
  ) {}

  private atomic<T>(action: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(action);
    this.#tail = result.catch(() => undefined);
    return result;
  }

  private owned(userId: UserId, batchId: string): BatchState {
    const state = this.#batches.get(batchId);
    if (!state || state.batch.userId !== userId)
      throw new HistoryImportRepositoryError("not_found");
    return state;
  }

  private async allWorkouts(userId: UserId, options: Options) {
    return this.workouts.list(userId, {
      from: null,
      to: null,
      limit: Number.MAX_SAFE_INTEGER,
      accessToken: options.accessToken,
    });
  }

  /** Keys whose workout still exists (a deleted record frees its key). */
  private async liveRecord(userId: UserId, key: string, options: Options) {
    const record = this.#records.get(`${userId}:${key}`);
    if (!record) return null;
    const row = await this.workouts.getById(record.workoutId, options);
    if (row?.userId === userId) return record;
    this.#records.delete(`${userId}:${key}`);
    return null;
  }

  private batchOf(userId: UserId, workoutId: string): string | null {
    for (const [key, record] of this.#records)
      if (key.startsWith(`${userId}:`) && record.workoutId === workoutId)
        return record.batchId;
    return null;
  }

  begin(
    userId: UserId,
    input: {
      readonly batchId: string;
      readonly format: HistoryImportFormat;
      readonly fileName: string | null;
      readonly digest: string;
    },
  ) {
    return this.atomic(async () => {
      const existing = this.#batches.get(input.batchId);
      if (existing) {
        if (
          existing.batch.userId !== userId ||
          existing.digest !== input.digest ||
          existing.batch.format !== input.format
        )
          throw new HistoryImportRepositoryError("conflict");
        return existing.batch;
      }
      const batch: StoredHistoryImportBatch = {
        id: input.batchId,
        userId,
        format: input.format,
        fileName: input.fileName,
        status: "importing",
        chunksDone: 0,
        workoutCount: 0,
        setCount: 0,
        runCount: 0,
        duplicateCount: 0,
        overlapCount: 0,
        firstStartedAt: null,
        lastStartedAt: null,
        createdAt: new Date(),
        completedAt: null,
      };
      this.#batches.set(input.batchId, {
        batch,
        digest: input.digest,
        createdExerciseIds: [],
      });
      return batch;
    });
  }

  resolveExercises(
    userId: UserId,
    batchId: string,
    specs: readonly HistoryExerciseSpec[],
    options: Options,
  ) {
    return this.atomic(async () => {
      // A replay after the batch completed only finds existing records.
      const state = this.owned(userId, batchId);
      const resolved = new Map<string, string>();
      for (const spec of specs) {
        const saved = await this.exercises.list(userId, {
          limit: Number.MAX_SAFE_INTEGER,
          accessToken: options.accessToken,
        });
        const byName = saved.find(
          (e) =>
            !("catalogId" in e.metadata) &&
            e.name.trim().toLowerCase() === spec.name.toLowerCase(),
        );
        let found =
          spec.kind === "catalog"
            ? (saved.find((e) => e.metadata.catalogId === spec.catalogId) ??
              byName)
            : byName;
        if (!found) {
          const now = new Date();
          found = await this.exercises.create(
            userId,
            {
              id: crypto.randomUUID(),
              userId,
              name: spec.name,
              instructions: null,
              metadata:
                spec.kind === "catalog"
                  ? {
                      catalogId: spec.catalogId,
                      trackingMode: spec.trackingMode,
                      importBatchId: batchId,
                    }
                  : {
                      custom: true,
                      trackingMode: spec.trackingMode,
                      importBatchId: batchId,
                    },
              createdAt: now,
              updatedAt: now,
            },
            options,
          );
          state.createdExerciseIds.push(found.id);
        }
        resolved.set(spec.key, found.id);
      }
      return resolved;
    });
  }

  writeChunk(
    userId: UserId,
    batchId: string,
    chunk: HistoryImportWriteChunk,
    options: Options,
  ): Promise<HistoryImportChunkResult> {
    return this.atomic(async () => {
      const state = this.owned(userId, batchId);
      const { batch } = state;
      const result = {
        workouts: 0,
        sets: 0,
        runs: 0,
        duplicates: 0,
        overlapping: 0,
      };
      // An earlier chunk is a no-op even after the batch completed (late replay).
      if (chunk.index < batch.chunksDone) return result;
      if (batch.status !== "importing" || chunk.index > batch.chunksDone)
        throw new HistoryImportRepositoryError("conflict");
      // Validate the whole chunk first: the SQL RPC is one transaction.
      await this.validateChunk(userId, batch, chunk, options);
      const existing = await this.allWorkouts(userId, options);
      const otherBatch = (w: StoredWorkout) =>
        this.batchOf(userId, w.id) !== batchId;
      const now = Date.now();
      for (const item of chunk.workouts) {
        const start = new Date(item.startedAt);
        const end = new Date(item.completedAt);
        if (await this.liveRecord(userId, item.key, options)) {
          result.duplicates++;
          continue;
        }
        if (
          chunk.skipOverlaps &&
          existing.some(
            (w) =>
              otherBatch(w) &&
              !isNonStrengthWorkoutDetails(w.details) &&
              readWorkoutLifecycle(w.details)?.kind !== "routine" &&
              w.startedAt <= end &&
              (w.completedAt ?? w.startedAt) >= start,
          )
        ) {
          result.overlapping++;
          continue;
        }
        const id = crypto.randomUUID();
        const created = new Date();
        await this.workouts.create(
          userId,
          {
            id,
            userId,
            name: item.name.trim(),
            startedAt: start,
            completedAt: end,
            notes: item.notes,
            source: "manual",
            details: {
              workoutLifecycle: { kind: "session" },
              sessionMode: "one_time",
              entryMode: "history_import",
              importSource: { format: batch.format },
            },
            createdAt: created,
            updatedAt: created,
          },
          options,
        );
        let sequence = 0;
        for (const set of item.sets) {
          const exercise = await this.exercises.getById(
            set.exerciseId,
            options,
          );
          if (exercise?.userId !== userId)
            throw new HistoryImportRepositoryError("invalid");
          sequence++;
          await this.sets.create(
            userId,
            {
              id: crypto.randomUUID(),
              userId,
              workoutId: id,
              exerciseId: set.exerciseId,
              sequence,
              setType: set.setType,
              repetitions: set.repetitions,
              loadKg: set.loadKg,
              durationSeconds: set.durationSeconds,
              distanceMeters: set.distanceMeters,
              perceivedExertion: set.perceivedExertion,
              completedAt: end,
              createdAt: created,
            },
            options,
          );
        }
        this.#records.set(`${userId}:${item.key}`, { workoutId: id, batchId });
        result.workouts++;
        result.sets += sequence;
      }
      for (const run of chunk.runs) {
        let summary;
        try {
          summary = createFileImportedRunSummary({
            externalId: run.externalId,
            startedAt: run.startedAt,
            recordingTimezone: chunk.timezone,
            durationSeconds: run.durationSeconds,
            distanceMeters: run.distanceMeters,
            environment: run.environment,
          });
        } catch {
          throw new HistoryImportRepositoryError("invalid");
        }
        const envelope = runTimestampEnvelope(summary);
        if (envelope.completedAt.getTime() > now)
          throw new HistoryImportRepositoryError("invalid");
        const key = `strava:${run.externalId}`;
        if (await this.liveRecord(userId, key, options)) {
          result.duplicates++;
          continue;
        }
        if (
          chunk.skipOverlaps &&
          existing.some((w) => {
            const other = readRunSummary(w.details);
            if (!other || !otherBatch(w)) return false;
            return other.timePrecision === "day"
              ? other.activityDate === summary.activityDate
              : w.startedAt <= envelope.completedAt &&
                  (w.completedAt ?? w.startedAt) >= envelope.startedAt;
          })
        ) {
          result.overlapping++;
          continue;
        }
        const id = crypto.randomUUID();
        const created = new Date();
        await this.workouts.create(
          userId,
          {
            id,
            userId,
            clientOperationId: crypto.randomUUID(),
            name: run.name.trim(),
            notes: null,
            source: "manual",
            ...envelope,
            details: {
              activityType: "running",
              workoutLifecycle: { kind: "session" },
              runSummary: summary,
            },
            createdAt: created,
            updatedAt: created,
          },
          options,
        );
        this.#records.set(`${userId}:${key}`, { workoutId: id, batchId });
        result.runs++;
      }
      state.batch = {
        ...batch,
        chunksDone: batch.chunksDone + 1,
        duplicateCount: batch.duplicateCount + result.duplicates,
        overlapCount: batch.overlapCount + result.overlapping,
      };
      return result;
    });
  }

  private async validateChunk(
    userId: UserId,
    batch: StoredHistoryImportBatch,
    chunk: HistoryImportWriteChunk,
    options: Options,
  ): Promise<void> {
    const invalid = () => new HistoryImportRepositoryError("invalid");
    const measure = (value: number | null, max: number, step: number) =>
      value === null ||
      (value > 0 &&
        value <= max &&
        Math.abs(value * step - Math.round(value * step)) < 1e-6);
    const totalSets = chunk.workouts.reduce((n, w) => n + w.sets.length, 0);
    if (
      chunk.workouts.length > 200 ||
      chunk.runs.length > 200 ||
      totalSets > 5_000 ||
      (chunk.runs.length > 0 && batch.format !== "strava") ||
      (chunk.workouts.length > 0 && batch.format === "strava")
    )
      throw invalid();
    const now = Date.now();
    for (const item of chunk.workouts) {
      const start = Date.parse(item.startedAt);
      const end = Date.parse(item.completedAt);
      if (
        !item.key.startsWith(`${batch.format}:`) ||
        item.key.length > 300 ||
        item.name.trim().length < 1 ||
        item.name.trim().length > 200 ||
        (item.notes !== null && item.notes.length > 4000) ||
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        start < 0 ||
        end < start ||
        end > now ||
        end - start > 2 * 86_400_000 ||
        item.sets.length < 1 ||
        item.sets.length > 500
      )
        throw invalid();
      for (const set of item.sets) {
        const exercise = await this.exercises.getById(set.exerciseId, options);
        if (
          exercise?.userId !== userId ||
          !measure(set.repetitions, 9999.99, 100) ||
          !measure(set.loadKg, 9999.999, 1000) ||
          !measure(set.durationSeconds, 86_400, 1) ||
          !measure(set.distanceMeters, 1_000_000, 100) ||
          (set.perceivedExertion !== null &&
            (set.perceivedExertion < 0 || set.perceivedExertion > 10)) ||
          (set.repetitions === null &&
            set.loadKg === null &&
            set.durationSeconds === null &&
            set.distanceMeters === null)
        )
          throw invalid();
      }
    }
    for (const run of chunk.runs) {
      try {
        const summary = createFileImportedRunSummary({
          externalId: run.externalId,
          startedAt: run.startedAt,
          recordingTimezone: chunk.timezone,
          durationSeconds: run.durationSeconds,
          distanceMeters: run.distanceMeters,
          environment: run.environment,
        });
        if (runTimestampEnvelope(summary).completedAt.getTime() > now)
          throw invalid();
      } catch {
        throw invalid();
      }
    }
  }

  private async batchWorkouts(
    userId: UserId,
    batchId: string,
    options: Options,
  ) {
    const rows: StoredWorkout[] = [];
    for (const [key, record] of this.#records) {
      if (!key.startsWith(`${userId}:`) || record.batchId !== batchId) continue;
      const row = await this.workouts.getById(record.workoutId, options);
      if (row?.userId === userId) rows.push(row);
    }
    return rows;
  }

  finish(userId: UserId, batchId: string, chunks: number, options: Options) {
    return this.atomic(async () => {
      const state = this.owned(userId, batchId);
      if (state.batch.status === "complete") return state.batch;
      if (chunks !== state.batch.chunksDone)
        throw new HistoryImportRepositoryError("conflict");
      const rows = await this.batchWorkouts(userId, batchId, options);
      let setCount = 0;
      for (const row of rows)
        setCount += (await this.sets.listForWorkout(row.id, options)).length;
      const starts = rows.map((row) => row.startedAt.getTime());
      state.batch = {
        ...state.batch,
        status: "complete",
        completedAt: new Date(),
        workoutCount: rows.filter((row) => !readRunSummary(row.details)).length,
        runCount: rows.filter((row) => readRunSummary(row.details)).length,
        setCount,
        firstStartedAt: starts.length ? new Date(Math.min(...starts)) : null,
        lastStartedAt: starts.length ? new Date(Math.max(...starts)) : null,
      };
      return state.batch;
    });
  }

  async list(userId: UserId) {
    return [...this.#batches.values()]
      .filter((state) => state.batch.userId === userId)
      .map((state) => state.batch)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  remove(
    userId: UserId,
    batchId: string,
    options: Options,
  ): Promise<HistoryImportRemoval> {
    return this.atomic(async () => {
      const state = this.owned(userId, batchId);
      const rows = await this.batchWorkouts(userId, batchId, options);
      for (const row of rows) {
        await this.sets.deleteAllForWorkout(row.id, options);
        await this.workouts.delete(row.id, options);
      }
      for (const [key, record] of this.#records)
        if (key.startsWith(`${userId}:`) && record.batchId === batchId)
          this.#records.delete(key);
      this.#batches.delete(batchId);
      let exercises = 0;
      for (const id of state.createdExerciseIds) {
        const used = await this.sets.recentForExercise(userId, id, 1, options);
        if (used.length === 0 && (await this.exercises.delete(id, options)))
          exercises++;
      }
      const runs = rows.filter((row) => readRunSummary(row.details)).length;
      return { workouts: rows.length - runs, runs, exercises };
    });
  }

  async check(
    userId: UserId,
    _format: HistoryImportFormat,
    items: readonly HistoryImportCheckItem[],
    options: Options,
  ) {
    const rows = await this.allWorkouts(userId, options);
    let existing = 0;
    let overlapping = 0;
    for (const item of items) {
      if (await this.liveRecord(userId, item.key, options)) {
        existing++;
        continue;
      }
      const start = new Date(item.startedAt);
      const end = new Date(item.completedAt);
      const overlaps = rows.some((w) => {
        const run = readRunSummary(w.details);
        if (item.kind === "run")
          return run
            ? run.timePrecision === "day"
              ? run.activityDate === item.activityDate
              : w.startedAt <= end && (w.completedAt ?? w.startedAt) >= start
            : false;
        return (
          !isNonStrengthWorkoutDetails(w.details) &&
          readWorkoutLifecycle(w.details)?.kind !== "routine" &&
          w.startedAt <= end &&
          (w.completedAt ?? w.startedAt) >= start
        );
      });
      if (overlaps) overlapping++;
    }
    return { existing, overlapping };
  }

  /** Account erasure in the in-memory composition. */
  async clearForUser(userId: UserId): Promise<void> {
    for (const [id, state] of this.#batches)
      if (state.batch.userId === userId) this.#batches.delete(id);
    for (const key of this.#records.keys())
      if (key.startsWith(`${userId}:`)) this.#records.delete(key);
  }

  /** Account export rows, shaped like the SQL table. */
  async exportForUser(userId: UserId) {
    const records = [...this.#records.entries()]
      .filter(([key]) => key.startsWith(`${userId}:`))
      .map(([key, record]) => ({
        workout_id: record.workoutId,
        import_batch_id: record.batchId,
        import_key: key.slice(userId.length + 1),
      }));
    const batches = (await this.list(userId)).map((batch) => ({
      id: batch.id,
      user_id: batch.userId,
      format: batch.format,
      file_name: batch.fileName,
      status: batch.status,
      workout_count: batch.workoutCount,
      set_count: batch.setCount,
      run_count: batch.runCount,
      duplicate_count: batch.duplicateCount,
      overlap_count: batch.overlapCount,
      first_started_at: batch.firstStartedAt?.toISOString() ?? null,
      last_started_at: batch.lastStartedAt?.toISOString() ?? null,
      created_at: batch.createdAt.toISOString(),
      completed_at: batch.completedAt?.toISOString() ?? null,
    }));
    return { batches, records };
  }
}
