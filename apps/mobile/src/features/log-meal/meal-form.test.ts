import { describe, expect, it } from "vitest";

import {
  isRecoverableMealDraft,
  mealFormStringsFromDraft,
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

describe("recoverable AI meal drafts", () => {
  const candidate = {
    name: "Tuna",
    caloriesKcal: 290,
    proteinG: 63,
    carbohydrateG: 0,
    fatG: 2,
    calorieRangeKcal: { low: 250, high: 340 },
    proteinRangeG: { low: 55, high: 70 },
    carbohydrateRangeG: { low: 0, high: 2 },
    fatRangeG: { low: 1, high: 5 },
    confidence: 0.8,
    warnings: ["Confirm drained weight."],
    assumptions: ["Assumes tuna in water."],
    provenance: {
      inputKind: "text" as const,
      provider: "mistral",
      model: "mistral-medium-latest",
      promptVersion: "nutrition-draft-v2",
    },
  };

  it("keeps the proposal and provenance alongside editable form strings", () => {
    const draft = {
      ...mealFormStringsFromDraft(candidate),
      aiDraft: candidate,
      sourceProposalId: "00000000-0000-4000-8000-000000000123",
    };
    expect(isRecoverableMealDraft(draft)).toBe(true);
    expect(draft).toMatchObject({
      name: "Tuna",
      calories: "290",
      protein: "63",
      sourceProposalId: "00000000-0000-4000-8000-000000000123",
      aiDraft: { provenance: { inputKind: "text" } },
    });
  });

  it("rejects malformed AI candidates", () => {
    expect(
      isRecoverableMealDraft({
        name: "Tuna",
        calories: "290",
        protein: "63",
        carbs: "0",
        fat: "2",
        aiDraft: { confidence: 4 },
      }),
    ).toBe(false);
  });
});
