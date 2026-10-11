import { describe, expect, it } from "vitest";
import { normalizeMealIllustrationName } from "./meal-illustration.js";
describe("private dish cache normalization", () => {
  it("reuses the same dish across case/spacing/amounts without sending quantity", () => {
    expect(normalizeMealIllustrationName("  Bryndzové  Halušky 250 g ")).toBe(
      "bryndzové halušky",
    );
    expect(normalizeMealIllustrationName("BRYNDZOVÉ HALUŠKY 0.5 kg")).toBe(
      "bryndzové halušky",
    );
    expect(normalizeMealIllustrationName("Soup 250ml")).toBe("soup");
    expect(normalizeMealIllustrationName("Ham & Eggs")).toBe("ham and eggs");
  });
  it("rejects notes, dates, arbitrary fields, excessive names, and numeric/time content", () => {
    expect(normalizeMealIllustrationName("Meal 2026-10-09")).toBeNull();
    expect(normalizeMealIllustrationName("Lunch 12:30")).toBeNull();
    expect(normalizeMealIllustrationName("Soup; notes: diabetes")).toBeNull();
    expect(normalizeMealIllustrationName("a".repeat(101))).toBeNull();
    expect(normalizeMealIllustrationName(" ")).toBeNull();
  });
});
