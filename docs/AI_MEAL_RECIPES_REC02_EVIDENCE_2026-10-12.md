# AI meal recipes — REC-02 catalog and nutrition evidence

> Local engineering package under [#241](https://github.com/AdamHikl/mizyun/issues/241). Baseline `0135228778059dc25c1a4925738f0b6934ed4f0c`, plus disclosed uncommitted REC-01 dependency and REC-02 owned overlays. No commit, push, provider request, route, database change, native install, Dev deployment or Production release.

## Outcome

- Pinned 29 generic USDA foods and 116 observed energy/protein/carbohydrate/fat values, with actual FDC IDs, preparation states, source records, nutrient dictionary and archive/member hashes. Source release April 2018 differs from FDC publication date 2019-04-01. Importer verifies the public archive before writing.
- Pure `ingredient-weight-v1` calculation includes every ingredient and oil, divides by actual servings, rounds only at the output boundary and preserves source kcal. Missing nutrients remain null, source-state mismatches are unknown, contradictory yield fails. Optional ranges represent explicit user weight bounds; templates do not invent natural-variation confidence intervals.
- Eight offline templates: chicken/lentil/chickpea/tofu rice bowls, two yogurt bowls, chickpea salad and egg/potato bowl. User-confirmed matches and staples only. Gram supplies cover the whole recipe; unknown or nonweighed quantities carry a visible check. Confirmed shortages, excluded food families/allergens/diets and missing ingredients cannot produce a feasible candidate.
- Unsupported products, state mismatches, constraints and cuisine requests require clarification. Basic aliases return catalog choices for user confirmation; no fuzzy branded match. Templates contain relevant storage/thermometer guidance and label/cross-contact warnings. Planned portion mass can change after heating; it is not a measured final yield.
- Public module exports and core-to-server-to-contract/ranking checks connect this foundation to REC-01, including the 50P/150C/10F focus example. Coach still classifies recipes as internal engineering, with no recipe screen availability claim.

## Focused evidence

- Core: 26 new nutrition tests +45 REC-01 macro tests passed.
- API: 25 catalog/template tests passed, including independently calculated two-serving rice/chicken/puree/oil reference: 549.1 kcal, 47.03P /63.52C /10.37F per serving.
- Public boundary: 2 new catalog/ranking +4 REC-01 integration tests passed.
- Core/API typechecks and contract20/capability29/knowledge9 checks passed. Total recipe-focused checks: 122 (53 new). Full-gate results are recorded in the post-check receipt.
- Coordinator freshly checked the original archive SHA256, all four member checksums, 29 food records and 116 nutrient rows against retained data. Non-author reviewer additionally checked all selected legacy rows.
- Import helper reported reproducible regeneration, corrupted-archive rejection before mutation and Python compile success. Coordinator independently regenerated the semantic JSON and byte-identical formatted catalog TypeScript, and verified corrupt-archive rejection without output mutation. USDA archive checksum: `b80817294b8850530aaedf2e515c02593b1824f763a0ff356e5c2081643e6fd0`.
- Fresh Sol Medium independent engineering review froze 14 path hashes at start/end, independently ran API25/core26 and found no blockers. This is not qualified nutrition/food-safety acceptance.

## Isolated full-gate scope

The shared tree has concurrent Community, cache, analytics and Coach edits. A separate candidate is selected before the broad gate, based on the prior REC-01 isolated source plus REC-02 overlays. Its Git HEAD resolves to the exact baseline above. External installed dependencies are reused; workspace links point at candidate source. Required ignored Expo type scaffolding is retained without credentials. Only owned recipe continuity/ADR/map sections are added; unrelated runtime changes, migrations and continuity updates are excluded.

[ADR 0058](adr/0058-pinned-recipe-nutrition-catalog.md) records the data format and calculation boundary. The full `pnpm check` passed with fingerprint `f07197c8772c5c4873f80ae66ccd8eb3145a10787ef508b8ffc7ddc84256679f`. Main counts: core521, contracts323, runtime91, mobile2157, API1005; 15 API E2E tests across three credential-gated suites were skipped, not accepted. Both bundle exports and 74 safeguard fixtures passed. Offline safety screener evidence is not live-provider evaluation.

Durable [candidate manifest](evidence/meal-recipes-rec02-2026-10-12/candidate-manifest.json), [verification receipt](evidence/meal-recipes-rec02-2026-10-12/verification-receipt.json) and [compact full-gate log](evidence/meal-recipes-rec02-2026-10-12/full-check-summary.txt) are post-check records. This evidence page, plan/status outcome wording and issue update were finalized after the gate; applicable document checks are separate from the recorded source fingerprint. Runtime code remained hash-identical to the reviewed/tested candidate. Preflight found copied workspace links resolving through a `/tmp` alias to REC-01; all35 links were rebound before final API/public/type checks and before the only broad gate.

## Remaining gates and exact next action

Start **REC-03**: provider-neutral ports, strict proposal validation/recomputation, authenticated owned context, consent/kill switches and durable recipe request budgets. Review the existing budget port and current provider documentation first. Do not enable live requests before the applicable AI checklist is satisfied.

Qualified nutrition/food-safety review of the catalog and templates is required before broader use. REC-03–06, text/photo/mobile flows, complete response bounds at transport, live-provider evaluation, physical iOS/Android, Dev and Production acceptance remain open. The source feature is not yet available in the installed app. Issue #241 stays open.
