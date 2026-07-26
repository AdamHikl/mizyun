import { describe, expect, it } from "vitest";

import { buildCoachingPlan } from "./coaching-plan";
import { ENERGY_FORMULA_VERSION, type EnergyBreakdown } from "./energy";
import type { UserId } from "./index";

const userId = "00000000-0000-4000-8000-000000000001" as UserId;

const energy = (overrides: Partial<EnergyBreakdown> = {}): EnergyBreakdown => ({
  formulaVersion: ENERGY_FORMULA_VERSION,
  userId,
  computedAt: new Date("2026-07-26T10:00:00.000Z"),
  complete: true,
  incompleteReason: null,
  ageYears: 34,
  bmrKcal: 1_800,
  activityMultiplier: 1.5,
  tdeeKcal: 2_700,
  exerciseKcal: null,
  goalAdjustmentKcal: 300,
  dailyTargetKcal: 3_000,
  targetProteinG: 144,
  targetCarbohydrateG: 375,
  targetFatG: 83,
  balanceKcal: null,
  balanceUncertaintyKcal: null,
  inputs: {
    weightKg: 80,
    heightCm: 180,
    birthYear: 1992,
    sexAtBirth: "male",
    activityLevel: "lightly_active",
    goalKind: "bulk",
    goalPace: "gradual",
  },
  ...overrides,
});

describe("buildCoachingPlan", () => {
  it("builds auditable calorie, protein, and training targets", () => {
    const plan = buildCoachingPlan({
      energy: energy(),
      completedWorkoutsLast7Days: 3,
    });

    expect(plan.complete).toBe(true);
    expect(plan.calorie).toMatchObject({
      targetKcal: 3_000,
      planningRangeLowKcal: 2_900,
      planningRangeHighKcal: 3_100,
    });
    expect(plan.protein).toEqual({
      basisWeightKg: 80,
      minG: 128,
      targetG: 144,
      maxG: 160,
      minGramsPerKg: 1.6,
      targetGramsPerKg: 1.8,
      maxGramsPerKg: 2,
    });
    expect(plan.training).toMatchObject({
      focus: "hypertrophy_and_strength",
      resistanceDaysMin: 3,
      resistanceDaysMax: 4,
      aerobicMinutesMin: 150,
      completedSessionsLast7Days: 3,
      status: "within_base_frequency",
    });
  });

  it("does not fabricate targets when confirmed inputs are missing", () => {
    const plan = buildCoachingPlan({
      energy: energy({
        complete: false,
        incompleteReason: "weight_missing",
        dailyTargetKcal: null,
        inputs: {
          weightKg: null,
          heightCm: 180,
          birthYear: 1992,
          sexAtBirth: "male",
          activityLevel: "lightly_active",
          goalKind: null,
          goalPace: null,
        },
      }),
      completedWorkoutsLast7Days: 0,
    });

    expect(plan.complete).toBe(false);
    expect(plan.missingInputs).toEqual([
      "active_goal",
      "body_weight",
      "energy_target",
    ]);
    expect(plan.calorie).toBeNull();
    expect(plan.protein).toBeNull();
    expect(plan.training).toBeNull();
  });

  it("normalizes an invalid negative workout count at the boundary", () => {
    const plan = buildCoachingPlan({
      energy: energy(),
      completedWorkoutsLast7Days: -2.5,
    });
    expect(plan.training).toMatchObject({
      completedSessionsLast7Days: 0,
      status: "below_base_frequency",
    });
  });
});
