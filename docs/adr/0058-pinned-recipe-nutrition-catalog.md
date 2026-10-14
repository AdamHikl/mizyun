# ADR 0058: Pinned ingredient nutrition for meal recipes

- Date: 2026-10-12
- Status: Accepted for local REC-02 engineering; qualified nutrition/food-safety and release acceptance remain open
- Package: AI-RECIPES-001 / #241

## Decision

Keep the first ingredient catalog as a small server-owned subset of pinned USDA FoodData Central SR Legacy April 2018 download records. Store original selected food/nutrient rows, archive/member checksums, nutrient units and IDs, attribution and application review metadata beside the server module. Use the checksum-verified offline importer to reproduce the data; no runtime nutrition API, key, database or mobile catalog is added.

The pure core calculation accepts provider-neutral per-100g references and explicit edible ingredient weights in matching preparation states. Sum every ingredient, including oil, before dividing by actual servings and rounding to two decimals. Preserve source kcal rather than reconstructing it from macros. Missing nutrients remain null. Raw-to-cooked yield is never guessed; final portion yield is separately declared, and template portion mass is explicitly a planned estimate.

Recipe templates use only user-confirmed catalog matches, including staples. Known gram quantities must cover the whole recipe; nonweighed or unknown quantities produce a visible quantity check. Exclusions cover preparation variants through food families, supported allergen aliases and reviewed diet metadata. Unsupported constraints or product/state matches require clarification. Template instructions are fixed, with applicable leftover reheating guidance; model-generated cooking instructions are not accepted by this module.

## Consequences and limits

The subset is deliberately small and historical. Nutrient references do not establish actual branded-food composition, natural variability, cross-contact, freshness or safe storage. Generic product matching still requires explicit confirmation. The catalog carries no invented confidence interval; pure calculation ranges describe only explicit user weight bounds. A qualified nutrition/food-safety review is required before broader use.

REC-03 must validate all provider proposals against this catalog, recompute nutrition, enforce full response bounds and preserve guarded access/budget/lifecycle rules. No route, provider, photo or intake mutation is enabled by REC-02.

## Primary sources checked 2026-10-12

- [USDA downloads](https://fdc.nal.usda.gov/download-datasets/) and [data documentation](https://fdc.nal.usda.gov/data-documentation/): release identity and historical reference limits.
- [USDA licensing](https://fdc.nal.usda.gov/api-guide/) and [SR documentation](https://www.ars.usda.gov/ARSUserFiles/80400525/Data/SR-Legacy/SR-Legacy_Doc.pdf): attribution, edible per-100g basis and nutrient availability.
- [EU food information](https://food.ec.europa.eu/food-safety/labelling-and-nutrition/food-information-consumers-legislation/mandatory-food-information_en): ingredient/allergen labels remain necessary; application tags do not certify products.
- [FoodSafety.gov temperature guidance](https://www.foodsafety.gov/food-safety-charts/safe-minimum-internal-temperatures): use a thermometer and reheat leftovers to 74°C.
