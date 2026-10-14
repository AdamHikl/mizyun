import { describe, expect, it } from "vitest";
import {
  mealRecipeCandidateSchema,
  mealRecipeDraftSchema,
  type MealRecipeInput,
} from "@mizyun/contracts";
import {
  buildFeasibleRecipeTemplates,
  getRecipeCatalogIngredient,
  resolveRecipeIngredient,
  resolveExcludedIngredientFamilies,
  RECIPE_TEMPLATE_IDS,
} from "./index";
const now = new Date("2026-10-12T12:00:00Z");
const inputFor = (ids: string[]): MealRecipeInput => ({
  version: "meal-recipe-v1",
  ingredients: ids.map((ingredientId) => ({
    ingredientId,
    name: "User label is not nutrition authority",
    preparationState:
      getRecipeCatalogIngredient(ingredientId)!.preparationState,
    confirmed: true,
    quantity: 5000,
    quantityUnit: "g",
    availability: "confirmed",
  })),
  exclusions: { ingredientIds: [], allergens: [], dietaryRestrictions: [] },
  preferences: { maximumPrepMinutes: null, mealSize: "normal", cuisines: [] },
});
const riceInput = () =>
  inputFor([
    "rice-white-cooked",
    "chicken-breast-cooked",
    "lentils-cooked",
    "chickpeas-cooked",
    "tofu-firm",
    "tomato-puree",
    "olive-oil",
  ]);
