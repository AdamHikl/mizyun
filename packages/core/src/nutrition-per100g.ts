import type { FoodEntryCore } from "./food-entry";
import { CALORIES_MAX, MACRO_MAX } from "./food-entry";
import type { Result } from "./index";

export type PortionNutrition = Pick<
  FoodEntryCore,
  | "caloriesKcal"
  | "proteinG"
  | "carbohydrateG"
  | "fatG"
  | "fibreG"
  | "saturatedFatG"
  | "totalSugarsG"
  | "sodiumMg"
  | "cholesterolMg"
>;

const limits = {
  caloriesKcal: CALORIES_MAX,
  proteinG: MACRO_MAX,
  carbohydrateG: MACRO_MAX,
  fatG: MACRO_MAX,
  fibreG: MACRO_MAX,
  saturatedFatG: MACRO_MAX,
  totalSugarsG: MACRO_MAX,
  sodiumMg: 100_000,
  cholesterolMg: 100_000,
} as const;

/** v1: serving total = label value per 100 g × weight in g / 100.
 * Round once to 2 decimals at the serving boundary (kcal, g, mg).
 * Unknown/omitted nutrients stay unknown/omitted; zero stays zero.
 */
export const nutritionForWeightFromPer100g = (
  per100g: PortionNutrition,
  weightGrams: number,
): Result<PortionNutrition, "invalid_weight" | "invalid_nutrition"> => {
  if (!Number.isFinite(weightGrams) || weightGrams <= 0 || weightGrams > 20_000)
    return { ok: false, error: "invalid_weight" };
  const totals = { ...per100g };
  for (const field of Object.keys(limits) as (keyof typeof limits)[]) {
    const value = per100g[field];
    if (value == null) continue;
    const scaled = value * (weightGrams / 100);
    if (
      !Number.isFinite(value) ||
      value < 0 ||
      value > limits[field] ||
      !Number.isFinite(scaled) ||
      scaled > limits[field]
    )
      return { ok: false, error: "invalid_nutrition" };
    // Correct representation error at this magnitude (e.g. 0.75 × 2.9).
    const correction = 4 * Number.EPSILON * Math.max(1, Math.abs(scaled));
    totals[field] = Math.round((scaled + correction) * 100) / 100;
  }
  return { ok: true, value: totals };
};
