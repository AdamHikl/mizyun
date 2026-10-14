import { describe, expect, it } from "vitest";
import {
  ingredientRecognitionResponseSchema,
  mealRecipeSuggestionRequestSchema,
} from "./meal-recipe-generation";
const requestId = "78000000-0000-4000-8000-000000000001";
const input = {
  version: "meal-recipe-v1",
  ingredients: [
    {
      ingredientId: "rice-white-cooked",
      name: "rice",
      confirmed: true,
      preparationState: "cooked",
      quantity: 200,
      quantityUnit: "g",
      availability: "confirmed",
    },
  ],
  exclusions: { ingredientIds: [], allergens: [], dietaryRestrictions: [] },
  preferences: { maximumPrepMinutes: null, mealSize: "normal", cuisines: [] },
};
describe("recipe transport trust boundaries", () => {
  it("requires explicit stable UUID, bounded servings and no injected target or owner", () => {
    expect(
      mealRecipeSuggestionRequestSchema.safeParse({
        requestId,
        input,
        servings: 1,
      }).success,
    ).toBe(true);
    for (const extra of [
      { userId: "another-owner" },
      { targets: { proteinG: 200 } },
    ])
      expect(
        mealRecipeSuggestionRequestSchema.safeParse({
          requestId,
          input,
          servings: 1,
          ...extra,
        }).success,
      ).toBe(false);
    expect(
      mealRecipeSuggestionRequestSchema.safeParse({
        requestId: "automatic",
        input,
        servings: 13,
      }).success,
    ).toBe(false);
  });
  it("recognition can never assert a quantity, confirmed inventory or allergy safety", () => {
    const ingredient = {
      ingredientId: "rice-white-cooked",
      name: "rice",
      preparationState: "cooked",
      confirmed: false,
      quantity: null,
      quantityUnit: "g",
      availability: "check_quantity",
    };
    const response = {
      version: "meal-recipe-v1",
      requestId,
      ingredients: [ingredient],
      warnings: [],
    };
    expect(
      ingredientRecognitionResponseSchema.safeParse(response).success,
    ).toBe(true);
    for (const override of [
      { confirmed: true },
      { quantity: 200 },
      { allergenSafe: true },
      { availability: "confirmed" },
    ])
      expect(
        ingredientRecognitionResponseSchema.safeParse({
          ...response,
          ingredients: [{ ...ingredient, ...override }],
        }).success,
      ).toBe(false);
  });
  it("enforces whole response UTF8 bytes, not just per-name character caps", () => {
    const ingredient = {
      ingredientId: "a".repeat(128),
      name: "🍚".repeat(80),
      preparationState: "unknown",
      confirmed: false,
      quantity: null,
      quantityUnit: "g",
      availability: "check_quantity",
    };
    expect(
      ingredientRecognitionResponseSchema.safeParse({
        version: "meal-recipe-v1",
        requestId,
        ingredients: Array(30).fill(ingredient),
        warnings: Array(5).fill("x".repeat(300)),
      }).success,
    ).toBe(false);
  });
});
