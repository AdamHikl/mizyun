import { describe, expect, it } from "vitest";
import { mealIllustrationResponseSchema } from "./meal-illustration.js";
describe("decorative illustration wire boundary", () => {
  it("permits pending/unavailable and ready bounded raster bytes", () => {
    expect(
      mealIllustrationResponseSchema.safeParse({ status: "pending" }).success,
    ).toBe(true);
    expect(
      mealIllustrationResponseSchema.safeParse({ status: "unavailable" })
        .success,
    ).toBe(true);
    expect(
      mealIllustrationResponseSchema.safeParse({
        status: "ready",
        image: { key: "a".repeat(64), base64: "AQID", mimeType: "image/jpeg" },
      }).success,
    ).toBe(true);
  });
  it("rejects leaked cache metadata, URLs, absent ready bytes, and unbounded content", () => {
    expect(
      mealIllustrationResponseSchema.safeParse({
        status: "pending",
        userId: "other",
      }).success,
    ).toBe(false);
    expect(
      mealIllustrationResponseSchema.safeParse({ status: "ready" }).success,
    ).toBe(false);
    expect(
      mealIllustrationResponseSchema.safeParse({
        status: "ready",
        image: {
          key: "a".repeat(64),
          base64: "A".repeat(349_529),
          mimeType: "image/jpeg",
        },
      }).success,
    ).toBe(false);
    expect(
      mealIllustrationResponseSchema.safeParse({
        status: "ready",
        image: {
          key: "a".repeat(64),
          url: "https://example.test/private",
          mimeType: "image/jpeg",
        },
      }).success,
    ).toBe(false);
  });
});
