import { describe, expect, it } from "vitest";
import {
  addLocalDays,
  clampWeeklyLogGoal,
  computeLoggingConsistency,
} from "./logging-consistency";

// 2026-10-17 is a Saturday; its ISO week starts Monday 2026-10-12.
const compute = (loggedDates: string[], today = "2026-10-17", goal = 5) =>
  computeLoggingConsistency({ loggedDates, today, weeklyGoal: goal })!;

describe("computeLoggingConsistency", () => {
  it("counts distinct logged days in the Monday-based week", () => {
    const result = compute(["2026-10-12", "2026-10-14", "2026-10-14"]);
    expect(result.weekStart).toBe("2026-10-12");
    expect(result.daysLoggedThisWeek).toBe(2);
    expect(result.goalMet).toBe(false);
    expect(result.weekDays.map((d) => d.date)[6]).toBe("2026-10-18");
    expect(result.weekDays.filter((d) => d.isFuture)).toHaveLength(1);
    expect(result.weekDays.find((d) => d.isToday)?.date).toBe("2026-10-17");
  });

  it("does not count the previous Sunday in the new week", () => {
    const result = compute(["2026-10-11"], "2026-10-12");
    expect(result.daysLoggedThisWeek).toBe(0);
    expect(result.weekStart).toBe("2026-10-12");
    expect(result.daysSinceLastLog).toBe(1);
    expect(result.showWelcomeBack).toBe(false);
  });

  it("counts Sunday as the last day of the week", () => {
    const result = compute(["2026-10-12", "2026-10-18"], "2026-10-18");
    expect(result.daysLoggedThisWeek).toBe(2);
    expect(result.loggedToday).toBe(true);
  });

  it("marks the goal met at the goal and beyond", () => {
    const days = ["2026-10-12", "2026-10-13", "2026-10-14"];
    expect(compute(days, "2026-10-14", 3).goalMet).toBe(true);
    expect(compute(days, "2026-10-14", 4).goalMet).toBe(false);
  });

  it("ignores future dates and malformed values", () => {
    const result = compute([
      "2026-10-18",
      "2027-01-01",
      "2026-02-31",
      "not-a-date",
      "2026-10-17T10:00:00Z",
      "2026-10-16",
    ]);
    expect(result.daysLoggedThisWeek).toBe(1);
    expect(result.daysSinceLastLog).toBe(1);
  });

  it("reports null days since last log for empty history", () => {
    const result = compute([]);
    expect(result.daysSinceLastLog).toBeNull();
    expect(result.showWelcomeBack).toBe(false);
    expect(result.daysLoggedThisWeek).toBe(0);
  });

  it("shows welcome-back after two or more days without a log", () => {
    expect(compute(["2026-10-15"]).showWelcomeBack).toBe(true);
    expect(compute(["2026-10-16"]).showWelcomeBack).toBe(false);
    expect(compute(["2026-10-17"]).showWelcomeBack).toBe(false);
    expect(compute(["2026-09-01"]).showWelcomeBack).toBe(true);
  });

  it("never shows welcome-back when today is logged", () => {
    expect(compute(["2026-10-01", "2026-10-17"]).showWelcomeBack).toBe(false);
  });

  it("is stable across DST transitions", () => {
    // US fall-back is 2026-11-01 and spring-forward 2026-03-08.
    expect(addLocalDays("2026-11-01", 1)).toBe("2026-11-02");
    expect(addLocalDays("2026-03-08", -1)).toBe("2026-03-07");
    const result = compute(["2026-10-30"], "2026-11-02");
    expect(result.daysSinceLastLog).toBe(3);
    expect(result.weekStart).toBe("2026-11-02");
    const spring = compute(["2026-03-06"], "2026-03-09");
    expect(spring.daysSinceLastLog).toBe(3);
    expect(spring.weekDays.map((d) => d.date)).toEqual([
      "2026-03-09",
      "2026-03-10",
      "2026-03-11",
      "2026-03-12",
      "2026-03-13",
      "2026-03-14",
      "2026-03-15",
    ]);
  });

  it("crosses month and year boundaries", () => {
    const result = compute(["2026-12-29"], "2027-01-01");
    expect(result.weekStart).toBe("2026-12-28");
    expect(result.daysLoggedThisWeek).toBe(1);
    expect(result.daysSinceLastLog).toBe(3);
  });

  it("clamps the goal", () => {
    expect(compute([], "2026-10-17", 1).weeklyGoal).toBe(3);
    expect(compute([], "2026-10-17", 99).weeklyGoal).toBe(7);
    expect(compute([], "2026-10-17", 4.6).weeklyGoal).toBe(5);
    expect(clampWeeklyLogGoal(Number.NaN)).toBe(5);
    expect(clampWeeklyLogGoal("6")).toBe(5);
    expect(clampWeeklyLogGoal(undefined)).toBe(5);
  });

  it("returns null for an invalid today", () => {
    expect(
      computeLoggingConsistency({
        loggedDates: [],
        today: "bad",
        weeklyGoal: 5,
      }),
    ).toBeNull();
  });
});
