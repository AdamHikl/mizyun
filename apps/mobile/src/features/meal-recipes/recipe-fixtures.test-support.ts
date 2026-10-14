import type {
  MealRecipeInput,
  MealRecipeRevalidationResponse,
  MealRecipeSessionContext,
  MealRecipeCapabilities,
} from "@mizyun/contracts";
import type { RecipeSession } from "./recipe-storage";
export const NOW = Date.parse("2026-10-13T12:00:00Z");
export const requestId = "81000000-0000-4000-8000-000000000001";
export const input: MealRecipeInput = {
  version: "meal-recipe-v1",
  ingredients: [
    {
      ingredientId: "rice-cooked",
      name: "Rice",
      confirmed: true,
      preparationState: "cooked",
      quantity: null,
      quantityUnit: "g",
      availability: "check_quantity",
    },
  ],
  exclusions: { ingredientIds: [], allergens: [], dietaryRestrictions: [] },
  preferences: { maximumPrepMinutes: null, mealSize: "normal", cuisines: [] },
};
export const metadata: MealRecipeSessionContext = {
  version: "meal-recipe-v1",
  catalogRevision: "catalog-v1",
  catalog: [
    {
      id: "rice-cooked",
      name: "Cooked rice",
      familyId: "rice",
      preparationState: "cooked",
      per100g: { caloriesKcal: 130, proteinG: 3, carbohydrateG: 28, fatG: 0.3 },
      allergens: [],
      vegan: true,
      vegetarian: true,
    },
  ],
  context: {
    version: "meal-recipe-v1",
    rankingVersion: "macro-balance-v1",
    targets: { proteinG: 100, carbohydrateG: 200, fatG: 40 },
    consumed: { proteinG: 50, carbohydrateG: 50, fatG: 30 },
    remaining: { proteinG: 50, carbohydrateG: 150, fatG: 10 },
    positiveGaps: { proteinG: 50, carbohydrateG: 150, fatG: 10 },
    snapshot: {
      localDate: "2026-10-13",
      timeZone: "UTC",
      generatedAt: new Date(NOW).toISOString(),
      expiresAt: new Date(NOW + 300000).toISOString(),
      energyFormulaVersion: "energy-v1",
      goalRevision: "goal-1",
      intakeRevision: "intake-1",
      constraintsRevision: "constraint-1",
      profileRevision: "profile-1",
    },
    coverage: "logged_so_far",
    state: "ready",
    reason: "logged_so_far",
    focus: ["carbohydrate", "protein"],
  },
};
export const validated: MealRecipeRevalidationResponse = {
  version: "meal-recipe-v1",
  catalogRevision: "catalog-v1",
  recipes: [
    {
      version: "meal-recipe-v1",
      recipeId: "rice-bowl",
      name: "Rice bowl",
      servings: 1,
      ingredients: [
        {
          ingredientId: "rice-cooked",
          weightGrams: 200,
          preparationState: "cooked",
        },
      ],
      steps: ["Warm the cooked rice."],
      prepMinutes: 5,
      caloriesKcal: 260,
      calorieRangeKcal: null,
      assumptions: ["Check available quantities."],
      warnings: [],
      nutritionPerServing: { proteinG: 6, carbohydrateG: 56, fatG: 0.6 },
      rangesPerServing: { proteinG: null, carbohydrateG: null, fatG: null },
      provenance: {
        source: "reference",
        catalogRevision: "catalog-v1",
        calculationVersion: "recipe-nutrition-v1",
        generatedAt: new Date(NOW).toISOString(),
      },
    },
  ],
  candidates: [
    {
      recipeId: "rice-bowl",
      name: "Rice bowl",
      nutrition: { proteinG: 6, carbohydrateG: 56, fatG: 0.6 },
      portionGrams: 200,
      minimumPortionGrams: 50,
      maximumPortionGrams: 2000,
      preparationState: "cooked",
      nutritionPreparationState: "cooked",
      availability: "check_quantity",
      prepMinutes: 5,
      estimateQuality: "reference",
      excluded: false,
    },
  ],
  ranking: {
    context: metadata.context,
    ranked: [
      {
        recipeId: "rice-bowl",
        name: "Rice bowl",
        fitLoss: 0.4,
        desiredMacros: { proteinG: 14, carbohydrateG: 42, fatG: 2.8 },
        reason: "logged_so_far",
      },
    ],
    rejected: [],
  },
};
export const recovery = (): RecipeSession => ({
  version: "recipe-session-v1",
  updatedAt: NOW,
  expiresAt: NOW + 86400000,
  input,
  result: validated,
  selectedRecipeId: "rice-bowl",
  portion: 1,
  operationId: null,
  handoffOpened: false,
  pendingRequestId: null,
});
export const capabilities: MealRecipeCapabilities = {
  version: "meal-recipe-v1",
  suggest: true,
  recognizeIngredients: true,
  reason: "ready",
  maximumImages: 1,
  maximumTotalImageBytes: 4194304,
  maximumImageDimension: 4096,
  requiresIngredientConfirmation: true,
  requestIdRequired: true,
};
