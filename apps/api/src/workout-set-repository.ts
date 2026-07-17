import type {
  StoredWorkoutSet,
  UserId,
  WorkoutSetRepository,
} from "@mizyun/core";

/**
 * In-memory implementation of the `WorkoutSetRepository` port.
 *
 * Used by `apps/api` until the Supabase adapter lands. Behaviour:
 *   - `create` enforces the per-workout sequence uniqueness
 *     invariant (`unique (workout_id, sequence)`). Throws when
 *     the supplied sequence collides.
 *   - `listForWorkout` returns sets ordered by `sequence`
 *     ascending.
 *   - `recentForExercise` filters by tenant and exercise id,
 *     sorts by `createdAt` descending, and caps at `limit`.
 *   - `getById` is tenant-blind: the route enforces ownership
 *     against the verified principal.
 *   - `deleteAllForWorkout` cascades a workout deletion so the
 *     in-memory store doesn't leak orphaned rows. SQL relies on
 *     the FK `ON DELETE CASCADE`.
 */
export class InMemoryWorkoutSetRepository implements WorkoutSetRepository {
  readonly #byId = new Map<string, StoredWorkoutSet>();
  // Indexes for fast scans. SQL will use the migration's indexes.
  readonly #byWorkout = new Map<string, StoredWorkoutSet[]>();

  async create(
    userId: UserId,
    set: StoredWorkoutSet,
  ): Promise<StoredWorkoutSet> {
    if (set.userId !== userId) {
      throw new Error("workout set create userId mismatch");
    }
    if (this.#byId.has(set.id)) {
      throw new Error(`workout set id collision ${set.id}`);
    }
    const existing = this.#byWorkout.get(set.workoutId) ?? [];
    if (existing.some((s) => s.sequence === set.sequence)) {
      throw new Error(
        `workout set sequence collision: workout=${set.workoutId} sequence=${set.sequence}`,
      );
    }
    this.#byWorkout.set(set.workoutId, [...existing, set]);
    this.#byId.set(set.id, set);
    return set;
  }

  async listForWorkout(
    workoutId: string,
  ): Promise<ReadonlyArray<StoredWorkoutSet>> {
    const list = this.#byWorkout.get(workoutId) ?? [];
    return [...list].sort((a, b) => a.sequence - b.sequence);
  }

  async recentForExercise(
    userId: UserId,
    exerciseId: string,
    limit: number,
  ): Promise<ReadonlyArray<StoredWorkoutSet>> {
    const all = [...this.#byId.values()].filter(
      (s) => s.userId === userId && s.exerciseId === exerciseId,
    );
    return all
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, Math.max(0, limit));
  }

  async getById(id: string): Promise<StoredWorkoutSet | null> {
    return this.#byId.get(id) ?? null;
  }

  async delete(id: string): Promise<boolean> {
    const existing = this.#byId.get(id);
    if (existing === undefined) return false;
    this.#byId.delete(id);
    const list = this.#byWorkout.get(existing.workoutId) ?? [];
    this.#byWorkout.set(
      existing.workoutId,
      list.filter((s) => s.id !== id),
    );
    return true;
  }

  async deleteAllForWorkout(workoutId: string): Promise<number> {
    const list = this.#byWorkout.get(workoutId) ?? [];
    for (const s of list) {
      this.#byId.delete(s.id);
    }
    this.#byWorkout.delete(workoutId);
    return list.length;
  }

  /** Test-only helper that pre-seeds a set. */
  __seedForTest(set: StoredWorkoutSet): void {
    this.#byId.set(set.id, set);
    const list = this.#byWorkout.get(set.workoutId) ?? [];
    this.#byWorkout.set(set.workoutId, [...list, set]);
  }
}
