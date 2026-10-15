import { describe, expect, it } from "vitest";

import type { WeightTrendSummary } from "./body-measurement";
import {
  buildCalorieReview,
  estimateAdaptiveMaintenance,
  isoWeekStart,
  type IntakeDay,
} from "./calorie-review";

const now = new Date("2026-10-15T08:00:00Z");

const trend = (
  overrides: Partial<WeightTrendSummary> = {},
): WeightTrendSummary => ({
  status: "ready",
  latestWeightKg: 80,
  smoothedWeightKg: 80,
  weeklyChangeKg: 0.4,
  observationCount: 20,
  spanDays: 28,
  windowDays: 28,
  smoothingHalfLifeDays: 7,
  ...overrides,
});

const days = (count: number, caloriesKcal: number | null): IntakeDay[] =>
  Array.from({ length: count }, (_, index) => ({
    date: `2026-10-${String(index + 1).padStart(2, "0")}`,
    caloriesKcal,
  }));

const review = (
  overrides: Partial<Parameters<typeof buildCalorieReview>[0]> = {},
) =>
  buildCalorieReview({
    goalKind: "bulk",
    goalPace: "gradual",
    goalStartsOn: "2026-09-01",
    calibrationKcal: 0,
    currentTargetKcal: 3_000,
    goalAdjustmentKcal: 154,
    safetyFloorKcal: 1_500,
    weightTrend: trend(),
    recentIntakeDays: days(7, 3_000),
    adaptiveMaintenance: null,
    now,
    ...overrides,
  });

describe("estimateAdaptiveMaintenance", () => {
  it("derives maintenance from intake minus stored energy", () => {
    const estimate = estimateAdaptiveMaintenance({
      intakeDays: days(21, 3_000),
      weightTrend: trend({ weeklyChangeKg: 0.35 }),
      windowDays: 28,
    });
    // 3000 − 0.35 × 7700 / 7 = 2615
    expect(estimate.status).toBe("ready");
    expect(estimate.maintenanceKcal).toBe(2_615);
  });

  it("ignores incomplete days and requires 14 logged days", () => {
    const estimate = estimateAdaptiveMaintenance({
      intakeDays: [...days(13, 2_500), ...days(10, null)],
      weightTrend: trend(),
      windowDays: 28,
    });
    expect(estimate.status).toBe("insufficient");
    expect(estimate.reason).toBe("too_few_logged_days");
    expect(estimate.loggedDays).toBe(13);
  });

  it("requires a two-week weight trend", () => {
    const estimate = estimateAdaptiveMaintenance({
      intakeDays: days(20, 2_500),
      weightTrend: trend({ spanDays: 10 }),
      windowDays: 28,
    });
    expect(estimate.reason).toBe("weight_trend_too_short");
  });

  it("rejects implausible results instead of reporting them", () => {
    const estimate = estimateAdaptiveMaintenance({
      intakeDays: days(20, 900),
      weightTrend: trend({ weeklyChangeKg: 0.5 }),
      windowDays: 28,
    });
    expect(estimate.reason).toBe("implausible_result");
    expect(estimate.maintenanceKcal).toBeNull();
  });
});

describe("buildCalorieReview", () => {
  it("lowers a lean bulk that is gaining too fast", () => {
    // 0.4 kg/week at 80 kg = 0.5 %/week, above the 0.1–0.25 band.
    const result = review();
    expect(result.status).toBe("adjust");
    expect(result.reasons[0]).toBe("above_band");
    expect(result.method).toBe("rate_error");
    expect(result.deltaKcal).toBeLessThan(0);
    expect(result.deltaKcal).toBeGreaterThanOrEqual(-250);
    expect(result.proposedTargetKcal).toBe(3_000 + result.deltaKcal);
    expect(result.calibrationAfterKcal).toBe(result.deltaKcal);
  });

  it("holds an aggressive bulk gaining at the same rate", () => {
    const result = review({ goalPace: "aggressive" });
    expect(result.status).toBe("hold");
    expect(result.reasons).toEqual(["within_band"]);
    expect(result.proposedTargetKcal).toBeNull();
  });

  it("raises a cut that is losing too fast", () => {
    const result = review({
      goalKind: "cut",
      goalPace: "gradual",
      currentTargetKcal: 2_000,
      recentIntakeDays: days(6, 2_000),
      weightTrend: trend({ weeklyChangeKg: -0.8 }),
    });
    expect(result.status).toBe("adjust");
    expect(result.reasons[0]).toBe("below_band");
    expect(result.deltaKcal).toBeGreaterThan(0);
  });

  it("uses adaptive maintenance when it is ready", () => {
    const result = review({
      adaptiveMaintenance: {
        status: "ready",
        reason: null,
        maintenanceKcal: 2_560,
        averageIntakeKcal: 3_000,
        loggedDays: 25,
        windowDays: 28,
        weeklyChangeKg: 0.4,
      },
    });
    // ideal = 2560 + 0.175 % × 80 × 1100 = 2714 → −286 → capped at −250
    expect(result.method).toBe("adaptive_maintenance");
    expect(result.deltaKcal).toBe(-250);
    expect(result.proposedTargetKcal).toBe(2_750);
  });

  it("moves in the band's direction even when intake disagrees with the target", () => {
    // Ate 3,500 against a 3,000 target (117 %) and still gained too fast:
    // the arithmetic would say +, the band says −.
    const result = review({
      recentIntakeDays: days(7, 3_500),
      weightTrend: trend({ weeklyChangeKg: 0.24 }),
    });
    expect(result.status).toBe("adjust");
    expect(result.deltaKcal).toBeLessThan(0);
  });

  it("waits two weeks after a goal starts", () => {
    const result = review({ goalStartsOn: "2026-10-05" });
    expect(result.status).toBe("insufficient_data");
    expect(result.reasons).toEqual(["goal_too_new"]);
  });

  it("needs four logged days and 80–120 % adherence", () => {
    expect(review({ recentIntakeDays: days(3, 3_000) }).reasons).toEqual([
      "too_few_logged_days",
    ]);
    expect(review({ recentIntakeDays: days(7, 2_000) }).reasons).toEqual([
      "adherence_out_of_range",
    ]);
  });

  it("needs a two-week weight trend", () => {
    expect(review({ weightTrend: trend({ spanDays: 9 }) }).reasons).toEqual([
      "weight_trend_insufficient",
    ]);
  });

  it("never proposes a target below the safety floor", () => {
    const result = review({
      goalKind: "cut",
      goalPace: "gradual",
      currentTargetKcal: 1_550,
      recentIntakeDays: days(7, 1_550),
      weightTrend: trend({ weeklyChangeKg: 0 }),
    });
    expect(result.status).toBe("adjust");
    expect(result.proposedTargetKcal).toBe(1_500);
    expect(result.reasons).toContain("safety_floor");
    const atFloor = review({
      goalKind: "cut",
      goalPace: "gradual",
      currentTargetKcal: 1_500,
      recentIntakeDays: days(7, 1_500),
      weightTrend: trend({ weeklyChangeKg: 0 }),
    });
    expect(atFloor.status).toBe("hold");
    expect(atFloor.reasons).toContain("safety_floor");
  });

  it("stops at the cumulative calibration limit", () => {
    const result = review({ calibrationKcal: -900 });
    expect(result.deltaKcal).toBe(-100);
    expect(result.calibrationAfterKcal).toBe(-1_000);
    expect(result.reasons).toContain("calibration_limit");
  });
});

