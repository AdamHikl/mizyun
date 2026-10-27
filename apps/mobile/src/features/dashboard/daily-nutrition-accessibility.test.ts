import { describe, expect, it } from "vitest";
import { dailyNutritionAccessibilityLabel } from "./daily-nutrition-accessibility";
import {
  computeDailyNutritionDisplay,
  type DailySummary,
  type EnergySummary,
} from "./dashboard-data";

const summary = {
  date: "2026-10-04",
  entryCount: 3,
  caloriesKcal: 1243,
  proteinG: 92,
  carbohydrateG: 138,
  fatG: 36,
} as DailySummary;
const energy = {
  dailyTargetKcal: 3226,
  bmrKcal: 1800,
  tdeeKcal: 3226,
  complete: true,
  targetProteinG: 123,
  targetCarbohydrateG: 481,
  targetFatG: 90,
} as EnergySummary;

const label = (
  overrides: Partial<Parameters<typeof computeDailyNutritionDisplay>[0]>,
  ideas: readonly string[] = [],
) =>
  dailyNutritionAccessibilityLabel(
    computeDailyNutritionDisplay({
      summary,
      energy,
      caloriesToday: 1243,
      loading: false,
      hasError: false,
      ...overrides,
    }),
    ideas,
  );

describe("dailyNutritionAccessibilityLabel", () => {
  it("speaks eaten, target, remaining and each macro with grouped numbers", () => {
    expect(label({})).toBe(
      "Calories today: 1,243 of 3,226 kcal, 1,983 left. Protein 92 of 123 grams, carbs 138 of 481, fat 36 of 90.",
    );
  });

  it("says how far over target the day is", () => {
    expect(label({ caloriesToday: 3500 })).toBe(
      "Calories today: 3,500 of 3,226 kcal, 274 over. Protein 92 of 123 grams, carbs 138 of 481, fat 36 of 90.",
    );
  });

  it("states a missing calorie and macro target instead of inventing one", () => {
    expect(
      label({
        energy: {
          ...energy,
          dailyTargetKcal: 0,
          targetProteinG: 0,
          targetCarbohydrateG: 0,
          targetFatG: 0,
        },
      }),
    ).toBe(
      "Calories today: 1,243 kcal, no calorie target set. Protein 92 grams, carbs 138, fat 36.",
    );
  });

  it("withholds remaining calories and flags unknown calories as unconfirmed", () => {
    expect(label({ caloriesToday: null })).toBe(
      "Calories today unknown of 3,226 kcal. Protein 92 of 123 grams, carbs 138 of 481, fat 36 of 90. Some meals have unconfirmed nutrition.",
    );
  });

  it("withholds remaining calories and names unknown macros when macros are unconfirmed", () => {
    expect(label({ summary: { ...summary, carbohydrateG: null } })).toBe(
      "Calories today: 1,243 of 3,226 kcal. Protein 92 of 123 grams, carbs unknown of 481, fat 36 of 90. Some meals have unconfirmed nutrition.",
    );
  });

  it("speaks a day with no meals as zero eaten with the full allowance left", () => {
    expect(
      label({ summary: { ...summary, entryCount: 0 }, caloriesToday: 0 }),
    ).toBe(
      "Calories today: 0 of 3,226 kcal, 3,226 left. Protein 0 of 123 grams, carbs 0 of 481, fat 0 of 90.",
    );
  });

  it("never reports zero totals while loading or after a failed read", () => {
    expect(label({ summary: null, caloriesToday: null, loading: true })).toBe(
      "Calories today loading, target 3,226 kcal.",
    );
    expect(label({ summary: null, caloriesToday: null, hasError: true })).toBe(
      "Calories today unavailable.",
    );
  });

  it("includes visible protein ideas", () => {
    expect(label({}, ["Tofu or tempeh", "Edamame"])).toContain(
      "Protein ideas for later today: Tofu or tempeh, Edamame.",
    );
  });
});
