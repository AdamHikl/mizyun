import { describe, expect, it } from "vitest";
import type { FoodEntry } from "@mizyun/contracts";

import {
  extractGramsFromName,
  getEntryGrams,
  getEntryMealGroup,
  scaleNutrition,
  scaledAdvancedPatchForExisting,
  scaleNutritionFromKnownPortion,
  updateGramsInName,
  withMealGrams,
  withMealGroup,
} from "./meal-scale";

const FAKE_ENTRY: FoodEntry = {
  id: "00000000-0000-0000-0000-000000000001",
  userId: "00000000-0000-0000-0000-000000000002",
  name: "Chicken breast 200g",
  consumedAt: "2026-09-17T08:00:00.000Z",
  caloriesKcal: 330,
  proteinG: 62,
  carbohydrateG: 0,
  fatG: 7,
  source: "manual",
  confidence: null,
  confirmedByUser: true,
  details: {},
  createdAt: "2026-09-17T08:00:00.000Z",
  updatedAt: "2026-09-17T08:00:00.000Z",
};

describe("extractGramsFromName", () => {
  it("extracts grams from various name formats", () => {
    expect(extractGramsFromName("Chicken breast 200g")).toBe(200);
    expect(extractGramsFromName("Chicken breast 200 g")).toBe(200);
    expect(extractGramsFromName("Chicken breast 200 grams")).toBe(200);
    expect(extractGramsFromName("Chicken breast 200gr")).toBe(200);
    expect(extractGramsFromName("Oatmeal (80g)")).toBe(80);
    expect(extractGramsFromName("150.5g Rice")).toBe(150.5);
  });

  it("returns null when no weight in grams is found", () => {
    expect(extractGramsFromName("Apple")).toBeNull();
    expect(extractGramsFromName("Scrambled eggs with toast")).toBeNull();
    expect(extractGramsFromName("200ml milk")).toBeNull();
  });
});

describe("updateGramsInName", () => {
  it("replaces grams in the name correctly", () => {
    expect(updateGramsInName("Chicken breast 200g", 250)).toBe(
      "Chicken breast 250g",
    );
    expect(updateGramsInName("Oatmeal (80g)", 100)).toBe("Oatmeal (100g)");
    expect(updateGramsInName("150g Rice", 75)).toBe("75g Rice");
  });

  it("leaves names without grams untouched", () => {
    expect(updateGramsInName("Apple", 150)).toBe("Apple");
    expect(updateGramsInName("Scrambled eggs", 200)).toBe("Scrambled eggs");
  });
});

