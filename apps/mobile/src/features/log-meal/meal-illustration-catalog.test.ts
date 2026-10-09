import { describe, expect, it } from "vitest";
import { selectMealIllustration } from "./meal-illustration-catalog";

describe("automatic decorative catalog", () => {
  it.each([
    ["Chicken with rice", "chicken"],
    ["Ovsená kaša", "oatmeal"],
    ["Cestoviny s kuracím mäsom", "pasta"],
    ["Greek yogurt, 200 g", "yogurt"],
    ["Salmon salad", "salad"],
    ["Vegetable soup", "soup"],
    ["Toast sandwich", "sandwich"],
    ["Chocolate muffin", "dessert"],
  ])("matches %s without user input", (name, kind) => {
    expect(selectMealIllustration(name).kind).toBe(kind);
  });
  it("keeps repeated meals stable and excludes accidental substring matches", () => {
    expect(selectMealIllustration("OATMEAL 100g")).toEqual(
      selectMealIllustration("Oatmeal 200g"),
    );
    expect(selectMealIllustration("Pineapple").kind).toBe("meal");
    expect(selectMealIllustration("Eggplant").kind).toBe("meal");
  });
  it("always provides a neutral fallback, including empty and unfamiliar names", () => {
    for (const name of ["", "Homemade dinner", "家常菜"]) {
      expect(selectMealIllustration(name)).toEqual({
        kind: "meal",
        row: 3,
        column: 3,
        matched: false,
      });
    }
  });
});
