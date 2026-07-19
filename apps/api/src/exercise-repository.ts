import type { ExerciseRepository, StoredExercise, UserId } from "@mizyun/core";

/**
 * In-memory implementation of the `ExerciseRepository` port.
 *
 * Used by `apps/api` until the Supabase adapter lands. Behaviour:
 *   - `create` stores the exercise under the user's tenant partition.
 *   - `list` returns the user's exercises sorted by name
 *     (case-insensitive) for a stable picker experience.
 *   - `getById` is tenant-blind: it returns the exercise regardless
 *     of who owns it. The route is the owner of the cross-user
 *     access check (it must compare the returned `userId` to the
 *     authenticated principal before returning the body).
 *   - `update` rejects ids the repository does not know about.
 *   - `delete` returns `true` when a row was removed, `false`
 *     when the id was unknown.
 *
 * The repository deliberately does not enforce RLS — the SQL
 * policies on `public.exercises` are the source of truth. Tests
 * that exercise isolation should use the e2e suite against a real
 * Supabase stack, not this in-memory implementation.
 */
export class InMemoryExerciseRepository implements ExerciseRepository {
  readonly #byUser = new Map<UserId, StoredExercise[]>();
  readonly #byId = new Map<string, StoredExercise>();

  async create(
    userId: UserId,
    exercise: StoredExercise,
    options: { readonly accessToken: string },
  ): Promise<StoredExercise> {
    void options.accessToken;
    if (exercise.userId !== userId) {
      throw new Error("exercise create userId mismatch");
    }
    if (this.#byId.has(exercise.id)) {
      throw new Error(`exercise id collision ${exercise.id}`);
    }
    const list = this.#byUser.get(userId) ?? [];
    this.#byUser.set(userId, [...list, exercise]);
    this.#byId.set(exercise.id, exercise);
    return exercise;
  }

  async list(
    userId: UserId,
    options: { readonly limit: number; readonly accessToken: string },
  ): Promise<ReadonlyArray<StoredExercise>> {
    void options.accessToken;
    const list = this.#byUser.get(userId) ?? [];
    return [...list]
      .sort((a, b) =>
        a.name.toLowerCase() < b.name.toLowerCase()
          ? -1
          : a.name.toLowerCase() > b.name.toLowerCase()
            ? 1
            : 0,
      )
      .slice(0, Math.max(0, options.limit));
  }

  async getById(
    id: string,
    options: { readonly accessToken: string },
  ): Promise<StoredExercise | null> {
    void options.accessToken;
    return this.#byId.get(id) ?? null;
  }

  async update(
    exercise: StoredExercise,
    options: { readonly accessToken: string },
  ): Promise<StoredExercise> {
    void options.accessToken;
    const existing = this.#byId.get(exercise.id);
    if (existing === undefined) {
      throw new Error(`exercise ${exercise.id} does not exist`);
    }
    const owner = existing.userId;
    const list = this.#byUser.get(owner) ?? [];
    const idx = list.findIndex((e) => e.id === exercise.id);
    if (idx < 0) {
      throw new Error(`exercise ${exercise.id} missing from owner partition`);
    }
    const next = [...list];
    next[idx] = exercise;
    this.#byUser.set(owner, next);
    this.#byId.set(exercise.id, exercise);
    return exercise;
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

  /** Test-only helper that pre-seeds an exercise for a user. */
  __seedForTest(exercise: StoredExercise): void {
    const list = this.#byUser.get(exercise.userId) ?? [];
    this.#byUser.set(exercise.userId, [...list, exercise]);
    this.#byId.set(exercise.id, exercise);
  }
}
