import { describe, expect, it } from "vitest";
import { isExplicitDailyPlanIntent } from "./daily-plan-action";

describe("isExplicitDailyPlanIntent", () => {
  it.each([
    "What should I do today?",
    "Show my daily plan",
    "Čo mám dnes jesť?",
  ])("accepts explicit daily-plan request: %s", (text) => {
    expect(isExplicitDailyPlanIntent(text)).toBe(true);
  });

  it("does not hijack a general coaching question", () => {
    expect(isExplicitDailyPlanIntent("Why is protein important?")).toBe(false);
  });
});
