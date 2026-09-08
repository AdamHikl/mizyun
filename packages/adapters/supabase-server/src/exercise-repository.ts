import type { ExerciseRepository, StoredExercise, UserId } from "@mizyun/core";

import type { RepositorySupabaseClient } from "./index.js";
import { RepositoryError } from "./repository-error.js";

/**
 * SQL row shape as Supabase returns it.
 */
interface ExerciseRow extends Record<string, unknown> {
  readonly id: string;
  readonly user_id: string;
  readonly name: string;
  readonly instructions: string | null;
  readonly metadata: Record<string, unknown>;
  readonly created_at: string;
  readonly updated_at: string;
}

export const exerciseFromRow = (row: ExerciseRow): StoredExercise => ({
  id: row.id,
  userId: row.user_id as UserId,
  name: row.name,
  instructions: row.instructions,
  metadata: { ...row.metadata },
  createdAt: new Date(row.created_at),
  updatedAt: new Date(row.updated_at),
});
const fromRow = exerciseFromRow;

const toInsertRow = (
  userId: UserId,
  exercise: StoredExercise,
): Partial<ExerciseRow> => ({
  id: exercise.id,
  user_id: userId,
  name: exercise.name,
  instructions: exercise.instructions,
  metadata: { ...exercise.metadata },
});

export interface SupabaseExerciseRepositoryOptions {
  readonly clientFor: (accessToken: string) => RepositorySupabaseClient;
}

export class SupabaseExerciseRepository implements ExerciseRepository {
  readonly #clientFor: (accessToken: string) => RepositorySupabaseClient;

  constructor(options: SupabaseExerciseRepositoryOptions) {
    this.#clientFor = options.clientFor;
  }

  async create(
    userId: UserId,
    exercise: StoredExercise,
    options: { readonly accessToken: string },
  ): Promise<StoredExercise> {
    const client = this.#clientFor(options.accessToken);
    const { data, error } = await client
      .from<ExerciseRow>("exercises")
      .insert(toInsertRow(userId, exercise))
      .select("*")
      .single();
    if (error || data === null) {
      throw new RepositoryError(
        error?.message ?? "exercise insert returned no row",
      );
    }
    return fromRow(data);
  }

  async list(
    userId: UserId,
    options: { readonly limit: number; readonly accessToken: string },
  ): Promise<ReadonlyArray<StoredExercise>> {
    const client = this.#clientFor(options.accessToken);
    // The SQL migration does not have a `created_at` column on
    // `public.exercises` (the row uses `id, user_id, name,
    // instructions, metadata, created_at, updated_at`). We sort
    // by `created_at` descending; PostgREST uses the index on
    // `(user_id, name)` when filtering by name but doesn't
    // benefit from a `(user_id, created_at desc)` index here —
    // ordering falls back to in-memory sort at the SQL layer
    // via the `order` clause. Fine for v1.
    const { data, error } = await client
      .from<ExerciseRow>("exercises")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(options.limit);
    if (error) {
      throw new RepositoryError(error.message);
    }
    return (data ?? []).map(fromRow);
  }

  async getById(
    id: string,
    options: { readonly accessToken: string },
  ): Promise<StoredExercise | null> {
    const client = this.#clientFor(options.accessToken);
    const { data, error } = await client
      .from<ExerciseRow>("exercises")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      throw new RepositoryError(error.message);
    }
    return data === null ? null : fromRow(data);
  }

  async update(
    exercise: StoredExercise,
    options: { readonly accessToken: string },
  ): Promise<StoredExercise> {
    const client = this.#clientFor(options.accessToken);
    const { data, error } = await client
      .from<ExerciseRow>("exercises")
      .update(toInsertRow(exercise.userId, exercise))
      .eq("id", exercise.id)
      .select("*")
      .single();
    if (error || data === null) {
      throw new RepositoryError(
        error?.message ?? "exercise update returned no row",
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
      .from<ExerciseRow>("exercises")
      .delete()
      .eq("id", id)
      .select("id");
    if (error) {
      throw new RepositoryError(error.message);
    }
    return Array.isArray(data) && data.length > 0;
  }
}
