# ADR0063 — Frozen offline recipe evaluation

- Status: Accepted for local evaluation engineering; release acceptance remains open
- Date: 2026-10-13
- Scope: REC-06 / #241

## Decision

Keep the recipe evaluation corpus in `scripts/recipe-evaluation`, separate from runtime suggestions and user records. A checked-in SHA-256 manifest pins recipe/context cases, synthetic scene descriptions/assets, thresholds and the REC-02 catalog/source manifest. Changing references requires an explicit reviewed freeze; the evaluator never repairs the manifest or derives expected answers from production function results. It fails closed on missing/tampered members, unsafe SVG content and paths escaping the repository.

Exercise public recipe/template/domain contracts and the actual server composition with fake providers. Frozen recipe nutrition vectors include ingredient weights, preparation states, FDC IDs and source values; independently sum those reference rows outside the production calculator. Rank expectations are fixed from the documented macro-balance-v1 calculation. No external provider, database mutation, runtime availability switch or device integration is added.

Ingredient scoring uses identifiable visible canonical labels. Hidden/ambiguous guesses and repeated predictions count as false positives; missed visible labels count as false negatives. Undefined precision or recall is null. Full and partial abstention are reported separately. User-corrected inputs do not replace the original recognition ground truth. Scripted observations test scorer mechanics, including deliberate errors, and cannot establish actual provider accuracy.

Release thresholds remain 90% independently judged feasible eligible generation, 90% visible-item precision and provider-operation p95 at most15seconds. Report recall, abstentions, retry and two-photo/generation costs separately. The offline report leaves all live metrics null and all qualified review/native/Dev/pilot gates open. Blocked cases can pass a safety assertion without becoming successful generations. Repository `test:ai-eval` runs the recipe references and scorer regressions as part of the ordinary full gate.

## Consequences

The corpus contains only fictional scenarios and original labelled SVG illustrations; no real health data or photos. SVGs are inventory test descriptions, not supported provider-upload photos or evidence of visual recognition. Future authorized live work must freeze its exact supported image bytes and independent ground truth before observing results; it cannot quietly repurpose scripted predictions as live outputs.

Engineering review, offline tests and bundling remain distinct from qualified nutrition/food-safety review, actual Auth/RLS/Storage isolation, native device journeys, provider feasibility/cost/latency and product validation. Recipe access remains disabled until its applicable gates are accepted.

## Primary sources checked 2026-10-13

- [Node25 test runner](https://nodejs.org/docs/latest-v25.x/api/test.html): use stable Node tests and actual subprocess exit assertions, compatible with installed Node25.3.0.
- [Scikit-learn precision/recall definitions](https://scikit-learn.org/stable/modules/model_evaluation.html#precision-recall-and-f-measures): TP/(TP+FP), TP/(TP+FN); the duplicate/ambiguity and undefined-denominator policies are explicit application choices.
- [Gemini safety benchmarking guidance](https://ai.google.dev/gemini-api/docs/safety-guidance): establish minimum safety metrics before testing and use application-specific datasets/independent human assessment. This does not authorize a live request.
- [USDA FoodData Central documentation](https://fdc.nal.usda.gov/data-documentation/): use the pinned SR Legacy source basis; reference arithmetic is not brand-specific or qualified food-safety acceptance.
