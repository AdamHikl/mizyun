import { describe, expect, it } from "vitest";
import { validateFeedback, type NewFeedback } from "./feedback.js";

describe("feedback domain validation", () => {
  it("passes validation for valid feedback", () => {
    const input: NewFeedback = {
      category: "like",
      rating: 5,
      message: "The new workout logger is super smooth!",
      context: { screen: "dashboard" },
    };
    expect(validateFeedback(input)).toBeNull();
  });

  it("passes validation for feedback with null/omitted rating", () => {
    const input: NewFeedback = {
      category: "change",
      message: "Could we have dark/light theme toggle in settings?",
    };
    expect(validateFeedback(input)).toBeNull();
  });

  it("fails validation for invalid category", () => {
    const input = {
      category: "unknown_category" as unknown as NewFeedback["category"],
      message: "Hello",
    };
    expect(validateFeedback(input)).toEqual({
      kind: "invalid_category",
      received: "unknown_category",
    });
  });

  it("fails validation for out-of-range rating", () => {
    expect(
      validateFeedback({
        category: "general",
        rating: 0,
        message: "Bad",
      }),
    ).toEqual({
      kind: "rating_out_of_range",
      received: 0,
    });

    expect(
      validateFeedback({
        category: "general",
        rating: 6,
        message: "Super",
      }),
    ).toEqual({
      kind: "rating_out_of_range",
      received: 6,
    });

    expect(
      validateFeedback({
        category: "general",
        rating: 4.5,
        message: "Half",
      }),
    ).toEqual({
      kind: "rating_out_of_range",
      received: 4.5,
    });
  });

  it("fails validation for empty or whitespace-only message", () => {
    expect(
      validateFeedback({
        category: "bug",
        message: "",
      }),
    ).toEqual({ kind: "empty_message" });

    expect(
      validateFeedback({
        category: "bug",
        message: "   \n\t  ",
      }),
    ).toEqual({ kind: "empty_message" });
  });

  it("fails validation for message exceeding 4000 characters", () => {
    expect(
      validateFeedback({
        category: "general",
        message: "x".repeat(4001),
      }),
    ).toEqual({
      kind: "message_too_long",
      length: 4001,
    });
  });
});
