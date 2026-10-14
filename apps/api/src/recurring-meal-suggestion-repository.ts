import { randomUUID } from "node:crypto";
import {
  detectRecurringMealSuggestion,
  recurringMealLocalDateAt,
  validateRecurringMealSchedule,
  RecurringMealRepositoryError,
  RecurringMealSuggestionRepositoryError,
  type FoodEntryRepository,
  type StoredFoodEntry,
  type UserId,
  type RecurringMealSuggestionEntry,
  type RecurringMealSuggestionDecision,
  type RecurringMealSuggestionRepository,
  type RecurringMealSuggestionProposal,
} from "@mizyun/core";
import { InMemoryRecurringMealRepository } from "./recurring-meal-repository.js";
type Access = { readonly accessToken: string };
type AcceptInput = Parameters<RecurringMealSuggestionRepository["accept"]>[1];
type AcceptResult = Awaited<
  ReturnType<RecurringMealSuggestionRepository["accept"]>
>;
type State = RecurringMealSuggestionDecision & { scheduleId?: string };
const stable = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
        )
      : item,
  );
const entryWire = (e: StoredFoodEntry): RecurringMealSuggestionEntry => ({
  ...e,
  consumedAt: e.consumedAt.toISOString(),
  createdAt: e.createdAt.toISOString(),
  updatedAt: e.updatedAt.toISOString(),
});
/** Explicitly injected test/development fallback. SQL is the durable runtime authority. */
export class InMemoryRecurringMealSuggestionRepository implements RecurringMealSuggestionRepository {
  readonly #states = new Map<string, Map<string, State>>();
  readonly #preferences = new Map<string, boolean>();
  readonly #receipts = new Map<
    string,
    Map<string, { request: string; result: AcceptResult }>
  >();
  readonly #locks = new Map<string, Promise<void>>();
  constructor(
    readonly foodEntryRepository: FoodEntryRepository,
    readonly recurringMealRepository: InMemoryRecurringMealRepository,
    readonly options: {
      isDeleting?: (userId: UserId) => boolean | Promise<boolean>;
    } = {},
  ) {}
  async #admit(userId: UserId) {
    if (await this.options.isDeleting?.(userId))
      throw new RecurringMealSuggestionRepositoryError("invalid");
  }
  #ownedStates(userId: UserId) {
    let states = this.#states.get(userId);
    if (!states) {
      states = new Map();
      this.#states.set(userId, states);
    }
    return states;
  }
  async #lock<T>(userId: UserId, action: () => Promise<T>): Promise<T> {
    const previous = this.#locks.get(userId) ?? Promise.resolve();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.#locks.set(userId, held);
    await previous;
    try {
      await this.#admit(userId);
      return await action();
    } finally {
      release();
      if (this.#locks.get(userId) === held) this.#locks.delete(userId);
    }
  }
  async #history(userId: UserId, options: Access) {
    const to = new Date(),
      from = new Date(to.getTime() - 9 * 86400000),
      entries: StoredFoodEntry[] = [];
    let cursor: { consumedAt: Date; id: string } | null = null;
    const seen = new Set<string>();
    for (let page = 0; page < 11; page++) {
      const rows = await this.foodEntryRepository.list(userId, {
        ...options,
        from,
        to,
        limit: 500,
        cursor,
      });
      if (rows.some((row) => row.userId !== userId))
        throw new RecurringMealSuggestionRepositoryError("not_found");
      if (
        new Set(rows.map((row) => row.id)).size !== rows.length ||
        rows.some((row) => seen.has(row.id))
      )
        return { entries, complete: false };
      for (const row of rows) {
        seen.add(row.id);
        entries.push(row);
      }
      if (entries.length > 5000) return { entries, complete: false };
      if (rows.length < 500) return { entries, complete: true };
      const last = rows.at(-1)!;
      cursor = { consumedAt: last.consumedAt, id: last.id };
    }
    return { entries, complete: false };
  }
  async #candidate(
    userId: UserId,
    timeZone: string,
    options: Access,
    ignoreSchedules = false,
    ignoreAcceptedFamily?: string,
  ) {
    const { entries, complete } = await this.#history(userId, options);
    const now = Date.now();
    const decisions = [...this.#ownedStates(userId).values()].map(
      (original) => {
        const s =
          original.familyKey === ignoreAcceptedFamily
            ? { ...original, accepted: false }
            : original;
        return (s.cooldownUntil && Date.parse(s.cooldownUntil) <= now) ||
          (s.expiresAt && Date.parse(s.expiresAt) + 30 * 86400000 <= now)
          ? { ...s, firstShownAt: null, expiresAt: null }
          : s;
      },
    );
    return detectRecurringMealSuggestion({
      userId,
      entries: entries.map(entryWire),
      generatedEntryIds: [],
      historyComplete: complete,
      referenceAt: new Date(),
      timeZone,
      enabled: this.#preferences.get(userId) ?? true,
      decisions,
      existingSchedules: ignoreSchedules
        ? []
        : this.recurringMealRepository.suggestionProjection(userId),
    });
  }
  async getForUser(
    userId: UserId,
    input: { timeZone: string },
    options: Access,
  ) {
    if (
      !validateRecurringMealSchedule({
        localTime: "12:00",
        timeZone: input.timeZone,
        weekdays: [0],
      })
    )
      throw new RecurringMealSuggestionRepositoryError("invalid");
    return {
      suggestion: await this.#candidate(userId, input.timeZone, options),
      enabled: this.#preferences.get(userId) ?? true,
    };
  }
  async #validate(
    userId: UserId,
    proposal: RecurringMealSuggestionProposal,
    options: Access,
  ) {
    // For acceptance ignore current equivalents and the family's prior acceptance;
    // those produce Already scheduled rather than invalidating valid evidence.
    const current = await this.#candidate(
      userId,
      proposal.timeZone,
      options,
      true,
      proposal.familyKey,
    );
    if (
      !current ||
      stable({ ...current, expiresAt: proposal.expiresAt }) !== stable(proposal)
    )
      throw new RecurringMealSuggestionRepositoryError("conflict");
    for (const evidence of proposal.evidence) {
      const live = await this.foodEntryRepository.getById(evidence.id, options);
      if (
        !live ||
        live.userId !== userId ||
        !live.confirmedByUser ||
        live.updatedAt.toISOString() !== evidence.updatedAt
      )
        throw new RecurringMealSuggestionRepositoryError("conflict");
    }
    const source = await this.foodEntryRepository.getById(
      proposal.sourceEntryId,
      options,
    );
    if (
      !source ||
      source.userId !== userId ||
      source.updatedAt.toISOString() !== proposal.sourceUpdatedAt ||
      (proposal.expiresAt !== current.expiresAt &&
        proposal.expiresAt !==
          new Date(source.createdAt.getTime() + 7 * 86400000).toISOString())
    )
      throw new RecurringMealSuggestionRepositoryError("conflict");
    return source;
  }
  async decide(
    userId: UserId,
    input: Parameters<RecurringMealSuggestionRepository["decide"]>[1],
    options: Access,
  ): Promise<void> {
    await this.#lock(userId, async () => {
      const states = this.#ownedStates(userId),
        state = states.get(input.proposal.familyKey),
        now = Date.now();
      if (
        state?.firstShownAt &&
        state.expiresAt &&
        Date.parse(state.expiresAt) > now
      ) {
        if (
          input.decision === "shown" ||
          (input.decision === "never" && state.never) ||
          (input.decision === "not_now" &&
            state.cooldownUntil &&
            Date.parse(state.cooldownUntil) > now)
        )
          return;
      }
      await this.#validate(userId, input.proposal, options);
      await this.#admit(userId);
      states.set(input.proposal.familyKey, {
        ...state,
        familyKey: input.proposal.familyKey,
        firstShownAt:
          (state?.cooldownUntil && Date.parse(state.cooldownUntil) <= now) ||
          (state?.expiresAt &&
            Date.parse(state.expiresAt) + 30 * 86400000 <= now)
            ? new Date().toISOString()
            : (state?.firstShownAt ?? new Date().toISOString()),
        expiresAt:
          state?.expiresAt && Date.parse(state.expiresAt) > now
            ? state.expiresAt
            : new Date(now + 7 * 86400000).toISOString(),
        ...(input.decision === "shown" ? { cooldownUntil: null } : {}),
        ...(input.decision === "never" ? { never: true } : {}),
        ...(input.decision === "not_now"
          ? { cooldownUntil: new Date(now + 30 * 86400000).toISOString() }
          : {}),
      });
    });
  }
  async accept(
    userId: UserId,
    input: AcceptInput,
    options: Access,
  ): Promise<AcceptResult> {
    return this.#lock(userId, async () => {
      const request = stable(input);
      const receipts = this.#receipts.get(userId) ?? new Map();
      this.#receipts.set(userId, receipts);
      const receipt = receipts.get(input.operationId);
      if (receipt) {
        if (receipt.request !== request)
          throw new RecurringMealSuggestionRepositoryError("conflict");
        const meal = this.recurringMealRepository.suggestionRead(
          userId,
          receipt.result.recurringMeal.id,
        );
        if (!meal)
          throw new RecurringMealSuggestionRepositoryError("not_found");
        return { ...receipt.result, recurringMeal: meal };
      }
      if (
        input.timeZone !== input.proposal.timeZone ||
        !validateRecurringMealSchedule(input)
      )
        throw new RecurringMealSuggestionRepositoryError("conflict");
      const state = this.#ownedStates(userId).get(input.proposal.familyKey);
      if (
        state?.scheduleId &&
        this.recurringMealRepository.suggestionIsStopped(
          userId,
          state.scheduleId,
        )
      )
        throw new RecurringMealSuggestionRepositoryError("conflict");
      const source = await this.#validate(userId, input.proposal, options);
      await this.#admit(userId);
      if (
        state?.scheduleId &&
        (this.recurringMealRepository.suggestionIsStopped(
          userId,
          state.scheduleId,
        ) ||
          !this.recurringMealRepository.suggestionFindEquivalent(
            userId,
            source,
            input,
          ))
      )
        throw new RecurringMealSuggestionRepositoryError("conflict");
      const tomorrow = new Date(
        `${recurringMealLocalDateAt(new Date(), input.timeZone)}T12:00:00Z`,
      );
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      while (!input.weekdays.includes(tomorrow.getUTCDay()))
        tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      let value: ReturnType<
        InMemoryRecurringMealRepository["suggestionCreate"]
      >;
      try {
        value = this.recurringMealRepository.suggestionCreate(userId, source, {
          id: randomUUID(),
          sourceEntryId: source.id,
          localTime: input.localTime,
          timeZone: input.timeZone,
          weekdays: input.weekdays,
        });
      } catch (error) {
        if (error instanceof RecurringMealRepositoryError)
          throw new RecurringMealSuggestionRepositoryError(error.kind);
        throw error;
      }
      this.recurringMealRepository.suggestionLink(userId, value.meal.id);
      const result = {
        recurringMeal: value.meal,
        created: value.created,
        startLocalDate: tomorrow.toISOString().slice(0, 10),
      };
      this.#ownedStates(userId).set(input.proposal.familyKey, {
        ...state,
        familyKey: input.proposal.familyKey,
        accepted: true,
        scheduleId: value.meal.id,
      });
      receipts.set(input.operationId, { request, result });
      return result;
    });
  }
  async getPreferences(userId: UserId, options: Access) {
    void options;
    return { enabled: this.#preferences.get(userId) ?? true };
  }
  async setPreferences(
    userId: UserId,
    input: { enabled: boolean },
    options: Access,
  ) {
    void options;
    await this.#admit(userId);
    this.#preferences.set(userId, input.enabled);
    return input;
  }
  async resetDecisions(userId: UserId, options: Access): Promise<void> {
    void options;
    await this.#admit(userId);
    for (const [key, state] of this.#ownedStates(userId))
      if (!state.accepted) this.#ownedStates(userId).delete(key);
  }
  async exportForUser(userId: UserId, options: Access) {
    void options;
    return {
      states: [...this.#ownedStates(userId).values()].map((s) => ({ ...s })),
      preferences: this.#preferences.has(userId)
        ? [{ enabled: this.#preferences.get(userId) }]
        : [],
      receipts: [...(this.#receipts.get(userId)?.entries() ?? [])].map(
        ([operationId, r]) => ({
          operationId,
          request: JSON.parse(r.request) as unknown,
          result: r.result,
        }),
      ),
    };
  }
  async clearForUser(userId: UserId, options: Access): Promise<void> {
    void options;
    this.#states.delete(userId);
    this.#preferences.delete(userId);
    this.#receipts.delete(userId);
  }
}
