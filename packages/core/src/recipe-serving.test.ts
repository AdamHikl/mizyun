import { describe, expect, it } from "vitest";
import { scaleRecipeServing } from "./recipe-serving";
import type { MealRecipeCandidate } from "./meal-recipe";
const recipe = {
  ingredients: [
    {
      ingredientId: "rice",
      weightGrams: 100,
      preparationState: "raw" as const,
    },
  ],
  caloriesKcal: 180,
  calorieRangeKcal: { minimum: 170, maximum: 190 },
  nutritionPerServing: { proteinG: 20, carbohydrateG: 40, fatG: null },
  rangesPerServing: { proteinG: null, carbohydrateG: null, fatG: null },
};
const candidate: MealRecipeCandidate = {
  recipeId: "rice",
  name: "Rice",
  nutrition: recipe.nutritionPerServing,
  portionGrams: 300,
  minimumPortionGrams: 50,
  maximumPortionGrams: 2000,
  preparationState: "cooked",
  nutritionPreparationState: "cooked",
  availability: "check_quantity",
  prepMinutes: 10,
  estimateQuality: "reference",
  excluded: false,
};
describe("recipe serving", () => {
  it("scales once from original and preserves unknown nutrition and declared cooked yield", () => {
    const scaled = scaleRecipeServing(recipe, candidate, 1.5)!;
    expect(scaled.recipe.nutritionPerServing).toEqual({
      proteinG: 30,
      carbohydrateG: 60,
      fatG: null,
    });
    expect(scaled.candidate.portionGrams).toBe(450);
    expect(scaled.recipe.ingredients[0]?.weightGrams).toBe(150);
    expect(recipe.ingredients[0]?.weightGrams).toBe(100);
  });
  it("refuses extreme, nonfinite and out-of-bounds portions", () => {
    for (const multiplier of [0, 3, NaN, Infinity])
      expect(scaleRecipeServing(recipe, candidate, multiplier)).toBeNull();
    expect(
      scaleRecipeServing(recipe, { ...candidate, portionGrams: 30 }, 1),
    ).toBeNull();
  });
});
