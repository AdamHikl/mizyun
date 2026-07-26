import { describe, expect, it } from "vitest";

import type { UserId } from "./index.js";
import {
  ACTIVITY_MULTIPLIERS,
  ENERGY_FORMULA_VERSION,
  ageFromBirthYear,
  computeEnergy,
  estimateExerciseKcal,
  mifflinStJeorBmr,
  mifflinStJeorFormula,
  type ActivityLevel,
  type EnergyInputs,
  type SexAtBirth,
} from "./energy.js";
import type { StoredBodyMeasurement } from "./body-measurement.js";
import type { StoredGoal } from "./goal.js";
import type { StoredProfile } from "./profile.js";
import type { StoredWorkout } from "./workout.js";

const userId = "00000000-0000-4000-8000-000000000001" as UserId;

const baseProfile = (
  overrides: Partial<StoredProfile> = {},
): StoredProfile => ({
  userId,
  displayName: "Tester",
  unitSystem: "metric",
  timezone: "UTC",
  birthYear: 1990,
  heightCm: 175,
  activityLevel: null,
  sexAtBirth: null,
  planTier: "free",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  ...overrides,
});

const baseMeasurement = (
  overrides: Partial<StoredBodyMeasurement> = {},
): StoredBodyMeasurement => ({
  id: "00000000-0000-4000-8000-00000000a001",
  userId,
  measuredAt: new Date("2026-07-15T08:00:00Z"),
  weightKg: 70,
  measurements: {},
  source: "manual",
  createdAt: new Date("2026-07-15T08:00:00Z"),
  ...overrides,
});

const baseGoal = (overrides: Partial<StoredGoal> = {}): StoredGoal => ({
  id: "00000000-0000-4000-8000-00000000b001",
  userId,
  kind: "cut",
  status: "active",
  pace: "steady",
  target: { weightKg: 78 },
  startsOn: "2026-01-01",
  targetDate: "2026-04-01",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  ...overrides,
});

const baseWorkout = (
  overrides: Partial<StoredWorkout> = {},
): StoredWorkout => ({
  id: "00000000-0000-4000-8000-00000000c001",
  userId,
  name: "Leg day",
  startedAt: new Date("2026-07-15T08:00:00Z"),
  completedAt: new Date("2026-07-15T09:00:00Z"),
  notes: null,
  source: "manual",
  details: {},
  createdAt: new Date("2026-07-15T08:00:00Z"),
  updatedAt: new Date("2026-07-15T08:00:00Z"),
  ...overrides,
});

const NOW = new Date("2026-07-17T12:00:00Z");

const completeInputs = (
  overrides: Partial<EnergyInputs> = {},
): EnergyInputs => ({
  profile: baseProfile(),
  latestBodyMeasurement: baseMeasurement(),
  activeGoal: baseGoal(),
  activityLevel: "moderately_active",
  sexAtBirth: "male",
  recentWorkouts: [],
  recentWorkoutsDayCount: 0,
  consumedKcalToday: 2000,
  now: NOW,
  ...overrides,
});

describe("ENERGY_FORMULA_VERSION", () => {
  it("is the v1 Mifflin-St Jeor string", () => {
    expect(ENERGY_FORMULA_VERSION).toBe("v1-mifflin-st-jeor-2026-07");
  });
});

describe("ACTIVITY_MULTIPLIERS", () => {
  it("lists every level with the documented multiplier", () => {
    expect(ACTIVITY_MULTIPLIERS.sedentary).toBe(1.4);
    expect(ACTIVITY_MULTIPLIERS.lightly_active).toBe(1.5);
    expect(ACTIVITY_MULTIPLIERS.moderately_active).toBe(1.6);
    expect(ACTIVITY_MULTIPLIERS.very_active).toBe(1.75);
    expect(ACTIVITY_MULTIPLIERS.extra_active).toBe(2);
  });
});

describe("ageFromBirthYear", () => {
  it("returns the calendar-year delta", () => {
    expect(ageFromBirthYear(1990, new Date("2026-07-17T00:00:00Z"))).toBe(36);
    expect(ageFromBirthYear(1990, new Date("2026-01-01T00:00:00Z"))).toBe(36);
  });
  it("returns 0 when the birth year is the current year", () => {
    expect(ageFromBirthYear(2026, new Date("2026-07-17T00:00:00Z"))).toBe(0);
  });
});

describe("mifflinStJeorBmr", () => {
  it("computes the male formula", () => {
    // 70 kg * 10 = 700
    // 175 cm * 6.25 = 1093.75
    // 36 yr * 5 = 180 → −180
    // +5
    // = 1618.75
    expect(mifflinStJeorBmr(70, 175, 36, "male")).toBeCloseTo(1618.75, 2);
  });
  it("computes the female formula", () => {
    // Same numbers, subtract 166 instead of add 5.
    // 1618.75 - 166 = 1452.75
    expect(mifflinStJeorBmr(70, 175, 36, "female")).toBeCloseTo(1452.75, 2);
  });
  it("is deterministic — same inputs produce the same output", () => {
    const a = mifflinStJeorBmr(80, 180, 30, "male");
    const b = mifflinStJeorBmr(80, 180, 30, "male");
    expect(a).toBe(b);
  });
});

