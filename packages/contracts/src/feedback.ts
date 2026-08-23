import { z } from "zod";

/**
 * Feedback category classifying the type of input submitted by the user.
 * - "like": Things the user loves or works well.
 * - "dislike": Friction, confusion, or things they dislike.
 * - "change": Ideas, feature requests, or suggested improvements.
 * - "bug": Broken behavior, crashes, or bugs.
 * - "general": General reviews or open thoughts.
 */
export const feedbackCategorySchema = z.enum([
  "like",
  "dislike",
  "change",
  "bug",
  "general",
]);

export type FeedbackCategory = z.infer<typeof feedbackCategorySchema>;

/**
 * Optional 1-5 star rating for reviews or satisfaction scores.
 */
export const feedbackRatingSchema = z
  .number()
  .int("Rating must be an integer")
  .min(1, "Rating must be between 1 and 5")
  .max(5, "Rating must be between 1 and 5")
  .nullable();

export type FeedbackRating = z.infer<typeof feedbackRatingSchema>;

/**
 * Wire schema for creating a user feedback / review entry.
 */
export const createFeedbackSchema = z
  .object({
    category: feedbackCategorySchema,
    rating: feedbackRatingSchema.optional().default(null),
    message: z
      .string()
      .trim()
      .min(1, "Message cannot be empty")
      .max(4000, "Message cannot exceed 4000 characters"),
    context: z.record(z.unknown()).optional().default({}),
  })
  .strict();

export type CreateFeedbackInput = z.input<typeof createFeedbackSchema>;
export type CreateFeedbackBody = z.infer<typeof createFeedbackSchema>;

/**
 * Wire schema representing a stored user feedback item.
 */
export const feedbackItemSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  category: feedbackCategorySchema,
  rating: feedbackRatingSchema,
  message: z.string(),
  context: z.record(z.unknown()),
  createdAt: z.string().datetime(),
});

export type FeedbackItem = z.infer<typeof feedbackItemSchema>;

export const createFeedbackResponseSchema = z.object({
  feedback: feedbackItemSchema,
});

export type CreateFeedbackResponse = z.infer<
  typeof createFeedbackResponseSchema
>;

export const listFeedbackResponseSchema = z.object({
  feedback: z.array(feedbackItemSchema),
});

export type ListFeedbackResponse = z.infer<typeof listFeedbackResponseSchema>;
