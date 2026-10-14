import { describe, expect, it } from "vitest";
import {
  calculateRecipeNutrition,
  type RecipeNutritionInput,
  type RecipeNutritionReference,
} from "./recipe-nutrition";

const catalog: RecipeNutritionReference[] = [
  {
    id: "rice",
    preparationState: "cooked",
    per100g: { caloriesKcal: 130, proteinG: 2.7, carbohydrateG: 28, fatG: 0.3 },
  },
  {
    id: "chicken",
    preparationState: "cooked",
    per100g: { caloriesKcal: 165, proteinG: 31, carbohydrateG: 0, fatG: 3.6 },
  },
  {
    id: "oil",
    preparationState: "as_sold",
    per100g: { caloriesKcal: 884, proteinG: 0, carbohydrateG: 0, fatG: 100 },
  },
];
const recipe: RecipeNutritionInput = {
  servings: 2,
  finalYieldGrams: 560,
  ingredients: [
    { ingredientId: "rice", preparationState: "cooked", weightGrams: 320 },
    { ingredientId: "chicken", preparationState: "cooked", weightGrams: 240 },
    { ingredientId: "oil", preparationState: "as_sold", weightGrams: 20 },
  ],
};
describe("recipe nutrition", () => {
  it("counts all oil and divides by actual servings using source kcal", () => {
    const result = calculateRecipeNutrition(recipe, catalog);
    expect(result.totals).toEqual({
      caloriesKcal: 988.8,
      proteinG: 83.04,
      carbohydrateG: 89.6,
      fatG: 29.6,
    });
    expect(result.perServing).toEqual({
      caloriesKcal: 494.4,
      proteinG: 41.52,
      carbohydrateG: 44.8,
      fatG: 14.8,
    });
    expect(result.portionGrams).toBe(280);
    expect(result.calculationVersion).toBe("ingredient-weight-v1");
    expect(result.rangesPerServing.fatG).toBeNull();
  });
  it("rounds only after accumulation and division", () => {
    expect(
      calculateRecipeNutrition(
        {
          servings: 3,
          finalYieldGrams: 150,
          ingredients: [
            {
              ingredientId: "rice",
              preparationState: "cooked",
              weightGrams: 55.555,
            },
          ],
        },
        catalog,
      ).perServing.proteinG,
    ).toBe(0.5);
  });
  it("does not infer cooked yield from raw input mass", () => {
    expect(
      calculateRecipeNutrition({ ...recipe, finalYieldGrams: null }, catalog)
        .portionGrams,
    ).toBeNull();
  });
  it("propagates unknown nutrients individually instead of assuming zero", () => {
    const result = calculateRecipeNutrition(
      recipe,
      catalog.map((item) =>
        item.id === "chicken"
          ? { ...item, per100g: { ...item.per100g, proteinG: null } }
          : item,
      ),
    );
    expect(result.perServing.proteinG).toBeNull();
    expect(result.perServing.carbohydrateG).toBe(44.8);
    expect(result.estimateQuality).toBe("unknown");
  });
  it("unresolved foods produce unknown nutrition", () => {
    const result = calculateRecipeNutrition(recipe, catalog.slice(1));
    expect(Object.values(result.perServing)).toEqual([null, null, null, null]);
    expect(result.warnings).toContain("unresolved_ingredient");
  });
  it("never applies a cooked reference to a raw ingredient", () => {
    const result = calculateRecipeNutrition(
      {
        ...recipe,
        ingredients: [
          { ingredientId: "rice", preparationState: "raw", weightGrams: 200 },
        ],
      },
      catalog,
    );
    expect(result.warnings).toContain("preparation_mismatch");
    expect(result.perServing.caloriesKcal).toBeNull();
  });
  it("derives ranges only from explicit user weight bounds", () => {
    const result = calculateRecipeNutrition(
      {
        ...recipe,
        ingredients: recipe.ingredients.map((line) =>
          line.ingredientId === "oil"
            ? {
                ...line,
                weightBounds: {
                  minimum: 10,
                  maximum: 30,
                  source: "user_weight_bounds" as const,
                },
              }
            : line,
        ),
      },
      catalog,
    );
    expect(result.rangesPerServing.fatG).toEqual({
      minimum: 9.8,
      maximum: 19.8,
    });
    expect(result.rangesPerServing.caloriesKcal).toEqual({
      minimum: 450.2,
      maximum: 538.6,
    });
  });
  it.each([0, -1, 1.5, 13, NaN, Infinity])(
    "rejects invalid servings %s",
    (servings) => {
      expect(() =>
        calculateRecipeNutrition({ ...recipe, servings }, catalog),
      ).toThrow(RangeError);
    },
  );
  it.each([0, -1, NaN, Infinity, 10_001])(
    "rejects invalid weights %s",
    (weightGrams) => {
      expect(() =>
        calculateRecipeNutrition(
          {
            ...recipe,
            ingredients: [{ ...recipe.ingredients[0]!, weightGrams }],
          },
          catalog,
        ),
      ).toThrow(RangeError);
    },
  );
  it("rejects duplicate ingredients and references", () => {
    expect(() =>
      calculateRecipeNutrition(
        {
          ...recipe,
          ingredients: [recipe.ingredients[0]!, recipe.ingredients[0]!],
        },
        catalog,
      ),
    ).toThrow(RangeError);
    expect(() =>
      calculateRecipeNutrition(recipe, [...catalog, catalog[0]!]),
    ).toThrow(RangeError);
  });
  it("rejects empty and unbounded ingredient sets", () => {
    expect(() =>
      calculateRecipeNutrition({ ...recipe, ingredients: [] }, catalog),
    ).toThrow(RangeError);
    expect(() =>
      calculateRecipeNutrition(
        { ...recipe, ingredients: Array(51).fill(recipe.ingredients[0]) },
        catalog,
      ),
    ).toThrow(RangeError);
  });
  it("rejects invalid reference nutrition and inconsistent bounds", () => {
    expect(() =>
      calculateRecipeNutrition(recipe, [
        {
          ...catalog[0]!,
          per100g: {
            caloriesKcal: 300,
            proteinG: 90,
            carbohydrateG: 90,
            fatG: 0,
          },
        },
      ]),
    ).toThrow(RangeError);
    expect(() =>
      calculateRecipeNutrition(
        {
          ...recipe,
          ingredients: [
            {
              ...recipe.ingredients[0]!,
              weightBounds: {
                minimum: 400,
                maximum: 500,
                source: "user_weight_bounds",
              },
            },
          ],
        },
        catalog,
      ),
    ).toThrow(RangeError);
  });
  it.each([49, 4001, NaN, Infinity])(
    "rejects invalid final serving yield %s",
    (finalYieldGrams) => {
      expect(() =>
        calculateRecipeNutrition({ ...recipe, finalYieldGrams }, catalog),
      ).toThrow(RangeError);
    },
  );
  it("rejects a final yield smaller than its known macro mass", () => {
    expect(() =>
      calculateRecipeNutrition(
        {
          servings: 1,
          finalYieldGrams: 50,
          ingredients: [
            {
              ingredientId: "oil",
              preparationState: "as_sold",
              weightGrams: 100,
            },
          ],
        },
        catalog,
      ),
    ).toThrow(RangeError);
  });
});
