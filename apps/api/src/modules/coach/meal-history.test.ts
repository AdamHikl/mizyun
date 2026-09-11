import { describe, expect, it } from "vitest";
import type { StoredFoodEntry, UserId } from "@mizyun/core";

import { InMemoryFoodEntryRepository } from "../../food-entry-repository.js";
import { buildGetMealHistoryTool } from "./meal-history.js";

const userId = "00000000-0000-4000-8000-000000000001" as UserId;
const otherUserId = "00000000-0000-4000-8000-000000000002" as UserId;
const FIXED_NOW = new Date("2026-09-10T12:00:00.000Z");
const clock = { now: () => FIXED_NOW };

const createEntry = (
  uid: UserId,
  entry: {
    id: string;
    name: string;
    consumedAt: Date;
    caloriesKcal?: number | null;
    proteinG?: number | null;
    carbohydrateG?: number | null;
    fatG?: number | null;
  },
): StoredFoodEntry => ({
  id: entry.id,
  userId: uid,
  name: entry.name,
  consumedAt: entry.consumedAt,
  caloriesKcal: entry.caloriesKcal ?? 500,
  proteinG: entry.proteinG ?? 30,
  carbohydrateG: entry.carbohydrateG ?? 40,
  fatG: entry.fatG ?? 15,
  details: {},
  source: "manual",
  confidence: null,
  confirmedByUser: true,
  createdAt: entry.consumedAt,
  updatedAt: entry.consumedAt,
});

