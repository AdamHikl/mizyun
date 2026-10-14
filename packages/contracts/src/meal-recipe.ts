import { z } from "zod";

/** REC-01 wire bounds; catalog ownership and nutrition computation are server duties. */
export const MEAL_RECIPE_MAX_RESPONSE_BYTES = 16_384;
const id = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const text = (max: number) => z.string().trim().min(1).max(max);
const grams = z.number().finite().min(0).max(10_000);
const signedGrams = z.number().finite().min(-10_000).max(10_000);
const weight = z.number().finite().positive().max(10_000);
const portionWeight = z.number().finite().min(50).max(2_000);
const macroKeys = ["proteinG", "carbohydrateG", "fatG"] as const;
export const mealRecipePreparationStateSchema = z.enum([
  "raw",
  "cooked",
  "as_sold",
]);
export const mealRecipeMacroGramsSchema = z
  .object({
    proteinG: grams.nullable(),
    carbohydrateG: grams.nullable(),
    fatG: grams.nullable(),
  })
  .strict();
const signedMacroSchema = z
  .object({
    proteinG: signedGrams.nullable(),
    carbohydrateG: signedGrams.nullable(),
    fatG: signedGrams.nullable(),
  })
  .strict();
const localDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return (
      Number.isFinite(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  }, "Invalid calendar date");
const timeZone = z
  .string()
  .min(1)
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "Invalid time zone");
export const mealRecipeSourceSnapshotSchema = z
  .object({
    localDate,
    timeZone,
    generatedAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }),
    energyFormulaVersion: text(80),
    goalRevision: text(128),
    intakeRevision: text(128),
    constraintsRevision: text(128),
    profileRevision: text(128),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (Date.parse(value.expiresAt) <= Date.parse(value.generatedAt))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expiresAt"],
        message: "Expiry must follow generation",
      });
  });
export const mealRecipeContextReasonSchema = z.enum([
  "logged_so_far",
  "confirmed_so_far",
  "targets_unavailable",
  "intake_unknown",
  "source_incomplete",
  "source_stale",
  "no_remaining_gaps",
]);
export const mealRecipeMacroContextSchema = z
  .object({
    version: z.literal("meal-recipe-v1"),
    rankingVersion: z.literal("macro-balance-v1"),
    targets: mealRecipeMacroGramsSchema,
    consumed: mealRecipeMacroGramsSchema,
    remaining: signedMacroSchema,
    positiveGaps: mealRecipeMacroGramsSchema,
    snapshot: mealRecipeSourceSnapshotSchema,
    coverage: z.enum(["logged_so_far", "confirmed_so_far", "unknown"]),
    state: z.enum(["ready", "unknown", "stale", "no_remaining_gaps"]),
    reason: mealRecipeContextReasonSchema,
    focus: z.array(z.enum(["protein", "carbohydrate", "fat"])).max(3),
  })
  .strict()
  .superRefine((value, ctx) => {
    const issue = (message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    if (new Set(value.focus).size !== value.focus.length)
      issue("Duplicate focus");
    for (const key of macroKeys) {
      const target = value.targets[key],
        consumed = value.consumed[key];
      const expected =
        target === null || consumed === null ? null : target - consumed;
      if (
        value.remaining[key] !== expected ||
        value.positiveGaps[key] !==
          (expected === null ? null : Math.max(0, expected))
      )
        issue(`Inconsistent ${key} remaining or gap`);
    }
    if (value.state === "ready") {
      if (
        macroKeys.some((key) => value.positiveGaps[key] === null) ||
        !macroKeys.some((key) => (value.positiveGaps[key] ?? 0) > 0) ||
        value.coverage === "unknown" ||
        value.reason !== value.coverage
      )
        issue("Ready context requires known positive gaps and coverage");
      for (const focus of value.focus) {
        const key = (
          {
            protein: "proteinG",
            carbohydrate: "carbohydrateG",
            fat: "fatG",
          } as const
        )[focus];
        if ((value.positiveGaps[key] ?? 0) <= 0)
          issue("Focus requires a positive gap");
      }
    } else {
      if (value.focus.length !== 0)
        issue("Non-ready context cannot claim macro focus");
      if (value.state === "stale" && value.reason !== "source_stale")
        issue("Stale context requires source_stale reason");
      if (
        value.state === "unknown" &&
        ![
          "targets_unavailable",
          "intake_unknown",
          "source_incomplete",
        ].includes(value.reason)
      )
        issue("Unknown context requires an unavailable-source reason");
      if (
        value.state === "no_remaining_gaps" &&
        (value.reason !== "no_remaining_gaps" ||
          macroKeys.some((key) => value.positiveGaps[key] !== 0))
      )
        issue("Exhausted context requires known zero gaps");
    }
  });
export const mealRecipeCandidateSchema = z
  .object({
    recipeId: id,
    name: text(160),
    nutrition: mealRecipeMacroGramsSchema,
    portionGrams: portionWeight,
    minimumPortionGrams: portionWeight,
    maximumPortionGrams: portionWeight,
    preparationState: mealRecipePreparationStateSchema,
    nutritionPreparationState: mealRecipePreparationStateSchema,
    availability: z.enum(["confirmed", "check_quantity", "missing"]),
    prepMinutes: z.number().int().min(0).max(1_440),
    estimateQuality: z.enum(["reference", "estimated", "unknown"]),
    excluded: z.boolean(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.minimumPortionGrams > value.portionGrams ||
      value.portionGrams > value.maximumPortionGrams
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["portionGrams"],
        message: "Portion outside approved bounds",
      });
    if (
      macroKeys.reduce((sum, key) => sum + (value.nutrition[key] ?? 0), 0) >
      value.portionGrams
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["nutrition"],
        message: "Known macros exceed portion weight",
      });
    if (value.preparationState !== value.nutritionPreparationState)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["nutritionPreparationState"],
        message: "Nutrition preparation state mismatch",
      });
  });
