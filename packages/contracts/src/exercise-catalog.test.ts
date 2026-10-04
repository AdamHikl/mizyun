import { describe, expect, it } from "vitest";
import {
  exerciseCatalogItemSchema,
  exerciseCatalogQuerySchema,
} from "./exercise";

const oldItem = {
  id: "example",
  name: "Example",
  movementPattern: "core",
  equipment: [],
  blockedBy: [],
  focusFit: ["balanced"],
  primaryMuscles: [],
  secondaryMuscles: [],
  instructions: ["Start with control."],
  category: "strength",
  level: "beginner",
  mechanic: null,
};

describe("exercise catalog compatibility", () => {
  it("accepts older responses without new source or animation fields", () => {
    expect(exerciseCatalogItemSchema.safeParse(oldItem).success).toBe(true);
  });

  it("preserves pending future media and rejects incomplete rights records", () => {
    expect(
      exerciseCatalogItemSchema.parse({ ...oldItem, demonstration: null })
        .demonstration,
    ).toBeNull();
    expect(
      exerciseCatalogItemSchema.safeParse({
        ...oldItem,
        demonstration: {
          variantId: "example",
          assets: [
            {
              id: "demo",
              kind: "animation",
              uri: "https://example.com/demo.gif",
            },
          ],
        },
      }).success,
    ).toBe(false);
    expect(
      exerciseCatalogItemSchema.safeParse({
        ...oldItem,
        demonstration: { variantId: "different-variant", assets: [] },
      }).success,
    ).toBe(false);
    expect(
      exerciseCatalogItemSchema.safeParse({
        ...oldItem,
        contentReview: { status: "accepted", reviewedAt: null },
      }).success,
    ).toBe(false);
  });

  it("validates bounded pages and nonnegative integer offsets", () => {
    expect(
      exerciseCatalogQuerySchema.parse({ offset: "200", limit: "200" }),
    ).toEqual({ offset: 200, limit: 200 });
    expect(exerciseCatalogQuerySchema.safeParse({ offset: "-1" }).success).toBe(
      false,
    );
    expect(
      exerciseCatalogQuerySchema.safeParse({ offset: "0.5" }).success,
    ).toBe(false);
    expect(exerciseCatalogQuerySchema.safeParse({ limit: "201" }).success).toBe(
      false,
    );
  });
});