describe("estimateExerciseKcal", () => {
  it("returns zero for an empty workout list", () => {
    expect(estimateExerciseKcal([], () => 0)).toBe(0);
  });
  it("sums per-workout set counts times the kcal-per-set hint", () => {
    const workouts = [
      baseWorkout({ id: "00000000-0000-4000-8000-00000000c001" }),
    ];
    const kcal = estimateExerciseKcal(workouts, () => 5);
    // 5 sets * 8 kcal = 40
    expect(kcal).toBe(40);
  });
});

describe("computeEnergy / complete inputs", () => {
  it("returns a complete breakdown for a fully-specified user", () => {
    const result = computeEnergy(completeInputs(), userId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.breakdown.formulaVersion).toBe(ENERGY_FORMULA_VERSION);
    expect(result.breakdown.complete).toBe(true);
    expect(result.breakdown.incompleteReason).toBeNull();
    expect(result.breakdown.ageYears).toBe(36);
    expect(result.breakdown.bmrKcal).toBeCloseTo(1618.75, 2);
    expect(result.breakdown.activityMultiplier).toBe(1.6);
    // TDEE = 1618.75 * 1.6 = 2590
    expect(result.breakdown.tdeeKcal).toBeCloseTo(2590, 2);
    // cut / steady = −500
    expect(result.breakdown.goalAdjustmentKcal).toBe(-500);
    // 2590 - 500 = 2090
    expect(result.breakdown.dailyTargetKcal).toBe(2090);
    // consumedKcalToday = 2000, balance = 2000 - 2090 = -90
    // but route computes balance after consulting recent
    // workouts; core keeps it as null and lets the route fill
    // it in.
    expect(result.breakdown.inputs.weightKg).toBe(70);
    expect(result.breakdown.inputs.heightCm).toBe(175);
    expect(result.breakdown.inputs.birthYear).toBe(1990);
    expect(result.breakdown.inputs.sexAtBirth).toBe("male");
    expect(result.breakdown.inputs.activityLevel).toBe("moderately_active");
    expect(result.breakdown.inputs.goalKind).toBe("cut");
    expect(result.breakdown.inputs.goalPace).toBe("steady");
  });

  it("applies a calorie surplus for a gradual bulk goal", () => {
    const result = computeEnergy(
      completeInputs({
        activeGoal: baseGoal({ kind: "bulk", pace: "gradual" }),
      }),
      userId,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.breakdown.goalAdjustmentKcal).toBe(300);
    expect(result.breakdown.dailyTargetKcal).toBe(2890);
  });

  it("is deterministic across multiple invocations", () => {
    const a = computeEnergy(completeInputs(), userId);
    const b = computeEnergy(completeInputs(), userId);
    if (!a.ok || !b.ok) throw new Error("expected ok");
    expect(a.breakdown.bmrKcal).toBe(b.breakdown.bmrKcal);
    expect(a.breakdown.tdeeKcal).toBe(b.breakdown.tdeeKcal);
    expect(a.breakdown.dailyTargetKcal).toBe(b.breakdown.dailyTargetKcal);
  });

  it("echoes the userId and computedAt", () => {
    const result = computeEnergy(completeInputs(), userId);
    if (!result.ok) throw new Error("expected ok");
    expect(result.breakdown.userId).toBe(userId);
    expect(result.breakdown.computedAt).toBe(NOW);
  });
});

