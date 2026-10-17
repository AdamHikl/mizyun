import { describe, expect, it } from "vitest";
import { proteinIdeasFor } from "./protein-ideas";

describe("proteinIdeasFor (#293)", () => {
  it("offers vegetarian ideas including dairy and eggs", () => {
    expect(proteinIdeasFor(["vegetarian"])).toEqual([
      "Tofu or tempeh",
      "Greek yogurt or skyr",
      "Lentils or chickpeas",
      "Eggs",
    ]);
  });

  it("offers only plant foods for vegan preferences", () => {
    expect(proteinIdeasFor(["vegan"])).toEqual([
      "Tofu or tempeh",
      "Lentils or chickpeas",
      "Edamame",
      "Seitan",
    ]);
  });

  it("respects gluten-free and lactose-free preferences", () => {
    expect(proteinIdeasFor(["vegan", "gluten_free"])).not.toContain("Seitan");
    const lactoseFree = proteinIdeasFor(["vegetarian", "lactose_free"]);
    expect(lactoseFree).not.toContain("Greek yogurt or skyr");
    expect(lactoseFree).not.toContain("Cottage cheese");
    expect(lactoseFree).toContain("Eggs");
  });

  it("offers nothing for other or missing diets", () => {
    for (const preferences of [
      ["omnivore"] as const,
      ["pescatarian"] as const,
      [] as const,
      null,
      undefined,
    ]) {
      expect(proteinIdeasFor(preferences)).toEqual([]);
    }
  });
});
