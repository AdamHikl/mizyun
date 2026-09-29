# Advanced nutrition tracking for Pro — implementation plan

**Work package:** NUTR-PRO-001 / [issue #134](https://github.com/AdamHikl/mizyun/issues/134)  
**Mode:** Planning only, 2026-09-29. No feature code, migration, build, or deployment in this session.  
**Baseline:** planning began at `0b2540c` on `main` while Account navigation changes were in progress; that work was committed concurrently as `abac660`. Preserve it. This work follows the October 2–3 InVenture demo priority; it does not change `plan.md` sequencing.

## Context and scope

Mizyun records calories, protein, carbohydrate, and fat per confirmed food entry. Users should be able to capture and review additional nutrients without making the free meal flow slower. The user chose Pro for these additional fields; free users retain current manual logging and basic summaries.

**First release:** optional dietary fibre (g), saturated fat (g), total sugars (g), sodium (mg), and dietary cholesterol (mg) per meal; Pro-only entry/editing, per-meal display, daily/weekly review, and user-selected visibility. These are components of nutrition, not additional energy macros. Cholesterol is available for users who want it, with no default target and no claim that dietary cholesterol equals blood cholesterol.

**Later candidates, after data coverage and usability testing:** added sugars (distinct from total sugars), unsaturated fat breakdown, potassium, calcium, iron, vitamin D, caffeine, and hydration. Do not add automatic targets or badges for these in the first release. Hydration is a separate workflow because total water includes food and beverages.

**Non-goals:** food/barcode database integration, automatic backfill of old entries, AI extraction of new fields, medical interpretation, clinical recommendations, and store billing in this work package. AI food drafts continue to populate only the existing fields until their quality, provenance, privacy, and provider gates are separately accepted. Do not infer a nutrient from calories or other macros.

## Evidence and product decisions

Primary sources checked 2026-09-29:

| Source                                                                                                                                                                       | Consequence                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [WHO fat and carbohydrate guidance](https://www.who.int/news/item/17-07-2023-who-updates-guidelines-on-fats-and-carbohydrates)                                               | Adult dietary fibre of at least 25 g/day and saturated fat below 10% of energy are useful general reference points. Present as educational references, not personalized prescriptions.         |
| [WHO sodium guidance](https://www.who.int/tools/elena/interventions/sodium-cvd-adults)                                                                                       | Adult population reference is below 2,000 mg sodium/day (5 g salt). Store canonical sodium in mg.                                                                                              |
| [European Commission nutrition labelling](https://food.ec.europa.eu/food-safety/labelling-and-nutrition/food-information-consumers-legislation/nutrition-labelling_en)       | EU packs commonly provide saturated fat, sugars, and salt; fibre is optional. Use `sugars` as _total sugars_, and offer a salt-entry conversion to canonical sodium: 1 g salt = 400 mg sodium. |
| [FDA Nutrition Facts reference](https://www.fda.gov/food/nutrition-facts-label/daily-value-nutrition-and-supplement-facts-labels)                                            | US labels include fibre, saturated fat, sodium, total/added sugars, and cholesterol. FDA Daily Values are label reference values, not individual goals.                                        |
| [American Heart Association 2026 dietary guidance](https://professional.heart.org/en/science-news/2026-dietary-guidance-to-improve-cardiovascular-health/top-things-to-know) | For most people dietary cholesterol is no longer a primary cardiovascular risk target. Offer the value as optional information without a universal warning threshold.                          |
| [USDA nutrient documentation](https://fdc.nal.usda.gov/docs/cndb-documentation-cn27.pdf)                                                                                     | A measured zero differs from missing data. Empty fields and historical rows must stay `null`, never become zero.                                                                               |
| [EFSA sugars assessment](https://www.efsa.europa.eu/en/news/added-and-free-sugars-should-be-low-possible)                                                                    | Added/free sugars are not interchangeable with total sugars; defer added sugars until source data explicitly identifies them.                                                                  |

**Display policy:** Show numeric totals only when every included confirmed entry has a value for that nutrient. Otherwise show “incomplete” plus the known subtotal and coverage count, clearly labelled so it cannot be read as a complete daily intake. Zero is shown only when explicitly recorded. Avoid red/green judgments for incomplete data or cholesterol. Allow a user to hide any advanced metric. Reference values are optional, labelled as general adult guidance, and should not silently become personal goals; review locale and applicability before shipping them.

## Baseline and boundaries

- `packages/contracts/src/food-entry.ts`, `packages/core/src/food-entry.ts`, `apps/api/src/modules/food-entries/routes.ts`, and `packages/adapters/supabase-server/src/food-entry-repository.ts` currently model only the four basic numeric fields. `public.food_entries` has dedicated nullable columns for those fields and an open `details` JSON object. Use additive **typed nullable columns** for the five new nutrients, not `details`, so validation, export, and aggregation have explicit meaning.
- The daily summary already propagates unknown (`null`) when any entry lacks a basic field. Preserve that rule; add coverage information for the new fields so a useful subtotal can be shown without pretending it is complete.
- Meal editing, recoverable drafts, portion scaling, reusable meals, account export/deletion, and Coach nutrition context are downstream consumers. Keep nutrient data on the confirmed-entry path, include it in export/deletion, and do not add it to Coach prompts as authoritative guidance in this first release.
- The current `Beta Pro Pass` endpoint reports an approved request, and no general paid subscription entitlement exists in the inspected code. An approved beta request is not proof of purchase. Define a server-authoritative `advanced_nutrition` capability: approved Beta Pro may grant it during beta under an explicit server policy; a later paid Pro entitlement can grant the same capability after store receipt/server verification. Document which environment and grant source is active. Never trust a mobile Boolean or the request status alone as authorization.
- Free users must be able to read, correct, export, and delete advanced nutrient values already on their records after a Pro lapse. Restrict creation of **new** advanced values and advanced aggregate views; define how clearing a previously saved value works before implementation. Do not strip historical values from authoritative records or account export.

## Staged implementation

### 1. Requirement, entitlement, and data contract

**Files:** `[MODIFY] docs/PRODUCT_REQUIREMENTS.md`, `[NEW] docs/adr/<next>-advanced-nutrition-entitlement-and-storage.md` (if the final design changes the existing entitlement/storage strategy), `[MODIFY] packages/contracts/src/food-entry.ts`, `[MODIFY] packages/core/src/food-entry.ts`, `[NEW] supabase/migrations/<timestamp>_advanced_food_nutrients.sql`, `[MODIFY] packages/adapters/supabase-server/src/food-entry-repository.ts`.

Add the five nullable, nonnegative typed fields with bounded precision; canonical units are grams except sodium and cholesterol in milligrams. Reject impossible negatives, fractions beyond storage precision, and component values exceeding a known parent for saturated fat > fat or total sugars > carbohydrate, allowing missing parents. Add a forward-only migration with no historical default or backfill. Keep old client payloads valid and preserve values on an omitted PATCH. Add a versioned capability response and server-side grant resolver whose source is inspectable in tests. Review the migration, authorization, and export shape independently because the work touches data and access rules.

**Advance when:** old clients still create/read/edit basic meals; migration preserves old rows as unknown; entitlement cannot be forged or confused with a mere pending Beta Pro request; revoked Pro cannot write new advanced values but can edit or clear existing records according to the documented policy.

### 2. API, aggregation, and data lifecycle

**Files:** `[MODIFY] apps/api/src/modules/food-entries/routes.ts`, `[MODIFY] apps/api/src/modules/food-entries/routes.test.ts`, `[MODIFY] packages/core/src/food-entry.ts`, `[MODIFY] apps/api/src/modules/account/routes.ts`, `[MODIFY]` their focused tests and applicable account export/deletion adapters.

Authorize advanced-field writes and advanced summaries on the server. Include each field and a per-field known-entry count in daily/weekly aggregation. Handle `null`, explicit zero, local-day boundaries, edits, deletes, idempotent retries, mixed old/new records, and entitlement changes. Ensure account export includes all five fields for every owner regardless of entitlement and deletion removes them with the entry. Check that user A cannot read or change user B's values. Review whether free clients may receive advanced values in the ordinary entry response; choose an explicit privacy/product policy while preserving edit/export access.

**Advance when:** boundary and RLS tests pass, downgrade behavior is proven, and daily/weekly views cannot silently treat missing nutrients as zero.

### 3. Mobile Pro experience

**Files:** `[MODIFY] apps/mobile/src/features/log-meal/meal-form.ts`, `[MODIFY] apps/mobile/src/features/log-meal/log-meal-data.ts`, `[MODIFY] apps/mobile/src/features/log-meal/meal-list-screen.tsx`, `[MODIFY] apps/mobile/src/features/log-meal/meal-scale.ts`, `[MODIFY]` their focused tests; inspect and update the actual meal editor component, saved-meal flows, local draft storage, and Settings entry point reached through current Account navigation.

Keep calories and three macros immediately visible. For Pro, reveal an optional “More nutrients” section with correct units, an EU salt-to-sodium input option, and clear “not recorded” states. Support record/edit/copy/reuse/portion resizing without losing optional values. Show a restrained Pro explanation and access path for free users; an approved Beta Pro grant should unlock only after a fresh server capability check. Make offline drafts preserve entered values and fail safely if entitlement has changed before sync. Accessible labels must say nutrient and unit; verify dynamic type, keyboard, VoiceOver, and TalkBack.

**Advance when:** a Pro user can log a representative packaged food from its label and review per-meal and daily/weekly values; free logging remains fast; a free or downgraded user can reach existing records and account export.

### 4. Acceptance and rollout

Run focused contracts/core/API/mobile tests, Supabase migration and RLS tests on a disposable local database, `pnpm navigation:check`, formatting on changed files, then `pnpm check`. Verify with two users and pending/approved/revoked grants. Review all data/entitlement changes with an independent agent. Deploy only an exact checked and accepted SHA to Hetzner Dev; test standalone Dev iOS and Android flows, including network loss and Pro downgrade. Production promotion and any store billing/listing change remain separate release decisions and gates.

## Next-session prompt

> Implement `NUTR-PRO-001` from `docs/ADVANCED_NUTRITION_PRO_PLAN_2026-09-29.md`. First inspect `git -c core.fsmonitor=false status --short`, current `AGENTS.md`, `status.md`, and `pnpm context meal-logging`; preserve all Account-navigation work. Confirm the server-authoritative beta-versus-paid Pro grant policy, then implement Stage 1 with additive nullable columns and old-client compatibility. Delegate an independent authorization/migration review, update the issue and continuity evidence, and stop before Dev deployment until the exact candidate passes `pnpm check`.
