import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { StoredFoodEntry, UserId } from "@mizyun/core";
import { InMemoryFoodEntryRepository } from "./food-entry-repository.js";
import { InMemoryRecurringMealRepository } from "./recurring-meal-repository.js";

const user = "00000000-0000-4000-8000-000000000001" as UserId;
const other = "00000000-0000-4000-8000-000000000002" as UserId;
const sourceEntryId = "00000000-0000-4000-8000-000000000003";
const id = "00000000-0000-4000-8000-000000000004";
const options = { accessToken: "verified-token" };
const input = {
  id,
  sourceEntryId,
  localTime: "10:00",
  timeZone: "Europe/Bratislava",
  weekdays: [0, 1, 2, 3, 4, 5, 6],
};
const build = () => {
  const food = new InMemoryFoodEntryRepository();
  const source: StoredFoodEntry = {
    id: sourceEntryId,
    userId: user,
    name: "Breakfast",
    consumedAt: new Date(),
    caloriesKcal: null,
    proteinG: null,
    carbohydrateG: null,
    fatG: null,
    source: "manual",
    confidence: null,
    confirmedByUser: true,
    details: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  food.__seedForTest(source);
  return { food, repo: new InMemoryRecurringMealRepository(food), source };
};
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-03T08:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});
describe("in-memory recurring meal repository", () => {
  it("deduplicates simultaneous lost-response retries and conflicts mismatched requests", async () => {
    const { repo } = build();
    const [a, b] = await Promise.all([
      repo.create(user, input, options),
      repo.create(user, input, options),
    ]);
    expect(a).toEqual(b);
    expect(await repo.list(user, options)).toHaveLength(1);
    await expect(
      repo.create(user, { ...input, localTime: "11:00" }, options),
    ).rejects.toMatchObject({ kind: "conflict" });
  });
  it("does not resurrect a stopped schedule if replacement source loading races stop", async () => {
    const { repo, food, source } = build();
    await repo.create(user, input, options);
    let release: (entry: StoredFoodEntry) => void = () => {};
    vi.spyOn(food, "getById").mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const changing = repo.update(user, id, { sourceEntryId }, options);
    await repo.stop(user, id, options);
    release(source);
    expect(await changing).toBeNull();
    expect(await repo.list(user, options)).toEqual([]);
    await expect(repo.create(user, input, options)).rejects.toMatchObject({
      kind: "conflict",
    });
  });
  it("counts paused schedules towards the twenty schedule bound and releases stopped slots", async () => {
    const { repo } = build();
    for (let count = 0; count < 20; count++)
      await repo.create(
        user,
        {
          ...input,
          id: `00000000-0000-4000-8000-${String(count).padStart(12, "0")}`,
        },
        options,
      );
    await repo.update(
      user,
      "00000000-0000-4000-8000-000000000000",
      { enabled: false },
      options,
    );
    await expect(
      repo.create(
        user,
        { ...input, id: "00000000-0000-4000-8000-000000000099" },
        options,
      ),
    ).rejects.toMatchObject({ kind: "invalid" });
    await repo.stop(user, "00000000-0000-4000-8000-000000000000", options);
    expect(
      (
        await repo.create(
          user,
          { ...input, id: "00000000-0000-4000-8000-000000000099" },
          options,
        )
      ).enabled,
    ).toBe(true);
  });
  it("allows skip only on today's date in the pinned schedule zone", async () => {
    const { repo } = build();
    await repo.create(user, input, options);
    await expect(
      repo.skip(user, id, "2026-10-04", options),
    ).rejects.toMatchObject({ kind: "invalid" });
    await expect(
      repo.skip(user, id, "2026-10-02", options),
    ).rejects.toMatchObject({ kind: "invalid" });
    expect(await repo.skip(user, id, "2026-10-03", options)).toBe(true);
    expect(await repo.skip(user, id, "2026-10-03", options)).toBe(true);
  });
  it("exports stopped schedules and skip records only to the owner", async () => {
    const { repo } = build();
    await repo.create(user, input, options);
    await repo.skip(user, id, "2026-10-03", options);
    await repo.stop(user, id, options);
    const exported = await repo.exportForUser(user, options);
    expect(exported.schedules).toHaveLength(1);
    expect(exported.schedules[0]).toMatchObject({
      userId: user,
      id,
      stopped: true,
      enabled: false,
    });
    expect(exported.occurrences).toEqual([
      { recurringMealId: id, localDate: "2026-10-03", status: "skipped" },
    ]);
    expect(await repo.exportForUser(other, options)).toEqual({
      schedules: [],
      occurrences: [],
    });
  });
  it("returns detached values so caller edits cannot change stored authority", async () => {
    const { repo } = build();
    const row = await repo.create(user, input, options);
    (row.weekdays as number[]).splice(0);
    row.createdAt.setFullYear(2000);
    const [stored] = await repo.list(user, options);
    expect(stored!.weekdays).toEqual(input.weekdays);
    expect(stored!.createdAt.getUTCFullYear()).toBe(2026);
  });
  it("clears all owned schedule and skip data for account deletion without affecting another user", async () => {
    const { repo, food, source } = build();
    await repo.create(user, input, options);
    await repo.skip(user, id, "2026-10-03", options);
    await repo.stop(user, id, options);
    food.__seedForTest({ ...source, userId: other, id: other });
    await repo.create(
      other,
      { ...input, id: other, sourceEntryId: other },
      options,
    );
    await repo.clearForUser(user, options);
    expect(await repo.exportForUser(user, options)).toEqual({
      schedules: [],
      occurrences: [],
    });
    expect(await repo.list(user, options)).toEqual([]);
    expect(await repo.list(other, options)).toHaveLength(1);
  });
});
