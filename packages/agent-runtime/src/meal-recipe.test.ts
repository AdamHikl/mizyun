import { describe, expect, it } from "vitest";
import {
  DisabledIngredientRecognitionProvider,
  DisabledRecipeGenerationProvider,
  FakeIngredientRecognitionProvider,
  FakeRecipeGenerationProvider,
  RecipeProviderError,
  type IngredientRecognitionRequest,
  type RecipeGenerationRequest,
} from "./meal-recipe.js";

const generation: RecipeGenerationRequest = {
  eligibleRecipes: ["one", "two", "three", "four"].map((recipeId) => ({
    recipeId,
    nutrition: { proteinG: 10, carbohydrateG: 20, fatG: 5 },
    prepMinutes: 10,
  })),
  focus: ["protein"],
  preferences: { mealSize: "normal", maximumPrepMinutes: null },
  signal: new AbortController().signal,
};
const recognition: IngredientRecognitionRequest = {
  images: [{ mimeType: "image/jpeg", bytes: new Uint8Array([1]) }],
  catalog: [],
  signal: new AbortController().signal,
};

describe("recipe provider ports", () => {
  it("defaults disabled ports to unavailable without work", async () => {
    const recipes = new DisabledRecipeGenerationProvider();
    const ingredients = new DisabledIngredientRecognitionProvider();
    expect(await recipes.status()).toMatchObject({
      ready: false,
      externalAccess: false,
      provider: "disabled",
    });
    expect(await ingredients.status()).toMatchObject({ ready: false });
    await expect(recipes.generate(generation)).rejects.toMatchObject({
      reason: "unavailable",
    });
    await expect(ingredients.recognize(recognition)).rejects.toMatchObject({
      reason: "unavailable",
    });
  });

  it("returns deterministic synthetic results only after explicit injection", async () => {
    const recipes = new FakeRecipeGenerationProvider();
    expect(await recipes.status()).toMatchObject({ provider: "synthetic" });
    expect(await recipes.generate(generation)).toEqual({
      recipeIds: ["one", "two", "three"],
      tokensUsed: 1,
    });
    expect(
      await new FakeIngredientRecognitionProvider().recognize(recognition),
    ).toEqual({ ingredients: [], tokensUsed: 1 });
  });

  it("keeps injected failures and omitted usage explicit", async () => {
    const failure = new RecipeProviderError("refused");
    await expect(
      new FakeRecipeGenerationProvider(failure).generate(generation),
    ).rejects.toBe(failure);
    await expect(
      new FakeIngredientRecognitionProvider(failure).recognize(recognition),
    ).rejects.toBe(failure);
    expect(
      await new FakeRecipeGenerationProvider({ recipeIds: [] }).generate(
        generation,
      ),
    ).toEqual({ recipeIds: [] });
    expect(
      await new FakeIngredientRecognitionProvider({
        ingredients: [],
      }).recognize(recognition),
    ).toEqual({ ingredients: [] });
  });

  it("clones synthetic results and refuses already aborted requests", async () => {
    const recipes = new FakeRecipeGenerationProvider({ recipeIds: ["one"] });
    const first = await recipes.generate(generation);
    (first.recipeIds as string[]).push("injected");
    expect(await recipes.generate(generation)).toEqual({ recipeIds: ["one"] });
    const controller = new AbortController();
    controller.abort();
    await expect(
      recipes.generate({ ...generation, signal: controller.signal }),
    ).rejects.toMatchObject({ reason: "timeout" });
    await expect(
      new FakeIngredientRecognitionProvider().recognize({
        ...recognition,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ reason: "timeout" });
  });
});
