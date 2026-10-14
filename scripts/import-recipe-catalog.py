#!/usr/bin/env python3
"""Import the reviewed REC-02 subset from the pinned public USDA ZIP.

No network, API key, database, or archive extraction is used. The ZIP stays outside
this repository. To reproduce: python3 scripts/import-recipe-catalog.py /tmp/rec02-sr.zip
Then format the generated JSON/TypeScript with the repository's Prettier.
"""

import argparse
import csv
import hashlib
import io
import json
from pathlib import Path
import zipfile

REVISION = "usda-sr-legacy-2018-rec02-v1"
ARCHIVE_SHA256 = "b80817294b8850530aaedf2e515c02593b1824f763a0ff356e5c2081643e6fd0"
SOURCE_URL = "https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip"
PREFIX = "FoodData_Central_sr_legacy_food_csv_2018-04/"
# Review metadata is application-owned, not USDA allergen certification.
# Fields: ID, family, FDC ID, name, state, aliases, allergen groups, vegan, vegetarian.
SELECTION = [
    ("rice-white-cooked", "rice-white", 169757, "White rice, cooked", "cooked", ["cooked white rice", "cooked rice"], [], True, True),
    ("rice-white-raw", "rice-white", 169756, "White rice, dry", "raw", ["dry white rice", "uncooked white rice"], [], True, True),
    ("chicken-breast-cooked", "chicken-breast", 171477, "Chicken breast, roasted", "cooked", ["cooked chicken breast", "roasted chicken breast"], [], False, False),
    ("chicken-breast-raw", "chicken-breast", 171077, "Chicken breast, raw", "raw", ["raw chicken breast", "uncooked chicken breast"], [], False, False),
    ("chickpeas-cooked", "chickpeas", 173757, "Chickpeas, boiled", "cooked", ["cooked chickpeas", "boiled garbanzo beans"], [], True, True),
    ("lentils-cooked", "lentils", 172421, "Lentils, boiled", "cooked", ["cooked lentils", "boiled lentils"], [], True, True),
    ("black-beans-cooked", "black-beans", 173735, "Black beans, boiled", "cooked", ["cooked black beans", "boiled black beans"], [], True, True),
    ("tofu-firm", "tofu", 172475, "Firm tofu, calcium-set", "raw", ["firm tofu", "calcium-set tofu"], ["soy"], True, True),
    ("oats-dry", "oats", 173904, "Oats, dry", "as_sold", ["dry oats", "plain dry oatmeal"], ["gluten"], True, True),
    ("oats-cooked", "oats", 173905, "Oats, cooked in water", "cooked", ["cooked oats", "plain oatmeal cooked in water"], ["gluten"], True, True),
    ("olive-oil", "olive-oil", 171413, "Olive oil", "as_sold", ["olive oil"], [], True, True),
    ("tomato-puree", "tomato-puree", 170460, "Tomato puree, canned, no added salt", "as_sold", ["canned tomato puree", "tomato puree without added salt"], [], True, True),
    ("greek-yogurt-nonfat", "greek-yogurt", 170894, "Greek yogurt, plain, nonfat", "as_sold", ["plain nonfat greek yogurt", "fat-free plain greek yogurt"], ["milk"], False, True),
    ("egg-raw", "egg", 171287, "Whole egg, raw", "raw", ["raw whole egg", "raw egg"], ["eggs"], False, True),
    ("egg-boiled", "egg", 173424, "Whole egg, hard-boiled", "cooked", ["hard-boiled egg", "boiled egg"], ["eggs"], False, True),
    ("broccoli-raw", "broccoli", 170379, "Broccoli, raw", "raw", ["raw broccoli"], [], True, True),
    ("spinach-raw", "spinach", 168462, "Spinach, raw", "raw", ["raw spinach"], [], True, True),
    ("tomato-raw", "tomato", 170457, "Tomato, raw", "raw", ["raw tomato", "raw tomatoes"], [], True, True),
    ("carrot-raw", "carrot", 170393, "Carrot, raw", "raw", ["raw carrot", "raw carrots"], [], True, True),
    ("onion-raw", "onion", 170000, "Onion, raw", "raw", ["raw onion", "raw onions"], [], True, True),
    ("pepper-red-raw", "pepper-red", 170108, "Red sweet pepper, raw", "raw", ["raw red bell pepper", "raw red sweet pepper"], [], True, True),
    ("banana-raw", "banana", 173944, "Banana, raw", "raw", ["raw banana", "banana"], [], True, True),
    ("apple-raw", "apple", 171688, "Apple, with skin", "raw", ["raw apple with skin", "apple with skin"], [], True, True),
    ("potato-boiled", "potato", 170440, "Potato, peeled and boiled", "cooked", ["peeled boiled potato", "boiled potato without skin"], [], True, True),
    ("quinoa-cooked", "quinoa", 168917, "Quinoa, cooked", "cooked", ["cooked quinoa"], [], True, True),
    ("avocado-raw", "avocado", 171705, "Avocado, raw", "raw", ["raw avocado", "avocado"], [], True, True),
    ("almonds", "almonds", 170567, "Almonds", "as_sold", ["almonds", "plain almonds"], ["tree_nuts"], True, True),
    ("salmon-cooked", "salmon", 175168, "Atlantic salmon, farmed, cooked", "cooked", ["cooked farmed atlantic salmon"], ["fish"], False, False),
    ("cucumber-raw", "cucumber", 168409, "Cucumber, with peel", "raw", ["raw cucumber with peel", "cucumber with peel"], [], True, True),
]
NUTRIENTS = {"caloriesKcal": (1008, "KCAL"), "proteinG": (1003, "G"), "carbohydrateG": (1005, "G"), "fatG": (1004, "G")}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    args = parser.parse_args()
    raw_zip = args.archive.read_bytes()
    if digest(raw_zip) != ARCHIVE_SHA256:
        raise SystemExit("USDA archive checksum mismatch; refusing to import")
    with zipfile.ZipFile(io.BytesIO(raw_zip)) as archive:
        members = {name: archive.read(PREFIX + name) for name in ("food.csv", "food_nutrient.csv", "nutrient.csv", "sr_legacy_food.csv")}
    tables = {name: list(csv.DictReader(io.StringIO(data.decode("utf-8")))) for name, data in members.items()}
    foods = {int(row["fdc_id"]): row for row in tables["food.csv"]}
    legacy = {int(row["fdc_id"]): row for row in tables["sr_legacy_food.csv"]}
    dictionary = {int(row["id"]): row for row in tables["nutrient.csv"]}
    ids = {row[2] for row in SELECTION}
    selected_nutrients = {}
    for row in tables["food_nutrient.csv"]:
        key = (int(row["fdc_id"]), int(row["nutrient_id"]))
        if key[0] in ids and key[1] in {item[0] for item in NUTRIENTS.values()}:
            if key in selected_nutrients:
                raise SystemExit(f"Duplicate nutrient source row: {key}")
            selected_nutrients[key] = row
    catalog, evidence = [], []
    for item in SELECTION:
        ingredient_id, family, fdc_id, name, state, aliases, allergens, vegan, vegetarian = item
        food = foods[fdc_id]
        assert food["data_type"] == "sr_legacy_food"
        nutrients = {}
        source_rows = []
        for field, (nutrient_id, unit) in NUTRIENTS.items():
            assert dictionary[nutrient_id]["unit_name"] == unit
            source_row = selected_nutrients.get((fdc_id, nutrient_id))
            nutrients[field] = float(source_row["amount"]) if source_row else None
            if source_row:
                assert nutrients[field] >= 0
                source_rows.append(source_row)
        catalog.append(dict(id=ingredient_id, familyId=family, name=name, aliases=aliases, preparationState=state, fdcId=fdc_id, sourceDescription=food["description"], per100g=nutrients, allergens=allergens, vegan=vegan, vegetarian=vegetarian))
        evidence.append(dict(ingredientId=ingredient_id, food=food, srLegacyFood=legacy[fdc_id], foodNutrients=source_rows))
    destination = Path(__file__).resolve().parents[1] / "apps/api/src/modules/meal-recipes"
    (destination / "data").mkdir(parents=True, exist_ok=True)
    manifest = dict(
        catalogRevision=REVISION, dataset="USDA FoodData Central SR Legacy", datasetRelease="2018-04",
        sourceUrl=SOURCE_URL, downloadPage="https://fdc.nal.usda.gov/download-datasets/", checkedOn="2026-10-12",
        attribution="U.S. Department of Agriculture, Agricultural Research Service. FoodData Central. SR Legacy, April 2018.",
        license="CC0 1.0", licenseSourceUrl="https://fdc.nal.usda.gov/api-guide/",
        archiveSha256=ARCHIVE_SHA256, archiveBytes=len(raw_zip),
        members=[dict(path=PREFIX+name, sha256=digest(data), bytes=len(data)) for name, data in members.items()],
        basis=dict(quantity=100, unit="g", part="edible portion", documentationUrl="https://www.ars.usda.gov/ARSUserFiles/80400525/Data/SR-Legacy/SR-Legacy_Doc.pdf"),
        nutrients=[dict(field=field, nutrientId=value[0], unit=value[1], dictionaryRecord=dictionary[value[0]]) for field,value in NUTRIENTS.items()],
        ingredientCount=len(catalog),
        reviewNotes=[
            "Dataset release is April 2018; FDC food.csv publication_date for these records is 2019-04-01. These are distinct dates.",
            "Preparation state describes the selected nutrient reference, not an automatic raw-to-cooked yield conversion. Weights are edible amounts in that state.",
            "Allergen and diet tags are application review metadata for the described generic foods, not USDA certification or an allergy-safety guarantee. Actual product labels, additives and cross-contact remain unverified.",
            "Oats conservatively use the gluten cereal exclusion group; this does not establish that a specific oat product contains gluten or is certified gluten-free.",
            "Tomato puree means the pinned canned puree without added salt; other sauces, passata formulations, tomato paste and branded products require explicit matching or clarification.",
            "Tofu uses the selected firm calcium-sulfate reference; other tofu types and formulations require explicit matching.",
            "Missing nutrient source rows are imported as null; a recorded numeric zero remains zero. Energy is USDA nutrient 1008, not reconstructed from 4/4/9.",
            "No drained canned food is selected. Boiled chickpeas, lentils and beans use cooked edible solids, not a can weight including liquid.",
            "Qualified nutrition and food-safety review remains required before broader use.",
        ],
    )
    (destination / "catalog-source.json").write_text(json.dumps(manifest, indent=2)+"\n")
    (destination / "data/source-records.json").write_text(json.dumps(dict(catalogRevision=REVISION, archiveSha256=ARCHIVE_SHA256, records=evidence), indent=2)+"\n")
    type_decl = """export interface RecipeCatalogDataRow {
  id: string;
  familyId: string;
  name: string;
  aliases: readonly string[];
  preparationState: 'raw' | 'cooked' | 'as_sold';
  fdcId: number;
  sourceDescription: string;
  per100g: {
    caloriesKcal: number | null;
    proteinG: number | null;
    carbohydrateG: number | null;
    fatG: number | null;
  };
  allergens: readonly string[];
  vegan: boolean;
  vegetarian: boolean;
}
"""
    (destination / "catalog-data.ts").write_text(
        "// Generated from pinned USDA records by scripts/import-recipe-catalog.py.\n"
        "// Attribution, checksum and review limits: catalog-source.json.\n"
        + type_decl + f"\nexport const RECIPE_CATALOG_REVISION = '{REVISION}';\n\n"
        + "export const RECIPE_CATALOG_DATA: readonly RecipeCatalogDataRow[] = " + json.dumps(catalog, indent=2) + ";\n"
    )
    print(f"Imported {len(catalog)} ingredients; {len(selected_nutrients)} observed macro/energy rows; archive {ARCHIVE_SHA256}")


if __name__ == "__main__":
    main()
