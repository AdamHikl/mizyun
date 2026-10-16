import {
  isNonStrengthWorkoutDetails,
  readWorkoutLifecycle,
  type StoredWorkout,
  type UserId,
  type WorkoutRepository,
} from "@mizyun/core";

/**
 * In-memory implementation of the `WorkoutRepository` port.
 *
 * Used by `apps/api` until the Supabase adapter lands. Behaviour:
 *   - `create` stores the workout under the user's tenant
 *     partition.
 *   - `list` filters by tenant, inclusive bounds on `startedAt`,
 *     newest-first, capped at `limit`.
 *   - `getById` is tenant-blind: it returns the workout regardless
 *     of who owns it. The route is the owner of the cross-user
 *     access check (it must compare the returned `userId` to the
 *     authenticated principal before returning the body).
 *   - `update` rejects ids the repository does not know about.
 *   - `delete` returns `true` when a row was removed, `false`
 *     when the id was unknown.
 *
 * The repository deliberately does not enforce RLS — the SQL
 * policies on `public.workouts` are the source of truth. Tests
 * that exercise isolation should use the e2e suite against a real
 * Supabase stack, not this in-memory implementation.
 */
export class InMemoryWorkoutRepository implements WorkoutRepository {
  readonly #byUser = new Map<UserId, StoredWorkout[]>();
  readonly #byId = new Map<string, StoredWorkout>();

  async findByClientOperationId(
    userId: UserId,
    clientOperationId: string,
    options: { readonly accessToken: string },
  ): Promise<StoredWorkout | null> {
    void options.accessToken;
    const list = this.#byUser.get(userId) ?? [];
    return (
      list.find((entry) => entry.clientOperationId === clientOperationId) ??
      null
    );
  }

  async create(
    userId: UserId,
    workout: StoredWorkout,
    options: { readonly accessToken: string },
  ): Promise<StoredWorkout> {
    void options.accessToken;
    if (workout.userId !== userId) {
      throw new Error("workout create userId mismatch");
    }
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
    if (this.#byId.has(workout.id)) {
      throw new Error(`workout id collision ${workout.id}`);
    }
    const list = this.#byUser.get(userId) ?? [];
    this.#byUser.set(userId, [...list, workout]);
    this.#byId.set(workout.id, workout);
    return workout;
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
    void options.accessToken;
    const list = this.#byUser.get(userId) ?? [];
    const fromMs = options.from?.getTime() ?? Number.NEGATIVE_INFINITY;
    const toMs = options.to?.getTime() ?? Number.POSITIVE_INFINITY;
    const filtered = list.filter((entry) => {
      if (
        options.excludeNonStrength &&
        isNonStrengthWorkoutDetails(entry.details)
      )
        return false;
      const ms = entry.startedAt.getTime();
      if (ms < fromMs || ms > toMs) return false;
      if (options.kind !== undefined) {
        const lifecycle = readWorkoutLifecycle(entry.details);
        if (lifecycle !== null) {
          if (lifecycle.kind !== options.kind) return false;
        } else if (options.kind === "routine") {
          if (entry.completedAt !== null) return false;
        } else if (options.kind === "session") {
          if (entry.completedAt === null) return false;
        }
      }
      return true;
    });
    return [...filtered]
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
      .slice(0, Math.max(0, options.limit));
  }

  async getById(
    id: string,
    options: { readonly accessToken: string },
  ): Promise<StoredWorkout | null> {
    void options.accessToken;
    return this.#byId.get(id) ?? null;
  }

  async update(
    workout: StoredWorkout,
    options: { readonly accessToken: string },
  ): Promise<StoredWorkout> {
    void options.accessToken;
    const existing = this.#byId.get(workout.id);
    if (existing === undefined) {
      throw new Error(`workout ${workout.id} does not exist`);
    }
    const owner = existing.userId;
    const list = this.#byUser.get(owner) ?? [];
    const idx = list.findIndex((w) => w.id === workout.id);
    if (idx < 0) {
      throw new Error(`workout ${workout.id} missing from owner partition`);
    }
    const next = [...list];
    next[idx] = workout;
    this.#byUser.set(owner, next);
    this.#byId.set(workout.id, workout);
    return workout;
  }

  async delete(
    id: string,
    options: { readonly accessToken: string },
  ): Promise<boolean> {
    void options.accessToken;
    const existing = this.#byId.get(id);
    if (existing === undefined) return false;
    const owner = existing.userId;
    const list = this.#byUser.get(owner) ?? [];
    this.#byUser.set(
      owner,
      list.filter((entry) => entry.id !== id),
    );
    this.#byId.delete(id);
    return true;
  }

  /** Test-only helper that pre-seeds a workout for a user. */
  __seedForTest(workout: StoredWorkout): void {
    const list = this.#byUser.get(workout.userId) ?? [];
    this.#byUser.set(workout.userId, [...list, workout]);
    this.#byId.set(workout.id, workout);
  }
}
