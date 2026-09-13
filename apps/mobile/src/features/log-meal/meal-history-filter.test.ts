import { describe, expect, it } from "vitest";

import type { FoodEntry } from "@mizyun/contracts";

import { filterFoodDayGroups } from "./meal-history-filter";
import type { FoodDayGroup } from "./meal-lifecycle-data";

const ENTRY: FoodEntry = {
  id: "00000000-0000-4000-8000-000000000001",
  userId: "00000000-0000-4000-8000-000000000002",
  name: "Toast",
  consumedAt: "2026-07-19T08:00:00.000Z",
  caloriesKcal: 200,
  proteinG: 5,
  carbohydrateG: 30,
  fatG: 4,
  source: "manual",
  confidence: null,
  confirmedByUser: true,
  details: {},
  createdAt: "2026-07-19T08:00:00.000Z",
  updatedAt: "2026-07-19T08:00:00.000Z",
};

const group = (
  date: string,
  entries: ReadonlyArray<FoodEntry>,
): FoodDayGroup => ({
  date,
  displayDate: date,
  summary: {
    entryCount: entries.length,
    caloriesKcal: 9999,
    proteinG: 9999,
    carbohydrateG: 9999,
    fatG: 9999,
  },
  entries,
});

describe("filterFoodDayGroups", () => {
  it("returns the original groups for a blank or whitespace-only query", () => {
    const groups = [group("2026-07-19", [ENTRY])];

    expect(filterFoodDayGroups(groups, "")).toBe(groups);
    expect(filterFoodDayGroups(groups, " \n\t ")).toBe(groups);
  });

  it("matches meal names case-insensitively and preserves group and entry order", () => {
    const firstMatch = {
      ...ENTRY,
      id: crypto.randomUUID(),
      name: "Protein Bowl",
    };
    const nonMatch = { ...ENTRY, id: crypto.randomUUID(), name: "Toast" };
    const secondMatch = {
      ...ENTRY,
      id: crypto.randomUUID(),
      name: "Chocolate protein shake",
    };
    const groups = [
      group("2026-07-19", [firstMatch, nonMatch]),
      group("2026-07-18", [secondMatch]),
    ];

    const result = filterFoodDayGroups(groups, "  PROTEIN ");

    expect(result.map((item) => item.date)).toEqual([
      "2026-07-19",
      "2026-07-18",
    ]);
    expect(result[0]?.entries).toEqual([firstMatch]);
    expect(result[1]?.entries).toEqual([secondMatch]);
  });

  it("matches nested string details while ignoring property names and numeric values", () => {
    const match = {
      ...ENTRY,
      id: crypto.randomUUID(),
      name: "Lunch",
      details: {
        notes: "Extra avocado",
        aiDraft: { assumptions: ["Served with rye bread"] },
      },
    };
    const nonMatch = {
      ...ENTRY,
      id: crypto.randomUUID(),
      name: "Dinner",
      details: { avocado: 2 },
    };
    const groups = [group("2026-07-19", [match, nonMatch])];

    expect(filterFoodDayGroups(groups, "AVOCADO")[0]?.entries).toEqual([match]);
    expect(filterFoodDayGroups(groups, "rye")[0]?.entries).toEqual([match]);
    expect(filterFoodDayGroups(groups, "2")).toEqual([]);
  });

  it("does not match hidden provenance or identifier metadata", () => {
    const entry = {
      ...ENTRY,
      details: {
        aiDraft: {
          assumptions: ["Served with rye bread"],
          provenance: {
            inputKind: "photo",
            provider: "gemini",
            model: "gemini-internal-model",
          },
          sourceProposalId: "private-proposal-reference",
        },
      },
    };
    const groups = [group("2026-07-19", [entry])];

    expect(filterFoodDayGroups(groups, "rye")).toHaveLength(1);
    expect(filterFoodDayGroups(groups, "gemini")).toEqual([]);
    expect(filterFoodDayGroups(groups, "photo")).toEqual([]);
    expect(filterFoodDayGroups(groups, "private-proposal")).toEqual([]);
  });

  it("omits empty days and recomputes summaries from matched entries only", () => {
    const match = {
      ...ENTRY,
      id: crypto.randomUUID(),
      name: "Apple",
      caloriesKcal: 95.4,
      proteinG: 0.26,
      carbohydrateG: 25.13,
      fatG: null,
    };
    const nonMatch = {
      ...ENTRY,
      id: crypto.randomUUID(),
      name: "Toast",
      caloriesKcal: 200,
      proteinG: 5,
      carbohydrateG: 30,
      fatG: 4,
    };
    const groups = [
      group("2026-07-19", [match, nonMatch]),
      group("2026-07-18", [nonMatch]),
    ];

    const result = filterFoodDayGroups(groups, "apple");

    expect(result).toHaveLength(1);
    expect(result[0]?.summary).toEqual({
      entryCount: 1,
      caloriesKcal: 95,
      proteinG: 0.3,
      carbohydrateG: 25.1,
      fatG: null,
    });
  });

  it("does not mutate input groups, entries, or summaries", () => {
    const match = { ...ENTRY, id: crypto.randomUUID(), name: "Toast" };
    const nonMatch = { ...ENTRY, id: crypto.randomUUID(), name: "Soup" };
    const sourceGroup = group("2026-07-19", [match, nonMatch]);
    const originalEntries = sourceGroup.entries;
    const originalSummary = sourceGroup.summary;

    const result = filterFoodDayGroups([sourceGroup], "toast");

    expect(sourceGroup.entries).toBe(originalEntries);
    expect(sourceGroup.entries).toEqual([match, nonMatch]);
    expect(sourceGroup.summary).toBe(originalSummary);
    expect(result[0]).not.toBe(sourceGroup);
    expect(result[0]?.entries).not.toBe(originalEntries);
  });
});
