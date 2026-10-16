import type { WorkoutRepository, StoredWorkout, UserId } from "@mizyun/core";

import type { RepositorySupabaseClient } from "./index.js";
import { RepositoryError } from "./repository-error.js";

interface WorkoutRow extends Record<string, unknown> {
  readonly id: string;
  readonly user_id: string;
  readonly client_operation_id?: string | null;
  readonly name: string;
  readonly started_at: string;
  readonly completed_at: string | null;
  readonly notes: string | null;
  readonly source: string;
  readonly details: Record<string, unknown>;
  readonly created_at: string;
  readonly updated_at: string;
}

export const workoutFromRow = (row: WorkoutRow): StoredWorkout => ({
  id: row.id,
  userId: row.user_id as UserId,
  clientOperationId: row.client_operation_id ?? null,
  name: row.name,
  startedAt: new Date(row.started_at),
  completedAt: row.completed_at === null ? null : new Date(row.completed_at),
  notes: row.notes,
  source: "manual",
  details: { ...row.details },
  createdAt: new Date(row.created_at),
  updatedAt: new Date(row.updated_at),
});
const fromRow = workoutFromRow;

const toInsertRow = (
  userId: UserId,
  workout: StoredWorkout,
): Partial<WorkoutRow> => ({
  id: workout.id,
  user_id: userId,
  client_operation_id: workout.clientOperationId ?? null,
  name: workout.name,
  started_at: workout.startedAt.toISOString(),
  completed_at:
    workout.completedAt === null ? null : workout.completedAt.toISOString(),
  notes: workout.notes,
  source: "manual",
  details: { ...workout.details },
});

export interface SupabaseWorkoutRepositoryOptions {
  readonly clientFor: (accessToken: string) => RepositorySupabaseClient;
}

export class SupabaseWorkoutRepository implements WorkoutRepository {
  readonly #clientFor: (accessToken: string) => RepositorySupabaseClient;

  constructor(options: SupabaseWorkoutRepositoryOptions) {
    this.#clientFor = options.clientFor;
  }

  async findByClientOperationId(
    userId: UserId,
    clientOperationId: string,
    options: { readonly accessToken: string },
  ): Promise<StoredWorkout | null> {
    const client = this.#clientFor(options.accessToken);
    const { data, error } = await client
      .from<WorkoutRow>("workouts")
      .select("*")
      .eq("user_id", userId)
      .eq("client_operation_id", clientOperationId)
      .maybeSingle();
    if (error) {
      throw new RepositoryError(error.message);
    }
    return data === null ? null : fromRow(data);
  }

  async create(
    userId: UserId,
    workout: StoredWorkout,
    options: { readonly accessToken: string },
  ): Promise<StoredWorkout> {
    const client = this.#clientFor(options.accessToken);
    const { data, error } = await client
      .from<WorkoutRow>("workouts")
      .insert(toInsertRow(userId, workout))
      .select("*")
      .single();
    if (error || data === null) {
      // If unique violation on client_operation_id, return existing row
      if (workout.clientOperationId) {
        const existing = await this.findByClientOperationId(
          userId,
          workout.clientOperationId,
          options,
        );
        if (existing !== null) {
          return existing;
        }
      }
      throw new RepositoryError(
        error?.message ?? "workout insert returned no row",
      );
    }
    return fromRow(data);
  }

  async list(
    userId: UserId,
    options: {
      readonly from: Date | null;
      readonly to: Date | null;
      readonly limit: number;
      readonly kind?: "routine" | "session" | undefined;
      readonly excludeNonStrength?: boolean;
      readonly accessToken: string;
    },
  ): Promise<ReadonlyArray<StoredWorkout>> {
    const client = this.#clientFor(options.accessToken);
    let builder = client
      .from<WorkoutRow>("workouts")
      .select("*")
      .eq("user_id", userId)
      .order("started_at", { ascending: false })
      .limit(options.limit);
    if (options.excludeNonStrength) {
      builder = builder
        .or(
          "details->>activityType.is.null,details->>activityType.not.in.(running,bouldering)",
        )
        .is("details->runSummary", null)
        .is("details->boulderSession", null);
    }
    if (options.from !== null) {
      builder = builder.gte("started_at", options.from.toISOString());
    }
    if (options.to !== null) {
      builder = builder.lte("started_at", options.to.toISOString());
    }
    if (options.kind !== undefined) {
      builder = builder.eq("details->workoutLifecycle->>kind", options.kind);
    }
    const { data, error } = await builder;
    if (error) {
      throw new RepositoryError(error.message);
    }
    return (data ?? []).map(fromRow);
  }

  async getById(
    id: string,
    options: { readonly accessToken: string },
  ): Promise<StoredWorkout | null> {
    const client = this.#clientFor(options.accessToken);
    const { data, error } = await client
      .from<WorkoutRow>("workouts")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      throw new RepositoryError(error.message);
    }
    return data === null ? null : fromRow(data);
  }

  async update(
    workout: StoredWorkout,
    options: { readonly accessToken: string },
  ): Promise<StoredWorkout> {
    const client = this.#clientFor(options.accessToken);
    const { data, error } = await client
      .from<WorkoutRow>("workouts")
      .update(toInsertRow(workout.userId, workout))
      .eq("id", workout.id)
      .select("*")
      .single();
    if (error || data === null) {
      throw new RepositoryError(
        error?.message ?? "workout update returned no row",
      );
    }
    return fromRow(data);
  }

  async delete(
    id: string,
    options: { readonly accessToken: string },
  ): Promise<boolean> {
    const client = this.#clientFor(options.accessToken);
    const { data, error } = await client
      .from<WorkoutRow>("workouts")
      .delete()
      .eq("id", id)
      .select("id");
    if (error) {
      throw new RepositoryError(error.message);
    }
    return Array.isArray(data) && data.length > 0;
  }
}
