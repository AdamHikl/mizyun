import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredFoodEntry, UserId } from "@mizyun/core";
import { InMemoryFoodEntryRepository } from "./food-entry-repository.js";
import { InMemoryRecurringMealRepository } from "./recurring-meal-repository.js";
import { InMemoryRecurringMealSuggestionRepository } from "./recurring-meal-suggestion-repository.js";
const user = "10000000-0000-4000-8000-000000000001" as UserId;
const other = "10000000-0000-4000-8000-000000000002" as UserId;
const options = { accessToken: "verified" };
const operationId = "30000000-0000-4000-8000-000000000001";
const fixture = () => {
  const food = new InMemoryFoodEntryRepository();
  const entries: StoredFoodEntry[] = [11, 12, 13].map((day, index) => ({
    id: `20000000-0000-4000-8000-00000000000${index + 1}`,
    userId: user,
    name: "Oats with banana",
    consumedAt: new Date(`2026-10-${day}T08:00:00.000Z`),
    createdAt: new Date(`2026-10-${day}T08:00:00.000Z`),
    updatedAt: new Date(`2026-10-${day}T08:00:00.000Z`),
    confirmedByUser: true,
    caloriesKcal: 300,
    proteinG: 10,
    carbohydrateG: 40,
    fatG: 10,
    source: "manual",
    confidence: null,
    details: { grams: 100 },
  }));
  for (const entry of entries) food.__seedForTest(entry);
  const recurring = new InMemoryRecurringMealRepository(food);
  const repo = new InMemoryRecurringMealSuggestionRepository(food, recurring);
  const proposal = async () => {
    const p = (await repo.getForUser(user, { timeZone: "UTC" }, options))
      .suggestion;
    expect(p).not.toBeNull();
    return p!;
  };
  return { food, entries, recurring, repo, proposal };
};
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-13T10:00:00Z"));
});
afterEach(() => vi.useRealTimers());
describe("meal suggestion fallback recovery boundary", () => {
  it("offers and accepts a two-week weekday pattern on the proposed days", async () => {
    const food = new InMemoryFoodEntryRepository();
    // Tuesday 2026-10-13: Thursday 10-01/10-08 and Tuesday 10-06/10-13.
    ["01", "06", "08", "13"].forEach((day, index) =>
      food.__seedForTest({
        id: `21000000-0000-4000-8000-00000000000${index + 1}`,
        userId: user,
        name: "Protein shake",
        consumedAt: new Date(`2026-10-${day}T07:30:00.000Z`),
        createdAt: new Date(`2026-10-${day}T07:30:00.000Z`),
        updatedAt: new Date(`2026-10-${day}T07:30:00.000Z`),
        confirmedByUser: true,
        caloriesKcal: 200,
        proteinG: 30,
        carbohydrateG: 10,
        fatG: 3,
        source: "manual",
        confidence: null,
        details: {},
      }),
    );
    const recurring = new InMemoryRecurringMealRepository(food);
    const repo = new InMemoryRecurringMealSuggestionRepository(food, recurring);
    const p = (await repo.getForUser(user, { timeZone: "UTC" }, options))
      .suggestion!;
    expect(p).toMatchObject({
      reasonCode: "weekly_pattern",
      weekdays: [2, 4],
      localTime: "07:30",
    });
    const result = await repo.accept(
      user,
      {
        operationId,
        proposal: p,
        localTime: p.localTime,
        timeZone: "UTC",
        weekdays: p.weekdays,
      },
      options,
    );
    expect(result.recurringMeal.weekdays).toEqual([2, 4]);
    expect(result.startLocalDate).toBe("2026-10-15");
  });
  it("has no food writes on reads/decisions and persists controls across reads", async () => {
    const { food, repo, proposal } = fixture();
    const create = vi.spyOn(food, "create");
    const p = await proposal();
    await repo.decide(user, { proposal: p, decision: "shown" }, options);
    await repo.decide(user, { proposal: p, decision: "not_now" }, options);
    expect(
      (await repo.getForUser(user, { timeZone: "UTC" }, options)).suggestion,
    ).toBeNull();
    expect(create).not.toHaveBeenCalled();
    expect((await repo.exportForUser(user, options)).states).toHaveLength(1);
    await repo.resetDecisions(user, options);
    expect(
      (await repo.getForUser(user, { timeZone: "UTC" }, options)).suggestion,
    ).not.toBeNull();
  });
  it("double taps create one schedule, skip only today, replay after source deletion tomorrow never changes that skip", async () => {
    const { food, entries, recurring, repo, proposal } = fixture();
    const p = await proposal();
    const input = {
      operationId,
      proposal: p,
      localTime: p.localTime,
      timeZone: "UTC",
      weekdays: p.weekdays,
    };
    const [a, b] = await Promise.all([
      repo.accept(user, input, options),
      repo.accept(user, input, options),
    ]);
    expect(a.recurringMeal.id).toBe(b.recurringMeal.id);
    expect(a.created).toBe(true);
    const before = await recurring.exportForUser(user, options);
    expect(before.occurrences).toEqual([
      {
        recurringMealId: a.recurringMeal.id,
        localDate: "2026-10-13",
        status: "skipped",
      },
    ]);
    await food.delete(entries[2]!.id, options);
    vi.setSystemTime(new Date("2026-10-14T10:00:00Z"));
    expect((await repo.accept(user, input, options)).recurringMeal.id).toBe(
      a.recurringMeal.id,
    );
    expect((await recurring.exportForUser(user, options)).occurrences).toEqual(
      before.occurrences,
    );
    await recurring.stop(user, a.recurringMeal.id, options);
    expect(
      (await repo.accept(user, input, options)).recurringMeal.enabled,
    ).toBe(false);
    await expect(
      repo.accept(user, { ...input, localTime: "09:00" }, options),
    ).rejects.toMatchObject({ kind: "conflict" });
  });
  it("returns an equivalent manual/paused schedule without skipping it, and reciprocal manual creates conflict", async () => {
    const { entries, recurring, repo, proposal } = fixture();
    const p = await proposal();
    const manual = {
      id: operationId,
      sourceEntryId: entries[0]!.id,
      localTime: p.localTime,
      timeZone: "UTC",
      weekdays: p.weekdays,
    };
    await recurring.create(user, manual, options);
    await recurring.update(user, manual.id, { enabled: false }, options);
    const result = await repo.accept(
      user,
      {
        operationId,
        proposal: p,
        localTime: p.localTime,
        timeZone: "UTC",
        weekdays: p.weekdays,
      },
      options,
    );
    expect(result.created).toBe(false);
    expect(result.recurringMeal.id).toBe(manual.id);
    expect((await recurring.exportForUser(user, options)).occurrences).toEqual(
      [],
    );
    const second = fixture();
    const q = await second.proposal();
    await second.repo.accept(
      user,
      {
        operationId,
        proposal: q,
        localTime: q.localTime,
        timeZone: "UTC",
        weekdays: q.weekdays,
      },
      options,
    );
    await expect(
      second.recurring.create(
        user,
        { ...manual, id: "30000000-0000-4000-8000-000000000002" },
        options,
      ),
    ).rejects.toMatchObject({ kind: "conflict" });
  });
  it("rejects edited evidence, forged snapshots, owner mismatch and changed timezone without partial state", async () => {
    const { food, entries, recurring, repo, proposal } = fixture();
    const p = await proposal();
    const input = {
      operationId,
      proposal: p,
      localTime: p.localTime,
      timeZone: "UTC",
      weekdays: p.weekdays,
    };
    await expect(repo.accept(other, input, options)).rejects.toMatchObject({
      kind: "conflict",
    });
    await expect(
      repo.accept(
        user,
        { ...input, proposal: { ...p, caloriesKcal: 301 } },
        options,
      ),
    ).rejects.toMatchObject({ kind: "conflict" });
    await expect(
      repo.accept(user, { ...input, timeZone: "Europe/Bratislava" }, options),
    ).rejects.toMatchObject({ kind: "conflict" });
    await food.update({ ...entries[0]!, updatedAt: new Date() }, options);
    await expect(repo.accept(user, input, options)).rejects.toMatchObject({
      kind: "conflict",
    });
    expect(await recurring.list(user, options)).toEqual([]);
    expect((await repo.exportForUser(user, options)).receipts).toEqual([]);
  });
  it("custom weekdays start on their next selected date and deletion admission denies writes", async () => {
    const { food, recurring, proposal } = fixture();
    const p = await proposal();
    let deleting = false;
    const repo = new InMemoryRecurringMealSuggestionRepository(
      food,
      recurring,
      { isDeleting: () => deleting },
    );
    const result = await repo.accept(
      user,
      {
        operationId,
        proposal: p,
        localTime: "09:15",
        timeZone: "UTC",
        weekdays: [1],
      },
      options,
    );
    expect(result.startLocalDate).toBe("2026-10-19");
    deleting = true;
    await expect(
      repo.setPreferences(user, { enabled: false }, options),
    ).rejects.toMatchObject({ kind: "invalid" });
    await expect(
      repo.decide(user, { proposal: p, decision: "shown" }, options),
    ).rejects.toMatchObject({ kind: "invalid" });
  });
});
