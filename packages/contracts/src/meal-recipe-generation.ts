import { z } from "zod";
import {
  mealRecipeInputSchema,
  mealRecipeDraftSchema,
  mealRecipeRankResultSchema,
} from "./meal-recipe";
const bounded = <T extends z.ZodTypeAny>(schema: T) =>
  schema.superRefine((value, ctx) => {
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 16_384)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Recipe response exceeds byte limit",
      });
  });
export const mealRecipeSuggestionRequestSchema = z
  .object({
    requestId: z.string().uuid(),
    input: mealRecipeInputSchema,
    servings: z.number().int().min(1).max(12),
  })
  .strict();
export const mealRecipeSuggestionResponseSchema = bounded(
  z
    .object({
      version: z.literal("meal-recipe-v1"),
      requestId: z.string().uuid(),
      recipes: z.array(mealRecipeDraftSchema).max(3),
      ranking: mealRecipeRankResultSchema,
    })
    .strict(),
);
export const ingredientRecognitionCandidateSchema = z
  .object({
    ingredientId: z
      .string()
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/)
      .nullable(),
    name: z.string().trim().min(1).max(160),
    preparationState: z.enum(["raw", "cooked", "as_sold", "unknown"]),
    confirmed: z.literal(false),
    quantity: z.null(),
    quantityUnit: z.literal("g"),
    availability: z.literal("check_quantity"),
  })
  .strict();
export const ingredientRecognitionResponseSchema = bounded(
  z
    .object({
      version: z.literal("meal-recipe-v1"),
      requestId: z.string().uuid(),
      ingredients: z.array(ingredientRecognitionCandidateSchema).max(30),
      warnings: z.array(z.string().min(1).max(300)).max(5),
    })
    .strict(),
);
export const mealRecipeCapabilitiesSchema = z
  .object({
    version: z.literal("meal-recipe-v1"),
    suggest: z.boolean(),
    recognizeIngredients: z.boolean(),
    reason: z.enum([
      "ready",
      "disabled",
      "access_required",
      "provider_unavailable",
      "durable_budget_unavailable",
    ]),
    maximumImages: z.union([z.literal(1), z.literal(3)]),
    maximumTotalImageBytes: z.literal(4_194_304),
    maximumImageDimension: z.literal(4096),
    requiresIngredientConfirmation: z.literal(true),
    requestIdRequired: z.literal(true),
  })
  .strict();
export type MealRecipeSuggestionRequest = z.infer<
  typeof mealRecipeSuggestionRequestSchema
>;
export type MealRecipeSuggestionResponse = z.infer<
  typeof mealRecipeSuggestionResponseSchema
>;
export type IngredientRecognitionResponse = z.infer<
  typeof ingredientRecognitionResponseSchema
>;
export type MealRecipeCapabilities = z.infer<
  typeof mealRecipeCapabilitiesSchema
>;

export const recipeRequestIdSchema = z.string().uuid();
export const recipeTemplateSelectionSchema = z
  .array(z.string().min(1).max(128))
  .max(3);
export const recognizedIngredientProposalSchema = z
  .array(
    z
      .object({
        ingredientId: z.string().nullable(),
        name: z.string().trim().min(1).max(160),
        preparationState: z.enum(["raw", "cooked", "as_sold", "unknown"]),
      })
      .strict(),
  )
  .max(30);
export const RECIPE_API_ERROR_CODES = [
  "ACCOUNT_DELETION_IN_PROGRESS",
  "RECIPES_DISABLED",
  "RECIPE_BUDGET_UNAVAILABLE",
  "RECIPE_PROVIDER_UNAVAILABLE",
  "RECIPE_PROVIDER_BOUNDS_INVALID",
  "RECIPE_REQUEST_CONFLICT",
  "RECIPE_REQUEST_IN_PROGRESS",
  "RECIPE_OUTCOME_UNAVAILABLE",
  "RECIPE_PROVIDER_TIMEOUT",
  "RECIPE_PROVIDER_USAGE_INVALID",
  "RECIPE_RESULT_EXPIRED",
  "RECIPE_REQUEST_UNAVAILABLE",
  "RECIPE_INGREDIENTS_NEED_REVIEW",
  "INVALID_RECIPE_REQUEST",
  "RECIPE_CONTEXT_CHANGED",
  "RECIPE_IMAGE_LIMIT",
  "INVALID_RECIPE_IMAGE",
  "INVALID_RECIPE_IMAGE_REQUEST",
  "RECIPE_PROVIDER_REFUSED",
  "RECIPE_PROVIDER_MALFORMED_OUTPUT",
  "RECIPE_LIMIT_CONSENT",
  "RECIPE_LIMIT_DELETION",
  "RECIPE_LIMIT_TOKENS",
  "RECIPE_LIMIT_DRAFTS",
  "RECIPE_LIMIT_MINUTE",
  "RECIPE_LIMIT_INFLIGHT",
  "RECIPE_LIMIT_COST_DAY",
  "RECIPE_LIMIT_COST_MONTH",
] as const;
export type RecipeApiErrorCode = (typeof RECIPE_API_ERROR_CODES)[number];
