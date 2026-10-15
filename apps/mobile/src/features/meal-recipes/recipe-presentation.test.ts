import { describe, expect, it } from "vitest";
import type { MealRecipeSessionCatalogItem } from "@mizyun/contracts";
import { metadata, validated } from "./recipe-fixtures.test-support";
import {
  balanceView,
  bestFitRecipeId,
  catalogMatches,
  isDefinitiveRecipeRejection,
  orderedRecipes,
  parsePrepMinutes,
  recipeFitText,
  recipeRequestMessage,
  splitList,
  suggestedCatalogId,
} from "./recipe-presentation";

const food = (
  id: string,
  name: string,
  familyId: string,
  preparationState: "raw" | "cooked" | "as_sold",
): MealRecipeSessionCatalogItem => ({
  id,
  name,
  familyId,
  preparationState,
  per100g: { caloriesKcal: 1, proteinG: 1, carbohydrateG: 1, fatG: 1 },
  allergens: [],
  vegan: true,
  vegetarian: true,
});
const catalog = [
  food("rice-white-cooked", "White rice, cooked", "rice-white", "cooked"),
  food("rice-white-raw", "White rice, dry", "rice-white", "raw"),
  food("chicken-breast-raw", "Chicken breast, raw", "chicken-breast", "raw"),
  food("chickpeas-cooked", "Chickpeas, boiled", "chickpeas", "cooked"),
  food("olive-oil", "Olive oil", "olive-oil", "as_sold"),
  food("tomato-raw", "Tomato, raw", "tomato", "raw"),
];
const row = (
  name: string,
  preparationState: "raw" | "cooked" | "as_sold" | "unknown" = "unknown",
  ingredientId: string | null = null,
) => ({ name, preparationState, ingredientId });

describe("balanceView", () => {
  it("shows known values as targets met for a fresh no_remaining_gaps context (#243)", () => {
    const view = balanceView(
      {
        ...metadata.context,
        consumed: { proteinG: 100, carbohydrateG: 210, fatG: 40 },
        remaining: { proteinG: 0, carbohydrateG: -10, fatG: 0 },
        positiveGaps: { proteinG: 0, carbohydrateG: 0, fatG: 0 },
        state: "no_remaining_gaps",
        reason: "no_remaining_gaps",
        focus: [],
      },
      true,
    );
    expect(view).toEqual({
      kind: "met",
      values: [
        ["Protein", 0],
        ["Carbs", -10],
        ["Fat", 0],
      ],
    });
  });
  it("keeps unknown, stale and expired contexts unknown", () => {
    expect(balanceView(metadata.context, false)).toEqual({ kind: "unknown" });
    expect(
      balanceView(
        { ...metadata.context, state: "stale", reason: "source_stale" },
        true,
      ),
    ).toEqual({ kind: "unknown" });
    expect(
      balanceView(
        {
          ...metadata.context,
          state: "unknown",
          reason: "intake_unknown",
          remaining: { proteinG: null, carbohydrateG: null, fatG: null },
        },
        true,
      ),
    ).toEqual({ kind: "unknown" });
    expect(balanceView(undefined, true)).toEqual({ kind: "unknown" });
  });
  it("shows ready contexts as remaining", () => {
    expect(balanceView(metadata.context, true).kind).toBe("remaining");
  });
});

describe("recipe order and fit", () => {
  const second = { ...validated.recipes[0]!, recipeId: "oat-bowl" };
  const ranking = {
    ...validated.ranking,
    ranked: [
      { ...validated.ranking.ranked[0]!, recipeId: "oat-bowl" },
      validated.ranking.ranked[0]!,
    ],
  };
  it("renders recipes in deterministic ranked order, not model order", () => {
    expect(
      orderedRecipes([validated.recipes[0]!, second], ranking).map(
        (recipe) => recipe.recipeId,
      ),
    ).toEqual(["oat-bowl", "rice-bowl"]);
  });
  it("claims a best fit only for a fresh, scored, ready ranking", () => {
    expect(bestFitRecipeId(ranking, true)).toBe("oat-bowl");
    expect(bestFitRecipeId(ranking, false)).toBeNull();
    expect(
      bestFitRecipeId(
        {
          ...ranking,
          ranked: ranking.ranked.map((item) => ({ ...item, fitLoss: null })),
        },
        true,
      ),
    ).toBeNull();
  });
  it("describes each recipe's own contribution to the focus macros", () => {
    expect(recipeFitText(validated.recipes[0]!, metadata.context, true)).toBe(
      "56 of 150 g carbs left · 6 of 50 g protein left",
    );
    expect(
      recipeFitText(validated.recipes[0]!, metadata.context, false),
    ).toBeNull();
    expect(
      recipeFitText(
        {
          ...validated.recipes[0]!,
          nutritionPerServing: { proteinG: 60, carbohydrateG: 56, fatG: 1 },
        },
        { ...metadata.context, focus: ["protein"] },
        true,
      ),
    ).toBe("60 g protein, more than the 50 g left");
  });
});

