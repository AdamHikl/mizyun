import { describe, expect, it } from "vitest";
import {
  mealRecipeSessionContextSchema,
  mealRecipeRevalidationRequestSchema,
  mealRecipeRevalidationResponseSchema,
  recipeSessionRecoverySchema,
  recipeSessionEnvelopeSchema,
} from "./meal-recipe-session";
const macros = { proteinG: null, carbohydrateG: null, fatG: null };
const context = {
  version: "meal-recipe-v1",
  rankingVersion: "macro-balance-v1",
  targets: macros,
  consumed: macros,
  remaining: macros,
  positiveGaps: macros,
  snapshot: {
    localDate: "2026-10-13",
    timeZone: "UTC",
    generatedAt: "2026-10-13T00:00:00Z",
    expiresAt: "2026-10-14T00:00:00Z",
    energyFormulaVersion: "v1",
    goalRevision: "g",
    intakeRevision: "i",
    constraintsRevision: "c",
    profileRevision: "p",
  },
  coverage: "unknown",
  state: "unknown",
  reason: "targets_unavailable",
  focus: [],
};
const catalogItem = {
  id: "rice",
  name: "Rice",
  familyId: "rice",
  preparationState: "cooked",
  per100g: { caloriesKcal: 130, proteinG: 2, carbohydrateG: 28, fatG: 0 },
  allergens: [],
  vegan: true,
  vegetarian: true,
};
const session = {
  version: "meal-recipe-v1",
  catalogRevision: "current",
  catalog: [catalogItem],
  context,
};
const request = {
  version: "meal-recipe-v1",
  catalogRevision: "current",
  servings: 1,
  recipeIds: ["fixed"],
  input: {
    version: "meal-recipe-v1",
    ingredients: [
      {
        ingredientId: "rice",
        name: "Rice",
        preparationState: "cooked",
        confirmed: true,
        quantity: 200,
        quantityUnit: "g",
        availability: "confirmed",
      },
    ],
    exclusions: { ingredientIds: [], allergens: [], dietaryRestrictions: [] },
    preferences: { maximumPrepMinutes: null, mealSize: "normal", cuisines: [] },
  },
};
const draft = {
  version: "meal-recipe-v1",
  recipeId: "fixed",
  name: "Rice bowl",
  servings: 1,
  ingredients: [
    { ingredientId: "rice", weightGrams: 200, preparationState: "cooked" },
  ],
  steps: ["Reheat to 74°C throughout."],
  prepMinutes: 5,
  caloriesKcal: 260,
  calorieRangeKcal: null,
  assumptions: [],
  warnings: [],
  nutritionPerServing: { proteinG: 4, carbohydrateG: 56, fatG: 0 },
  rangesPerServing: macros,
  provenance: {
    source: "reference",
    catalogRevision: "current",
    calculationVersion: "v1",
    generatedAt: "2026-10-13T00:00:00Z",
  },
};
const candidate = {
  recipeId: "fixed",
  name: "Rice bowl",
  nutrition: draft.nutritionPerServing,
  portionGrams: 200,
  minimumPortionGrams: 50,
  maximumPortionGrams: 2000,
  preparationState: "cooked",
  nutritionPreparationState: "cooked",
  availability: "confirmed",
  prepMinutes: 5,
  estimateQuality: "reference",
  excluded: false,
};
const validated = {
  version: "meal-recipe-v1",
  catalogRevision: "current",
  recipes: [draft],
  candidates: [candidate],
  ranking: {
    context,
    ranked: [
      {
        recipeId: "fixed",
        name: "Rice bowl",
        fitLoss: null,
        desiredMacros: macros,
        reason: "targets_unavailable",
      },
    ],
    rejected: [],
  },
};
describe("strict recipe session contracts", () => {
  it("strictly bounds owner-scoped recovery, expiry, selection and raw photo exclusion", () => {
    const data = {
      version: "recipe-session-v1",
      updatedAt: 1,
      expiresAt: 86_400_001,
      input: request.input,
      result: validated,
      selectedRecipeId: "fixed",
      portion: 1,
      operationId: null,
      handoffOpened: false,
      pendingRequestId: null,
    };
    expect(
      recipeSessionEnvelopeSchema.safeParse({ owner: "synthetic-owner", data })
        .success,
    ).toBe(true);
    for (const override of [
      { expiresAt: 1 },
      { expiresAt: 86_400_002 },
      { selectedRecipeId: "other" },
      { selectedRecipeId: "fixed", result: null },
      { portion: 0.49 },
      { portion: 2.01 },
      { rawPhoto: "bytes" },
      { operationId: "automatic" },
      { handoffOpened: true, operationId: null },
      { pendingRequestId: "automatic" },
    ])
      expect(
        recipeSessionRecoverySchema.safeParse({ ...data, ...override }).success,
      ).toBe(false);
    expect(
      recipeSessionEnvelopeSchema.safeParse({ owner: "wrong owner", data })
        .success,
    ).toBe(false);
    expect(
      recipeSessionEnvelopeSchema.safeParse({
        owner: "synthetic-owner",
        data,
        photo: "bytes",
      }).success,
    ).toBe(false);
  });
  it("accepts sparse honest context and matching validated drafts/candidates", () => {
    expect(mealRecipeSessionContextSchema.safeParse(session).success).toBe(
      true,
    );
    expect(mealRecipeRevalidationRequestSchema.safeParse(request).success).toBe(
      true,
    );
    expect(
      mealRecipeRevalidationResponseSchema.safeParse(validated).success,
    ).toBe(true);
  });
  it("rejects owners, targets and metadata injected across strict boundaries", () => {
    for (const injected of [{ userId: "other" }, { targetProteinG: 100 }]) {
      expect(
        mealRecipeSessionContextSchema.safeParse({ ...session, ...injected })
          .success,
      ).toBe(false);
      expect(
        mealRecipeRevalidationRequestSchema.safeParse({
          ...request,
          ...injected,
        }).success,
      ).toBe(false);
    }
    expect(
      mealRecipeSessionContextSchema.safeParse({
        ...session,
        catalog: [{ ...catalogItem, aliases: ["invented"] }],
      }).success,
    ).toBe(false);
  });
  it("bounds servings and selected IDs and requires catalog identity", () => {
    for (const override of [
      { catalogRevision: "" },
      { servings: 0 },
      { servings: 13 },
      { recipeIds: [] },
      { recipeIds: ["fixed", "fixed"] },
      { recipeIds: ["a", "b", "c", "d"] },
    ])
      expect(
        mealRecipeRevalidationRequestSchema.safeParse({
          ...request,
          ...override,
        }).success,
      ).toBe(false);
  });
  it("rejects duplicate or oversized catalog and invalid preparation/nutrition/diet metadata", () => {
    expect(
      mealRecipeSessionContextSchema.safeParse({
        ...session,
        catalog: [catalogItem, catalogItem],
      }).success,
    ).toBe(false);
    expect(
      mealRecipeSessionContextSchema.safeParse({
        ...session,
        catalog: Array.from({ length: 101 }, (_, i) => ({
          ...catalogItem,
          id: `rice${i}`,
        })),
      }).success,
    ).toBe(false);
    for (const item of [
      { ...catalogItem, preparationState: "unknown" },
      { ...catalogItem, vegetarian: false },
      { ...catalogItem, per100g: { ...catalogItem.per100g, fatG: -1 } },
    ])
      expect(
        mealRecipeSessionContextSchema.safeParse({
          ...session,
          catalog: [item],
        }).success,
      ).toBe(false);
  });
  it("rejects changed catalog, mismatched IDs/nutrition and any rejected/unvalidated result", () => {
    for (const override of [
      { catalogRevision: "old" },
      { candidates: [{ ...candidate, recipeId: "other" }] },
      {
        candidates: [
          { ...candidate, nutrition: { ...candidate.nutrition, proteinG: 5 } },
        ],
      },
      { candidates: [] },
      { candidates: [{ ...candidate, excluded: true }] },
      { ranking: { ...validated.ranking, ranked: [] } },
      {
        ranking: {
          ...validated.ranking,
          rejected: [{ recipeId: "fixed", reason: "excluded" }],
        },
      },
    ])
      expect(
        mealRecipeRevalidationResponseSchema.safeParse({
          ...validated,
          ...override,
        }).success,
      ).toBe(false);
  });
  it("enforces bytes beyond bounded per-item lengths", () => {
    const many = Array.from({ length: 80 }, (_, i) => ({
      ...catalogItem,
      id: `rice${i}`,
      name: "A".repeat(160),
    }));
    expect(
      mealRecipeSessionContextSchema.safeParse({ ...session, catalog: many })
        .success,
    ).toBe(false);
  });
});
