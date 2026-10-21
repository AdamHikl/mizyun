import { describe, it, expect } from "vitest";
import { loadMealPhotosEnabled } from "./meal-photos";
describe("retained meal photos", () => {
  it("fails closed in Dev unless every explicit Dev condition holds", () => {
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

  it("needs the explicit release flag outside Dev", () => {
    const production = { API_PORT: "4000", MEAL_PHOTOS_ENABLED: "true" };
    expect(loadMealPhotosEnabled(production)).toBe(false);
    expect(
      loadMealPhotosEnabled({
        ...production,
        MIZYUN_MEAL_PHOTOS_ENABLED: "true",
      }),
    ).toBe(true);
    for (const value of ["1", "TRUE", "", undefined])
      expect(
        loadMealPhotosEnabled({
          ...production,
          MIZYUN_MEAL_PHOTOS_ENABLED: value,
        }),
      ).toBe(false);
  });
});
