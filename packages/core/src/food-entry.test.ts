import { describe, expect, it } from "vitest";

import type { UserId } from "./index.js";
import {
  applyFoodEntryPatch,
  CALORIES_MAX,
  CALORIES_MIN,
  FOOD_NAME_MAX,
  MACRO_MAX,
  MACRO_MIN,
  summariseFoodEntries,
  type FoodEntryPatch,
  type StoredFoodEntry,
  validateFoodEntryCreate,
  validateFoodEntryPatch,
} from "./food-entry.js";

const userId = "00000000-0000-4000-8000-000000000001" as UserId;

const baseStored = (
  overrides: Partial<StoredFoodEntry> = {},
): StoredFoodEntry => ({
  id: "00000000-0000-4000-8000-00000000a001",
  userId,
  name: "Plain toast",
  consumedAt: new Date("2026-07-10T08:00:00Z"),
  caloriesKcal: 200,
  proteinG: 5,
  carbohydrateG: 30,
  fatG: 4,
  source: "manual",
  confidence: null,
  confirmedByUser: true,
  details: {},
  createdAt: new Date("2026-07-10T08:00:00Z"),
  updatedAt: new Date("2026-07-10T08:00:00Z"),
  ...overrides,
});

describe("validateFoodEntryCreate", () => {
  it("accepts a minimal manual entry with only name and consumedAt", () => {
    expect(
      validateFoodEntryCreate({
        name: "Apple",
        consumedAt: new Date("2026-07-10T08:00:00Z"),
      }),
    ).toBeNull();
  });

  it("accepts a fully populated manual entry", () => {
    expect(
      validateFoodEntryCreate({
        name: "Greek yogurt",
        consumedAt: new Date("2026-07-10T08:00:00Z"),
        caloriesKcal: 150,
        proteinG: 17,
        carbohydrateG: 9,
        fatG: 5,
        details: { brand: "Fage" },
      }),
    ).toBeNull();
  });

  it("rejects a blank name", () => {
    expect(
      validateFoodEntryCreate({
        name: "   ",
        consumedAt: new Date("2026-07-10T08:00:00Z"),
      }),
    ).toEqual({ kind: "name_empty" });
  });

  it("rejects a name longer than the bound", () => {
    expect(
      validateFoodEntryCreate({
        name: "x".repeat(FOOD_NAME_MAX + 1),
        consumedAt: new Date("2026-07-10T08:00:00Z"),
      }),
    ).toEqual({ kind: "name_too_long", max: FOOD_NAME_MAX });
  });

  it("rejects a calories value below the range", () => {
    expect(
      validateFoodEntryCreate({
        name: "Apple",
        consumedAt: new Date("2026-07-10T08:00:00Z"),
        caloriesKcal: CALORIES_MIN - 1,
      }),
    ).toEqual({
      kind: "calories_out_of_range",
      min: CALORIES_MIN,
      max: CALORIES_MAX,
    });
  });

  it("rejects a calories value above the range", () => {
    expect(
      validateFoodEntryCreate({
        name: "Apple",
        consumedAt: new Date("2026-07-10T08:00:00Z"),
        caloriesKcal: CALORIES_MAX + 1,
      }),
    ).toEqual({
      kind: "calories_out_of_range",
      min: CALORIES_MIN,
      max: CALORIES_MAX,
    });
  });

  it("rejects a negative protein value", () => {
    expect(
      validateFoodEntryCreate({
        name: "Apple",
        consumedAt: new Date("2026-07-10T08:00:00Z"),
        proteinG: -1,
      }),
    ).toEqual({
      kind: "macro_out_of_range",
      field: "proteinG",
      min: MACRO_MIN,
      max: MACRO_MAX,
    });
  });

  it("rejects a macro value above the range", () => {
    expect(
      validateFoodEntryCreate({
        name: "Apple",
        consumedAt: new Date("2026-07-10T08:00:00Z"),
        fatG: MACRO_MAX + 1,
      }),
    ).toEqual({
      kind: "macro_out_of_range",
      field: "fatG",
      min: MACRO_MIN,
      max: MACRO_MAX,
    });
  });

  it("accepts null macro and calories", () => {
    expect(
      validateFoodEntryCreate({
        name: "Apple",
        consumedAt: new Date("2026-07-10T08:00:00Z"),
        caloriesKcal: null,
        proteinG: null,
        carbohydrateG: null,
        fatG: null,
      }),
    ).toBeNull();
  });

  it("rejects a non-object details value", () => {
    expect(
      validateFoodEntryCreate({
        name: "Apple",
        consumedAt: new Date("2026-07-10T08:00:00Z"),
        // Cast because the wire type accepts only an object at the
        // boundary; the validator is responsible for rejecting
        // malformed inputs.
        details: null as unknown as Record<string, unknown>,
      }),
    ).toEqual({ kind: "details_must_be_object" });
  });
});