describe("ingredient matching", () => {
  it("keeps raw versus cooked ambiguity for the user to resolve", () => {
    expect(catalogMatches(row("rice"), catalog).map((item) => item.id)).toEqual(
      ["rice-white-cooked", "rice-white-raw"],
    );
    expect(suggestedCatalogId(row("rice"), catalog)).toBeNull();
  });
  it("preselects one unambiguous match, respecting a known preparation state", () => {
    expect(suggestedCatalogId(row("white rice", "cooked"), catalog)).toBe(
      "rice-white-cooked",
    );
    // "White" was never typed, so plain "rice" stays a user choice.
    expect(suggestedCatalogId(row("Rice", "cooked"), catalog)).toBeNull();
    expect(suggestedCatalogId(row("chicken breasts"), catalog)).toBe(
      "chicken-breast-raw",
    );
    expect(suggestedCatalogId(row("Tomatoes"), catalog)).toBe("tomato-raw");
    expect(suggestedCatalogId(row("olive oil"), catalog)).toBe("olive-oil");
    expect(suggestedCatalogId(row("chicken", "cooked"), catalog)).toBeNull();
  });
  it("never preselects a substitute for a generic word", () => {
    const only = [food("oat-milk", "Oat milk", "oat-milk", "as_sold")];
    expect(catalogMatches(row("milk"), only)).toHaveLength(1);
    expect(suggestedCatalogId(row("milk"), only)).toBeNull();
    expect(
      suggestedCatalogId(row("oil"), [
        food("olive-oil", "Olive oil", "olive-oil", "as_sold"),
      ]),
    ).toBeNull();
  });
  it("trusts a recognized catalog ID only when the catalog still has it", () => {
    expect(
      suggestedCatalogId(row("x", "unknown", "chickpeas-cooked"), catalog),
    ).toBe("chickpeas-cooked");
    expect(
      suggestedCatalogId(row("tofu", "unknown", "tofu-firm"), catalog),
    ).toBeNull();
  });
});

describe("form values", () => {
  it("validates prep minutes instead of sending NaN or fractions", () => {
    expect(parsePrepMinutes("")).toEqual({ ok: true, value: null });
    expect(parsePrepMinutes(" 20 ")).toEqual({ ok: true, value: 20 });
    expect(parsePrepMinutes("abc").ok).toBe(false);
    expect(parsePrepMinutes("2.5").ok).toBe(false);
    expect(parsePrepMinutes("0").ok).toBe(false);
    expect(parsePrepMinutes("1441").ok).toBe(false);
  });
  it("dedupes comma lists so repeated words cannot fail validation", () => {
    expect(splitList(" milk, nuts ,, milk ")).toEqual(["milk", "nuts"]);
  });
});

describe("suggestion errors", () => {
  const http = (status: number, code: string) => ({
    kind: "http_error",
    status,
    code,
  });
  it("treats only server-decided rejections as definitive", () => {
    expect(isDefinitiveRecipeRejection(http(400, "RECIPE_REQUEST"))).toBe(true);
    expect(isDefinitiveRecipeRejection(http(403, "RECIPE_LIMIT_CONSENT"))).toBe(
      true,
    );
    expect(
      isDefinitiveRecipeRejection(http(422, "RECIPE_INGREDIENTS_NEED_REVIEW")),
    ).toBe(true);
    expect(
      isDefinitiveRecipeRejection(http(429, "RECIPE_LIMIT_INFLIGHT")),
    ).toBe(false);
    expect(
      isDefinitiveRecipeRejection(http(409, "RECIPE_OUTCOME_UNAVAILABLE")),
    ).toBe(false);
    expect(isDefinitiveRecipeRejection(http(503, "X"))).toBe(false);
    expect(isDefinitiveRecipeRejection({ kind: "network_error" })).toBe(false);
  });
  it("gives actionable copy with a bounded retry hint", () => {
    expect(
      recipeRequestMessage({
        ...http(429, "RECIPE_LIMIT_MINUTE"),
        retryAfterSeconds: 30,
      }),
    ).toBe("Too many requests right now. Try again in 30 seconds.");
    expect(
      recipeRequestMessage(http(422, "RECIPE_INGREDIENTS_NEED_REVIEW")),
    ).toContain("aren’t supported yet");
    expect(recipeRequestMessage(null)).toContain(
      "a retry creates a new request",
    );
  });
});
