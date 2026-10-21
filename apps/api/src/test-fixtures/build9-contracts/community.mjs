import { z } from "./zod-runtime.mjs";
export const workoutCategorySchema = z.enum([
  "strength",
  "running",
  "cycling",
  "hiit",
  "mobility",
  "walking",
  "other",
]);
export const communityReactionKindSchema = z.enum([
  "clap",
  "fire",
  "high_five",
  "fist_bump",
  "thumbs_up",
]);
export const sharedWorkoutDetailsSchema = z
  .object({
    exercises: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(120),
            sets: z
              .array(
                z
                  .object({
                    setType: z.enum(["normal", "warmup", "drop", "failure"]),
                    repetitions: z.number().min(0).max(9999.99).nullable(),
                    loadKg: z.number().min(0).max(9999.999).nullable(),
                    durationSeconds: z
                      .number()
                      .int()
                      .min(0)
                      .max(86400)
                      .nullable(),
                  })
                  .strict(),
              )
              .min(1)
              .max(500),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .refine(
    (value) => value.exercises.reduce((n, e) => n + e.sets.length, 0) <= 500,
    "At most 500 completed sets can be shared",
  );
export const sharedActivityFeedItemDtoSchema = z.object({
  id: z.string().uuid(),
  authorUserId: z.string().uuid(),
  authorHandle: z.string(),
  authorDisplayName: z.string(),
  authorAvatarSymbol: z.string(),
  category: workoutCategorySchema,
  sharedDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  durationSeconds: z.number().int().nonnegative().nullable(),
  workoutDetails: sharedWorkoutDetailsSchema.nullable().default(null),
  publishedAt: z.string().datetime(),
  reactionCounts: z.record(
    communityReactionKindSchema,
    z.number().int().nonnegative(),
  ),
  viewerReaction: communityReactionKindSchema.nullable(),
});
export const authorSharedActivityDtoSchema =
  sharedActivityFeedItemDtoSchema.extend({
    sourceWorkoutId: z.string().uuid(),
    version: z.number().int().positive(),
    revokedAt: z.string().datetime().nullable(),
  });
export const communityFeedResponseSchema = z.object({
  items: z.array(sharedActivityFeedItemDtoSchema),
  nextCursor: z.string().nullable().optional(),
});
