import { describe, expect, it } from "vitest";
import { computeLoggingConsistency } from "@mizyun/core";
import { presentLoggingConsistency } from "./logging-consistency-presentation";

const present = (loggedDates: string[], weeklyGoal = 5, today = "2026-10-17") =>
  presentLoggingConsistency(
    computeLoggingConsistency({ loggedDates, today, weeklyGoal })!,
  );

describe("presentLoggingConsistency", () => {
  it("shows progress with seven labelled dots", () => {
    const view = present(["2026-10-12", "2026-10-16"]);
    expect(view.kind).toBe("progress");
    expect(view.title).toBe("Logged 2 of 5 days this week");
    expect(view.message).toBeNull();
    expect(view.dots.map((d) => d.letter).join("")).toBe("MTWTFSS");
    expect(view.dots.filter((d) => d.logged)).toHaveLength(2);
    expect(view.dots[0].accessibilityLabel).toBe("Monday, logged");
    expect(view.dots[5].accessibilityLabel).toBe("Saturday, not logged yet");
    expect(view.dots[6].accessibilityLabel).toBe("Sunday, upcoming");
    expect(view.dots[1].accessibilityLabel).toBe("Tuesday, no log");
  });

  it("celebrates gently when the goal is met", () => {
    const view = present(["2026-10-12", "2026-10-13", "2026-10-16"], 3);
    expect(view.kind).toBe("goal-met");
    expect(view.message).toContain("Goal reached");
    expect(view.accessibilityLabel).toContain("Goal reached");
  });

  it("shows the goal fraction when exactly meeting the goal", () => {
    const view = present(["2026-10-12", "2026-10-13", "2026-10-16"], 3);
    expect(view.title).toBe("Logged 3 of 3 days this week");
  });

  it("shows only the day count once the goal is passed", () => {
    const view = present(
      ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"],
      3,
    );
    expect(view.kind).toBe("goal-met");
    expect(view.title).toBe("Logged 5 days this week");
    expect(view.accessibilityLabel).toBe(
      "Logged 5 days this week. Goal reached.",
    );
  });

  it("welcomes the user back without guilt wording", () => {
    const view = present(["2026-10-10"]);
    expect(view.kind).toBe("welcome-back");
    const text = JSON.stringify(view).toLowerCase();
    for (const word of ["streak", "broken", "missed", "failed", "lost"])
      expect(text).not.toContain(word);
    expect(view.title).toBe("Welcome back");
  });

  it("never uses streak or shame wording in any state", () => {
    const states = [
      present([]),
      present(["2026-10-16"]),
      present(["2026-10-12", "2026-10-13", "2026-10-16"], 3),
      present(["2026-10-01"]),
    ];
    for (const view of states)
      expect(JSON.stringify(view).toLowerCase()).not.toMatch(
        /streak|broken|missed|failed/,
      );
  });
});
