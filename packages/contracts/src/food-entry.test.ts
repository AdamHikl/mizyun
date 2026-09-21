import { describe, expect, it } from "vitest";

import {
  foodDraftCandidateSchema,
  foodEntryListQuerySchema,
  foodEntrySummaryQuerySchema,
  foodRefineDraftRequestSchema,
  foodTextDraftRequestSchema,
} from "./food-entry";

describe("food-entry local-day queries", () => {
  it("coerces a valid UTC offset from query-string input", () => {
    expect(
      foodEntryListQuerySchema.parse({
        from: "2026-07-10",
        to: "2026-07-10",
        utcOffsetMinutes: "120",
      }).utcOffsetMinutes,
    ).toBe(120);
  });

  it("rejects offsets outside the civil-time range", () => {
    expect(
      foodEntrySummaryQuerySchema.safeParse({
        date: "2026-07-10",
        utcOffsetMinutes: 841,
      }).success,
    ).toBe(false);
  });
});

describe("nutrition draft contracts", () => {
  it("accepts an editable candidate with uncertainty and provenance", () => {
    expect(
      foodDraftCandidateSchema.parse({
        name: "Eggs and toast",
        portionWeightG: 245.5,
        caloriesKcal: 350,
        proteinG: 20,
        carbohydrateG: 30,
        fatG: 16,
        calorieRangeKcal: { low: 280, high: 430 },
        proteinRangeG: { low: 16, high: 24 },
        carbohydrateRangeG: { low: 22, high: 38 },
        fatRangeG: { low: 12, high: 21 },
        confidence: 0.72,
        warnings: ["Verify added cooking fat."],
        assumptions: ["Assumes two large eggs."],
        provenance: {
          inputKind: "text",
          provider: "gemini",
          model: "resolved-model",
          promptVersion: "nutrition-draft-v2",
        },
      }),
    ).toMatchObject({
      portionWeightG: 245.5,
      provenance: { inputKind: "text" },
    });
  });

  it("keeps older drafts compatible and rejects invalid portion weights", () => {
    const legacyCandidate = {
      name: "Apple",
      caloriesKcal: 95,
      proteinG: 0.5,
      carbohydrateG: 25,
      fatG: 0.3,
      calorieRangeKcal: null,
      proteinRangeG: null,
      carbohydrateRangeG: null,
      fatRangeG: null,
      confidence: 0.8,
      warnings: [],
      assumptions: [],
      provenance: {
        inputKind: "text" as const,
        provider: "legacy",
        model: "legacy",
        promptVersion: "nutrition-draft-v2",
      },
    };

    expect(foodDraftCandidateSchema.safeParse(legacyCandidate).success).toBe(
      true,
    );
    expect(
      foodDraftCandidateSchema.safeParse({
        ...legacyCandidate,
        portionWeightG: 0,
      }).success,
    ).toBe(false);
    expect(
      foodDraftCandidateSchema.safeParse({
        ...legacyCandidate,
        portionWeightG: 20_001,
      }).success,
    ).toBe(false);
  });

  it("rejects inverted ranges and extra text-request fields", () => {
    expect(
      foodDraftCandidateSchema.safeParse({
        name: null,
        caloriesKcal: null,
        proteinG: null,
        carbohydrateG: null,
        fatG: null,
        calorieRangeKcal: { low: 500, high: 300 },
        proteinRangeG: null,
        carbohydrateRangeG: null,
        fatRangeG: null,
        confidence: 0.2,
        warnings: [],
        assumptions: [],
        provenance: {
          inputKind: "photo",
          provider: "test",
          model: "test",
          promptVersion: "nutrition-draft-v2",
        },
      }).success,
    ).toBe(false);
    expect(
      foodTextDraftRequestSchema.safeParse({
        description: "one apple",
        userId: "not-accepted",
      }).success,
    ).toBe(false);
  });
});

describe("foodRefineDraftRequestSchema (AI-ACT-007)", () => {
  const baselineDraft = {
    name: "Grilled chicken",
    caloriesKcal: 300,
    proteinG: 50,
    carbohydrateG: 0,
    fatG: 10,
    calorieRangeKcal: { low: 240, high: 360 },
    proteinRangeG: { low: 40, high: 60 },
    carbohydrateRangeG: { low: 0, high: 5 },
    fatRangeG: { low: 7, high: 14 },
    confidence: 0.7,
    warnings: [],
    assumptions: ["Assumes 100g chicken breast."],
    provenance: {
      inputKind: "text" as const,
      provider: "gemini",
      model: "test",
      promptVersion: "nutrition-draft-v2",
    },
  };

  it("accepts a valid current draft and a free-text instruction", () => {
    const parsed = foodRefineDraftRequestSchema.parse({
      currentDraft: baselineDraft,
      instruction: "Make the chicken 200g instead of 100g",
    });
    expect(parsed.instruction).toBe("Make the chicken 200g instead of 100g");
    expect(parsed.currentDraft.name).toBe("Grilled chicken");
  });

  it("rejects an instruction shorter than 2 characters", () => {
    expect(
      foodRefineDraftRequestSchema.safeParse({
        currentDraft: baselineDraft,
        instruction: "x",
      }).success,
    ).toBe(false);
  });

  it("rejects an instruction longer than 1,000 characters", () => {
    expect(
      foodRefineDraftRequestSchema.safeParse({
        currentDraft: baselineDraft,
        instruction: "a".repeat(1_001),
      }).success,
    ).toBe(false);
  });

  it("rejects extra top-level fields (strict object)", () => {
    expect(
      foodRefineDraftRequestSchema.safeParse({
        currentDraft: baselineDraft,
        instruction: "Halve the rice",
        userId: "00000000-0000-4000-8000-000000000099",
      }).success,
    ).toBe(false);
  });

  it("rejects a malformed current draft (e.g. inverted ranges)", () => {
    expect(
      foodRefineDraftRequestSchema.safeParse({
        currentDraft: {
          ...baselineDraft,
          calorieRangeKcal: { low: 600, high: 200 },
        },
        instruction: "Make the chicken 200g instead of 100g",
      }).success,
    ).toBe(false);
  });
});
