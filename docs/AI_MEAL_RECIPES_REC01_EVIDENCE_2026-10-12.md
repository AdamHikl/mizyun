# AI meal recipes — REC-01 foundation evidence

> 2026-10-12. AI-RECIPES-001/[#241](https://github.com/AdamHikl/mizyun/issues/241); [implementation guide](AI_MEAL_RECIPES_PLAN_2026-10-12.md). REC-01 source implementation only. Catalog, provider/API/photo processing, app UI and REC-02–06 acceptance remain separate.

## Outcome and boundary

- Pure core builds macro context from Home EnergyBreakdown targets and null-safe local-day summary values. Signed remaining values, positive gaps, logged-so-far qualification and unknown/stale/no-gap states remain distinct.
- macro-balance-v1 favors ordinary portions that follow the remaining P/C/F relationship, without consuming the whole remaining allowance. The 50 P / 150 C / 10 F reference favors carbs plus lean protein. Ranking keeps over-target macros as soft penalties and never prescribes skipped food.
- Candidate checks reject exclusions, missing ingredients, preparation mismatches, out-of-bound portions and impossible known macro mass. Trusted catalog/exclusion verification is a later composition responsibility; syntactic IDs alone establish neither.
- Strict versioned ingredient/recipe/context/result schemas retain unknowns, serving/preparation state, calorie/macro ranges and provenance. Numeric fit cannot accompany an ordinary-discovery response.
- Public core output is tested through actual wire schemas. Work is bounded at100candidates/20ranked options and16KiB serialized UTF-8 output. Oversized output raises an explicit RangeError rather than silently truncating rejection data; future API composition must normalize it. Malformed source metadata must be validated before calling core or returned as an explicit composition error.
- No target formula, Coach target policy, API route, model call, consent/access/budget, persistence, migration, photo handling or app UI changed in this slice.

## Verification

Initial focused shared-tree checks passed45core +20contracts +2public-output integration tests and both package typechecks. An independent settled-candidate review reproduced a26,558-byte valid-candidate result exceeding the16,384-byte wire limit. The coordinator added explicit output budgeting and a maximum-length Unicode cross-package regression. Final repair checks/review and full gate passed as recorded below; no earlier run is claimed as current evidence.

- Focused final isolated-candidate checks:45core +20contracts +4public-output/integration tests PASS (69recipe checks),29capability tests and9knowledge-validator tests PASS; core/contracts/agent-runtime typechecks PASS.
- Non-author review: initial ordinary Sol Medium review found one output-size blocker; repair-only review accepted the byte-limit fix with no remaining findings. The later required knowledge-classification repair also passed bounded final non-author review with no findings. Additional BMP/supplementary-Unicode/lone-surrogate probes passed. The contract author did not review their own work.
- Formatting/navigation preflight: passed on the isolated candidate; existing review/coverage/startup warnings retained. External Expo config resolution warning from static discovery was checked with actual require.resolve; the installed config exists.
- Full `pnpm check`: first attempt stopped at the required Coach knowledge check (new meal-recipes feature unclassified). Added an explicit internal-foundation classification and regression; knowledge preflight now passes. Final rerun PASS on the settled isolated candidate, input fingerprint `b86dd0c22fa97ede02ad5c3466ac93f6f56d24deaf94a5be7ef7a7b68904343e`. iOS/Android Metro exports and every required full-gate step passed. Main package counts:495core/323contracts/91agent-runtime/2157mobile/980API;15API tests across3credential-gated E2E suites skipped, not passed (Auth5, persistence8, account-deletion2).
- Provider integration, database, Dev deployment, native/device and Production release checks: unrun; these paths are not implemented/changed by REC-01.

## Stable candidate and source correspondence

Exact Git baseline: `0135228778059dc25c1a4925738f0b6934ed4f0c`. Candidate: `/private/tmp/mizyun-rec01-20261012-01a12b31`. Created by local shared-object clone and detached checkout, followed by only the owned recipe source overlays. All7whole-file owned source overlays matched the working copy before review. The added agent-runtime capability classification is a partial overlay: removing that addition reproduces the baseline candidate file and the pre-edit shared file independently, preserving unrelated Community capability changes.

Candidate documentation uses baseline plus recipe-owned requirements/feature/research additions. It includes the recipe guide and its missing local planning dependencies, updated project instructions, installed external dependencies and required Expo TypeScript scaffolding. Workspace package links point at candidate source. No credentials/env files or generated native build artifacts were copied.

Excluded: every pre-existing runtime/migration/Community/cache/analytics/Coach change, unrelated requirement/research/status updates and the untracked Community/analytics implementation artifacts. This gate cannot accept those exclusions. Baseline changes needed only for source dependencies were not inferred from the dirty tree; existing baseline packages supplied them.

| Owned source                                 | SHA256                                                             |
| -------------------------------------------- | ------------------------------------------------------------------ |
| `packages/core/src/meal-recipe.ts`           | `38861d0dde67494f12f164c406fa22033e61378fc401709a4d37c42bc2f8ec64` |
| `packages/core/src/meal-recipe.test.ts`      | `afe022ff04e49917ae45c9897f96a0533739be49c9a205bd15ad6d489b1892a7` |
| `packages/core/src/index.ts`                 | `cb9cc12d8b98236995715b6aa290f4c2f84d5b397d4023b46a944b6f9801b28f` |
| `packages/contracts/src/meal-recipe.ts`      | `d9d287b34b1329fed47e7620927cf7c4c317c50adcd4dcee28b279115b0d949a` |
| `packages/contracts/src/meal-recipe.test.ts` | `b49b4819bd59d89d848f32cdc4fa20655f1926d97d725922f092520eff99cc3b` |
| `packages/contracts/src/index.ts`            | `ae18fc9cb973486c7e8bb33d93e9d72cd3505be83582d6f84030711401152ee7` |
| `scripts/test-meal-recipe-foundation.mjs`    | `6e0a5e1c03a962d1478dfcd48bc507db58778a7c82af1471b9b66cb7cfa97397` |

Partial candidate capability-file SHA256: `2d60ae0c285bfb95a6e1427c20201d08e00fcd175061f369387d26f75187f839`; only the `meal-recipes` internal classification belongs to this package. No new recipe availability is advertised to Coach. REC-05 must replace this classification when its actual user-facing flow is accepted.

Local receipts: `/tmp/mizyun-rec01-candidate-manifest.json`, `/tmp/mizyun-rec01-preflight.log`, `/tmp/mizyun-rec01-format-preflight.log`; full gate receipt `/tmp/mizyun-rec01-full-check.log` passed; [durable verification receipt](evidence/meal-recipes-rec01-2026-10-12/verification-receipt.json), [package summaries](evidence/meal-recipes-rec01-2026-10-12/full-check-summary.txt) and [candidate manifest](evidence/meal-recipes-rec01-2026-10-12/candidate-manifest.json). Initial sandbox launch could not inspect the local process lock (`ps EPERM`); the escalated local gate launch started successfully. No commit/push occurred.

## Next exact action

Implement REC-02 reviewed ingredient nutrition and feasible recipes. Resolve real FDC IDs/preparation states and calculate serving estimates deterministically; do not fabricate catalog values or enable live generation. REC-01 does not make recipes available in the installed app. Continue later stages only under their scoped acceptance/gates.

Final metadata note: source hashes above are unchanged after the passing candidate gate. This durable evidence/status/issue update was finalized afterward and checked for formatting/links; it is not represented as a second full-gate run on the shared concurrent tree.
