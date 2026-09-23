import type {
  FoodEntryRepository,
  StoredFoodEntry,
  UserId,
} from "@mizyun/core";

/**
 * In-memory implementation of the `FoodEntryRepository` port.
 *
 * Used by `apps/api` until the Supabase adapter lands. Behaviour:
 *   - `create` stores the entry under the user's tenant partition;
 *     the timestamp-based sort key is `consumedAt`.
 *   - `list` filters by tenant, inclusive bounds on `consumedAt`,
 *     newest-first, capped at `limit`.
 *   - `getById` is tenant-blind: it returns the entry regardless of
 *     who owns it. The route is the owner of the cross-user access
 *     check (it must compare the returned `userId` to the
 *     authenticated principal before returning the body).
 *   - `update` rejects ids the repository does not know about; the
 *     route is responsible for the ownership check.
 *   - `delete` returns `true` when a row was removed, `false` when
 *     the id was unknown.
 *
 * The repository deliberately does not enforce RLS — the SQL
 * policies on `public.food_entries` are the source of truth. Tests
 * that exercise isolation should use the e2e suite against a real
 * Supabase stack, not this in-memory implementation.
 */
export class InMemoryFoodEntryRepository implements FoodEntryRepository {
  readonly #byUser = new Map<UserId, StoredFoodEntry[]>();
  readonly #byId = new Map<string, StoredFoodEntry>();

  async findByClientOperationId(
    userId: UserId,
    clientOperationId: string,
    options: { readonly accessToken: string },
  ): Promise<StoredFoodEntry | null> {
    void options.accessToken;
    const list = this.#byUser.get(userId) ?? [];
    return (
      list.find((entry) => entry.clientOperationId === clientOperationId) ??
      null
    );
  }

  async create(
    userId: UserId,
    entry: StoredFoodEntry,
    options: { readonly accessToken: string },
  ): Promise<StoredFoodEntry> {
    void options.accessToken;
    if (entry.userId !== userId) {
      throw new Error("food entry create userId mismatch");
    }
    if (this.#byId.has(entry.id)) {
      throw new Error(`food entry id collision ${entry.id}`);
    }
    if (entry.clientOperationId) {
      const existing = await this.findByClientOperationId(
        userId,
        entry.clientOperationId,
        options,
      );
      if (existing !== null) {
        return existing;
      }
    }
    const list = this.#byUser.get(userId) ?? [];
    this.#byUser.set(userId, [...list, entry]);
    this.#byId.set(entry.id, entry);
    return entry;
  }

  async list(
    userId: UserId,
    options: {
      readonly from: Date | null;
      readonly to: Date | null;
      readonly limit: number;
      readonly cursor?: {
        readonly consumedAt: Date;
        readonly id: string;
      } | null;
      readonly search?: string | null;
      readonly accessToken: string;
    },
  ): Promise<ReadonlyArray<StoredFoodEntry>> {
    void options.accessToken;
    const list = this.#byUser.get(userId) ?? [];
    const fromMs = options.from?.getTime() ?? Number.NEGATIVE_INFINITY;
    const toMs = options.to?.getTime() ?? Number.POSITIVE_INFINITY;
    const normalizedSearch = options.search?.trim().toLowerCase() ?? null;

    const filtered = list.filter((entry) => {
      const ms = entry.consumedAt.getTime();
      if (ms < fromMs || ms > toMs) return false;
      if (normalizedSearch !== null && normalizedSearch.length > 0) {
        if (!entry.name.toLowerCase().includes(normalizedSearch)) return false;
      }
      return true;
    });

    const sorted = [...filtered].sort((a, b) => {
      const timeDiff = b.consumedAt.getTime() - a.consumedAt.getTime();
      if (timeDiff !== 0) return timeDiff;
      return b.id.localeCompare(a.id);
    });

    if (options.cursor) {
      const cursorTime = options.cursor.consumedAt.getTime();
      const cursorId = options.cursor.id;
      const afterCursor = sorted.filter((entry) => {
        const diff = entry.consumedAt.getTime() - cursorTime;
        if (diff < 0) return true;
        if (diff === 0 && entry.id.localeCompare(cursorId) < 0) return true;
        return false;
      });
      return afterCursor.slice(0, Math.max(0, options.limit));
    }

    return sorted.slice(0, Math.max(0, options.limit));
  }

  async getById(
    id: string,
    options: { readonly accessToken: string },
  ): Promise<StoredFoodEntry | null> {
    void options.accessToken;
    return this.#byId.get(id) ?? null;
  }

  async update(
    entry: StoredFoodEntry,
    options: { readonly accessToken: string },
  ): Promise<StoredFoodEntry> {
    void options.accessToken;
    const existing = this.#byId.get(entry.id);
    if (existing === undefined) {
      throw new Error(`food entry ${entry.id} does not exist`);
    }
    const owner = existing.userId;
    const list = this.#byUser.get(owner) ?? [];
    const idx = list.findIndex((e) => e.id === entry.id);
    if (idx < 0) {
      throw new Error(`food entry ${entry.id} missing from owner partition`);
    }
    const next = [...list];
    next[idx] = entry;
    this.#byUser.set(owner, next);
    this.#byId.set(entry.id, entry);
    return entry;
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

  /** Test-only helper that pre-seeds an entry for a user. */
  __seedForTest(entry: StoredFoodEntry): void {
    const list = this.#byUser.get(entry.userId) ?? [];
    this.#byUser.set(entry.userId, [...list, entry]);
    this.#byId.set(entry.id, entry);
  }
}
