import type {
  MealRecipeMacroContext,
  MealRecipeRankResult,
} from "@mizyun/core";
import type {
  MealRecipeDraft,
  MealRecipeSessionCatalogItem,
} from "@mizyun/contracts";
import type { ReviewedIngredient } from "./ingredient-review-storage";

export type MacroLabel = "Protein" | "Carbs" | "Fat";
const macroKeys = [
  ["Protein", "proteinG"],
  ["Carbs", "carbohydrateG"],
  ["Fat", "fatG"],
] as const;

/**
 * Display state for the daily balance card. A fresh `no_remaining_gaps`
 * context still carries known remaining amounts; only unknown or stale
 * contexts hide them.
 */
export type BalanceView =
  | {
      readonly kind: "remaining" | "met";
      readonly values: readonly (readonly [MacroLabel, number])[];
    }
  | { readonly kind: "unknown" };

export function balanceView(
  context: MealRecipeMacroContext | undefined,
  fresh: boolean,
): BalanceView {
  if (!context || !fresh) return { kind: "unknown" };
  if (context.state !== "ready" && context.state !== "no_remaining_gaps")
    return { kind: "unknown" };
  const values = macroKeys.map(
    ([label, key]) => [label, context.remaining[key]] as const,
  );
  if (values.some(([, value]) => value === null)) return { kind: "unknown" };
  return {
    kind: context.state === "ready" ? "remaining" : "met",
    values: values as readonly (readonly [MacroLabel, number])[],
  };
}

export const focusText = (focus: MealRecipeMacroContext["focus"]) =>
  focus
    .map((value) => (value === "carbohydrate" ? "carbs" : value))
    .join(" and ");

/** Orders recipes by the deterministic ranking; unranked recipes keep their order last. */
export function orderedRecipes(
  recipes: readonly MealRecipeDraft[],
  ranking: MealRecipeRankResult | null,
): readonly MealRecipeDraft[] {
  if (!ranking) return recipes;
  const position = new Map(
    ranking.ranked.map((row, index) => [row.recipeId, index]),
  );
  return recipes
    .map((recipe, index) => ({ recipe, index }))
    .sort(
      (a, b) =>
        (position.get(a.recipe.recipeId) ?? Infinity) -
          (position.get(b.recipe.recipeId) ?? Infinity) || a.index - b.index,
    )
    .map((row) => row.recipe);
}

/** The top recipe only earns a fit claim when ranking is fresh and scored. */
export function bestFitRecipeId(
  ranking: MealRecipeRankResult | null,
  fresh: boolean,
): string | null {
  const top = ranking?.ranked[0];
  return fresh &&
    ranking?.context.state === "ready" &&
    top &&
    top.fitLoss !== null
    ? top.recipeId
    : null;
}

/**
 * Per-recipe, factual contribution to the focus macros, e.g.
 * "32 of 50 g protein left". Returns null unless the context is fresh and ready.
 */
export function recipeFitText(
  recipe: MealRecipeDraft,
  context: MealRecipeMacroContext | undefined,
  fresh: boolean,
): string | null {
  if (!context || !fresh || context.state !== "ready") return null;
  const parts = context.focus.flatMap((focus) => {
    const key =
      focus === "protein"
        ? "proteinG"
        : focus === "carbohydrate"
          ? "carbohydrateG"
          : "fatG";
    const value = recipe.nutritionPerServing[key],
      gap = context.positiveGaps[key];
    if (value === null || gap === null || !Number.isFinite(value)) return [];
    const name = focus === "carbohydrate" ? "carbs" : focus;
    return [
      Math.round(value) > Math.round(gap)
        ? `${Math.round(value)} g ${name}, more than the ${Math.round(gap)} g left`
        : `${Math.round(value)} of ${Math.round(gap)} g ${name} left`,
    ];
  });
  return parts.length ? parts.join(" · ") : null;
}

const tokens = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1)
    .map(stem);

// Crude but symmetric stemming: both sides pass through it, so "tomatoes" and
// "tomato" or "olives" and "olive" reduce to the same token.
function stem(token: string) {
  if (token.length <= 3) return token;
  let value = token.endsWith("ies") ? `${token.slice(0, -3)}y` : token;
  if (value.endsWith("s") && !value.endsWith("ss")) value = value.slice(0, -1);
  return value.length > 3 && value.endsWith("e") ? value.slice(0, -1) : value;
}

/** Catalog foods whose name or family contains every word the user typed. */
export function catalogMatches(
  row: Pick<ReviewedIngredient, "name" | "preparationState">,
  catalog: readonly MealRecipeSessionCatalogItem[],
): readonly MealRecipeSessionCatalogItem[] {
  const wanted = tokens(row.name);
  if (!wanted.length) return [];
  return catalog.filter((item) => {
    if (
      row.preparationState !== "unknown" &&
      item.preparationState !== row.preparationState
    )
      return false;
    const have = new Set([...tokens(item.name), ...tokens(item.familyId)]);
    return wanted.every((token) => have.has(token));
  });
}

