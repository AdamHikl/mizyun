import {
  mealRecipeDraftSchema,
  mealRecipeInputSchema,
  type MealRecipeDraft,
} from "@mizyun/contracts";
import {
  calculateRecipeNutrition,
  type MealRecipeCandidate,
  type RecipeIngredientWeight,
} from "@mizyun/core";
import {
  getRecipeCatalogIngredient,
  RECIPE_CATALOG_REVISION,
  RECIPE_NUTRITION_REFERENCES,
  resolveExcludedIngredientFamilies,
} from "./catalog";

interface Template {
  readonly id: string;
  readonly name: string;
  readonly prepMinutes: number;
  readonly ingredients: readonly {
    readonly id: string;
    readonly grams: number;
  }[];
  readonly steps: readonly string[];
  readonly reheat: boolean;
}
const TEMPLATE_DATA: readonly Template[] = [
  {
    id: "chicken-rice-tomato",
    name: "Chicken and tomato rice bowl",
    prepMinutes: 12,
    ingredients: [
      { id: "rice-white-cooked", grams: 200 },
      { id: "chicken-breast-cooked", grams: 130 },
      { id: "tomato-puree", grams: 80 },
      { id: "olive-oil", grams: 5 },
    ],
    steps: [
      "Weigh already-cooked rice and chicken in their cooked state. Add tomato puree and the measured oil.",
      "Heat together, stirring, until a food thermometer reads at least 74°C throughout. Divide into the specified servings.",
    ],
    reheat: true,
  },
  {
    id: "lentil-rice-tomato",
    name: "Lentil and tomato rice bowl",
    prepMinutes: 12,
    ingredients: [
      { id: "rice-white-cooked", grams: 180 },
      { id: "lentils-cooked", grams: 180 },
      { id: "tomato-puree", grams: 80 },
      { id: "olive-oil", grams: 5 },
    ],
    steps: [
      "Weigh already-cooked rice and lentils; add tomato puree and measured oil.",
      "Heat together, stirring, until a food thermometer reads at least 74°C throughout. Divide into the specified servings.",
    ],
    reheat: true,
  },
  {
    id: "chickpea-rice-tomato",
    name: "Chickpea and tomato rice bowl",
    prepMinutes: 12,
    ingredients: [
      { id: "rice-white-cooked", grams: 180 },
      { id: "chickpeas-cooked", grams: 160 },
      { id: "tomato-puree", grams: 80 },
      { id: "olive-oil", grams: 5 },
    ],
    steps: [
      "Weigh already-cooked rice and chickpeas; add tomato puree and measured oil.",
      "Heat together, stirring, until a food thermometer reads at least 74°C throughout. Divide into the specified servings.",
    ],
    reheat: true,
  },
  {
    id: "tofu-rice-tomato",
    name: "Tofu and tomato rice bowl",
    prepMinutes: 15,
    ingredients: [
      { id: "rice-white-cooked", grams: 200 },
      { id: "tofu-firm", grams: 180 },
      { id: "tomato-puree", grams: 80 },
      { id: "olive-oil", grams: 5 },
    ],
    steps: [
      "Cut firm tofu. Add the weighed already-cooked rice, tomato puree and measured oil.",
      "Follow the tofu package cooking directions. Heat the assembled dish to at least 74°C throughout, measured with a food thermometer. Divide into the specified servings.",
    ],
    reheat: true,
  },
  {
    id: "yogurt-oats-banana",
    name: "Yogurt, oats and banana bowl",
    prepMinutes: 5,
    ingredients: [
      { id: "greek-yogurt-nonfat", grams: 200 },
      { id: "oats-dry", grams: 50 },
      { id: "banana-raw", grams: 100 },
    ],
    steps: [
      "Weigh plain nonfat Greek yogurt, dry rolled oats and peeled banana. Check the oats package is suitable for eating without cooking.",
      "Slice the banana and combine with yogurt and oats. Divide into the specified servings; keep refrigerated until eaten.",
    ],
    reheat: false,
  },
  {
    id: "yogurt-apple-almond",
    name: "Yogurt, apple and almond bowl",
    prepMinutes: 5,
    ingredients: [
      { id: "greek-yogurt-nonfat", grams: 200 },
      { id: "apple-raw", grams: 150 },
      { id: "almonds", grams: 20 },
    ],
    steps: [
      "Wash the apple and remove the core; weigh the edible portion, plain nonfat Greek yogurt and almonds.",
      "Cut the apple and combine with yogurt and almonds. Divide into the specified servings; keep refrigerated until eaten.",
    ],
    reheat: false,
  },
  {
    id: "chickpea-cucumber-tomato",
    name: "Chickpea, cucumber and tomato salad",
    prepMinutes: 8,
    ingredients: [
      { id: "chickpeas-cooked", grams: 200 },
      { id: "cucumber-raw", grams: 100 },
      { id: "tomato-raw", grams: 100 },
      { id: "olive-oil", grams: 5 },
    ],
    steps: [
      "Wash cucumber and tomatoes, then weigh their edible portions. Weigh already-cooked chickpeas and the oil.",
      "Chop vegetables and mix with chickpeas and the measured oil. Divide into the specified servings; keep refrigerated until eaten.",
    ],
    reheat: false,
  },
  {
    id: "egg-potato-tomato",
    name: "Egg and potato tomato bowl",
    prepMinutes: 12,
    ingredients: [
      { id: "egg-boiled", grams: 100 },
      { id: "potato-boiled", grams: 200 },
      { id: "tomato-puree", grams: 80 },
      { id: "olive-oil", grams: 5 },
    ],
    steps: [
      "Use already hard-boiled eggs and boiled potatoes; weigh their edible cooked portions. Combine chopped potatoes, tomato puree and measured oil.",
      "Reheat potatoes and sauce to 74°C throughout using a food thermometer. Add the eggs and heat the assembled dish to 74°C throughout. Divide into the specified servings.",
    ],
    reheat: true,
  },
];
export const RECIPE_TEMPLATE_IDS = TEMPLATE_DATA.map((item) => item.id);
const ALLERGENS: Record<string, string> = {
  gluten: "gluten",
  wheat: "gluten",
  barley: "gluten",
  rye: "gluten",
  oats: "gluten",
  crustaceans: "crustaceans",
  eggs: "eggs",
  egg: "eggs",
  fish: "fish",
  peanuts: "peanuts",
  peanut: "peanuts",
  soy: "soy",
  soya: "soy",
  soybeans: "soy",
  milk: "milk",
  dairy: "milk",
  "tree nuts": "tree_nuts",
  tree_nuts: "tree_nuts",
  celery: "celery",
  mustard: "mustard",
  sesame: "sesame",
  "sesame seeds": "sesame",
  sulphites: "sulphites",
  sulfites: "sulphites",
  "sulphur dioxide": "sulphites",
  lupin: "lupin",
  molluscs: "molluscs",
  mollusks: "molluscs",
};
const normalize = (value: string) =>
  value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
