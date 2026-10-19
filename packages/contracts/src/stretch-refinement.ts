import { z } from "zod";

/**
 * AI refinement of the evening stretch session (#298, ADR-0076). The app
 * sends today's finished training; the server builds the deterministic
 * plan, asks the model to choose catalog stretches from the allowed list
 * and returns only stretch ids, holds and focus muscles. Instructions
 * always come from the catalog on the device, which re-validates the
 * plan and falls back to its deterministic plan on any error.
 */

export const STRETCH_REFINE_MAX_EXERCISES = 40;

export const stretchRefineRequestSchema = z
  .object({
    exercises: z
      .array(
        z
          .object({
            name: z
              .string()
              .trim()
              .min(1)
              .max(120)
              .regex(/^[^\p{Cc}]*$/u),
            setCount: z.number().int().min(0).max(100),
          })
          .strict(),
      )
      .max(STRETCH_REFINE_MAX_EXERCISES),
    activities: z
      .array(z.enum(["running", "bouldering"]))
      .max(2)
      .refine((list) => new Set(list).size === list.length, {
        message: "activities must be distinct",
      }),
  })
  .strict()
  .refine((body) => body.exercises.length > 0 || body.activities.length > 0, {
    message: "at least one exercise or activity is required",
  });

export type StretchRefineRequest = z.infer<typeof stretchRefineRequestSchema>;

const muscleSchema = z.string().trim().min(1).max(40);

export const stretchRefinedPlanSchema = z
  .object({
    focusMuscles: z.array(muscleSchema).max(4),
    steps: z
      .array(
        z
          .object({
            exerciseId: z.string().min(1).max(120),
            holdSeconds: z.number().int().min(20).max(45),
          })
          .strict(),
      )
      .min(3)
      .max(6),
  })
  .strict();

export type StretchRefinedPlan = z.infer<typeof stretchRefinedPlanSchema>;

export const stretchRefineResponseSchema = z
  .object({
    /** Unusable model output is an error; the app keeps its own plan. */
    plan: stretchRefinedPlanSchema,
    provenance: z
      .object({
        provider: z.string().min(1).max(40),
        model: z.string().min(1).max(120),
        promptVersion: z.string().min(1).max(60),
      })
      .strict(),
    /** Server-side correlation id for log tracing. */
    requestId: z.string().min(1),
  })
  .strict();

export type StretchRefineResponse = z.infer<typeof stretchRefineResponseSchema>;