/**
 * Preselects a catalog food only when the choice is unambiguous: the review
 * already carried a catalog ID, or exactly one food matches. Raw versus cooked
 * changes nutrition substantially, so ambiguous rows stay unselected.
 */
export function suggestedCatalogId(
  row: Pick<ReviewedIngredient, "ingredientId" | "name" | "preparationState">,
  catalog: readonly MealRecipeSessionCatalogItem[],
): string | null {
  if (
    row.ingredientId !== null &&
    catalog.some((item) => item.id === row.ingredientId)
  )
    return row.ingredientId;
  // Exact only: every descriptive word of the catalog name must have been
  // typed, so a generic "milk" never silently becomes "oat milk".
  const typed = new Set(tokens(row.name));
  const exact = catalogMatches(row, catalog).filter((item) =>
    tokens(item.name)
      .filter((token) => !preparationWords.has(token))
      .every((token) => typed.has(token)),
  );
  return exact.length === 1 ? exact[0]!.id : null;
}
const preparationWords = new Set(
  [
    "raw",
    "cooked",
    "boiled",
    "roasted",
    "dry",
    "as",
    "sold",
    "in",
    "water",
  ].map(stem),
);

export type PrepMinutes =
  | { readonly ok: true; readonly value: number | null }
  | { readonly ok: false; readonly error: string };

export function parsePrepMinutes(text: string): PrepMinutes {
  const value = text.trim();
  if (!value) return { ok: true, value: null };
  if (!/^\d+$/.test(value))
    return { ok: false, error: "Enter whole minutes, such as 20." };
  const minutes = Number(value);
  if (minutes < 1 || minutes > 1_440)
    return { ok: false, error: "Enter between 1 and 1,440 minutes." };
  return { ok: true, value: minutes };
}

export const splitList = (value: string) => [
  ...new Set(
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  ),
];

export const preparationText = (value: string) =>
  value === "as_sold" ? "as sold" : value.replaceAll("_", " ");

interface RecipeHttpError {
  readonly kind: string;
  readonly status?: number;
  readonly code?: string;
  readonly retryAfterSeconds?: number;
}

const retryText = (seconds: number | undefined) =>
  seconds !== undefined && seconds > 0 && seconds <= 600
    ? `Try again in ${seconds < 60 ? `${Math.ceil(seconds)} seconds` : `${Math.ceil(seconds / 60)} minutes`}.`
    : "Try again shortly.";

/** User-facing copy for a failed suggestion request, by API error code. */
export function recipeRequestMessage(error: RecipeHttpError | null): string {
  const fallback =
    "Suggestions could not be completed. Your saved request is retained; a retry creates a new request.";
  if (!error || error.kind !== "http_error") return fallback;
  switch (error.code) {
    case "RECIPE_LIMIT_DRAFTS":
      return "You’ve used today’s meal ideas. They’ll be available again tomorrow.";
    case "RECIPE_LIMIT_COST_DAY":
      return "You’ve used today’s AI allowance. It renews at midnight UTC.";
    case "RECIPE_LIMIT_COST_MONTH":
      return "You’ve used this month’s AI allowance. It renews on the 1st.";
    case "RECIPE_LIMIT_MINUTE":
    case "RECIPE_LIMIT_INFLIGHT":
    case "RECIPE_LIMIT_TOKENS":
      return `Too many requests right now. ${retryText(error.retryAfterSeconds)}`;
    case "RECIPE_LIMIT_CONSENT":
      return "Review your AI sharing consent to get meal ideas.";
    case "RECIPE_LIMIT_DELETION":
      return "Meal ideas are unavailable while your account deletion is in progress.";
    case "RECIPE_INGREDIENTS_NEED_REVIEW":
      return "Some ingredients, allergens or diet settings aren’t supported yet. Edit them and try again.";
    case "RECIPE_CONTEXT_CHANGED":
    case "RECIPE_CATALOG_REVISION":
      return "Your day or the food list changed. Refresh, then find meals again.";
    case "RECIPE_PROVIDER_UNAVAILABLE":
    case "RECIPE_PROVIDER_TIMEOUT":
    case "RECIPE_BUDGET_UNAVAILABLE":
      return `Meal ideas aren’t available right now. ${retryText(error.retryAfterSeconds)}`;
    default:
      return fallback;
  }
}

/**
 * A rejection the server decided before any provider outcome existed; the
 * pending request no longer has an unknown result.
 */
export const isDefinitiveRecipeRejection = (error: RecipeHttpError | null) =>
  error?.kind === "http_error" &&
  [400, 403, 422, 429].includes(error.status ?? 0) &&
  // An in-flight limit means an earlier request may still be running.
  error.code !== "RECIPE_LIMIT_INFLIGHT";
