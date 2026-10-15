import { describe, expect, it } from "vitest";

import {
  GOAL_MODES,
  dailyKcalForWeeklyChangeKg,
  goalAdjustmentKcalFor,
  goalModeFor,
  projectGoal,
} from "./goal-modes";

const now = new Date("2026-10-15T12:00:00Z");

describe("goal modes", () => {
  it("names every stored kind/pace pair", () => {
    expect(goalModeFor("bulk", "gradual").label).toBe("Lean bulk");
    expect(goalModeFor("bulk", "steady").label).toBe("Standard bulk");
    expect(goalModeFor("bulk", "aggressive").label).toBe("Aggressive bulk");
    expect(goalModeFor("cut", "gradual").label).toBe("Gradual cut");
    expect(goalModeFor("cut", "steady").label).toBe("Standard cut");
    expect(goalModeFor("cut", "aggressive").label).toBe("Aggressive cut");
    expect(goalModeFor("recomp", "aggressive").id).toBe("recomp");
    expect(goalModeFor("maintain", "gradual").id).toBe("maintain");
  });

  it("orders bands without gaps or overlaps inside each kind", () => {
    for (const kind of ["cut", "bulk"] as const) {
      const modes = GOAL_MODES.filter((mode) => mode.kind === kind).sort(
        (a, b) => a.minWeeklyPercent - b.minWeeklyPercent,
      );
      for (let index = 1; index < modes.length; index += 1) {
        expect(modes[index]?.minWeeklyPercent).toBe(
          modes[index - 1]?.maxWeeklyPercent,
        );
      }
    }
  });

  it("never plans a cut faster than 1 %BW or a bulk faster than 0.75 %BW", () => {
    for (const mode of GOAL_MODES) {
      expect(mode.minWeeklyPercent).toBeGreaterThanOrEqual(-1);
      expect(mode.maxWeeklyPercent).toBeLessThanOrEqual(0.75);
      expect(mode.targetWeeklyPercent).toBeGreaterThanOrEqual(
        mode.minWeeklyPercent,
      );
      expect(mode.targetWeeklyPercent).toBeLessThanOrEqual(
        mode.maxWeeklyPercent,
      );
    }
  });

  it("converts weekly kg change at 7,700 kcal/kg", () => {
    expect(dailyKcalForWeeklyChangeKg(0.5)).toBeCloseTo(550, 6);
    expect(goalAdjustmentKcalFor(goalModeFor("cut", "steady"), 80)).toBe(-550);
  });
});

describe("projectGoal", () => {
  it("returns no projection when the mode moves away from the target", () => {
    const projection = projectGoal({
      goalMode: goalModeFor("cut", "steady"),
      currentWeightKg: 70,
      targetWeightKg: 75,
      targetDate: "2027-01-01",
      now,
    });
    expect(projection.projectedWeeksToTarget).toBeNull();
    expect(projection.targetDateRealistic).toBeNull();
  });

  it("marks a reachable target date as realistic", () => {
    const projection = projectGoal({
      goalMode: goalModeFor("bulk", "gradual"),
      currentWeightKg: 80,
      targetWeightKg: 82,
      targetDate: "2027-12-31",
      now,
    });
    // 0.175 % of 80 kg = 0.14 kg/week → ceil(2 / 0.14) = 15 weeks
    expect(projection.projectedWeeksToTarget).toBe(15);
    expect(projection.targetDateRealistic).toBe(true);
  });

  it("does not project maintain or recomp goals", () => {
    expect(
      projectGoal({
        goalMode: goalModeFor("maintain", "steady"),
        currentWeightKg: 80,
        targetWeightKg: 78,
        targetDate: null,
        now,
      }).projectedWeeksToTarget,
    ).toBeNull();
  });
});
