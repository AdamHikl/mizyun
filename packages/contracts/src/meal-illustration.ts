import { z } from "zod";

export const mealIllustrationImageSchema = z
  .object({
    base64: z
      .string()
      .min(4)
      .max(349_528)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/),
    mimeType: z.literal("image/jpeg"),
    key: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export const mealIllustrationResponseSchema = z.discriminatedUnion("status", [
  z
    .object({ status: z.literal("ready"), image: mealIllustrationImageSchema })
    .strict(),
  z.object({ status: z.literal("pending") }).strict(),
  z.object({ status: z.literal("unavailable") }).strict(),
]);
export type MealIllustrationResponse = z.infer<
  typeof mealIllustrationResponseSchema
>;
export const mealIllustrationCapabilitySchema = z
  .object({ available: z.boolean() })
  .strict();
export type MealIllustrationCapability = z.infer<
  typeof mealIllustrationCapabilitySchema
>;

export const exportedMealIllustrationSchema = z
  .object({
    id: z.string().uuid(),
    userId: z.string().uuid(),
    sourceEntryId: z.string().uuid(),
    key: z.string().regex(/^[a-f0-9]{64}$/),
    state: z.enum(["generating", "ready", "failed", "unknown"]),
    createdAt: z.string().datetime(),
    leaseUntil: z.string().datetime(),
    image: mealIllustrationImageSchema.nullable(),
  })
  .strict()
  .refine(
    (value) => (value.state === "ready") === (value.image !== null),
    "Ready illustration requires image bytes",
  );

export const exportedMealIllustrationUsageSchema = z
  .object({
    userId: z.string().uuid(),
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    attempts: z.number().int().nonnegative(),
  })
  .strict();
