import type { GoalRepository, StoredGoal, UserId } from "@mizyun/core";
import type { Clock } from "@mizyun/core";

interface InMemoryGoalRepositoryOptions {
  readonly clock?: Clock;
}

/**
 * In-memory implementation of the `GoalRepository` port.
 *
 * Used by `apps/api` until the Supabase adapter lands. Behaviour:
 *   - `getActive` returns the most recently-updated `active` goal
 *     for the user, or `null`. The "at most one active goal per user"
 *     invariant is maintained here.
 *   - `getHistory` returns every goal for the user, newest first.
 *   - `create` rejects if the user already has an active goal.
 *   - `update` rejects if the goal id does not belong to the user.
 *
 * The repository deliberately does not enforce RLS — the SQL
 * policies on `public.goals` are the source of truth. Tests that
 * exercise isolation should use the e2e suite against a real
 * Supabase stack, not this in-memory implementation.
 */
export class InMemoryGoalRepository implements GoalRepository {
  readonly #byUser = new Map<UserId, StoredGoal[]>();
  readonly #clock: Clock;

  constructor(options: InMemoryGoalRepositoryOptions = {}) {
    this.#clock = options.clock ?? { now: () => new Date() };
  }

  async getActive(userId: UserId): Promise<StoredGoal | null> {
    const list = this.#byUser.get(userId) ?? [];
    const active = list.filter((g) => g.status === "active");
    if (active.length === 0) return null;
    // If somehow multiple actives exist, return the most recently
    // updated; the SQL partial unique index will enforce the
    // invariant once it lands.
    return active.reduce((a, b) => (a.updatedAt > b.updatedAt ? a : b));
  }

  async getHistory(userId: UserId): Promise<ReadonlyArray<StoredGoal>> {
    const list = this.#byUser.get(userId) ?? [];
    return [...list].sort(
      (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
    );
  }

  async create(userId: UserId, goal: StoredGoal): Promise<StoredGoal> {
    if (goal.userId !== userId) {
      throw new Error("goal create userId mismatch");
    }
    const existing = this.#byUser.get(userId) ?? [];
    if (existing.some((g) => g.status === "active")) {
      throw new Error("user already has an active goal");
    }
    this.#byUser.set(userId, [...existing, goal]);
    return goal;
  }

  async update(userId: UserId, goal: StoredGoal): Promise<StoredGoal> {
    if (goal.userId !== userId) {
      throw new Error("goal update userId mismatch");
    }
    const list = this.#byUser.get(userId) ?? [];
    const idx = list.findIndex((g) => g.id === goal.id);
    if (idx < 0) {
      throw new Error(`update called for missing goal ${goal.id}`);
    }
    const next = [...list];
    next[idx] = goal;
    this.#byUser.set(userId, next);
    return goal;
  }

  /**
   * Hard-delete a goal. The route layer never exposes this; the
   * DATA-001 account-deletion path uses it to clean up after a
   * user wipes their account. SQL cascades through the
   * `auth.users` FK instead.
   */
  async delete(id: string): Promise<boolean> {
    // Walk the user's partitions because the index is keyed by
    // user. Real SQL looks up by id alone (the `(id, user_id)`
    // unique constraint is fast enough).
    for (const [userId, list] of this.#byUser.entries()) {
      const idx = list.findIndex((g) => g.id === id);
      if (idx >= 0) {
        const next = list.filter((g) => g.id !== id);
        this.#byUser.set(userId, next);
        return true;
      }
    }
    return false;
  }

  /** Test-only helper that pre-seeds a goal for a user. */
  __seedForTest(goal: StoredGoal): void {
    const list = this.#byUser.get(goal.userId) ?? [];
    this.#byUser.set(goal.userId, [...list, goal]);
  }
}
