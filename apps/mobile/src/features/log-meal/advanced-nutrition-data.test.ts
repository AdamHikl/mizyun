import { describe, expect, it } from "vitest";
import type { DailyFoodSummary } from "@mizyun/contracts";
import { weeklyAdvancedNutrientLines } from "./advanced-nutrition-data";

const day = (
  entryCount: number,
  known: number,
  subtotal: number,
): DailyFoodSummary => ({
  date: "2026-09-29",
  entryCount,
  caloriesKcal: null,
  proteinG: null,
  carbohydrateG: null,
  fatG: null,
  advancedCoverage: {
    fibreG: known,
    saturatedFatG: 0,
    totalSugarsG: 0,
    sodiumMg: 0,
    cholesterolMg: 0,
  },
  advancedKnownSubtotal: {
    fibreG: subtotal,
    saturatedFatG: 0,
    totalSugarsG: 0,
    sodiumMg: 0,
    cholesterolMg: 0,
  },
});

describe("weekly advanced nutrient display", () => {
  it("marks missing logged-meal values incomplete and keeps the known subtotal", () => {
    expect(
      weeklyAdvancedNutrientLines([day(2, 1, 4), day(1, 1, 0)], ["fibreG"]),
    ).toEqual(["Fibre: incomplete · known subtotal 4 g (2/3 logged meals)"]);
  });

  it("shows a complete explicit zero and respects hidden metrics", () => {
    expect(weeklyAdvancedNutrientLines([day(1, 1, 0)], ["fibreG"])).toEqual([
      "Fibre: 0 g across 1 logged meal",
    ]);
    expect(weeklyAdvancedNutrientLines([day(1, 1, 0)], [])).toEqual([]);
  });
});
