import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RECIPE_CATALOG_DATA, RECIPE_CATALOG_REVISION } from "./catalog-data";
import { calculateRecipeNutrition } from "@mizyun/core";
const manifest = JSON.parse(
  readFileSync(new URL("./catalog-source.json", import.meta.url), "utf8"),
);
const evidence = JSON.parse(
  readFileSync(new URL("./data/source-records.json", import.meta.url), "utf8"),
);
describe("pinned ingredient catalog provenance", () => {
  it("pins the public USDA archive, release, units and member checksums", () => {
    expect(manifest.catalogRevision).toBe(RECIPE_CATALOG_REVISION);
    expect(manifest.archiveSha256).toBe(
      "b80817294b8850530aaedf2e515c02593b1824f763a0ff356e5c2081643e6fd0",
    );
    expect(manifest.sourceUrl).toBe(
      "https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip",
    );
    expect(manifest.datasetRelease).toBe("2018-04");
    expect(manifest.basis).toMatchObject({
      quantity: 100,
      unit: "g",
      part: "edible portion",
    });
    expect(manifest.ingredientCount).toBe(29);
    expect(manifest.members).toHaveLength(4);
    expect(
      manifest.members.every((item: { sha256: string }) =>
        /^[0-9a-f]{64}$/.test(item.sha256),
      ),
    ).toBe(true);
    expect(
      manifest.nutrients.map((item: { nutrientId: number }) => item.nutrientId),
    ).toEqual([1008, 1003, 1005, 1004]);
  });
  it("matches every food ID, description and nutrient to retained original source rows", () => {
    expect(evidence.archiveSha256).toBe(manifest.archiveSha256);
    expect(new Set(RECIPE_CATALOG_DATA.map((item) => item.id)).size).toBe(29);
    expect(new Set(RECIPE_CATALOG_DATA.map((item) => item.fdcId)).size).toBe(
      29,
    );
    for (const item of RECIPE_CATALOG_DATA) {
      const record = evidence.records.find(
        (row: { ingredientId: string }) => row.ingredientId === item.id,
      );
      expect(record.food.fdc_id).toBe(String(item.fdcId));
      expect(record.food.data_type).toBe("sr_legacy_food");
      expect(record.food.description).toBe(item.sourceDescription);
      expect(record.food.publication_date).toBe("2019-04-01");
      expect(record.foodNutrients).toHaveLength(4);
      for (const nutrient of manifest.nutrients) {
        const row = record.foodNutrients.find(
          (row: { nutrient_id: string }) =>
            row.nutrient_id === String(nutrient.nutrientId),
        );
        expect(row.fdc_id).toBe(String(item.fdcId));
        expect(item.per100g[nutrient.field as keyof typeof item.per100g]).toBe(
          Number(row.amount),
        );
        expect(nutrient.dictionaryRecord.unit_name).toBe(nutrient.unit);
      }
    }
  });
  it("preserves numeric zeros, source preparation and application review metadata", () => {
    expect(
      RECIPE_CATALOG_DATA.find((item) => item.id === "olive-oil")!.per100g,
    ).toEqual({ caloriesKcal: 884, proteinG: 0, carbohydrateG: 0, fatG: 100 });
    for (const item of RECIPE_CATALOG_DATA) {
      expect(
        calculateRecipeNutrition(
          {
            servings: 1,
            finalYieldGrams: 100,
            ingredients: [
              {
                ingredientId: item.id,
                preparationState: item.preparationState,
                weightGrams: 100,
              },
            ],
          },
          RECIPE_CATALOG_DATA,
        ).perServing,
      ).toEqual(item.per100g);
      expect(item.vegan && !item.vegetarian).toBe(false);
      if (item.familyId === "egg") expect(item.allergens).toContain("eggs");
      if (item.familyId === "greek-yogurt")
        expect(item.allergens).toContain("milk");
      if (item.familyId === "tofu") expect(item.allergens).toContain("soy");
    }
    expect(manifest.reviewNotes.join(" ")).toContain("not USDA certification");
    expect(manifest.reviewNotes.join(" ")).toContain(
      "Qualified nutrition and food-safety review remains required",
    );
  });
});
