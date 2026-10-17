import type {
  StoredWorkoutSet,
  UserId,
  WorkoutSetRepository,
} from "@mizyun/core";

import type { RepositorySupabaseClient } from "./index.js";
import { RepositoryError } from "./repository-error.js";

interface WorkoutSetRow extends Record<string, unknown> {
  readonly id: string;
  readonly user_id: string;
  readonly workout_id: string;
  readonly exercise_id: string;
  readonly sequence: number;
  readonly set_type?: string | null;
  readonly repetitions: number | null;
  readonly load_kg: number | null;
  readonly duration_seconds: number | null;
  readonly distance_meters: number | null;
  readonly perceived_exertion: number | null;
  readonly completed_at: string | null;
  readonly created_at: string;
}

export const workoutSetFromRow = (row: WorkoutSetRow): StoredWorkoutSet => ({
  id: row.id,
  userId: row.user_id as UserId,
  workoutId: row.workout_id,
  exerciseId: row.exercise_id,
  sequence: row.sequence,
  setType: (row.set_type as StoredWorkoutSet["setType"]) ?? "normal",
  repetitions: row.repetitions,
  loadKg: row.load_kg,
  durationSeconds: row.duration_seconds,
  distanceMeters: row.distance_meters,
  perceivedExertion: row.perceived_exertion,
  completedAt: row.completed_at === null ? null : new Date(row.completed_at),
  createdAt: new Date(row.created_at),
});
const fromRow = workoutSetFromRow;

const toInsertRow = (set: StoredWorkoutSet): Partial<WorkoutSetRow> => ({
  id: set.id,
  user_id: set.userId,
  workout_id: set.workoutId,
  exercise_id: set.exerciseId,
  sequence: set.sequence,
  set_type: set.setType ?? "normal",
  repetitions: set.repetitions,
  load_kg: set.loadKg,
  duration_seconds: set.durationSeconds,
  distance_meters: set.distanceMeters,
  perceived_exertion: set.perceivedExertion,
  completed_at: set.completedAt === null ? null : set.completedAt.toISOString(),
});

export interface SupabaseWorkoutSetRepositoryOptions {
  readonly clientFor: (accessToken: string) => RepositorySupabaseClient;
}

export class SupabaseWorkoutSetRepository implements WorkoutSetRepository {
  readonly #clientFor: (accessToken: string) => RepositorySupabaseClient;

  constructor(options: SupabaseWorkoutSetRepositoryOptions) {
    this.#clientFor = options.clientFor;
  }

  async create(
    userId: UserId,
    set: StoredWorkoutSet,
    options: { readonly accessToken: string },
  ): Promise<StoredWorkoutSet> {
    const client = this.#clientFor(options.accessToken);
    try {
      const { data, error } = await client
        .from<WorkoutSetRow>("workout_sets")
        .insert(toInsertRow(set))
        .select("*")
        .single();
      if (error || data === null) {
        throw new RepositoryError(
          error?.message ?? "workout set insert returned no row",
        );
      }
      return fromRow(data);
    } catch (cause) {
      // 23505 unique_violation on (workout_id, sequence).
      const message = cause instanceof Error ? cause.message : "unknown";
      if (
        message.includes("workout_sets") &&
        message.includes("duplicate key value")
      ) {
        throw new RepositoryError(
          `workout set sequence collision: workout=${set.workoutId} sequence=${set.sequence}`,
        );
      }
      throw cause;
    }
  }

  async listForWorkout(
    workoutId: string,
    options: { readonly accessToken: string },
  ): Promise<ReadonlyArray<StoredWorkoutSet>> {
    const client = this.#clientFor(options.accessToken);
    const { data, error } = await client
      .from<WorkoutSetRow>("workout_sets")
      .select("*")
      .eq("workout_id", workoutId)
      .order("sequence", { ascending: true });
    if (error) {
      throw new RepositoryError(error.message);
    }
    return (data ?? []).map(fromRow);
  }

  async recentForExercise(
    userId: UserId,
    exerciseId: string,
    limit: number,
    options: { readonly accessToken: string },
  ): Promise<ReadonlyArray<StoredWorkoutSet>> {
    const client = this.#clientFor(options.accessToken);
    const { data, error } = await client
      .from<WorkoutSetRow>("workout_sets")
      .select("*")
      .eq("user_id", userId)
      .eq("exercise_id", exerciseId)
      // "Recent" means when the set was performed, so backdated sets
      // do not outrank newer performances. created_at breaks ties.
      .order("completed_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) {
      throw new RepositoryError(error.message);
    }
    return (data ?? []).map(fromRow);
  }

  async getById(
    id: string,
    options: { readonly accessToken: string },
  ): Promise<StoredWorkoutSet | null> {
    const client = this.#clientFor(options.accessToken);
    const { data, error } = await client
      .from<WorkoutSetRow>("workout_sets")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      throw new RepositoryError(error.message);
    }
    return data === null ? null : fromRow(data);
  }

  async delete(
    id: string,
    options: { readonly accessToken: string },
  ): Promise<boolean> {
    const client = this.#clientFor(options.accessToken);
    const { data, error } = await client
      .from<WorkoutSetRow>("workout_sets")
      .delete()
      .eq("id", id)
      .select("id");
    if (error) {
      throw new RepositoryError(error.message);
    }
    return Array.isArray(data) && data.length > 0;
  }

  /**
   * In SQL, `public.workout_sets.workout_id` references
   * `public.workouts(id, user_id) ON DELETE CASCADE`, so the
   * database handles the cascade. The Supabase adapter is a
   * no-op; the in-memory adapter walks the sets explicitly.
   */
  async deleteAllForWorkout(
    _workoutId: string,
    _options: { readonly accessToken: string },
  ): Promise<number> {
    return 0;
  }
}
