import { describe, expect, it } from "vitest";
import { isExplicitWeeklyAdaptationIntent } from "./weekly-adaptation-action";

describe("isExplicitWeeklyAdaptationIntent", () => {
  it.each([
    "Review my week",
    "Should my calories change?",
    "Ukáž mi týždenné zhodnotenie",
  ])("accepts an explicit weekly review: %s", (text) => {
    expect(isExplicitWeeklyAdaptationIntent(text)).toBe(true);
  });

  it("does not hijack general nutrition discussion", () => {
    expect(isExplicitWeeklyAdaptationIntent("How do calories work?")).toBe(
      false,
    );
  });
});