export interface FeasibleRecipe {
  readonly draft: MealRecipeDraft;
  readonly candidate: MealRecipeCandidate;
}
export interface RecipeTemplateResult {
  readonly state:
    "ready" | "no_feasible_recipe" | "clarification_needed" | "invalid_input";
  readonly recipes: readonly FeasibleRecipe[];
  readonly clarificationReasons: readonly (
    | "unsupported_constraint"
    | "unsupported_cuisine"
    | "unsupported_ingredient"
    | "preparation_mismatch"
  )[];
}
/** Offline templates only. No provider calls, routes, intake writes, or implicit pantry staples. */
export function buildFeasibleRecipeTemplates(
  untrusted: unknown,
  options: {
    readonly servings: number;
    readonly now: Date;
    /** Server-authored advisories (e.g. unenforceable profile diets) added to every draft. */
    readonly advisoryWarnings?: readonly string[];
  },
): RecipeTemplateResult {
  const parsed = mealRecipeInputSchema.safeParse(untrusted);
  if (
    !parsed.success ||
    !Number.isInteger(options.servings) ||
    options.servings < 1 ||
    options.servings > 12 ||
    !Number.isFinite(options.now.getTime())
  ) {
    return { state: "invalid_input", recipes: [], clarificationReasons: [] };
  }
  const input = parsed.data;
  const reasons = new Set<
    RecipeTemplateResult["clarificationReasons"][number]
  >();
  const excludedFamilies = new Set<string>();
  for (const excluded of input.exclusions.ingredientIds) {
    const families = resolveExcludedIngredientFamilies(excluded);
    if (!families.length) reasons.add("unsupported_constraint");
    families.forEach((family) => excludedFamilies.add(family));
  }
  const allergens = new Set<string>();
  for (const allergen of input.exclusions.allergens) {
    const key = normalize(allergen);
    if (key === "nuts") {
      allergens.add("tree_nuts");
      allergens.add("peanuts");
    } else if (Object.hasOwn(ALLERGENS, key)) allergens.add(ALLERGENS[key]!);
    else reasons.add("unsupported_constraint");
  }
  const diets = new Set<string>();
  for (const diet of input.exclusions.dietaryRestrictions) {
    const key = normalize(diet);
    if (["vegan", "vegetarian"].includes(key)) diets.add(key);
    else if (key === "gluten free") allergens.add("gluten");
    else if (key === "dairy free") allergens.add("milk");
    else reasons.add("unsupported_constraint");
  }
  // These neutral templates have no reviewed cuisine classification; do not silently ignore a requested cuisine.
  if (input.preferences.cuisines.length) reasons.add("unsupported_cuisine");
  for (const ingredient of input.ingredients) {
    const item = getRecipeCatalogIngredient(ingredient.ingredientId);
    if (!item) reasons.add("unsupported_ingredient");
    else if (item.preparationState !== ingredient.preparationState)
      reasons.add("preparation_mismatch");
  }
  if (reasons.size)
    return {
      state: "clarification_needed",
      recipes: [],
      clarificationReasons: [...reasons],
    };
  const recipes: FeasibleRecipe[] = [];
  const scale = ({ small: 0.75, normal: 1, large: 1.25 } as const)[
    input.preferences.mealSize
  ];
  for (const template of TEMPLATE_DATA) {
    if (
      input.preferences.maximumPrepMinutes !== null &&
      template.prepMinutes > input.preferences.maximumPrepMinutes
    )
      continue;
    const lines: RecipeIngredientWeight[] = [];
    let needsQuantityCheck = false;
    let feasible = true;
    for (const line of template.ingredients) {
      const item = getRecipeCatalogIngredient(line.id)!;
      const available = input.ingredients.find(
        (ingredient) => ingredient.ingredientId === line.id,
      );
      const weightGrams = line.grams * scale * options.servings;
      if (
        !available?.confirmed ||
        available.availability === "missing" ||
        excludedFamilies.has(item.familyId) ||
        item.allergens.some((allergen) => allergens.has(allergen)) ||
        (diets.has("vegan") && !item.vegan) ||
        (diets.has("vegetarian") && !item.vegetarian) ||
        weightGrams > 10_000
      ) {
        feasible = false;
        break;
      }
      // Only weighed grams prove sufficiency. No guessed count weights or ml-to-g density.
      if (available.quantityUnit === "g" && available.quantity !== null) {
        if (available.quantity < weightGrams) {
          feasible = false;
          break;
        }
        if (available.availability !== "confirmed") needsQuantityCheck = true;
      } else needsQuantityCheck = true;
      lines.push({
        ingredientId: item.id,
        preparationState: item.preparationState,
        weightGrams,
      });
    }
    if (!feasible) continue;
    const plannedYield = lines.reduce((sum, line) => sum + line.weightGrams, 0);
    const nutrition = calculateRecipeNutrition(
      {
        ingredients: lines,
        servings: options.servings,
        finalYieldGrams: plannedYield,
      },
      RECIPE_NUTRITION_REFERENCES,
    );
    const { caloriesKcal, ...macros } = nutrition.perServing;
    const { caloriesKcal: calorieRangeKcal, ...rangesPerServing } =
      nutrition.rangesPerServing;
    const draft = mealRecipeDraftSchema.parse({
      version: "meal-recipe-v1",
      recipeId: template.id,
      name: template.name,
      servings: options.servings,
      ingredients: lines,
      steps: [...template.steps],
      prepMinutes: template.prepMinutes,
      caloriesKcal,
      calorieRangeKcal,
      nutritionPerServing: macros,
      rangesPerServing,
      assumptions: [
        "Nutrition uses generic USDA reference foods in the listed preparation state; brands and natural variation can differ.",
        "Portion grams are the planned ingredient mass; measure the finished dish if heating changes its yield.",
        "No natural-variation confidence interval is available for these reference values.",
      ],
      warnings: [
        "Check package ingredients, allergen and cross-contact information; catalog filtering cannot guarantee allergy safety.",
        "Use safely stored ingredients. Ingredient recognition cannot establish freshness or safe storage.",
        ...(needsQuantityCheck
          ? [
              "Check you have enough: some amounts are unknown or not weighed in grams.",
            ]
          : []),
        ...(template.reheat
          ? [
              "Start with safely stored already-cooked rice and other cooked ingredients; reheat leftovers to 74°C using a food thermometer.",
            ]
          : []),
        ...(options.advisoryWarnings ?? []),
      ],
      provenance: {
        source: nutrition.estimateQuality,
        catalogRevision: RECIPE_CATALOG_REVISION,
        calculationVersion: nutrition.calculationVersion,
        generatedAt: options.now.toISOString(),
      },
    });
    recipes.push({
      draft,
      candidate: {
        recipeId: template.id,
        name: template.name,
        nutrition: macros,
        portionGrams: nutrition.portionGrams!,
        minimumPortionGrams: 50,
        maximumPortionGrams: 2000,
        preparationState: template.reheat ? "cooked" : "as_sold",
        nutritionPreparationState: template.reheat ? "cooked" : "as_sold",
        availability: needsQuantityCheck ? "check_quantity" : "confirmed",
        prepMinutes: template.prepMinutes,
        estimateQuality: nutrition.estimateQuality,
        excluded: false,
      },
    });
  }
  return {
    state: recipes.length ? "ready" : "no_feasible_recipe",
    recipes,
    clarificationReasons: [],
  };
}
