# ADR-0035: AI estimates for additional meal nutrients

**Status:** Accepted for local implementation, 2026-10-02, [#178](https://github.com/AdamHikl/mizyun/issues/178). Provider quality, Dev deployment and installed-device acceptance remain separate gates.

## Context

Adam requested automatic filling of the additional nutrient fields after observing that AI estimated only calories and macros. This extends the first-release scope of ADR-0029; it does not change the existing Pro entitlement, confirmed-food persistence or broader AI admission policy.

## Decision

- Extend the provider-neutral candidate and wire contract with optional nullable meal-total `fibreG`, `saturatedFatG`, `totalSugarsG`, `sodiumMg` and `cholesterolMg`. Reuse existing food-entry bounds and units; omit fields for older/basic-only producers. Preserve missing, explicit null and zero through drafts, refinement and saving.
- The API enables generation from the same server-owned paid profile or approved Beta Pro grant used for advanced editing. A quota-tier override or client flag grants nothing. An unavailable capability lookup leaves basic AI usable and disables extras. Strip extras from unentitled refine inputs and generated outputs, including Coach meal proposals.
- Gemini uses extended structured output only when the server authorizes it. Prefer supplied readable nutrition labels or supported exact-product sources; otherwise estimate from identified ingredients and portions with explicit assumptions and uncertainty. Unknown values remain null; never derive these nutrients from calories or macros. Model and provider configuration remain unchanged.
- Validate finite bounded values and round to existing two-decimal storage precision. If saturated fat exceeds total fat or sugars exceed carbohydrates, clear only the contradictory estimate and show a warning. Unsafe output clears every nutrient. Structured output proves format, not nutrition accuracy.
- Photo, text and Coach estimates remain editable proposals. Saved meals can request estimates through the existing AI refinement action. Refinement uses current edited values, and later responses must not overwrite edits made during the request. Saving requires deliberate user confirmation and the existing fresh capability/write checks.
- Do not backfill historical meals, add medical targets, change billing, widen AI access or add provider calls to tests. Existing exports and ordinary confirmed summaries use the already supported nutrient columns; no database migration is required.

## Consequences and acceptance

This supersedes only ADR-0029's basic-only AI-draft restriction and the original plan's AI-extraction exclusion for these five fields. Coach advice/grounding remains on its existing confirmed inputs. Extra estimates are point estimates with the draft's warnings, assumptions and provenance; no per-nutrient accuracy claim or range is established.

Synthetic tests must verify provider-to-contract-to-form preservation, null/zero and older drafts, all server access states, malformed/contradictory values, refinement races and explicit save. Actual Gemini accuracy against known labels/weighed meals, exact Dev deployment and standalone iOS/Android journeys remain required before calling this accepted on devices. `docs/BEFORE_TESTING.md` and #29 still govern live provider evaluation and broader access.

## Primary sources

- [Gemini structured outputs](https://ai.google.dev/gemini-api/docs/structured-output), accessed 2026-10-02: nullable structured numeric output plus application validation.
- [Gemini image understanding](https://ai.google.dev/gemini-api/docs/image-understanding), accessed 2026-10-02: existing inline multimodal request path retained.
- [Zod schemas](https://zod.dev/api), accessed 2026-10-02: optional and nullable are distinct; retain the installed Zod 3.25 API and existing validation conventions.
- [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/), accessed 2026-10-02: existing React Native/Expo presentation path; no new native dependency or permission.
