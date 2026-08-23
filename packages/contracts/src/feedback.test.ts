import { describe, expect, it } from "vitest";
import {
  createFeedbackSchema,
  feedbackCategorySchema,
  feedbackItemSchema,
  feedbackRatingSchema,
} from "./feedback.js";

describe("feedback contracts", () => {
  it("validates allowed feedback categories", () => {
    expect(feedbackCategorySchema.safeParse("like").success).toBe(true);
    expect(feedbackCategorySchema.safeParse("dislike").success).toBe(true);
    expect(feedbackCategorySchema.safeParse("change").success).toBe(true);
    expect(feedbackCategorySchema.safeParse("bug").success).toBe(true);
    expect(feedbackCategorySchema.safeParse("general").success).toBe(true);
    expect(feedbackCategorySchema.safeParse("invalid").success).toBe(false);
  });

  it("validates ratings between 1 and 5 or null", () => {
    expect(feedbackRatingSchema.safeParse(1).success).toBe(true);
    expect(feedbackRatingSchema.safeParse(5).success).toBe(true);
    expect(feedbackRatingSchema.safeParse(null).success).toBe(true);
    expect(feedbackRatingSchema.safeParse(0).success).toBe(false);
    expect(feedbackRatingSchema.safeParse(6).success).toBe(false);
    expect(feedbackRatingSchema.safeParse(3.5).success).toBe(false);
  });

  it("parses valid feedback creation payload", () => {
    const parsed = createFeedbackSchema.safeParse({
      category: "like",
      rating: 5,
      message: "The coach features are amazing!",
      context: { platform: "ios", version: "1.0.0" },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.category).toBe("like");
      expect(parsed.data.rating).toBe(5);
      expect(parsed.data.message).toBe("The coach features are amazing!");
      expect(parsed.data.context).toEqual({
        platform: "ios",
        version: "1.0.0",
      });
    }
  });

  it("defaults rating to null and context to empty object if omitted", () => {
    const parsed = createFeedbackSchema.safeParse({
      category: "change",
      message: "Please add barcode scanning in the future.",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.rating).toBeNull();
      expect(parsed.data.context).toEqual({});
    }
  });

  it("rejects empty message or whitespace-only message", () => {
    expect(
      createFeedbackSchema.safeParse({
        category: "bug",
        message: "",
      }).success,
    ).toBe(false);
    expect(
      createFeedbackSchema.safeParse({
        category: "bug",
        message: "   ",
      }).success,
    ).toBe(false);
  });

  it("rejects message exceeding 4000 characters", () => {
    expect(
      createFeedbackSchema.safeParse({
        category: "general",
        message: "a".repeat(4001),
      }).success,
    ).toBe(false);
  });

  it("validates feedback item wire representation", () => {
    const item = {
      id: "11111111-1111-4111-8111-111111111111",
      userId: "22222222-2222-4222-8222-222222222222",
      category: "dislike",
      rating: 2,
      message: "Dark mode has low contrast on some text.",
      context: {},
      createdAt: "2026-08-24T12:00:00.000Z",
    };
    expect(feedbackItemSchema.safeParse(item).success).toBe(true);
  });
});
