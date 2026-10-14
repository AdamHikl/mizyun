import type { MealRecipePreparationState } from "./meal-recipe";

export const RECIPE_NUTRITION_VERSION = "ingredient-weight-v1" as const;

export interface RecipeNutrientValues {
  readonly caloriesKcal: number | null;
  readonly proteinG: number | null;
  readonly carbohydrateG: number | null;
  readonly fatG: number | null;
}
export interface RecipeNutritionReference {
  readonly id: string;
  readonly preparationState: MealRecipePreparationState;
  readonly per100g: RecipeNutrientValues;
}
export interface RecipeWeightBounds {
  readonly minimum: number;
  readonly maximum: number;
  readonly source: "user_weight_bounds";
}
export interface RecipeIngredientWeight {
  readonly ingredientId: string;
  readonly preparationState: MealRecipePreparationState;
  readonly weightGrams: number;
  readonly weightBounds?: RecipeWeightBounds;
}
export interface RecipeNutritionInput {
  readonly servings: number;
  readonly ingredients: readonly RecipeIngredientWeight[];
  /** Explicit measured/declared final dish yield; never inferred from raw input mass. */
  readonly finalYieldGrams: number | null;
}
export type RecipeNutrientRanges = {
  readonly [K in keyof RecipeNutrientValues]: {
    readonly minimum: number;
    readonly maximum: number;
  } | null;
};
export interface RecipeNutritionResult {
  readonly calculationVersion: typeof RECIPE_NUTRITION_VERSION;
  readonly totals: RecipeNutrientValues;
  readonly perServing: RecipeNutrientValues;
  readonly rangesPerServing: RecipeNutrientRanges;
  readonly portionGrams: number | null;
  readonly estimateQuality: "reference" | "unknown";
  readonly warnings: readonly (
    "unresolved_ingredient" | "preparation_mismatch" | "unknown_nutrient"
  )[];
}
const KEYS = ["caloriesKcal", "proteinG", "carbohydrateG", "fatG"] as const;
const STATES = ["raw", "cooked", "as_sold"] as const;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const rounded = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;
const validWeight = (value: number): boolean =>
  Number.isFinite(value) && value > 0 && value <= 10_000;

/** Per-100g reference nutrients multiplied by grams, summed, then divided by actual servings.
 * kcal uses the source energy value, not a reconstructed 4/4/9 total. Missing nutrients
 * propagate individually. Ranges only describe explicit weight bounds; they do not claim
 * to measure natural reference-food variability or analytical confidence.
 */
