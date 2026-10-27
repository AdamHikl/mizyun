import {
  RunRepositoryError,
  type RunRepository,
  type RunMutationInput,
  type RunListOptions,
  type UserId,
} from "@mizyun/core";
import type { RepositorySupabaseClient } from "./index.js";
import { workoutFromRow } from "./workout-repository.js";
import { RepositoryError } from "./repository-error.js";
type WorkoutRow = Parameters<typeof workoutFromRow>[0];
export class SupabaseRunRepository implements RunRepository {
  constructor(
    private readonly clientFor: (token: string) => RepositorySupabaseClient,
  ) {}
  private async call(
    token: string,
    name: string,
    args: Record<string, unknown>,
  ) {
    const { data, error } = await this.clientFor(token).rpc<WorkoutRow>(
      name,
      args,
    );
    if (error) {
      if (error.code === "P0002" || error.code === "42501")
        throw new RunRepositoryError("not_found");
      if (error.code === "P0003") throw new RunRepositoryError("removed");
      if (["PT409", "40001", "23505"].includes(error.code ?? ""))
        throw new RunRepositoryError("conflict");
      if (
        ["22023", "22P02", "22007", "22008", "23514"].includes(error.code ?? "")
      )
        throw new RunRepositoryError("invalid");
      throw new RepositoryError("Run persistence unavailable");
    }
    return data;
  }
  private owned(rows: readonly WorkoutRow[], userId: UserId) {
    const row = rows[0];
    if (!row || row.user_id !== userId)
      throw new RunRepositoryError("not_found");
    return workoutFromRow(row);
  }
  async create(
    userId: UserId,
    input: RunMutationInput,
    options: { accessToken: string },
  ) {
    return this.owned(
      await this.call(options.accessToken, "run_create", {
        p_operation: input.clientOperationId,
        p_name: input.name,
        p_notes: input.notes,
        p_summary: input.summary,
      }),
      userId,
    );
  }
  async update(
    userId: UserId,
    id: string,
    input: RunMutationInput,
    expectedRevision: number,
    options: { accessToken: string },
  ) {
    return this.owned(
      await this.call(options.accessToken, "run_update", {
        p_id: id,
        p_operation: input.clientOperationId,
        p_expected_revision: expectedRevision,
        p_name: input.name,
        p_notes: input.notes,
        p_summary: input.summary,
      }),
      userId,
    );
  }
  /** The caller created the run only when the stored row carries its operation ID. */
  async importRun(
    userId: UserId,
    input: RunMutationInput,
    options: { accessToken: string },
  ) {
    const workout = this.owned(
      await this.call(options.accessToken, "run_import", {
        p_operation: input.clientOperationId,
        p_name: input.name,
        p_summary: input.summary,
      }),
      userId,
    );
    return {
      workout,
      created: workout.clientOperationId === input.clientOperationId,
    };
  }
  async get(userId: UserId, id: string, options: { accessToken: string }) {
    const rows = await this.call(options.accessToken, "run_get", { p_id: id });
    if (!rows[0]) return null;
    return this.owned(rows, userId);
  }
  async list(userId: UserId, options: RunListOptions) {
    const rows = await this.call(options.accessToken, "run_list", {
      p_from: options.from ?? null,
      p_to: options.to ?? null,
      p_cursor: options.cursor ?? null,
      p_limit: options.limit,
      p_include_imports: options.includeImports === true,
      p_include_file_imports: options.includeFileImports === true,
    });
    if (rows.some((row) => row.user_id !== userId))
      throw new RunRepositoryError("not_found");
    return rows.map(workoutFromRow);
  }
  async remove(userId: UserId, id: string, options: { accessToken: string }) {
    void userId;
    await this.call(options.accessToken, "run_remove", { p_id: id });
  }
  async cancel(
    userId: UserId,
    operationId: string,
    options: { accessToken: string },
  ) {
    void userId;
    await this.call(options.accessToken, "run_cancel", {
      p_operation: operationId,
    });
  }
}
