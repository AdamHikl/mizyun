import { describe, expect, it } from "vitest";

import {
  isRecoverableMealDraft,
  isStaleMealTimestamp,
  mealFormStringsFromDraft,
  mealFormStringsFromEntry,
  parseOptionalNutritionNumber,
  upgradeLegacyMealDraft,
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

describe("mealFormStringsFromDraft", () => {
  it("populates point values directly when present", () => {
    expect(
      mealFormStringsFromDraft({
        name: "Chicken and rice",
        caloriesKcal: 420,
        proteinG: 38,
        carbohydrateG: 45,
        fatG: 9,
      }),
    ).toEqual({
      name: "Chicken and rice",
      calories: "420",
      protein: "38",
      carbs: "45",
      fat: "9",
    });
  });

  it("derives midpoint values from ranges when point values are null", () => {
    expect(
      mealFormStringsFromDraft({
        name: "Open-faced Sandwich",
        caloriesKcal: null,
        proteinG: null,
        carbohydrateG: null,
        fatG: null,
        calorieRangeKcal: { low: 420, high: 550 },
        proteinRangeG: { low: 18, high: 25 },
        carbohydrateRangeG: { low: 35, high: 45 },
        fatRangeG: { low: 10, high: 20 },
      }),
    ).toEqual({
      name: "Open-faced Sandwich",
      calories: "485",
      protein: "21.5",
      carbs: "40",
      fat: "15",
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
      provider: "gemini",
      model: "gemini-3.8-flash",
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

  it("accepts an AI draft candidate with full calculation text", () => {
    const candidateWithCalc = {
      ...candidate,
      calculation:
        "Tuna 160g: 208 kcal (46g P, 0g C, 1.5g F). Olive oil 10g: 88 kcal (10g F).",
    };
    const draft = {
      ...mealFormStringsFromDraft(candidateWithCalc),
      aiDraft: candidateWithCalc,
    };
    expect(isRecoverableMealDraft(draft)).toBe(true);
    expect(draft.aiDraft?.calculation).toBe(
      "Tuna 160g: 208 kcal (46g P, 0g C, 1.5g F). Olive oil 10g: 88 kcal (10g F).",
    );
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

  it("accepts an optional free-text description used as a photo textHint", () => {
    const draft = {
      ...mealFormStringsFromDraft(candidate),
      description: "Tuna salad, two handfuls, olive oil dressing",
    };
    expect(isRecoverableMealDraft(draft)).toBe(true);
    expect(draft.description).toBe(
      "Tuna salad, two handfuls, olive oil dressing",
    );
  });

  it("accepts an optional attachedPhotoUri", () => {
    const draft = {
      ...mealFormStringsFromDraft(candidate),
      attachedPhotoUri: "file:///tmp/photo-123.jpg",
    };
    expect(isRecoverableMealDraft(draft)).toBe(true);
    expect(draft.attachedPhotoUri).toBe("file:///tmp/photo-123.jpg");
  });

  it("rejects a non-string attachedPhotoUri", () => {
    expect(
      isRecoverableMealDraft({
        name: "Tuna",
        calories: "290",
        protein: "63",
        carbs: "0",
        fat: "2",
        attachedPhotoUri: 12345,
      }),
    ).toBe(false);
  });

  it("validates clientOperationId as a UUID when present", () => {
    const validDraft = {
      ...mealFormStringsFromDraft(candidate),
      clientOperationId: "11111111-2222-4333-8444-555555555555",
      consumedAt: "2026-09-08T12:00:00.000Z",
      submissionVersion: 1,
    };
    expect(isRecoverableMealDraft(validDraft)).toBe(true);

    const invalidDraft = {
      ...mealFormStringsFromDraft(candidate),
      clientOperationId: "not-a-uuid",
    };
    expect(isRecoverableMealDraft(invalidDraft)).toBe(false);
  });

  it("upgrades legacy drafts without clientOperationId or consumedAt", () => {
    const legacyDraft = {
      name: "Tuna",
      calories: "290",
      protein: "63",
      carbs: "0",
      fat: "2",
    };
    const fixedDate = new Date("2026-09-08T12:30:00.000Z");
    const upgraded = upgradeLegacyMealDraft(legacyDraft, () => fixedDate);
    expect(upgraded.clientOperationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(upgraded.consumedAt).toBe("2026-09-08T12:30:00.000Z");
    expect(upgraded.submissionVersion).toBe(1);
    expect(upgraded.name).toBe("Tuna");
  });

  it("preserves recent valid clientOperationId and consumedAt when upgrading", () => {
    const existingOpId = "22222222-3333-4444-8555-666666666666";
    const existingTime = "2026-09-08T10:00:00.000Z";
    const draft = {
      name: "Salad",
      calories: "150",
      protein: "3",
      carbs: "10",
      fat: "8",
      clientOperationId: existingOpId,
      consumedAt: existingTime,
    };
    const refDate = new Date("2026-09-08T11:00:00.000Z");
    const upgraded = upgradeLegacyMealDraft(draft, () => refDate);
    expect(upgraded.clientOperationId).toBe(existingOpId);
    expect(upgraded.consumedAt).toBe(existingTime);
  });

  it("refreshes stale consumedAt and clientOperationId when upgrading yesterday's draft", () => {
    const existingOpId = "22222222-3333-4444-8555-666666666666";
    const yesterdayTime = "2026-09-07T20:07:00.000Z";
    const draft = {
      name: "Chocolate chip Banana bread",
      calories: "350",
      protein: "5",
      carbs: "50",
      fat: "12",
      clientOperationId: existingOpId,
      consumedAt: yesterdayTime,
    };
    const today = new Date("2026-09-08T11:20:00.000Z");
    const upgraded = upgradeLegacyMealDraft(draft, () => today);
    expect(upgraded.clientOperationId).not.toBe(existingOpId);
    expect(upgraded.consumedAt).toBe("2026-09-08T11:20:00.000Z");
  });

  it("detects stale meal timestamps correctly", () => {
    const now = new Date("2026-09-12T12:00:00.000Z");
    expect(isStaleMealTimestamp(undefined, now)).toBe(true);
    expect(isStaleMealTimestamp("invalid-date", now)).toBe(true);
    // 30 minutes ago, same day
    expect(isStaleMealTimestamp("2026-09-12T11:30:00.000Z", now)).toBe(false);
    // 5 hours ago
    expect(isStaleMealTimestamp("2026-09-12T06:00:00.000Z", now)).toBe(true);
    // Yesterday (15+ hours ago)
    expect(isStaleMealTimestamp("2026-09-11T20:07:00.000Z", now)).toBe(true);
    // 15 minutes ago across midnight (23:55 to 00:10 next day) - not stale
    expect(
      isStaleMealTimestamp(
        "2026-09-12T23:55:00.000Z",
        new Date("2026-09-13T00:10:00.000Z"),
      ),
    ).toBe(false);
    // In future by 10 minutes
    expect(isStaleMealTimestamp("2026-09-12T12:10:00.000Z", now)).toBe(true);
  });
});