describe("CoachTools — get_meal_history", () => {
  it("returns today's meals on default call with no args", async () => {
    const foodEntryRepository = new InMemoryFoodEntryRepository();
    const tool = buildGetMealHistoryTool({ foodEntryRepository, clock });

    await foodEntryRepository.create(
      userId,
      createEntry(userId, {
        id: "meal-today",
        name: "Greek Yogurt Bowl",
        consumedAt: new Date("2026-09-10T08:30:00.000Z"),
        caloriesKcal: 350,
        proteinG: 25,
        carbohydrateG: 40,
        fatG: 5,
      }),
      { accessToken: "token" },
    );

    await foodEntryRepository.create(
      userId,
      createEntry(userId, {
        id: "meal-2-days-ago",
        name: "Grilled Salmon",
        consumedAt: new Date("2026-09-08T12:00:00.000Z"),
        caloriesKcal: 600,
        proteinG: 45,
        carbohydrateG: 10,
        fatG: 28,
      }),
      { accessToken: "token" },
    );

    const evidence = await tool.execute({
      principalUserId: userId,
      args: {},
      accessToken: "token",
      clock,
    });

    expect(evidence.kind).toBe("nutrition");
    expect(evidence.label).toBe("Logged meal history");
    expect(evidence.confirmed).toBe(true);
    expect(evidence.freshness).toBe("2026-09-10T12:00:00.000Z");
    expect(evidence.data).toEqual({
      count: 1,
      meals: [
        {
          id: "meal-today",
          name: "Greek Yogurt Bowl",
          caloriesKcal: 350,
          proteinG: 25,
          carbohydrateG: 40,
          fatG: 5,
          consumedAt: "2026-09-10T08:30:00.000Z",
        },
      ],
    });
  });

  it("filters meals by specific date (YYYY-MM-DD)", async () => {
    const foodEntryRepository = new InMemoryFoodEntryRepository();
    const tool = buildGetMealHistoryTool({ foodEntryRepository, clock });

    await foodEntryRepository.create(
      userId,
      createEntry(userId, {
        id: "meal-target-date",
        name: "Protein Pancakes",
        consumedAt: new Date("2026-09-08T14:15:00.000Z"),
        caloriesKcal: 450,
        proteinG: 35,
        carbohydrateG: 55,
        fatG: 8,
      }),
      { accessToken: "token" },
    );

    await foodEntryRepository.create(
      userId,
      createEntry(userId, {
        id: "meal-today",
        name: "Greek Yogurt Bowl",
        consumedAt: new Date("2026-09-10T08:30:00.000Z"),
      }),
      { accessToken: "token" },
    );

    const evidence = await tool.execute({
      principalUserId: userId,
      args: { date: "2026-09-08" },
      accessToken: "token",
      clock,
    });

    expect(evidence.data).toMatchObject({
      count: 1,
      meals: [
        {
          id: "meal-target-date",
          name: "Protein Pancakes",
          consumedAt: "2026-09-08T14:15:00.000Z",
        },
      ],
    });
  });

  it("case-insensitively filters by food name query", async () => {
    const foodEntryRepository = new InMemoryFoodEntryRepository();
    const tool = buildGetMealHistoryTool({ foodEntryRepository, clock });

    await foodEntryRepository.create(
      userId,
      createEntry(userId, {
        id: "meal-eggs",
        name: "Scrambled Eggs on Toast",
        consumedAt: new Date("2026-09-10T08:00:00.000Z"),
      }),
      { accessToken: "token" },
    );

    await foodEntryRepository.create(
      userId,
      createEntry(userId, {
        id: "meal-shake",
        name: "Chocolate Protein Shake",
        consumedAt: new Date("2026-09-10T10:00:00.000Z"),
      }),
      { accessToken: "token" },
    );

    await foodEntryRepository.create(
      userId,
      createEntry(userId, {
        id: "meal-salad",
        name: "Egg & Avocado Salad",
        consumedAt: new Date("2026-09-10T11:00:00.000Z"),
      }),
      { accessToken: "token" },
    );

    const eggResult = await tool.execute({
      principalUserId: userId,
      args: { search: "egg" },
      accessToken: "token",
      clock,
    });

    expect(eggResult.data.count).toBe(2);
    const names = (
      eggResult.data.meals as Array<{ readonly name: string }>
    ).map((m) => m.name);
    expect(names).toEqual(["Egg & Avocado Salad", "Scrambled Eggs on Toast"]);

    const shakeResult = await tool.execute({
      principalUserId: userId,
      args: { search: "SHAKE" },
      accessToken: "token",
      clock,
    });
    expect(shakeResult.data.count).toBe(1);
    expect(
      (shakeResult.data.meals as Array<{ readonly name: string }>)[0]?.name,
    ).toBe("Chocolate Protein Shake");
  });

  it("enforces tenant isolation and never returns entries from other users", async () => {
    const foodEntryRepository = new InMemoryFoodEntryRepository();
    const tool = buildGetMealHistoryTool({ foodEntryRepository, clock });

    await foodEntryRepository.create(
      userId,
      createEntry(userId, {
        id: "user-1-meal",
        name: "User 1 Salad",
        consumedAt: new Date("2026-09-10T08:00:00.000Z"),
      }),
      { accessToken: "token" },
    );

    await foodEntryRepository.create(
      otherUserId,
      createEntry(otherUserId, {
        id: "user-2-meal",
        name: "User 2 Ribeye",
        consumedAt: new Date("2026-09-10T08:30:00.000Z"),
      }),
      { accessToken: "token" },
    );

    const evidence = await tool.execute({
      principalUserId: userId,
      args: {},
      accessToken: "token",
      clock,
    });

    expect(evidence.data.count).toBe(1);
    const meals = evidence.data.meals as Array<{
      readonly id: string;
      readonly name: string;
    }>;
    expect(meals).toHaveLength(1);
    expect(meals[0]?.id).toBe("user-1-meal");
    expect(meals[0]?.name).toBe("User 1 Salad");
  });

  it("limits results to specified limit with proper clamping", async () => {
    const foodEntryRepository = new InMemoryFoodEntryRepository();
    const tool = buildGetMealHistoryTool({ foodEntryRepository, clock });

    for (let i = 1; i <= 5; i++) {
      await foodEntryRepository.create(
        userId,
        createEntry(userId, {
          id: `meal-${i}`,
          name: `Meal ${i}`,
          consumedAt: new Date(`2026-09-10T0${i}:00:00.000Z`),
        }),
        { accessToken: "token" },
      );
    }

    const limitedResult = await tool.execute({
      principalUserId: userId,
      args: { limit: 2 },
      accessToken: "token",
      clock,
    });

    expect(limitedResult.data.count).toBe(2);
    expect(limitedResult.data.meals).toHaveLength(2);

    const clampedUnderflow = await tool.execute({
      principalUserId: userId,
      args: { limit: 0 },
      accessToken: "token",
      clock,
    });
    expect(clampedUnderflow.data.count).toBe(1);
    expect(clampedUnderflow.data.meals).toHaveLength(1);
  });

  it("handles undefined args safely without throwing", async () => {
    const foodEntryRepository = new InMemoryFoodEntryRepository();
    const tool = buildGetMealHistoryTool({ foodEntryRepository, clock });

    const result = await tool.execute({
      principalUserId: userId,
      args: undefined as unknown as Record<string, never>,
      accessToken: "token",
      clock,
    });

    expect(result.kind).toBe("nutrition");
    expect(result.data.count).toBe(0);
    expect(result.data.meals).toEqual([]);
  });
});
