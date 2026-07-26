import { describe, expect, it } from "vitest";
import { buildDailyActionPlan } from "./daily-action-plan";
import type { CoachingPlan } from "./coaching-plan";

const plan: CoachingPlan = {
  version: "v1-general-fitness-2026-07",
  computedAt: new Date("2026-07-26T12:00:00.000Z"),
  complete: true,
  missingInputs: [],
  goalKind: "recomp",
  calorie: {
    targetKcal: 2_200,
    planningRangeLowKcal: 2_100,
    planningRangeHighKcal: 2_300,
    formulaVersion: "test",
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
    focus: "hypertrophy_and_conditioning",
    resistanceDaysMin: 3,
    resistanceDaysMax: 4,
    aerobicMinutesMin: 150,
    completedSessionsLast7Days: 1,
    status: "below_base_frequency",
    exerciseTypes: ["compound_resistance"],
  },
  assumptions: [],
  safetyNotice: "test",
};

describe("buildDailyActionPlan", () => {
  it("computes bounded remainders and prioritises a material protein gap", () => {
    expect(
      buildDailyActionPlan({
        plan,
        date: "2026-07-26",
        consumedKcal: 1_500,
        consumedProteinG: 80,
        completedWorkoutToday: false,
      }),
    ).toMatchObject({
      calorie: { remainingKcal: 700 },
      protein: { remainingG: 64 },
      training: { due: true },
      nextAction: "prioritise_protein",
    });
  });

  it("asks for a meal log before inferring zero intake", () => {
    expect(
      buildDailyActionPlan({
        plan,
        date: "2026-07-26",
        consumedKcal: null,
        consumedProteinG: null,
        completedWorkoutToday: false,
      }).nextAction,
    ).toBe("log_meal");
  });
});