describe("validateFoodEntryPatch", () => {
  it("rejects an empty patch", () => {
    expect(validateFoodEntryPatch({})).toEqual({ kind: "empty_patch" });
  });

  it("accepts a single-field patch", () => {
    expect(validateFoodEntryPatch({ caloriesKcal: 100 })).toBeNull();
  });

  it("accepts a name-only patch", () => {
    expect(validateFoodEntryPatch({ name: "Toast" })).toBeNull();
  });

  it("accepts clearing a nullable field to null", () => {
    expect(validateFoodEntryPatch({ caloriesKcal: null })).toBeNull();
    expect(validateFoodEntryPatch({ proteinG: null })).toBeNull();
    expect(validateFoodEntryPatch({ fatG: null })).toBeNull();
  });

  it("rejects a blank name in the patch", () => {
    expect(validateFoodEntryPatch({ name: "   " })).toEqual({
      kind: "name_empty",
    });
  });

  it("rejects an out-of-range macro in the patch", () => {
    expect(validateFoodEntryPatch({ fatG: MACRO_MAX + 1 })).toEqual({
      kind: "macro_out_of_range",
      field: "fatG",
      min: MACRO_MIN,
      max: MACRO_MAX,
    });
  });

  it("accepts a `details` object replacement", () => {
    expect(
      validateFoodEntryPatch({ details: { source: "recipe", page: 2 } }),
    ).toBeNull();
  });

  it("rejects `details` that is an array", () => {
    expect(
      validateFoodEntryPatch({
        details: [] as unknown as Record<string, unknown>,
      }),
    ).toEqual({ kind: "details_must_be_object" });
  });
});

describe("applyFoodEntryPatch", () => {
  it("returns the stored entry unchanged when the patch is empty (caller's responsibility)", () => {
    // The route layer must reject an empty patch before this is
    // called. The function still returns a structurally-correct
    // shape so a future test can rely on the contract.
    const stored = baseStored();
    const now = new Date("2026-08-01T00:00:00Z");
    const next = applyFoodEntryPatch(stored, {}, now);
    expect(next).toEqual({ ...stored, updatedAt: now });
  });

  it("updates the name when the patch sets it", () => {
    const stored = baseStored();
    const now = new Date("2026-08-01T00:00:00Z");
    const next = applyFoodEntryPatch(stored, { name: "Toast" }, now);
    expect(next.name).toBe("Toast");
    expect(next.consumedAt).toBe(stored.consumedAt);
    expect(next.caloriesKcal).toBe(stored.caloriesKcal);
    expect(next.createdAt).toBe(stored.createdAt);
    expect(next.updatedAt).toBe(now);
  });

  it("clears nullable macros when the patch sets them to null", () => {
    const stored = baseStored();
    const now = new Date("2026-08-01T00:00:00Z");
    const next = applyFoodEntryPatch(
      stored,
      { proteinG: null, fatG: null },
      now,
    );
    expect(next.proteinG).toBeNull();
    expect(next.fatG).toBeNull();
    expect(next.caloriesKcal).toBe(stored.caloriesKcal);
    expect(next.carbohydrateG).toBe(stored.carbohydrateG);
  });

  it("advances updatedAt", () => {
    const stored = baseStored();
    const now = new Date("2026-09-01T00:00:00Z");
    const next = applyFoodEntryPatch(stored, { caloriesKcal: 50 }, now);
    expect(next.updatedAt).toBe(now);
  });

  it("replaces the details object wholesale", () => {
    const stored = baseStored({ details: { brand: "Old" } });
    const now = new Date("2026-08-01T00:00:00Z");
    const next = applyFoodEntryPatch(
      stored,
      { details: { brand: "New", origin: "store" } },
      now,
    );
    expect(next.details).toEqual({ brand: "New", origin: "store" });
  });

  it("does not mutate the stored entry", () => {
    const stored = baseStored();
    const snapshot = JSON.parse(JSON.stringify(stored));
    applyFoodEntryPatch(stored, { name: "Toast" }, new Date());
    expect(JSON.parse(JSON.stringify(stored))).toEqual(snapshot);
  });

  it("preserves the immutable id, userId, source, confidence, and confirmedByUser", () => {
    const stored = baseStored({
      source: "manual",
      confidence: null,
      confirmedByUser: true,
    });
    const next = applyFoodEntryPatch(stored, { name: "Toast" }, new Date());
    expect(next.id).toBe(stored.id);
    expect(next.userId).toBe(stored.userId);
    expect(next.source).toBe("manual");
    expect(next.confidence).toBeNull();
    expect(next.confirmedByUser).toBe(true);
  });

  it("type-checks: the patch shape accepts a Date for consumedAt", () => {
    const stored = baseStored();
    const now = new Date("2026-08-01T00:00:00Z");
    const later = new Date("2026-08-01T12:00:00Z");
    const patch: FoodEntryPatch = { consumedAt: later };
    const next = applyFoodEntryPatch(stored, patch, now);
    expect(next.consumedAt).toBe(later);
  });
});

