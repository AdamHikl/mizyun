import type {
  MealRecipePreparationState,
  RecipeNutritionReference,
} from "@mizyun/core";
import { RECIPE_CATALOG_DATA, RECIPE_CATALOG_REVISION } from "./catalog-data";

export { RECIPE_CATALOG_REVISION };
export type RecipeCatalogIngredient = (typeof RECIPE_CATALOG_DATA)[number];
export const RECIPE_NUTRITION_REFERENCES: readonly RecipeNutritionReference[] =
  RECIPE_CATALOG_DATA;
const normalize = (value: string): string =>
  value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[_\s-]+/g, " ");
// These aliases return catalog choices for confirmation, never establish a user's product match.
const FAMILY_ALIASES: Readonly<Record<string, string>> = {
  rice: "rice-white",
  "white rice": "rice-white",
  "chicken breast": "chicken-breast",
  oats: "oats",
  egg: "egg",
  eggs: "egg",
};
export function getRecipeCatalogIngredient(
  id: string,
): RecipeCatalogIngredient | undefined {
  return RECIPE_CATALOG_DATA.find((item) => item.id === id);
}
export function resolveRecipeIngredient(
  nameOrId: string,
  state?: MealRecipePreparationState,
):
  | { status: "matched"; ingredient: RecipeCatalogIngredient }
  | { status: "ambiguous"; ingredientIds: string[] }
  | { status: "unsupported" } {
  const needle = normalize(nameOrId);
  const matches = RECIPE_CATALOG_DATA.filter(
    (item) =>
      (!state || item.preparationState === state) &&
      (FAMILY_ALIASES[needle] === item.familyId ||
        [item.id, item.name, ...item.aliases].some(
          (name) => normalize(name) === needle,
        )),
  );
  if (matches.length === 1)
    return { status: "matched", ingredient: matches[0]! };
  if (matches.length > 1)
    return {
      status: "ambiguous",
      ingredientIds: matches.map((item) => item.id),
    };
  return { status: "unsupported" };
}
export function resolveExcludedIngredientFamilies(
  idOrAlias: string,
): readonly string[] {
  const needle = normalize(idOrAlias);
  return [
    ...new Set(
      RECIPE_CATALOG_DATA.filter(
        (item) =>
          FAMILY_ALIASES[needle] === item.familyId ||
          [item.id, item.familyId, item.name, ...item.aliases].some(
            (name) => normalize(name) === needle,
          ),
      ).map((item) => item.familyId),
    ),
  ];
}
