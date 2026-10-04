import { describe, expect, it } from "vitest";

import {
  advancedNutrientsFromForm,
  parseMealDate,
  mealTimestampForDate,
  mealTimestampMatchesDate,
  mealNutritionForSubmission,
  sameAdvancedNutrients,
  needsFreshAdvancedGrant,
  isRecoverableMealDraft,
  isStaleMealTimestamp,
  mealFormStringsFromDraft,
  mealFormStringsFromEntry,
  mealDraftFromCurrentForm,
  mergeMealDraftIntoForm,
  parseOptionalNutritionNumber,
  portionGramsStringFromDraft,
  upgradeLegacyMealDraft,
} from "./meal-form";

describe("per-100-g form recovery", () => {
  const form = {
    name: "Synthetic food",
    calories: "200",
    protein: "10",
    carbs: "20",
    fat: "5",
  };
  it("accepts old drafts and the explicit new basis, rejects unknown bases", () => {
    expect(isRecoverableMealDraft(form)).toBe(true);
    expect(
      isRecoverableMealDraft({
        ...form,
        nutritionBasis: "per100g",
        portionGrams: "150",
      }),
    ).toBe(true);
    expect(isRecoverableMealDraft({ ...form, nutritionBasis: "per kg" })).toBe(
      false,
    );
    expect(
      upgradeLegacyMealDraft({
        ...form,
        nutritionBasis: "per100g",
        portionGrams: "150",
      }).nutritionBasis,
    ).toBe("per100g");
  });
  it("preserves total-mode values and optional weight without scaling", () => {
    expect(mealNutritionForSubmission(form, "total", "150")).toMatchObject({
      ok: true,
      grams: 150,
      nutrition: { caloriesKcal: 200, proteinG: 10 },
    });
    expect(mealNutritionForSubmission(form, "total", "")).toMatchObject({
      ok: true,
      grams: null,
      nutrition: { caloriesKcal: 200 },
    });
  });
});

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
      fibre: "",
      saturatedFat: "",
      totalSugars: "",
      sodium: "",
      cholesterol: "",
    });
  });
});