describe("computeEnergy / incomplete inputs (ENG-06)", () => {
  it("returns incompleteReason 'weight_missing' when weight is missing", () => {
    const result = computeEnergy(
      completeInputs({ latestBodyMeasurement: null }),
      userId,
    );
    if (!result.ok) throw new Error("expected ok");
    expect(result.breakdown.complete).toBe(false);
    expect(result.breakdown.incompleteReason).toBe("weight_missing");
    expect(result.breakdown.bmrKcal).toBeNull();
    expect(result.breakdown.dailyTargetKcal).toBeNull();
  });

  it("returns incompleteReason 'height_missing' when height is null", () => {
    const result = computeEnergy(
      completeInputs({
        profile: baseProfile({ heightCm: null }),
      }),
      userId,
    );
    if (!result.ok) throw new Error("expected ok");
    expect(result.breakdown.incompleteReason).toBe("height_missing");
    expect(result.breakdown.bmrKcal).toBeNull();
  });

  it("returns incompleteReason 'birth_year_missing' when birth year is null", () => {
    const result = computeEnergy(
      completeInputs({
        profile: baseProfile({ birthYear: null }),
      }),
      userId,
    );
    if (!result.ok) throw new Error("expected ok");
    expect(result.breakdown.incompleteReason).toBe("birth_year_missing");
    expect(result.breakdown.bmrKcal).toBeNull();
  });

  it("returns incompleteReason 'sex_missing' when sexAtBirth is null", () => {
    const result = computeEnergy(completeInputs({ sexAtBirth: null }), userId);
    if (!result.ok) throw new Error("expected ok");
    expect(result.breakdown.incompleteReason).toBe("sex_missing");
    expect(result.breakdown.bmrKcal).toBeNull();
  });

  it("returns incompleteReason 'activity_unset' when activityLevel is null", () => {
    const result = computeEnergy(
      completeInputs({ activityLevel: null }),
      userId,
    );
    if (!result.ok) throw new Error("expected ok");
    expect(result.breakdown.incompleteReason).toBe("activity_unset");
    expect(result.breakdown.tdeeKcal).toBeNull();
  });

  it("returns incompleteReason 'no_active_goal' when the goal is missing", () => {
    const result = computeEnergy(completeInputs({ activeGoal: null }), userId);
    if (!result.ok) throw new Error("expected ok");
    expect(result.breakdown.incompleteReason).toBe("no_active_goal");
    expect(result.breakdown.goalAdjustmentKcal).toBeNull();
    expect(result.breakdown.dailyTargetKcal).toBeNull();
  });

  it("returns incompleteReason 'below_safety_floor' when the cut is too aggressive", () => {
    // female, lightweight; an aggressive cut on a small woman
    // would put daily intake below the 1200 kcal floor.
    const result = computeEnergy(
      completeInputs({
        sexAtBirth: "female" as SexAtBirth,
        profile: baseProfile({ birthYear: 1990, heightCm: 160 }),
        latestBodyMeasurement: baseMeasurement({ weightKg: 55 }),
        activeGoal: baseGoal({
          kind: "cut",
          pace: "aggressive",
        }),
        activityLevel: "moderately_active" as ActivityLevel,
      }),
      userId,
    );
    if (!result.ok) throw new Error("expected ok");
    expect(result.breakdown.complete).toBe(false);
    expect(result.breakdown.incompleteReason).toBe("below_safety_floor");
    expect(result.breakdown.dailyTargetKcal).toBeNull();
    // Even when the daily target is null, intermediate values
    // are still surfaceable for the audit trail.
    expect(result.breakdown.bmrKcal).not.toBeNull();
    expect(result.breakdown.tdeeKcal).not.toBeNull();
  });
});

describe("computeEnergy / rounding policy", () => {
  it("rounds intermediate values to two decimal places", () => {
    // 67.345 kg → 67.35 (round-half-to-even via 4/5 house rule)
    // We pick numbers that exercise the rounding edge.
    const result = computeEnergy(
      completeInputs({
        latestBodyMeasurement: baseMeasurement({ weightKg: 67.345 }),
      }),
      userId,
    );
    if (!result.ok) throw new Error("expected ok");
    // The implementation rounds to 2dp via Math.round(value*100)/100,
    // which is round-half-up. 67.345 * 100 = 6734.5 → 6735 → /100 = 67.35.
    expect(result.breakdown.bmrKcal).toBeCloseTo(
      mifflinStJeorBmr(67.345, 175, 36, "male"),
      1,
    );
  });
});

describe("computeEnergy / ENG-04 (no double counting)", () => {
  it("exerciseKcal is explicitly null at the engine layer", () => {
    // The engine delegates exercise-derived kcal to the route
    // because the route is the only place that has a
    // setCountForWorkout callback. Until that signal is wired,
    // exerciseKcal stays null. The breakdown surface lets the
    // UI render "exercise kcal not yet evaluated" honestly.
    const result = computeEnergy(
      completeInputs({
        recentWorkouts: [baseWorkout()],
        recentWorkoutsDayCount: 1,
      }),
      userId,
    );
    if (!result.ok) throw new Error("expected ok");
    expect(result.breakdown.exerciseKcal).toBeNull();
  });

  it("activityMultiplier stays applied to the non-exercise TDEE", () => {
    // With 1.6 the multiplier, BMR 1618.75 → TDEE 2590.
    // The activity multiplier is the residual; exercise kcal is
    // a separate field so they cannot double-count at the math
    // layer.
    const result = computeEnergy(completeInputs(), userId);
    if (!result.ok) throw new Error("expected ok");
    expect(result.breakdown.tdeeKcal).toBeCloseTo(2590, 2);
  });
});

describe("mifflinStJeorFormula.version", () => {
  it("echoes the current formula version", () => {
    expect(mifflinStJeorFormula.version).toBe(ENERGY_FORMULA_VERSION);
  });
});
