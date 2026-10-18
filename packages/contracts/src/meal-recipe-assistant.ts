import { z } from "zod";

/**
 * Conversational "What can I cook?" assistant (ADR0071). A turn carries the
 * client-held conversation, the ingredients spotted so far and the current
 * ideas; the server keeps no conversation. Nutrition in ideas is an AI
 * estimate and never becomes authoritative without the editable meal form.
 */
export const RECIPE_ASSISTANT_VERSION = "meal-recipe-assistant-v1" as const;
export const RECIPE_ASSISTANT_MAX_MESSAGES = 12;
export const RECIPE_ASSISTANT_MAX_MESSAGE_LENGTH = 1_000;
export const RECIPE_ASSISTANT_MAX_INGREDIENTS = 40;
export const RECIPE_ASSISTANT_MAX_IDEAS = 3;
export const RECIPE_ASSISTANT_MAX_TURN_BYTES = 24_576;

const text = (max: number) => z.string().trim().min(1).max(max);
const estimate = z.number().finite().nonnegative().max(10_000).nullable();

export const recipeAssistantMessageSchema = z
  .object({
    role: z.enum(["user", "assistant"]),
    text: text(RECIPE_ASSISTANT_MAX_MESSAGE_LENGTH),
  })
  .strict();

export const recipeAssistantIdeaSchema = z
  .object({
    ideaId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/),
    name: text(80),
    summary: text(240),
    prepMinutes: z.number().int().min(1).max(240),
    servings: z.number().int().min(1).max(8),
    ingredients: z
      .array(
        z
          .object({
            name: text(80),
            amount: z.string().trim().max(40),
            fromPhoto: z.boolean(),
          })
          .strict(),
      )
      .min(1)
      .max(15),
    steps: z.array(text(300)).min(1).max(10),
    /** Per serving; AI estimates, not catalog-verified nutrition. */
    estimatePerServing: z
      .object({
        caloriesKcal: estimate,
        proteinG: estimate,
        carbohydrateG: estimate,
        fatG: estimate,
      })
      .strict(),
    warnings: z.array(text(200)).max(3),
  })
  .strict();

export const recipeAssistantTurnSchema = z
  .object({
    version: z.literal(RECIPE_ASSISTANT_VERSION),
    requestId: z.string().uuid(),
    ingredients: z.array(text(80)).max(RECIPE_ASSISTANT_MAX_INGREDIENTS),
    ideas: z.array(recipeAssistantIdeaSchema).max(RECIPE_ASSISTANT_MAX_IDEAS),
    /** Oldest first. A turn without photos must end with a user message. */
    messages: z
      .array(recipeAssistantMessageSchema)
      .max(RECIPE_ASSISTANT_MAX_MESSAGES),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      new TextEncoder().encode(JSON.stringify(value)).byteLength >
      RECIPE_ASSISTANT_MAX_TURN_BYTES
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Assistant turn exceeds byte limit",
      });
    const names = value.ideas.map((idea) => idea.ideaId);
    if (new Set(names).size !== names.length)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Duplicate idea identifiers",
      });
  });

export const recipeAssistantReplySchema = z
  .object({
    version: z.literal(RECIPE_ASSISTANT_VERSION),
    requestId: z.string().uuid(),
    reply: text(RECIPE_ASSISTANT_MAX_MESSAGE_LENGTH),
    ingredients: z.array(text(80)).max(RECIPE_ASSISTANT_MAX_INGREDIENTS),
    ideas: z.array(recipeAssistantIdeaSchema).max(RECIPE_ASSISTANT_MAX_IDEAS),
  })
  .strict()
  .superRefine((value, ctx) => {
    const names = value.ideas.map((idea) => idea.ideaId);
    if (new Set(names).size !== names.length)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Duplicate idea identifiers",
      });
  });

export type RecipeAssistantMessage = z.infer<
  typeof recipeAssistantMessageSchema
>;
export type RecipeAssistantIdea = z.infer<typeof recipeAssistantIdeaSchema>;
export type RecipeAssistantTurn = z.infer<typeof recipeAssistantTurnSchema>;
export type RecipeAssistantReply = z.infer<typeof recipeAssistantReplySchema>;