describe("advanced nutrient form", () => {
  it("distinguishes recorded zero, missing, and invalid values", () => {
    const form = {
      name: "Oats",
      calories: "",
      protein: "",
      carbs: "",
      fat: "",
      fibre: "0",
      saturatedFat: "",
      totalSugars: "3,5",
      sodium: "120",
      cholesterol: "",
    };
    expect(advancedNutrientsFromForm(form)).toEqual({
      fibreG: 0,
      saturatedFatG: null,
      totalSugarsG: 3.5,
      sodiumMg: 120,
      cholesterolMg: null,
    });
    expect(advancedNutrientsFromForm({ ...form, fibre: "-1" })).toBeNull();
  });

  it("replays an identical Pro payload after lapse but treats clearing a field as an edit", () => {
    const submitted = {
      fibreG: 4,
      saturatedFatG: null,
      totalSugarsG: 0,
      sodiumMg: null,
      cholesterolMg: null,
    };
    expect(sameAdvancedNutrients(submitted, submitted)).toBe(true);
    expect(needsFreshAdvancedGrant(true, true)).toBe(false);
    const cleared = { ...submitted, fibreG: null };
    expect(sameAdvancedNutrients(submitted, cleared)).toBe(false);
    expect(needsFreshAdvancedGrant(true, false)).toBe(true);
    expect(needsFreshAdvancedGrant(false, false)).toBe(false);
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

describe("portionGramsStringFromDraft", () => {
  it("maps an AI portion estimate to an editable value without inventing 100g", () => {
    expect(portionGramsStringFromDraft({ portionWeightG: 327.5 })).toBe(
      "327.5",
    );
    expect(portionGramsStringFromDraft({ portionWeightG: null })).toBe("");
    expect(portionGramsStringFromDraft({})).toBe("");
  });
});

describe("recoverable AI meal drafts", () => {
  const candidate = {
    name: "Tuna",
    portionWeightG: 170,
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
      portionGrams: portionGramsStringFromDraft(candidate),
      aiDraft: candidate,
      sourceProposalId: "00000000-0000-4000-8000-000000000123",
    };
    expect(isRecoverableMealDraft(draft)).toBe(true);
    expect(draft).toMatchObject({
      name: "Tuna",
      portionGrams: "170",
      calories: "290",
      protein: "63",
      sourceProposalId: "00000000-0000-4000-8000-000000000123",
      aiDraft: { provenance: { inputKind: "text" } },
    });
  });

  it("recovers estimated extra nutrients with zero and unknown values after restart", () => {
    const estimated = {
      ...candidate,
      fibreG: 0,
      saturatedFatG: null,
      totalSugarsG: 3.5,
      sodiumMg: 400,
      cholesterolMg: 0,
    };
    const stored = JSON.parse(
      JSON.stringify({
        ...mealFormStringsFromDraft(estimated),
        aiDraft: estimated,
      }),
    );
    expect(isRecoverableMealDraft(stored)).toBe(true);
    const upgraded = upgradeLegacyMealDraft(stored);
    expect(advancedNutrientsFromForm(upgraded)).toEqual({
      fibreG: 0,
      saturatedFatG: null,
      totalSugarsG: 3.5,
      sodiumMg: 400,
      cholesterolMg: 0,
    });
    const refinedBase = mealDraftFromCurrentForm(
      estimated,
      { ...upgraded, calories: "310", sodium: "0" },
      "180",
      true,
    );
    expect(refinedBase).toMatchObject({
      caloriesKcal: 310,
      portionWeightG: 180,
      fibreG: 0,
      sodiumMg: 0,
      calorieRangeKcal: null,
    });
    expect(
      mealDraftFromCurrentForm(
        estimated,
        { ...upgraded, fibre: "bad" },
        "180",
        true,
      ),
    ).toBeNull();
  });

  it("clears the previous meal's extra nutrients when a new basic draft replaces it", () => {
    const previous = {
      ...mealFormStringsFromDraft(candidate),
      name: "Synthetic previous meal",
      fibre: "8",
      saturatedFat: "3",
      totalSugars: "0",
      sodium: "450",
      cholesterol: "20",
    };
    const basic = { ...candidate, name: "Synthetic different meal" };
    const replacement = mergeMealDraftIntoForm(
      previous,
      basic,
      true,
      "replace",
    );
    expect(replacement).toMatchObject({
      name: "Synthetic different meal",
      fibre: "",
      saturatedFat: "",
      totalSugars: "",
      sodium: "",
      cholesterol: "",
    });
    expect(advancedNutrientsFromForm(replacement)).toEqual({
      fibreG: null,
      saturatedFatG: null,
      totalSugarsG: null,
      sodiumMg: null,
      cholesterolMg: null,
    });
    // Refine an existing meal instead of replacing it: label values remain.
    expect(mergeMealDraftIntoForm(previous, basic, true)).toMatchObject({
      fibre: "8",
      sodium: "450",
      totalSugars: "0",
    });
  });

  it("replaces previous nutrients with rich new estimates and clears estimates when access is absent", () => {
    const previous = {
      ...mealFormStringsFromDraft(candidate),
      fibre: "8",
      sodium: "450",
      cholesterol: "20",
    };
    const rich = {
      ...candidate,
      fibreG: 0,
      saturatedFatG: null,
      totalSugarsG: 4,
      sodiumMg: 120,
      cholesterolMg: null,
    };
    expect(
      mergeMealDraftIntoForm(previous, rich, true, "replace"),
    ).toMatchObject({
      fibre: "0",
      saturatedFat: "",
      totalSugars: "4",
      sodium: "120",
      cholesterol: "",
    });
    expect(
      mergeMealDraftIntoForm(previous, rich, false, "replace"),
    ).toMatchObject({
      fibre: "",
      saturatedFat: "",
      totalSugars: "",
      sodium: "",
      cholesterol: "",
    });
  });

  it("preserves old-provider omissions and ignores extra fields when the current grant is absent", () => {
    const form = {
      ...mealFormStringsFromDraft(candidate),
      fibre: "3",
      sodium: "100",
    };
    expect(mergeMealDraftIntoForm(form, candidate, true)).toMatchObject({
      fibre: "3",
      sodium: "100",
    });
    expect(
      mergeMealDraftIntoForm(
        form,
        { ...candidate, fibreG: null, sodiumMg: 0 },
        true,
      ),
    ).toMatchObject({ fibre: "", sodium: "0" });
    expect(
      mergeMealDraftIntoForm(
        form,
        { ...candidate, fibreG: 8, sodiumMg: 0 },
        false,
      ),
    ).toMatchObject({ fibre: "3", sodium: "100" });
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

describe("intentional meal calendar dates", () => {
  it.each([
    undefined,
    ["2026-09-12"],
    "2026-02-30",
    "2025-02-29",
    "2026-13-01",
    "bad",
    "2026-9-12",
    "0000-01-01",
  ])("rejects malformed day %s", (value) => {
    expect(parseMealDate(value)).toBeNull();
  });
  it("uses the local calendar date and noon for backdates", () => {
    expect(parseMealDate("2024-02-29")).toBe("2024-02-29");
    const stamp = mealTimestampForDate("2026-03-29", new Date(2026, 9, 4));
    const local = new Date(stamp);
    expect([
      local.getFullYear(),
      local.getMonth(),
      local.getDate(),
      local.getHours(),
    ]).toEqual([2026, 2, 29, 12]);
    expect(mealTimestampMatchesDate(stamp, "2026-03-29")).toBe(true);
  });
  it("preserves a backdated draft and operation identity after restart", () => {
    const draft = {
      name: "Synthetic past food",
      calories: "",
      protein: "",
      carbs: "",
      fat: "",
      mealDate: "2026-03-29",
      consumedAt: mealTimestampForDate("2026-03-29"),
      clientOperationId: "11111111-1111-4111-8111-111111111111",
    };
    expect(isRecoverableMealDraft(draft)).toBe(true);
    expect(
      upgradeLegacyMealDraft(draft, () => new Date(2026, 9, 4)),
    ).toMatchObject(draft);
    expect(isRecoverableMealDraft({ ...draft, mealDate: "2026-02-30" })).toBe(
      false,
    );
  });
});
