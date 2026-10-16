import type { UserId } from "./index.js";
import type { StoredWorkout } from "./workout.js";
import type { RunSummaryCore } from "./running.js";

export interface RunMutationInput {
  readonly clientOperationId: string;
  readonly name: string;
  readonly notes: string | null;
  readonly summary: RunSummaryCore;
}
export interface RunListOptions {
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  readonly cursor?: string | undefined;
  readonly limit: number;
  readonly accessToken: string;
  /** Imported Health runs are opt-in so Coach and older clients see manual runs only. */
  readonly includeImports?: boolean | undefined;
}
export interface RunImportResult {
  readonly workout: StoredWorkout;
  /** False when this provider/source/external ID already exists or the operation replays a dedupe. */
  readonly created: boolean;
}
export class RunRepositoryError extends Error {
  constructor(
    readonly kind:
      "not_found" | "conflict" | "removed" | "invalid" | "unavailable",
  ) {
    super(`Run mutation ${kind}`);
    this.name = "RunRepositoryError";
  }
}
/** Mutations and their minimal receipts commit atomically. */
export interface RunRepository {
  exportReceipts?(userId: UserId): Promise<readonly Record<string, unknown>[]>;
  clearForUser?(userId: UserId): Promise<void>;
  create(
    userId: UserId,
    input: RunMutationInput,
    options: { accessToken: string },
  ): Promise<StoredWorkout>;
  update(
    userId: UserId,
    id: string,
    input: RunMutationInput,
    expectedRevision: number,
    options: { accessToken: string },
  ): Promise<StoredWorkout>;
  /** One-time copy of a user-selected Health workout; not a sync. */
  importRun(
    userId: UserId,
    input: RunMutationInput,
    options: { accessToken: string },
  ): Promise<RunImportResult>;
  get(
    userId: UserId,
    id: string,
    options: { accessToken: string },
  ): Promise<StoredWorkout | null>;
  list(
    userId: UserId,
    options: RunListOptions,
  ): Promise<readonly StoredWorkout[]>;
  remove(
    userId: UserId,
    id: string,
    options: { accessToken: string },
  ): Promise<void>;
  cancel(
    userId: UserId,
    operationId: string,
    options: { accessToken: string },
  ): Promise<void>;
}
