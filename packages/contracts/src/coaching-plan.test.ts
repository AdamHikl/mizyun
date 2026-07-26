import { describe, expect, it } from "vitest";

import { coachingPlanSchema } from "./coaching-plan";

describe("coachingPlanSchema", () => {
  it("accepts a complete bulk plan", () => {
    expect(
      coachingPlanSchema.parse({
        version: "v1",
        computedAt: "2026-07-26T10:00:00.000Z",
        complete: true,
        missingInputs: [],
        goalKind: "bulk",
        calorie: {
          targetKcal: 3_000,
          planningRangeLowKcal: 2_900,
          planningRangeHighKcal: 3_100,
          formulaVersion: "energy-v1",
        },
        protein: {
          basisWeightKg: 80,
          minG: 128,
          targetG: 144,
          maxG: 160,
          minGramsPerKg: 1.6,
          targetGramsPerKg: 1.8,
          maxGramsPerKg: 2,
        },
        training: {
          focus: "hypertrophy_and_strength",
          resistanceDaysMin: 3,
          resistanceDaysMax: 4,
          aerobicMinutesMin: 150,
          completedSessionsLast7Days: 3,
          status: "within_base_frequency",
          exerciseTypes: [
            "compound_resistance",
            "accessory_resistance",
            "moderate_aerobic",
            "mobility_recovery",
          ],
        },
        assumptions: ["General healthy exercising adult."],
        safetyNotice: "General wellness guidance only.",
      }).goalKind,
    ).toBe("bulk");
  });

  it("accepts an honest incomplete plan", () => {
    const parsed = coachingPlanSchema.parse({
      version: "v1",
      computedAt: "2026-07-26T10:00:00.000Z",
      complete: false,
      missingInputs: ["active_goal", "body_weight", "energy_target"],
      goalKind: null,
      calorie: null,
      protein: null,
      training: null,
      assumptions: ["No inputs were guessed."],
      safetyNotice: "General wellness guidance only.",
    });
    expect(parsed.complete).toBe(false);
  });
});
