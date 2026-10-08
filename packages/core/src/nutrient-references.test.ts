import { describe, expect, it } from "vitest";
import { adultNutrientReferences } from "./nutrient-references";

describe("general adult nutrient references", () => {
  it("uses 10% of the calorie target, never today's partial calorie intake", () => {
    expect(adultNutrientReferences(2400)).toEqual({
      fibreMinimumG: 25,
      sodiumBelowMg: 2000,
      saturatedFatMaximumG: 2400 / 90,
    });
    expect(adultNutrientReferences(1800).saturatedFatMaximumG).toBe(20);
  });

  it.each([null, 0, -1800, NaN, Infinity])(
    "withholds the energy-dependent reference for invalid target %s",
    (target) => {
      expect(adultNutrientReferences(target).saturatedFatMaximumG).toBeNull();
    },
  );
});
