import { describe, expect, it } from "vitest";

import {
  mealFormStringsFromEntry,
  parseOptionalNutritionNumber,
} from "./meal-form";

describe("parseOptionalNutritionNumber", () => {
  it("distinguishes blank optional values from invalid input", () => {
    expect(parseOptionalNutritionNumber("  ")).toEqual({
      ok: true,
      value: null,
    });
    expect(parseOptionalNutritionNumber("12.5")).toEqual({
      ok: true,
      value: 12.5,
    });
    expect(parseOptionalNutritionNumber("abc")).toEqual({ ok: false });
    expect(parseOptionalNutritionNumber("-1")).toEqual({ ok: false });
  });
});

describe("mealFormStringsFromEntry", () => {
  it("preserves numbers and renders nullable fields as blank", () => {
    expect(
      mealFormStringsFromEntry({
        id: "00000000-0000-4000-8000-000000000001",
        userId: "00000000-0000-4000-8000-000000000002",
        name: "Toast",
        consumedAt: "2026-07-19T10:00:00.000Z",
        caloriesKcal: 200,
        proteinG: null,
        carbohydrateG: 30,
        fatG: 4,
        source: "manual",
        confidence: null,
        confirmedByUser: true,
        details: {},
        createdAt: "2026-07-19T10:00:00.000Z",
        updatedAt: "2026-07-19T10:00:00.000Z",
      }),
    ).toEqual({
      name: "Toast",
      calories: "200",
      protein: "",
      carbs: "30",
      fat: "4",
    });
  });
});