describe("scaleNutrition", () => {
  it("keeps existing advanced nutrients proportional on a downgraded portion edit", () => {
    const entry = {
      ...FAKE_ENTRY,
      fibreG: 3,
      saturatedFatG: null,
      totalSugarsG: 0,
      sodiumMg: 125,
      cholesterolMg: null,
    };
    const scaled = scaleNutrition({ ...entry, grams: 100 }, 200);
    expect(scaledAdvancedPatchForExisting(entry, scaled)).toEqual({
      fibreG: 6,
      totalSugarsG: 0,
      sodiumMg: 250,
    });
  });
  it("scales optional nutrients while preserving missing values", () => {
    const scaled = scaleNutrition(
      {
        caloriesKcal: 100,
        proteinG: null,
        carbohydrateG: null,
        fatG: null,
        fibreG: 3,
        saturatedFatG: null,
        totalSugarsG: 0,
        sodiumMg: 125,
        cholesterolMg: 20,
        grams: 100,
      },
      200,
    );
    expect(scaled).toMatchObject({
      fibreG: 6,
      saturatedFatG: null,
      totalSugarsG: 0,
      sodiumMg: 250,
      cholesterolMg: 40,
    });
  });
  it("scales calories and macros proportionally", () => {
    const base = {
      caloriesKcal: 330,
      proteinG: 62,
      carbohydrateG: 0,
      fatG: 7,
      grams: 200,
    };

    // Halve to 100g
    const halved = scaleNutrition(base, 100);
    expect(halved.ratio).toBe(0.5);
    expect(halved.caloriesKcal).toBe(165);
    expect(halved.proteinG).toBe(31);
    expect(halved.carbohydrateG).toBe(0);
    expect(halved.fatG).toBe(3.5);

    // Increase to 250g (1.25x)
    const scaled = scaleNutrition(base, 250);
    expect(scaled.ratio).toBe(1.25);
    expect(scaled.caloriesKcal).toBe(413); // 330 * 1.25 = 412.5 -> 413
    expect(scaled.proteinG).toBe(77.5); // 62 * 1.25 = 77.5
    expect(scaled.carbohydrateG).toBe(0);
    expect(scaled.fatG).toBe(8.8); // 7 * 1.25 = 8.75 -> 8.8
  });

  it("handles null macros gracefully", () => {
    const base = {
      caloriesKcal: 200,
      proteinG: null,
      carbohydrateG: null,
      fatG: null,
      grams: 100,
    };
    const doubled = scaleNutrition(base, 200);
    expect(doubled.caloriesKcal).toBe(400);
    expect(doubled.proteinG).toBeNull();
    expect(doubled.carbohydrateG).toBeNull();
    expect(doubled.fatG).toBeNull();
  });

  it("returns original values if base or target grams are invalid", () => {
    const base = {
      caloriesKcal: 200,
      proteinG: 20,
      carbohydrateG: 10,
      fatG: 5,
      grams: 0,
    };
    const res = scaleNutrition(base, 100);
    expect(res.caloriesKcal).toBe(200);
    expect(res.ratio).toBe(1);
  });
});

describe("scaleNutritionFromKnownPortion", () => {
  it("records a first real weight without treating totals as per 100g", () => {
    const result = scaleNutritionFromKnownPortion(
      {
        caloriesKcal: 420,
        proteinG: 38,
        carbohydrateG: 45,
        fatG: 9,
        grams: null,
      },
      320,
    );

    expect(result).toEqual({
      caloriesKcal: 420,
      proteinG: 38,
      carbohydrateG: 45,
      fatG: 9,
      ratio: 1,
    });
  });
});

describe("getEntryGrams", () => {
  it("prefers details.grams if present", () => {
    const entry: FoodEntry = {
      ...FAKE_ENTRY,
      name: "Chicken breast 200g",
      details: { grams: 250 },
    };
    expect(getEntryGrams(entry)).toBe(250);
  });

  it("falls back to parsing name if details.grams is missing", () => {
    expect(getEntryGrams(FAKE_ENTRY)).toBe(200);
  });

  it("returns null if neither is present", () => {
    const entry: FoodEntry = {
      ...FAKE_ENTRY,
      name: "Banana",
      details: {},
    };
    expect(getEntryGrams(entry)).toBeNull();
  });
});

describe("meal group metadata helpers", () => {
  it("reads and writes meal group to details", () => {
    expect(getEntryMealGroup(FAKE_ENTRY)).toBeNull();

    const withGroup = withMealGroup(FAKE_ENTRY.details, {
      id: "group-123",
      name: "Breakfast",
    });
    const entryWithGroup: FoodEntry = {
      ...FAKE_ENTRY,
      details: withGroup,
    };

    expect(getEntryMealGroup(entryWithGroup)).toEqual({
      id: "group-123",
      name: "Breakfast",
    });

    const removedGroup = withMealGroup(entryWithGroup.details, null);
    expect(
      getEntryMealGroup({ ...FAKE_ENTRY, details: removedGroup }),
    ).toBeNull();
  });

  it("reads and writes grams to details", () => {
    const withGrams = withMealGrams(FAKE_ENTRY.details, 185);
    expect(withGrams.grams).toBe(185);

    const cleared = withMealGrams(withGrams, null);
    expect(cleared.grams).toBeUndefined();
  });
});