describe("summariseFoodEntries", () => {
  it("returns an empty list when no entries are in range", () => {
    expect(
      summariseFoodEntries([], { from: "2026-07-10", to: "2026-07-12" }),
    ).toEqual([]);
  });

  it("aggregates entries on the same UTC day into one summary", () => {
    const entries: StoredFoodEntry[] = [
      baseStored({
        id: "00000000-0000-4000-8000-00000000a001",
        consumedAt: new Date("2026-07-10T08:00:00Z"),
        caloriesKcal: 200,
        proteinG: 5,
      }),
      baseStored({
        id: "00000000-0000-4000-8000-00000000a002",
        consumedAt: new Date("2026-07-10T18:00:00Z"),
        caloriesKcal: 300,
        proteinG: 10,
      }),
    ];
    const summaries = summariseFoodEntries(entries, {
      from: "2026-07-10",
      to: "2026-07-10",
    });
    expect(summaries).toEqual([
      {
        date: "2026-07-10",
        entryCount: 2,
        caloriesKcal: 500,
        proteinG: 15,
        carbohydrateG: 60,
        fatG: 8,
      },
    ]);
  });

  it("rounds totals to two decimal places", () => {
    const entries: StoredFoodEntry[] = [
      baseStored({
        id: "00000000-0000-4000-8000-00000000a001",
        consumedAt: new Date("2026-07-10T08:00:00Z"),
        caloriesKcal: 100.555,
      }),
      baseStored({
        id: "00000000-0000-4000-8000-00000000a002",
        consumedAt: new Date("2026-07-10T12:00:00Z"),
        caloriesKcal: 50.444,
      }),
    ];
    const summaries = summariseFoodEntries(entries, {
      from: "2026-07-10",
      to: "2026-07-10",
    });
    // 100.555 + 50.444 = 150.999 → rounds to 151
    expect(summaries[0]?.caloriesKcal).toBe(151);
  });

  it("propagates `null` for any field with at least one null entry", () => {
    const entries: StoredFoodEntry[] = [
      baseStored({
        id: "00000000-0000-4000-8000-00000000a001",
        consumedAt: new Date("2026-07-10T08:00:00Z"),
        proteinG: 5,
      }),
      baseStored({
        id: "00000000-0000-4000-8000-00000000a002",
        consumedAt: new Date("2026-07-10T12:00:00Z"),
        proteinG: null,
      }),
    ];
    const summaries = summariseFoodEntries(entries, {
      from: "2026-07-10",
      to: "2026-07-10",
    });
    expect(summaries[0]?.proteinG).toBeNull();
    // Other fields still sum.
    expect(summaries[0]?.caloriesKcal).toBe(400);
  });

  it("groups multiple days in range oldest-first", () => {
    const entries: StoredFoodEntry[] = [
      baseStored({
        id: "00000000-0000-4000-8000-00000000a003",
        consumedAt: new Date("2026-07-12T08:00:00Z"),
        caloriesKcal: 100,
      }),
      baseStored({
        id: "00000000-0000-4000-8000-00000000a001",
        consumedAt: new Date("2026-07-10T08:00:00Z"),
        caloriesKcal: 200,
      }),
      baseStored({
        id: "00000000-0000-4000-8000-00000000a002",
        consumedAt: new Date("2026-07-11T08:00:00Z"),
        caloriesKcal: 300,
      }),
    ];
    const summaries = summariseFoodEntries(entries, {
      from: "2026-07-10",
      to: "2026-07-12",
    });
    expect(summaries.map((s) => s.date)).toEqual([
      "2026-07-10",
      "2026-07-11",
      "2026-07-12",
    ]);
    expect(summaries.map((s) => s.caloriesKcal)).toEqual([200, 300, 100]);
  });

  it("ignores entries outside the [from, to] range", () => {
    const entries: StoredFoodEntry[] = [
      baseStored({
        id: "00000000-0000-4000-8000-00000000a001",
        consumedAt: new Date("2026-07-09T08:00:00Z"),
        caloriesKcal: 999,
      }),
      baseStored({
        id: "00000000-4000-4000-8000-00000000a002",
        consumedAt: new Date("2026-07-15T08:00:00Z"),
        caloriesKcal: 999,
      }),
    ];
    const summaries = summariseFoodEntries(entries, {
      from: "2026-07-10",
      to: "2026-07-12",
    });
    expect(summaries).toEqual([]);
  });

  it("returns zero-entry summaries for days with only null fields", () => {
    const entries: StoredFoodEntry[] = [
      baseStored({
        id: "00000000-0000-4000-8000-00000000a001",
        consumedAt: new Date("2026-07-10T08:00:00Z"),
        caloriesKcal: null,
        proteinG: null,
        carbohydrateG: null,
        fatG: null,
      }),
    ];
    const summaries = summariseFoodEntries(entries, {
      from: "2026-07-10",
      to: "2026-07-10",
    });
    expect(summaries).toEqual([
      {
        date: "2026-07-10",
        entryCount: 1,
        caloriesKcal: null,
        proteinG: null,
        carbohydrateG: null,
        fatG: null,
      },
    ]);
  });
});
