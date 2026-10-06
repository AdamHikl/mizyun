import { describe, it, expect } from "vitest";
import { loadMealPhotosEnabled } from "./meal-photos";
describe("Dev retained meal photos", () => {
  it("fails closed unless every explicit Dev condition holds", () => {
    const dev = {
      MIZYUN_ENVIRONMENT: "dev",
      MEAL_PHOTOS_ENABLED: "true",
      API_PORT: "4100",
    };
    expect(loadMealPhotosEnabled(dev)).toBe(true);
    for (const change of [
      { MIZYUN_ENVIRONMENT: "production" },
      { API_PORT: "4000" },
      { MEAL_PHOTOS_ENABLED: "false" },
      { MIZYUN_ENVIRONMENT: undefined },
    ])
      expect(loadMealPhotosEnabled({ ...dev, ...change })).toBe(false);
    expect(loadMealPhotosEnabled({})).toBe(false);
  });
});