export function calculateRecipeNutrition(
  input: RecipeNutritionInput,
  catalog: readonly RecipeNutritionReference[],
): RecipeNutritionResult {
  if (
    !Number.isInteger(input.servings) ||
    input.servings < 1 ||
    input.servings > 12 ||
    input.ingredients.length < 1 ||
    input.ingredients.length > 50 ||
    catalog.length > 100
  ) {
    throw new RangeError("Recipe servings or ingredient count out of bounds");
  }
  if (
    input.finalYieldGrams !== null &&
    (!Number.isFinite(input.finalYieldGrams) ||
      input.finalYieldGrams / input.servings < 50 ||
      input.finalYieldGrams / input.servings > 2000)
  ) {
    throw new RangeError("Final yield must describe a supported portion");
  }
  const references = new Map<string, RecipeNutritionReference>();
  for (const reference of catalog) {
    if (
      !ID.test(reference.id) ||
      references.has(reference.id) ||
      !STATES.includes(reference.preparationState) ||
      KEYS.some(
        (key) =>
          reference.per100g[key] !== null &&
          (!Number.isFinite(reference.per100g[key]) ||
            reference.per100g[key]! < 0 ||
            reference.per100g[key]! > (key === "caloriesKcal" ? 1000 : 100)),
      ) ||
      ["proteinG", "carbohydrateG", "fatG"].reduce(
        (sum, key) =>
          sum + (reference.per100g[key as keyof RecipeNutrientValues] ?? 0),
        0,
      ) > 100.01
    ) {
      throw new RangeError("Invalid or duplicate nutrition reference");
    }
    references.set(reference.id, reference);
  }
  const warnings = new Set<RecipeNutritionResult["warnings"][number]>();
  const seen = new Set<string>();
  const resolved = input.ingredients.map((line) => {
    if (
      !ID.test(line.ingredientId) ||
      seen.has(line.ingredientId) ||
      !STATES.includes(line.preparationState) ||
      !validWeight(line.weightGrams)
    ) {
      throw new RangeError("Invalid or duplicate ingredient weight");
    }
    seen.add(line.ingredientId);
    if (
      line.weightBounds &&
      (line.weightBounds.source !== "user_weight_bounds" ||
        !validWeight(line.weightBounds.minimum) ||
        !validWeight(line.weightBounds.maximum) ||
        line.weightBounds.minimum > line.weightGrams ||
        line.weightBounds.maximum < line.weightGrams)
    ) {
      throw new RangeError("Weight bounds must contain the planned weight");
    }
    const reference = references.get(line.ingredientId);
    if (!reference) warnings.add("unresolved_ingredient");
    else if (reference.preparationState !== line.preparationState)
      warnings.add("preparation_mismatch");
    return {
      line,
      reference:
        reference?.preparationState === line.preparationState
          ? reference
          : undefined,
    };
  });
  const totals = {} as {
    -readonly [K in keyof RecipeNutrientValues]: RecipeNutrientValues[K];
  };
  const perServing = { ...totals };
  const rangesPerServing = {} as {
    -readonly [K in keyof RecipeNutrientRanges]: RecipeNutrientRanges[K];
  };
  const hasBounds = resolved.some(
    ({ line }) => line.weightBounds !== undefined,
  );
  for (const key of KEYS) {
    if (
      resolved.some(
        ({ reference }) => !reference || reference.per100g[key] === null,
      )
    ) {
      totals[key] = null;
      perServing[key] = null;
      rangesPerServing[key] = null;
      warnings.add("unknown_nutrient");
      continue;
    }
    const amount = resolved.reduce(
      (sum, { line, reference }) =>
        sum + (reference!.per100g[key]! * line.weightGrams) / 100,
      0,
    );
    totals[key] = rounded(amount);
    perServing[key] = rounded(amount / input.servings);
    rangesPerServing[key] = hasBounds
      ? {
          minimum: rounded(
            resolved.reduce(
              (sum, { line, reference }) =>
                sum +
                (reference!.per100g[key]! *
                  (line.weightBounds?.minimum ?? line.weightGrams)) /
                  100,
              0,
            ) / input.servings,
          ),
          maximum: rounded(
            resolved.reduce(
              (sum, { line, reference }) =>
                sum +
                (reference!.per100g[key]! *
                  (line.weightBounds?.maximum ?? line.weightGrams)) /
                  100,
              0,
            ) / input.servings,
          ),
        }
      : null;
  }
  if (
    input.finalYieldGrams !== null &&
    ["proteinG", "carbohydrateG", "fatG"].reduce(
      (sum, key) => sum + (perServing[key as keyof RecipeNutrientValues] ?? 0),
      0,
    ) >
      input.finalYieldGrams / input.servings + 0.02
  ) {
    throw new RangeError("Known macro mass exceeds declared serving yield");
  }
  return {
    calculationVersion: RECIPE_NUTRITION_VERSION,
    totals,
    perServing,
    rangesPerServing,
    portionGrams:
      input.finalYieldGrams === null
        ? null
        : rounded(input.finalYieldGrams / input.servings),
    estimateQuality: KEYS.every((key) => perServing[key] !== null)
      ? "reference"
      : "unknown",
    warnings: [...warnings],
  };
}