const options = { now, servings: 1 };
describe("bounded recipe templates", () => {
  it("offers every reviewed template using only confirmed catalog ingredients", () => {
    const input = inputFor([
      "rice-white-cooked",
      "chicken-breast-cooked",
      "lentils-cooked",
      "chickpeas-cooked",
      "tofu-firm",
      "tomato-puree",
      "olive-oil",
      "greek-yogurt-nonfat",
      "oats-dry",
      "banana-raw",
      "apple-raw",
      "almonds",
      "cucumber-raw",
      "tomato-raw",
      "egg-boiled",
      "potato-boiled",
    ]);
    const result = buildFeasibleRecipeTemplates(input, options);
    expect(result.recipes.map((recipe) => recipe.draft.recipeId)).toEqual(
      RECIPE_TEMPLATE_IDS,
    );
    for (const { draft, candidate } of result.recipes) {
      expect(mealRecipeDraftSchema.safeParse(draft).success).toBe(true);
      expect(mealRecipeCandidateSchema.safeParse(candidate).success).toBe(true);
      expect(candidate.portionGrams).toBeGreaterThanOrEqual(50);
      expect(candidate.portionGrams).toBeLessThanOrEqual(2000);
      expect(
        draft.ingredients.every((line) =>
          input.ingredients.some(
            (item) => item.ingredientId === line.ingredientId,
          ),
        ),
      ).toBe(true);
      expect(draft.rangesPerServing.fatG).toBeNull();
    }
  });
  it("counts oil, calculates two portions and uses independently computed USDA totals", () => {
    const result = buildFeasibleRecipeTemplates(riceInput(), {
      ...options,
      servings: 2,
    });
    const draft = result.recipes.find(
      (recipe) => recipe.draft.recipeId === "chicken-rice-tomato",
    )!.draft;
    // Per serving: rice 200g (130/2.69/28.17/.28), chicken 130g
    // (165/31.02/0/3.57), puree 80g (38/1.65/8.98/.21), oil 5g (884/0/0/100).
    expect(draft.caloriesKcal).toBe(549.1);
    expect(draft.nutritionPerServing).toEqual({
      proteinG: 47.03,
      carbohydrateG: 63.52,
      fatG: 10.37,
    });
    expect(
      draft.ingredients.find((item) => item.ingredientId === "olive-oil")!
        .weightGrams,
    ).toBe(10);
    expect(result.recipes[0]!.candidate.portionGrams).toBe(415);
  });
  it("rejects all templates when an actual oil supply is missing", () => {
    const input = riceInput();
    input.ingredients = input.ingredients.filter(
      (item) => item.ingredientId !== "olive-oil",
    );
    expect(buildFeasibleRecipeTemplates(input, options).state).toBe(
      "no_feasible_recipe",
    );
  });
  it("never uses an unconfirmed staple", () => {
    const input = riceInput();
    input.ingredients.find(
      (item) => item.ingredientId === "olive-oil",
    )!.confirmed = false;
    input.ingredients.find(
      (item) => item.ingredientId === "olive-oil",
    )!.availability = "check_quantity";
    expect(buildFeasibleRecipeTemplates(input, options).recipes).toEqual([]);
  });
  it("counts enough supply for all servings, not just one", () => {
    const input = riceInput();
    input.ingredients.find(
      (item) => item.ingredientId === "rice-white-cooked",
    )!.quantity = 250;
    expect(buildFeasibleRecipeTemplates(input, options).recipes).toHaveLength(
      4,
    );
    expect(
      buildFeasibleRecipeTemplates(input, { ...options, servings: 2 }).recipes,
    ).toHaveLength(0);
  });
  it.each(["g", "ml", "count"] as const)(
    "unknown or nonweighed %s quantities require a visible check",
    (quantityUnit) => {
      const input = riceInput();
      const oil = input.ingredients.find(
        (item) => item.ingredientId === "olive-oil",
      )!;
      oil.quantityUnit = quantityUnit;
      oil.quantity = quantityUnit === "g" ? null : 10;
      oil.availability = "check_quantity";
      const result = buildFeasibleRecipeTemplates(input, options);
      expect(
        result.recipes.every(
          (item) =>
            item.candidate.availability === "check_quantity" &&
            item.draft.warnings.some((text) =>
              text.startsWith("Check you have enough"),
            ),
        ),
      ).toBe(true);
      expect(result.recipes).toHaveLength(4);
    },
  );
  it("excludes the whole food family across aliases and preparation variants", () => {
    const input = riceInput();
    input.exclusions.ingredientIds = ["chicken-breast-raw"];
    expect(
      buildFeasibleRecipeTemplates(input, options).recipes.some((item) =>
        item.draft.recipeId.startsWith("chicken"),
      ),
    ).toBe(false);
    input.exclusions.ingredientIds = ["rice"];
    expect(buildFeasibleRecipeTemplates(input, options).recipes).toEqual([]);
    expect(resolveExcludedIngredientFamilies("  WHITE_RICE ")).toContain(
      getRecipeCatalogIngredient("rice-white-cooked")!.familyId,
    );
  });
  it("hard filters vegan and soy exclusions without unsafe substitutions", () => {
    const input = riceInput();
    input.exclusions.dietaryRestrictions = ["vegan"];
    input.exclusions.allergens = ["soya"];
    expect(
      buildFeasibleRecipeTemplates(input, options).recipes.map(
        (item) => item.draft.recipeId,
      ),
    ).toEqual(["lentil-rice-tomato", "chickpea-rice-tomato"]);
  });
  it("filters milk, gluten, tree-nut and egg recipe composition", () => {
    const input = inputFor([
      "greek-yogurt-nonfat",
      "oats-dry",
      "banana-raw",
      "apple-raw",
      "almonds",
      "egg-boiled",
      "potato-boiled",
      "tomato-puree",
      "olive-oil",
    ]);
    for (const allergen of ["milk", "gluten", "tree_nuts", "eggs"]) {
      input.exclusions.allergens = [allergen];
      const recipes = buildFeasibleRecipeTemplates(input, options).recipes;
      expect(
        recipes.every(({ draft }) =>
          draft.ingredients.every(
            (line) =>
              !getRecipeCatalogIngredient(
                line.ingredientId,
              )!.allergens.includes(allergen),
          ),
        ),
      ).toBe(true);
    }
  });
  it.each([
    "sesame mystery",
    "nightshades",
    "brand specific sauce",
    "constructor",
    "__proto__",
  ])("requires clarification for unsupported exclusion %s", (allergen) => {
    const input = riceInput();
    input.exclusions.allergens = [allergen];
    expect(buildFeasibleRecipeTemplates(input, options)).toMatchObject({
      state: "clarification_needed",
      recipes: [],
      clarificationReasons: ["unsupported_constraint"],
    });
  });
  it("requires clarification for unsupported diet or cuisine", () => {
    const input = riceInput();
    input.exclusions.dietaryRestrictions = ["renal diet"];
    input.preferences.cuisines = ["Thai"];
    expect(
      buildFeasibleRecipeTemplates(input, options).clarificationReasons,
    ).toEqual(["unsupported_constraint", "unsupported_cuisine"]);
  });
  it("does not accept a raw/cooked switch or invented branded record", () => {
    const input = riceInput();
    input.ingredients[0]!.preparationState = "raw";
    expect(
      buildFeasibleRecipeTemplates(input, options).clarificationReasons,
    ).toContain("preparation_mismatch");
    input.ingredients[0]!.ingredientId = "invented-brand";
    expect(
      buildFeasibleRecipeTemplates(input, options).clarificationReasons,
    ).toContain("unsupported_ingredient");
    expect(resolveRecipeIngredient("Brand Super Rice").status).toBe(
      "unsupported",
    );
  });
  it("asks for state when an alias resolves to raw and cooked rice", () => {
    expect(resolveRecipeIngredient("rice").status).toBe("ambiguous");
    expect(resolveRecipeIngredient("rice", "cooked")).toMatchObject({
      status: "matched",
      ingredient: { id: "rice-white-cooked" },
    });
  });
  it("supports honest no-feasible results and prep/meal-size preferences", () => {
    expect(
      buildFeasibleRecipeTemplates(inputFor(["banana-raw"]), options).state,
    ).toBe("no_feasible_recipe");
    const input = riceInput();
    input.preferences.maximumPrepMinutes = 5;
    expect(buildFeasibleRecipeTemplates(input, options).recipes).toEqual([]);
    input.preferences.maximumPrepMinutes = null;
    input.preferences.mealSize = "small";
    expect(
      buildFeasibleRecipeTemplates(input, options).recipes[0]!.candidate
        .portionGrams,
    ).toBe(311.25);
  });
  it("includes thermometer checks on every reheated template and no freshness claim", () => {
    for (const { draft } of buildFeasibleRecipeTemplates(riceInput(), options)
      .recipes) {
      expect(draft.steps.join(" ")).toContain("74°C");
      expect(draft.steps.join(" ")).toContain("thermometer");
      expect(draft.warnings.join(" ")).toContain("cannot establish freshness");
      expect(draft.warnings.join(" ")).toContain(
        "cannot guarantee allergy safety",
      );
    }
  });
  it("validates bounded input and options before calculation", () => {
    for (const input of [null, {}, { ...riceInput(), injectedUserId: "x" }])
      expect(buildFeasibleRecipeTemplates(input, options).state).toBe(
        "invalid_input",
      );
    expect(
      buildFeasibleRecipeTemplates(riceInput(), { ...options, servings: 13 })
        .state,
    ).toBe("invalid_input");
    expect(
      buildFeasibleRecipeTemplates(riceInput(), {
        ...options,
        now: new Date(NaN),
      }).state,
    ).toBe("invalid_input");
  });
});
