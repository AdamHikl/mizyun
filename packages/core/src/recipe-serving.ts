import type { MealRecipeCandidate, MealRecipeMacroGrams } from "./meal-recipe";
interface Range {
  readonly minimum: number;
  readonly maximum: number;
}
interface ServingRecipe {
  readonly ingredients: readonly {
    readonly ingredientId: string;
    readonly weightGrams: number;
    readonly preparationState: "raw" | "cooked" | "as_sold";
  }[];
  readonly caloriesKcal: number | null;
  readonly calorieRangeKcal: Range | null;
  readonly nutritionPerServing: MealRecipeMacroGrams;
  readonly rangesPerServing: {
    readonly proteinG: Range | null;
    readonly carbohydrateG: Range | null;
    readonly fatG: Range | null;
  };
}
/** A serving multiplier scales reference totals once; it never infers a cooked yield. */
export function scaleRecipeServing<T extends ServingRecipe>(
  recipe: T,
  candidate: MealRecipeCandidate,
  multiplier: number,
): { readonly recipe: T; readonly candidate: MealRecipeCandidate } | null {
  if (!Number.isFinite(multiplier) || multiplier < 0.5 || multiplier > 2)
    return null;
  const scale = (value: number | null) =>
    value === null ? null : Math.round(value * multiplier * 100) / 100;
  const range = (value: Range | null) =>
    value === null
      ? null
      : { minimum: scale(value.minimum)!, maximum: scale(value.maximum)! };
  const nutrition = {
    proteinG: scale(recipe.nutritionPerServing.proteinG),
    carbohydrateG: scale(recipe.nutritionPerServing.carbohydrateG),
    fatG: scale(recipe.nutritionPerServing.fatG),
  };
  const portionGrams = scale(candidate.portionGrams)!;
  const ingredients = recipe.ingredients.map((row) => ({
    ...row,
    weightGrams: scale(row.weightGrams)!,
  }));
  const caloriesKcal = scale(recipe.caloriesKcal);
  if (
    portionGrams < candidate.minimumPortionGrams ||
    portionGrams > candidate.maximumPortionGrams ||
    ingredients.some(
      (row) => row.weightGrams <= 0 || row.weightGrams > 10000,
    ) ||
    Object.values(nutrition).some(
      (value) =>
        value !== null &&
        (!Number.isFinite(value) || value < 0 || value > 10000),
    ) ||
    (caloriesKcal !== null &&
      (!Number.isFinite(caloriesKcal) || caloriesKcal > 20000))
  )
    return null;
  return {
    recipe: {
      ...recipe,
      ingredients,
      caloriesKcal,
      calorieRangeKcal: range(recipe.calorieRangeKcal),
      nutritionPerServing: nutrition,
      rangesPerServing: {
        proteinG: range(recipe.rangesPerServing.proteinG),
        carbohydrateG: range(recipe.rangesPerServing.carbohydrateG),
        fatG: range(recipe.rangesPerServing.fatG),
      },
    },
    candidate: { ...candidate, nutrition, portionGrams },
  };
}
