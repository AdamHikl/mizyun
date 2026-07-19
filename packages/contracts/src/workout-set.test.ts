import { describe, expect, it } from "vitest";

import { exerciseRecentSetsQuerySchema } from "./workout-set";

describe("exercise recent-set queries", () => {
  it("accepts a workout UUID to exclude from previous performance", () => {
    const excludeWorkoutId = "00000000-0000-4000-8000-000000000001";
    expect(
      exerciseRecentSetsQuerySchema.parse({ excludeWorkoutId })
        .excludeWorkoutId,
    ).toBe(excludeWorkoutId);
  });

  it("rejects a malformed excluded workout id", () => {
    expect(
      exerciseRecentSetsQuerySchema.safeParse({
        excludeWorkoutId: "not-a-workout",
      }).success,
    ).toBe(false);
  });
});