export const mealRecipeRankResultSchema = z
  .object({
    context: mealRecipeMacroContextSchema,
    ranked: z
      .array(
        z
          .object({
            recipeId: id,
            name: text(160),
            fitLoss: z.number().finite().min(0).max(1_000_000).nullable(),
            desiredMacros: mealRecipeMacroGramsSchema,
            reason: mealRecipeContextReasonSchema,
          })
          .strict(),
      )
      .max(20),
    rejected: z
      .array(
        z
          .object({
            recipeId: id.nullable(),
            reason: z.enum([
              "invalid_candidate",
              "portion_out_of_bounds",
              "preparation_mismatch",
              "excluded",
              "missing_ingredients",
            ]),
          })
          .strict(),
      )
      .max(100),
  })
  .strict()
  .superRefine((value, ctx) => {
    const ids = value.ranked.map((item) => item.recipeId);
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Duplicate recipe IDs",
      });
    for (const item of value.ranked) {
      const invalidFit =
        item.fitLoss === null
          ? macroKeys.some((key) => item.desiredMacros[key] !== null)
          : value.context.state !== "ready" ||
            macroKeys.some((key) => item.desiredMacros[key] === null);
      if (invalidFit)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Fit loss and desired macros must share known state",
        });
      if (item.reason !== value.context.reason)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Rank reason differs from context",
        });
      if (
        value.context.state !== "ready" &&
        (item.fitLoss !== null ||
          macroKeys.some((key) => item.desiredMacros[key] !== null))
      )
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Ordinary discovery cannot claim macro fit",
        });
    }
    if (
      new TextEncoder().encode(JSON.stringify(value)).byteLength >
      MEAL_RECIPE_MAX_RESPONSE_BYTES
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Response exceeds byte limit",
      });
  });

export const mealRecipeIngredientInputSchema = z
  .object({
    ingredientId: id,
    name: text(160),
    confirmed: z.boolean(),
    preparationState: mealRecipePreparationStateSchema,
    quantity: grams.nullable(),
    quantityUnit: z.enum(["g", "ml", "count"]),
    availability: z.enum(["confirmed", "check_quantity", "missing"]),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.availability === "confirmed" &&
      (!value.confirmed || value.quantity === null || value.quantity === 0)
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Confirmed availability requires confirmed positive quantity",
      });
  });
