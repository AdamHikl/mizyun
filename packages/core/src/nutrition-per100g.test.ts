import { describe, expect, it } from "vitest";
import { nutritionForWeightFromPer100g } from "./index";
import type { PortionNutrition } from "./index";

const label: PortionNutrition = {
  caloriesKcal: 201,
  proteinG: 10.11,
  carbohydrateG: 20,
  fatG: 5,
  fibreG: 2,
  saturatedFatG: 1,
  totalSugarsG: 4,
  sodiumMg: 30,
  cholesterolMg: 0,
};
describe("per-100-g nutrition v1", () => {
  it("rounds decimal half boundaries correctly at different magnitudes", () => {
    expect(
      nutritionForWeightFromPer100g({ ...label, proteinG: 8.45 }, 230),
    ).toMatchObject({ ok: true, value: { proteinG: 19.44 } });
    expect(
      nutritionForWeightFromPer100g({ ...label, proteinG: 0.75 }, 290),
    ).toMatchObject({ ok: true, value: { proteinG: 2.18 } });
    expect(
      nutritionForWeightFromPer100g({ ...label, caloriesKcal: 100.5 }, 10),
    ).toMatchObject({ ok: true, value: { caloriesKcal: 10.05 } });
  });
  it("calculates every nutrient in its canonical unit, rounded once to two decimals", () => {
    expect(nutritionForWeightFromPer100g(label, 150.5)).toEqual({
      ok: true,
      value: {
        caloriesKcal: 302.51,
        proteinG: 15.22,
        carbohydrateG: 30.1,
        fatG: 7.53,
        fibreG: 3.01,
        saturatedFatG: 1.51,
        totalSugarsG: 6.02,
        sodiumMg: 45.15,
        cholesterolMg: 0,
      },
    });
    expect(label.proteinG).toBe(10.11);
  });
  it("preserves unknown, omitted and zero values", () => {
    expect(
      nutritionForWeightFromPer100g(
        { caloriesKcal: null, proteinG: 0, carbohydrateG: null, fatG: null },
        50,
      ),
    ).toEqual({
      ok: true,
      value: {
        caloriesKcal: null,
        proteinG: 0,
        carbohydrateG: null,
        fatG: null,
      },
    });
  });
  it.each([0, -1, NaN, Infinity, 20_001])(
    "rejects invalid weight %s",
    (weight) => {
      expect(nutritionForWeightFromPer100g(label, weight)).toEqual({
        ok: false,
        error: "invalid_weight",
      });
    },
  );
  it.each([-1, NaN, Infinity, 20_001])(
    "rejects invalid calories %s",
    (value) => {
      expect(
        nutritionForWeightFromPer100g({ ...label, caloriesKcal: value }, 50).ok,
      ).toBe(false);
    },
  );
  it("rejects excessive unrounded totals rather than clipping or overflowing", () => {
    expect(
      nutritionForWeightFromPer100g(
        { ...label, caloriesKcal: 20_000 },
        100.00001,
      ).ok,
    ).toBe(false);
    expect(
      nutritionForWeightFromPer100g({ ...label, sodiumMg: 100_000 }, 200).ok,
    ).toBe(false);
    expect(
      nutritionForWeightFromPer100g({ ...label, proteinG: 10_000 }, 200).ok,
    ).toBe(false);
  });
  it("supports fractional grams and recalculates from the original label", () => {
    expect(nutritionForWeightFromPer100g(label, 0.5)).toEqual({
      ok: true,
      value: {
        caloriesKcal: 1.01,
        proteinG: 0.05,
        carbohydrateG: 0.1,
        fatG: 0.03,
        fibreG: 0.01,
        saturatedFatG: 0.01,
        totalSugarsG: 0.02,
        sodiumMg: 0.15,
        cholesterolMg: 0,
      },
    });
    expect(nutritionForWeightFromPer100g(label, 100)).toEqual({
      ok: true,
      value: label,
    });
  });
});
