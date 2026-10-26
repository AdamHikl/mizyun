import { createHash } from "node:crypto";
import {
  RunRepositoryError,
  readRunSummary,
  runTimestampEnvelope,
  sameImportedRunMetrics,
  type RunImportResult,
  type RunSummaryCore,
  type RunRepository,
  type RunMutationInput,
  type RunListOptions,
  type StoredWorkout,
  type UserId,
  type WorkoutRepository,
} from "@mizyun/core";

interface Receipt {
  kind: "create" | "update" | "import";
  digest: string | null;
  runId: string | null;
  deleted: boolean;
  revision: number;
}
const canonical = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(",")}}`;
};
const digest = (input: RunMutationInput) =>
  createHash("sha256").update(canonical(input)).digest("hex");
const isRun = (w: StoredWorkout) => w.details.activityType === "running";
const summaryOf = (w: StoredWorkout): RunSummaryCore | null =>
  readRunSummary(w.details);
const importIdentity = (summary: RunSummaryCore | null): string | null =>
  summary?.origin.kind === "health_import"
    ? JSON.stringify([
        summary.origin.provider,
        summary.origin.sourceAppId,
        summary.origin.externalId,
      ])
    : null;
export class InMemoryRunRepository implements RunRepository {
  private readonly receipts = new Map<string, Receipt>();
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly workouts: WorkoutRepository) {}
  private atomic<T>(action: () => Promise<T>): Promise<T> {
    const result = this.tail.then(action);
    this.tail = result.catch(() => undefined);
    return result;
  }
  async exportReceipts(
    userId: UserId,
  ): Promise<readonly Record<string, unknown>[]> {
    return [...this.receipts.entries()]
      .filter(([key]) => key.startsWith(`${userId}:`))
      .map(([key, r]) => ({
        user_id: userId,
        operation_id: key.slice(userId.length + 1),
        kind: r.kind,
        run_id: r.runId,
        payload_digest: r.digest,
        accepted_revision: r.revision,
        deleted: r.deleted,
      }));
  }
  clearForUser(userId: UserId): Promise<void> {
    return this.atomic(async () => {
      for (const key of this.receipts.keys())
        if (key.startsWith(`${userId}:`)) this.receipts.delete(key);
    });
  }
  private key(userId: UserId, op: string) {
    return `${userId}:${op}`;
  }
  async get(userId: UserId, id: string, options: { accessToken: string }) {
    const row = await this.workouts.getById(id, options);
    return row?.userId === userId && isRun(row) ? row : null;
  }
  async list(userId: UserId, options: RunListOptions) {
    // Test adapter has bounded fixture size; production filters and pages in SQL.
    const rows = await this.workouts.list(userId, {
      from: null,
      to: null,
      limit: Number.MAX_SAFE_INTEGER,
      accessToken: options.accessToken,
    });
    return rows
      .filter(isRun)
      .filter((w) => {
        const kind = summaryOf(w)?.origin.kind;
        return (
          kind === "manual" ||
          (kind === "health_import" && options.includeImports === true) ||
          (kind === "file_import" && options.includeFileImports === true)
        );
      })
      .filter((w) => {
        const date = (w.details.runSummary as { activityDate: string })
          .activityDate;
        return (
          (!options.from || date >= options.from) &&
          (!options.to || date <= options.to) &&
          (!options.cursor || `${date}:${w.id}` < options.cursor)
        );
      })
      .sort((a, b) =>
        `${(b.details.runSummary as { activityDate: string }).activityDate}:${b.id}`.localeCompare(
          `${(a.details.runSummary as { activityDate: string }).activityDate}:${a.id}`,
        ),
      )
      .slice(0, options.limit);
  }
  create(
    userId: UserId,
    input: RunMutationInput,
    options: { accessToken: string },
  ) {
    return this.atomic(async () => {
      const key = this.key(userId, input.clientOperationId);
      const receipt = this.receipts.get(key);
      if (receipt) {
        if (receipt.deleted) throw new RunRepositoryError("removed");
        if (receipt.kind !== "create" || receipt.digest !== digest(input))
          throw new RunRepositoryError("conflict");
        const row = receipt.runId
          ? await this.get(userId, receipt.runId, options)
          : null;
        if (!row) throw new RunRepositoryError("removed");
        return row;
      }
      if (input.summary.origin.kind !== "manual")
        throw new RunRepositoryError("invalid");
      return this.insert(userId, input, "create", options);
    });
  }
  importRun(
    userId: UserId,
    input: RunMutationInput,
    options: { accessToken: string },
  ): Promise<RunImportResult> {
    return this.atomic(async () => {
      const key = this.key(userId, input.clientOperationId);
      const receipt = this.receipts.get(key);
      const result = (workout: StoredWorkout): RunImportResult => ({
        workout,
        created: workout.clientOperationId === input.clientOperationId,
      });
      if (receipt) {
        if (receipt.deleted) throw new RunRepositoryError("removed");
        if (receipt.kind !== "import" || receipt.digest !== digest(input))
          throw new RunRepositoryError("conflict");
        const row = receipt.runId
          ? await this.get(userId, receipt.runId, options)
          : null;
        if (!row) throw new RunRepositoryError("removed");
        return result(row);
      }
      const identity = importIdentity(input.summary);
      if (
        identity === null ||
        input.summary.revision !== 1 ||
        input.summary.perceivedExertion !== null
      )
        throw new RunRepositoryError("invalid");
      const rows = await this.workouts.list(userId, {
        from: null,
        to: null,
        limit: Number.MAX_SAFE_INTEGER,
        accessToken: options.accessToken,
      });
      const existing = rows.find(
        (w) => isRun(w) && importIdentity(summaryOf(w)) === identity,
      );
      if (existing) {
        this.receipts.set(key, {
          kind: "import",
          digest: digest(input),
          runId: existing.id,
          deleted: false,
          revision: 0,
        });
        return result(existing);
      }
      return result(await this.insert(userId, input, "import", options));
    });
  }
  /** Caller holds the atomic section. */
  private async insert(
    userId: UserId,
    input: RunMutationInput,
    kind: "create" | "import",
    options: { accessToken: string },
  ): Promise<StoredWorkout> {
    {
      const key = this.key(userId, input.clientOperationId);
      const now = new Date();
      const envelope = runTimestampEnvelope(input.summary);
      const rowId = crypto.randomUUID();
      const row = await this.workouts.create(
        userId,
        {
          id: rowId,
          userId,
          clientOperationId: input.clientOperationId,
          name: input.name,
          notes: input.notes,
          // WorkoutSource is closed to "manual"; SQL stores imports as "health_import".
          source: "manual",
          ...envelope,
          details: {
            activityType: "running",
            workoutLifecycle: { kind: "session" },
            runSummary: input.summary,
          },
          createdAt: now,
          updatedAt: now,
        },
        options,
      );
      if (row.id !== rowId) throw new RunRepositoryError("conflict");
      this.receipts.set(key, {
        kind,
        digest: digest(input),
        runId: row.id,
        deleted: false,
        revision: 1,
      });
      return row;
    }
  }
  update(
    userId: UserId,
    id: string,
    input: RunMutationInput,
    expectedRevision: number,
    options: { accessToken: string },
  ) {
    return this.atomic(async () => {
      const key = this.key(userId, input.clientOperationId);
      const receipt = this.receipts.get(key);
      const row = await this.get(userId, id, options);
      if (
        receipt?.deleted ||
        [...this.receipts.entries()].some(
          ([k, r]) => k.startsWith(`${userId}:`) && r.runId === id && r.deleted,
        )
      )
        throw new RunRepositoryError("removed");
      if (!row) throw new RunRepositoryError("not_found");
      const revision = (row.details.runSummary as { revision: number })
        .revision;
      if (receipt) {
        if (
          receipt.kind !== "update" ||
          receipt.runId !== id ||
          receipt.digest !== digest(input) ||
          receipt.revision !== revision
        )
          throw new RunRepositoryError("conflict");
        return row;
      }
      if (revision !== expectedRevision)
        throw new RunRepositoryError("conflict");
      // Mirror SQL: imported provider facts are read-only; origins never switch.
      const stored = summaryOf(row);
      if (
        stored && stored.origin.kind !== "manual"
          ? !sameImportedRunMetrics(stored, input.summary)
          : input.summary.origin.kind !== "manual"
      )
        throw new RunRepositoryError("invalid");
      const next = await this.workouts.update(
        {
          ...row,
          name: input.name,
          notes: input.notes,
          ...runTimestampEnvelope(input.summary),
          details: {
            activityType: "running",
            workoutLifecycle: { kind: "session" },
            runSummary: input.summary,
          },
          updatedAt: new Date(),
        },
        options,
      );
      this.receipts.set(key, {
        kind: "update",
        digest: digest(input),
        runId: id,
        deleted: false,
        revision: input.summary.revision,
      });
      return next;
    });
  }
  remove(userId: UserId, id: string, options: { accessToken: string }) {
    return this.atomic(async () => {
      const row = await this.get(userId, id, options);
      if (!row) return;
      for (const [key, receipt] of this.receipts)
        if (key.startsWith(`${userId}:`) && receipt.runId === id)
          receipt.deleted = true;
      await this.workouts.delete(id, options);
    });
  }
  cancel(
    userId: UserId,
    operationId: string,
    options: { accessToken: string },
  ) {
    return this.atomic(async () => {
      const key = this.key(userId, operationId);
      const receipt = this.receipts.get(key);
      if (receipt && receipt.kind !== "create")
        throw new RunRepositoryError("conflict");
      if (receipt?.runId) {
        for (const [k, r] of this.receipts)
          if (k.startsWith(`${userId}:`) && r.runId === receipt.runId)
            r.deleted = true;
        await this.workouts.delete(receipt.runId, options);
      }
      this.receipts.set(
        key,
        receipt
          ? { ...receipt, deleted: true }
          : {
              kind: "create",
              digest: null,
              runId: null,
              deleted: true,
              revision: 0,
            },
      );
    });
  }
}