describe("isoWeekStart", () => {
  it("returns the Monday of the week", () => {
    expect(isoWeekStart("2026-10-15")).toBe("2026-10-12");
    expect(isoWeekStart("2026-10-12")).toBe("2026-10-12");
    expect(isoWeekStart("2026-10-18")).toBe("2026-10-12");
  });
});

describe("buildCalorieReview / review findings", () => {
  it("does not stack corrections while the slope still reflects the old target", () => {
    // Week 1: accepted −250. Weeks 2–3 the 28-day slope is unchanged.
    const accepted = new Date("2026-10-08T08:00:00Z");
    const weekTwo = review({ calibrationKcal: -250, lastAcceptedAt: accepted });
    expect(weekTwo.status).toBe("insufficient_data");
    expect(weekTwo.reasons).toEqual(["recent_adjustment"]);
    const weekThree = review({
      calibrationKcal: -250,
      lastAcceptedAt: accepted,
      now: new Date("2026-10-22T08:00:00Z"),
    });
    expect(weekThree.status).toBe("adjust");
  });

  it("gates on the regression window span, not the whole history", () => {
    // One old weigh-in makes spanDays 60, but the slope comes from 7 days.
    const result = review({
      weightTrend: trend({ spanDays: 60, windowSpanDays: 7 }),
    });
    expect(result.reasons).toEqual(["weight_trend_insufficient"]);
    expect(
      estimateAdaptiveMaintenance({
        intakeDays: days(20, 3_000),
        weightTrend: trend({ spanDays: 60, windowSpanDays: 7 }),
        windowDays: 28,
      }).reason,
    ).toBe("weight_trend_too_short");
  });

  it("treats a missing goal start date as insufficient data, not NaN", () => {
    const result = review({ goalStartsOn: "" });
    expect(result.status).toBe("insufficient_data");
    expect(result.reasons).toEqual(["goal_too_new"]);
    expect(Number.isFinite(result.goalAgeDays)).toBe(true);
  });
});

describe("buildCalorieReview / floor clamp", () => {
  it("makes an accepted raise visible while the floor clamp absorbs calibration", () => {
    // Uncalibrated 1300, calibration −300 → clamped target 1200. Losing
    // too fast on a gradual cut: the raise must lift the visible target.
    const result = review({
      goalKind: "cut",
      goalPace: "gradual",
      calibrationKcal: -300,
      uncalibratedTargetKcal: 1_300,
      currentTargetKcal: 1_200,
      safetyFloorKcal: 1_200,
      recentIntakeDays: days(7, 1_200),
      weightTrend: trend({ smoothedWeightKg: 60, weeklyChangeKg: -0.6 }),
    });
    expect(result.status).toBe("adjust");
    expect(result.targetChangeKcal).toBeGreaterThan(0);
    expect(result.proposedTargetKcal).toBe(1_200 + result.targetChangeKcal);
    // Acceptance applies the calibration change; the new target equals
    // uncalibrated + calibrationAfter, i.e. exactly the proposed target.
    expect(1_300 + result.calibrationAfterKcal).toBe(result.proposedTargetKcal);
    expect(result.deltaKcal).toBe(result.calibrationAfterKcal + 300);
  });
});
