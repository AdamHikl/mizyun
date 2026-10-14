import { z } from "zod";
import {
  mealRecipePreparationStateSchema,
  mealRecipeMacroContextSchema,
  mealRecipeInputSchema,
  mealRecipeDraftSchema,
  mealRecipeCandidateSchema,
  mealRecipeRankResultSchema,
} from "./meal-recipe";

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
const revision = z.string().trim().min(1).max(128);
const nutrient = z.number().finite().min(0).max(10_000).nullable();
const bounded = <T extends z.ZodTypeAny>(
  schema: T,
  maximum: number,
): z.ZodEffects<T, z.output<T>, z.input<T>> =>
  schema.superRefine((value, ctx) => {
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > maximum)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Recipe session exceeds byte limit",
      });
  });

export const mealRecipeSessionCatalogItemSchema = z
  .object({
    id,
    name: z.string().trim().min(1).max(160),
    familyId: id,
    preparationState: mealRecipePreparationStateSchema,
    per100g: z
      .object({
        caloriesKcal: nutrient,
        proteinG: nutrient,
        carbohydrateG: nutrient,
        fatG: nutrient,
      })
      .strict(),
    allergens: z.array(z.string().trim().min(1).max(80)).max(30),
    vegan: z.boolean(),
    vegetarian: z.boolean(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.vegan && !value.vegetarian)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Vegan catalog item must be vegetarian",
      });
    if (new Set(value.allergens).size !== value.allergens.length)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Duplicate allergens",
      });
  });
export const mealRecipeSessionContextSchema = bounded(
  z
    .object({
      version: z.literal("meal-recipe-v1"),
      catalogRevision: revision,
      catalog: z.array(mealRecipeSessionCatalogItemSchema).min(1).max(100),
      context: mealRecipeMacroContextSchema,
    })
    .strict()
    .superRefine((value, ctx) => {
      if (
        new Set(value.catalog.map((item) => item.id)).size !==
        value.catalog.length
      )
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Duplicate catalog IDs",
        });
    }),
  16_384,
);
export const mealRecipeRevalidationRequestSchema = bounded(
  z
    .object({
      version: z.literal("meal-recipe-v1"),
      catalogRevision: revision,
      input: mealRecipeInputSchema,
      servings: z.number().int().min(1).max(12),
      recipeIds: z.array(id).min(1).max(3),
    })
    .strict()
    .superRefine((value, ctx) => {
      if (new Set(value.recipeIds).size !== value.recipeIds.length)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Duplicate recipe IDs",
        });
    }),
  32_768,
);
export const mealRecipeRevalidationResponseSchema = bounded(
  z
    .object({
      version: z.literal("meal-recipe-v1"),
      catalogRevision: revision,
      recipes: z.array(mealRecipeDraftSchema).min(1).max(3),
      candidates: z.array(mealRecipeCandidateSchema).min(1).max(3),
      ranking: mealRecipeRankResultSchema,
    })
    .strict()
    .superRefine((value, ctx) => {
      const ids = value.recipes.map((recipe) => recipe.recipeId);
      if (
        new Set(ids).size !== ids.length ||
        value.ranking.rejected.length ||
        ids.length !== value.candidates.length ||
        ids.length !== value.ranking.ranked.length ||
        value.recipes.some((recipe, index) => {
          const candidate = value.candidates[index];
          return (
            recipe.provenance.catalogRevision !== value.catalogRevision ||
            candidate?.recipeId !== recipe.recipeId ||
            value.ranking.ranked[index]?.recipeId !== recipe.recipeId ||
            candidate.name !== recipe.name ||
            candidate.prepMinutes !== recipe.prepMinutes ||
            candidate.excluded ||
            candidate.availability === "missing" ||
            ["proteinG", "carbohydrateG", "fatG"].some(
              (key) =>
                candidate.nutrition[key as keyof typeof candidate.nutrition] !==
                recipe.nutritionPerServing[
                  key as keyof typeof recipe.nutritionPerServing
                ],
            )
          );
        })
      )
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Inconsistent validated recipes, candidates or ranking",
        });
    }),
  16_384,
);
export type MealRecipeSessionContext = z.infer<
  typeof mealRecipeSessionContextSchema
>;
export type MealRecipeSessionCatalogItem = z.infer<
  typeof mealRecipeSessionCatalogItemSchema
>;
export type MealRecipeRevalidationRequest = z.infer<
  typeof mealRecipeRevalidationRequestSchema
>;
export type MealRecipeRevalidationResponse = z.infer<
  typeof mealRecipeRevalidationResponseSchema
>;

/** Pending cooking content only; durable consumed-meal mutations remain in their own lifecycle. */
export const recipeSessionRecoverySchema = bounded(
  z
    .object({
      version: z.literal("recipe-session-v1"),
      updatedAt: z.number().int().min(0),
      expiresAt: z.number().int().positive(),
      input: mealRecipeInputSchema.nullable(),
      result: mealRecipeRevalidationResponseSchema.nullable(),
      selectedRecipeId: id.nullable(),
      portion: z.number().finite().min(0.5).max(2),
      operationId: z.string().uuid().nullable(),
      handoffOpened: z.boolean(),
      pendingRequestId: z.string().uuid().nullable(),
    })
    .strict()
    .superRefine((value, ctx) => {
      if (
        (value.handoffOpened && value.operationId === null) ||
        value.expiresAt <= value.updatedAt ||
        value.expiresAt - value.updatedAt > 86_400_000
      )
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Invalid pending recipe expiry",
        });
      if (
        value.selectedRecipeId !== null &&
        !value.result?.recipes.some(
          (recipe) => recipe.recipeId === value.selectedRecipeId,
        )
      )
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Selected recipe is absent from validated result",
        });
    }),
  16_384,
);
export const recipeSessionEnvelopeSchema = z
  .object({
    owner: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/),
    data: recipeSessionRecoverySchema,
  })
  .strict();
export type RecipeSessionRecovery = z.infer<typeof recipeSessionRecoverySchema>;
