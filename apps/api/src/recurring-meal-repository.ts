import {
  RecurringMealRepositoryError,
  isRecurringMealLocalDate,
  recurringMealLocalDateAt,
  validateRecurringMealSchedule,
  type FoodEntryRepository,
  type RecurringMealCreate,
  type RecurringMealPatch,
  type RecurringMealRepository,
  type StoredRecurringMeal,
  type UserId,
} from "@mizyun/core";

type RecordState = {
  meal: StoredRecurringMeal;
  readonly original: string;
  stopped: boolean;
  readonly skips: Set<string>;
};

const fingerprint = (input: RecurringMealCreate): string =>
  JSON.stringify({
    sourceEntryId: input.sourceEntryId,
    localTime: input.localTime,
    timeZone: input.timeZone,
    weekdays: [...input.weekdays].sort((a, b) => a - b),
  });
const clone = (meal: StoredRecurringMeal): StoredRecurringMeal => ({
  ...meal,
  weekdays: [...meal.weekdays],
  createdAt: new Date(meal.createdAt),
  updatedAt: new Date(meal.updatedAt),
});

/** Test/development fallback. Durable occurrence creation belongs to the SQL worker. */
export class InMemoryRecurringMealRepository implements RecurringMealRepository {
  readonly #rows = new Map<string, RecordState>();
  constructor(readonly foodEntryRepository: FoodEntryRepository) {}

  async clearForUser(
    userId: UserId,
    options: { readonly accessToken: string },
  ): Promise<void> {
    void options;
    for (const [id, row] of this.#rows) {
      if (row.meal.userId === userId) this.#rows.delete(id);
    }
  }

  async exportForUser(
    userId: UserId,
    options: { readonly accessToken: string },
  ): Promise<{
    readonly schedules: readonly Record<string, unknown>[];
    readonly occurrences: readonly Record<string, unknown>[];
  }> {
    void options;
    const owned = [...this.#rows.values()].filter(
      (row) => row.meal.userId === userId,
    );
    return {
      schedules: owned.map((row) => ({
        ...clone(row.meal),
        stopped: row.stopped,
        createdAt: row.meal.createdAt.toISOString(),
        updatedAt: row.meal.updatedAt.toISOString(),
      })),
      occurrences: owned.flatMap((row) =>
        [...row.skips].map((localDate) => ({
          recurringMealId: row.meal.id,
          localDate,
          status: "skipped",
        })),
      ),
    };
  }

  async #source(
    userId: UserId,
    id: string,
    options: { readonly accessToken: string },
  ) {
    const entry = await this.foodEntryRepository.getById(id, options);
    if (!entry || entry.userId !== userId)
      throw new RecurringMealRepositoryError("not_found");
    if (!entry.confirmedByUser)
      throw new RecurringMealRepositoryError("invalid");
    return entry;
  }

  async list(
    userId: UserId,
    options: { readonly accessToken: string },
  ): Promise<readonly StoredRecurringMeal[]> {
    void options;
    return [...this.#rows.values()]
      .filter((row) => row.meal.userId === userId && !row.stopped)
      .map((row) => clone(row.meal))
      .sort(
        (a, b) =>
          b.createdAt.getTime() - a.createdAt.getTime() ||
          a.id.localeCompare(b.id),
      );
  }

  async create(
    userId: UserId,
    input: RecurringMealCreate,
    options: { readonly accessToken: string },
  ): Promise<StoredRecurringMeal> {
    if (!validateRecurringMealSchedule(input))
      throw new RecurringMealRepositoryError("invalid");
    const original = fingerprint(input);
    const existing = this.#rows.get(input.id);
    if (existing) {
      if (existing.meal.userId !== userId)
        throw new RecurringMealRepositoryError("not_found");
      if (existing.stopped || existing.original !== original)
        throw new RecurringMealRepositoryError("conflict");
      return clone(existing.meal);
    }
    const source = await this.#source(userId, input.sourceEntryId, options);
    // Another same-id request can finish the source read while this request awaits it.
    const raced = this.#rows.get(input.id);
    if (raced) return this.create(userId, input, options);
    if (
      [...this.#rows.values()].filter(
        (row) => row.meal.userId === userId && !row.stopped,
      ).length >= 20
    )
      throw new RecurringMealRepositoryError("invalid");
    const now = new Date();
    const meal: StoredRecurringMeal = {
      id: input.id,
      userId,
      name: source.name,
      localTime: input.localTime,
      timeZone: input.timeZone,
      weekdays: [...input.weekdays].sort((a, b) => a - b),
      enabled: true,
      createdAt: now,
      updatedAt: now,
    };
    this.#rows.set(input.id, {
      meal,
      original,
      stopped: false,
      skips: new Set(),
    });
    return clone(meal);
  }

  async update(
    userId: UserId,
    id: string,
    patch: RecurringMealPatch,
    options: { readonly accessToken: string },
  ): Promise<StoredRecurringMeal | null> {
    const row = this.#rows.get(id);
    if (!row || row.meal.userId !== userId || row.stopped) return null;
    if (!Object.values(patch).some((value) => value !== undefined))
      throw new RecurringMealRepositoryError("invalid");
    const source =
      patch.sourceEntryId === undefined
        ? null
        : await this.#source(userId, patch.sourceEntryId, options);
    // A stop performed while loading a replacement snapshot is final.
    if (row.stopped) return null;
    const next: StoredRecurringMeal = {
      ...row.meal,
      localTime: patch.localTime ?? row.meal.localTime,
      timeZone: patch.timeZone ?? row.meal.timeZone,
      weekdays: [...(patch.weekdays ?? row.meal.weekdays)].sort(
        (a, b) => a - b,
      ),
      enabled: patch.enabled ?? row.meal.enabled,
      name: source?.name ?? row.meal.name,
      updatedAt: new Date(),
    };
    if (!validateRecurringMealSchedule(next))
      throw new RecurringMealRepositoryError("invalid");
    row.meal = next;
    return clone(next);
  }

  async stop(
    userId: UserId,
    id: string,
    options: { readonly accessToken: string },
  ): Promise<boolean> {
    void options;
    const row = this.#rows.get(id);
    if (!row || row.meal.userId !== userId) return false;
    row.stopped = true;
    row.meal = { ...row.meal, enabled: false, updatedAt: new Date() };
    return true;
  }

  async skip(
    userId: UserId,
    id: string,
    localDate: string,
    options: { readonly accessToken: string },
  ): Promise<boolean> {
    void options;
    if (!isRecurringMealLocalDate(localDate))
      throw new RecurringMealRepositoryError("invalid");
    const row = this.#rows.get(id);
    if (!row || row.meal.userId !== userId || row.stopped) return false;
    if (localDate !== recurringMealLocalDateAt(new Date(), row.meal.timeZone))
      throw new RecurringMealRepositoryError("invalid");
    row.skips.add(localDate);
    return true;
  }
}
