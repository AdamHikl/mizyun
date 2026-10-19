import { describe, expect, it } from "vitest";

import {
  stretchRefineRequestSchema,
  stretchRefineResponseSchema,
} from "./stretch-refinement";

describe("stretchRefineRequestSchema", () => {
  const valid = {
    exercises: [{ name: "Chest Dips", setCount: 3 }],
    activities: ["running"],
  };

  it("accepts today's training", () => {
    expect(stretchRefineRequestSchema.safeParse(valid).success).toBe(true);
  });

  it.each([
    ["no training", { ...valid, exercises: [], activities: [] }],
    ["unknown keys", { ...valid, extra: true }],
    [
      "control characters",
      { ...valid, exercises: [{ name: "a\nb", setCount: 1 }] },
    ],
    [
      "too many sets",
      { ...valid, exercises: [{ name: "Dips", setCount: 101 }] },
    ],
    ["repeated activities", { ...valid, activities: ["running", "running"] }],
    ["unknown activity", { ...valid, activities: ["swimming"] }],
    [
      "too many exercises",
      {
        ...valid,
        exercises: Array.from({ length: 41 }, (_, i) => ({
          name: `E${i}`,
          setCount: 1,
        })),
      },
    ],
  ])("rejects %s", (_label, body) => {
    expect(stretchRefineRequestSchema.safeParse(body).success).toBe(false);
  });
});

describe("stretchRefineResponseSchema", () => {
  const step = (exerciseId: string) => ({ exerciseId, holdSeconds: 30 });
  const valid = {
    plan: { focusMuscles: ["chest"], steps: [step("a"), step("b"), step("c")] },
    provenance: { provider: "gemini", model: "m", promptVersion: "v" },
    requestId: "r",
  };

  it("accepts a refined plan", () => {
    expect(stretchRefineResponseSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects holds outside 20-45 s and plans outside 3-6 stretches", () => {
    expect(
      stretchRefineResponseSchema.safeParse({
        ...valid,
        plan: { ...valid.plan, steps: [step("a"), step("b")] },
      }).success,
    ).toBe(false);
    expect(
      stretchRefineResponseSchema.safeParse({
        ...valid,
        plan: {
          ...valid.plan,
          steps: [step("a"), step("b"), { exerciseId: "c", holdSeconds: 60 }],
        },
      }).success,
    ).toBe(false);
  });
});
