import { describe, expect, it } from "vitest";

import {
  foodDraftCandidateSchema,
  foodEntryListQuerySchema,
  foodEntrySummaryQuerySchema,
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
          provider: "mistral",
          model: "resolved-model",
          promptVersion: "nutrition-draft-v2",
        },
      }).provenance.inputKind,
    ).toBe("text");
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
