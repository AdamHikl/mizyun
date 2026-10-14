import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMealRecipeMacroContext,
  rankMealRecipeCandidates,
  calculateRecipeNutrition,
} from "../packages/core/src/index.ts";
import {
  mealRecipeDraftSchema,
  mealRecipeRankResultSchema,
} from "../packages/contracts/src/index.ts";
import {
  buildFeasibleRecipeTemplates,
  getRecipeCatalogIngredient,
} from "../apps/api/src/modules/meal-recipes/index.ts";
const now = new Date("2026-10-12T12:00:00Z");
const input = {
  version: "meal-recipe-v1",
  ingredients: [
    "rice-white-cooked",
    "chicken-breast-cooked",
    "lentils-cooked",
    "chickpeas-cooked",
    "tofu-firm",
    "tomato-puree",
    "olive-oil",
  ].map((ingredientId) => ({
    ingredientId,
    name: ingredientId,
    confirmed: true,
    preparationState: getRecipeCatalogIngredient(ingredientId).preparationState,
    quantity: 1000,
    quantityUnit: "g",
    availability: "confirmed",
  })),
  exclusions: { ingredientIds: [], allergens: [], dietaryRestrictions: [] },
  preferences: { maximumPrepMinutes: 20, mealSize: "normal", cuisines: [] },
};
test("catalog templates use deterministic per-serving nutrition through public boundaries", () => {
  const result = buildFeasibleRecipeTemplates(input, { now, servings: 2 });
  assert.equal(result.recipes.length, 4);
  for (const { draft } of result.recipes) {
    assert.equal(mealRecipeDraftSchema.safeParse(draft).success, true);
    const references = draft.ingredients.map((line) =>
      getRecipeCatalogIngredient(line.ingredientId),
    );
    const computed = calculateRecipeNutrition(
      {
        ingredients: draft.ingredients,
        servings: draft.servings,
        finalYieldGrams: null,
      },
      references,
    );
    assert.equal(draft.caloriesKcal, computed.perServing.caloriesKcal);
    assert.equal(
      draft.nutritionPerServing.proteinG,
      computed.perServing.proteinG,
    );
  }
});
test("remaining 50P/150C/10F focuses carbs and lean protein while ranking real feasible meals", () => {
  const context = buildMealRecipeMacroContext({
    energy: {
      complete: true,
      formulaVersion: "energy-v1",
      targetProteinG: 150,
      targetCarbohydrateG: 250,
      targetFatG: 60,
    },
    summary: {
      date: "2026-10-12",
      entryCount: 2,
      proteinG: 100,
      carbohydrateG: 100,
      fatG: 50,
    },
    snapshot: {
      localDate: "2026-10-12",
      timeZone: "UTC",
      generatedAt: now.toISOString(),
      expiresAt: "2026-10-12T12:05:00Z",
      energyFormulaVersion: "energy-v1",
      goalRevision: "g1",
      intakeRevision: "i1",
      constraintsRevision: "c1",
      profileRevision: "p1",
    },
    coverage: "logged_so_far",
    intakeReadComplete: true,
    now,
  });
  assert.deepEqual(context.focus, ["carbohydrate", "protein"]);
  const { recipes } = buildFeasibleRecipeTemplates(input, { now, servings: 1 });
  const ranked = rankMealRecipeCandidates(
    context,
    recipes.map(({ candidate }) => candidate),
    { now, current: context.snapshot },
  );
  assert.equal(mealRecipeRankResultSchema.safeParse(ranked).success, true);
  assert.equal(ranked.ranked.length, 4);
  assert.equal(ranked.rejected.length, 0);
  assert.ok(ranked.ranked.every((item) => Number.isFinite(item.fitLoss)));
});