export const mealRecipeExclusionsSchema = z
  .object({
    ingredientIds: z.array(id).max(100),
    allergens: z.array(text(80)).max(30),
    dietaryRestrictions: z.array(text(80)).max(20),
  })
  .strict();
export const mealRecipePreferencesSchema = z
  .object({
    maximumPrepMinutes: z.number().int().min(1).max(1_440).nullable(),
    mealSize: z.enum(["small", "normal", "large"]),
    cuisines: z.array(text(80)).max(10),
  })
  .strict();
export const mealRecipeInputSchema = z
  .object({
    version: z.literal("meal-recipe-v1"),
    ingredients: z.array(mealRecipeIngredientInputSchema).min(1).max(50),
    exclusions: mealRecipeExclusionsSchema,
    preferences: mealRecipePreferencesSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    const ids = value.ingredients.map((item) => item.ingredientId);
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Duplicate ingredient IDs",
      });
  });
const rangeSchema = z
  .object({ minimum: grams, maximum: grams })
  .strict()
  .refine(
    (value) => value.minimum <= value.maximum,
    "Inverted nutrition range",
  );
export const mealRecipeDraftSchema = z
  .object({
    version: z.literal("meal-recipe-v1"),
    recipeId: id,
    name: text(160),
    servings: z.number().int().min(1).max(12),
    ingredients: z
      .array(
        z
          .object({
            ingredientId: id,
            weightGrams: weight,
            preparationState: mealRecipePreparationStateSchema,
          })
          .strict(),
      )
      .min(1)
      .max(50),
    steps: z.array(text(600)).min(1).max(20),
    prepMinutes: z.number().int().min(1).max(1_440),
    caloriesKcal: z.number().finite().min(0).max(20_000).nullable(),
    calorieRangeKcal: z
      .object({
        minimum: z.number().finite().min(0).max(20_000),
        maximum: z.number().finite().min(0).max(20_000),
      })
      .strict()
      .refine(
        (value) => value.minimum <= value.maximum,
        "Inverted calorie range",
      )
      .nullable(),
    assumptions: z.array(text(300)).max(20),
    warnings: z.array(text(300)).max(20),
    nutritionPerServing: mealRecipeMacroGramsSchema,
    rangesPerServing: z
      .object({
        proteinG: rangeSchema.nullable(),
        carbohydrateG: rangeSchema.nullable(),
        fatG: rangeSchema.nullable(),
      })
      .strict(),
    provenance: z
      .object({
        source: z.enum(["reference", "estimated", "unknown"]),
        catalogRevision: text(128),
        calculationVersion: text(80),
        generatedAt: z.string().datetime({ offset: true }),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      new Set(value.ingredients.map((item) => item.ingredientId)).size !==
      value.ingredients.length
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Duplicate ingredient IDs",
      });
    if (
      value.calorieRangeKcal !== null &&
      (value.caloriesKcal === null ||
        value.caloriesKcal < value.calorieRangeKcal.minimum ||
        value.caloriesKcal > value.calorieRangeKcal.maximum)
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Calories must fall within known range",
      });
    for (const key of macroKeys) {
      const estimate = value.nutritionPerServing[key],
        range = value.rangesPerServing[key];
      if (
        range !== null &&
        (estimate === null ||
          estimate < range.minimum ||
          estimate > range.maximum)
      )
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Estimate must fall within known range",
        });
    }
    if (
      new TextEncoder().encode(JSON.stringify(value)).byteLength >
      MEAL_RECIPE_MAX_RESPONSE_BYTES
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Response exceeds byte limit",
      });
  });
export type MealRecipeMacroGrams = z.infer<typeof mealRecipeMacroGramsSchema>;
export type MealRecipeMacroContext = z.infer<
  typeof mealRecipeMacroContextSchema
>;
export type MealRecipeSourceSnapshot = z.infer<
  typeof mealRecipeSourceSnapshotSchema
>;
export type MealRecipeCandidate = z.infer<typeof mealRecipeCandidateSchema>;
export type MealRecipeRankResult = z.infer<typeof mealRecipeRankResultSchema>;
export type MealRecipeInput = z.infer<typeof mealRecipeInputSchema>;
export type MealRecipeDraft = z.infer<typeof mealRecipeDraftSchema>;
