# REC-06 frozen recipe evaluation and acceptance protocol

## Offline package

[ADR0063](adr/0063-frozen-offline-recipe-evaluation.md) defines the evaluation boundary. The checked-in corpus has58 recipe/context cases, eight independent nutrition vectors and23 synthetic photo scenarios with27 original SVGs. The recipe vectors explicitly retain USDA FDC IDs, source values, ingredient grams and preparation states. Context cases cover the reference50gP/150gC/10gF gap, protein/carbohydrate/fat priorities, overshoot, zero gaps, unknown intake, stale local day and changed revisions. Template cases cover exclusions, unsupported constraints, oils, raw/cooked mismatches, uncertain quantities, insufficient supplies, prep and serving scaling.

The photo corpus separates identifiable visible labels from hidden/occluded/ambiguous content; includes two locations, repeated items/photos, oils, exclusions, preparation uncertainty and image-text injection scenarios. These are labelled fictional illustrations, not photographs or provider recognition tests. Scripted predictions intentionally include six error cases and four abstentions. Empty ground truth or predictions produce null undefined metrics. Partial abstention retains missed visible labels in recall. No corrected ingredient list is substituted for the raw recognition score.

```sh
pnpm test:meal-recipe-eval
pnpm --filter @mizyun/api exec vitest run src/modules/meal-recipes/evaluation.test.ts --maxWorkers=1
node --import tsx scripts/run-meal-recipe-evaluation.mjs --output /tmp/recipe-evaluation-report.json
```

The evaluator checks the frozen manifest before any scoring. Do not automatically update expectations to match observed results. A deliberate versioned corpus change requires independent review and an explicit offline freeze before live observations:

```sh
node --import tsx scripts/freeze-meal-recipe-evaluation.mjs --confirm-offline-freeze
```

`test:ai-eval` includes this suite in `pnpm check`. The server evaluation uses actual authenticated route/service composition with fake providers and synthetic pixels. Denied requests must make zero provider calls; malicious forbidden selections must fail; same request IDs across owners must retain separate contexts; suggesting and recognizing must create no intake.

## Frozen targets and reporting

| Gate                                                                   | Frozen criterion                                                                                                | Current evidence tier                           |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Reference ranking, exclusion, source arithmetic and scorer regressions | 100% assertions pass                                                                                            | Offline engineering only                        |
| Unauthorized provider / cross-owner / forbidden recipe success         | Zero successes; denied requests make zero fake calls                                                            | Synthetic server composition, not real Auth/RLS |
| Eligible generation feasibility                                        | At least90% produce one independently judged feasible meal with no unmarked missing ingredient                  | Not evaluated live                              |
| Recognition precision                                                  | At least90% on declared identifiable visible items before correction                                            | Not evaluated live                              |
| Recognition recall / abstention                                        | Report recall, full/partial abstentions and missed items; no complete-inventory claim                           | Scripted metric mechanics only                  |
| Provider latency                                                       | p95≤15seconds per user-triggered operation, measured on the exact permitted candidate                           | Not measured                                    |
| Provider cost                                                          | Two-photo plus generation and explicit retries; compare permitted user caps and evidenced aggregate spend limit | Not measured; aggregate spend evidence open     |
| Qualified nutrition / food safety                                      | Named qualified review of catalog matches, exclusions and cooking guidance                                      | Open                                            |

Count eligible generation separately from blocked/clarification cases. A safety refusal may pass its guard assertion but is never a successful generation. Leave unmeasured live metrics null; do not compute provider p95 from local unit-test timing or use scripted precision as model precision. Inspect tail/worst-case failures in addition to aggregate rates. A high average does not waive any known safety failure.

## Remaining exact acceptance

| ID        | Journey or evidence                                                                                                                                                                          | Required environment                                                     |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| REC06-Q01 | Qualified review of pinned food/preparation matches, amounts, exclusion metadata and safe cooking/storage guidance; generic values are not allergy guarantees                                | Named qualified reviewer                                                 |
| REC06-P01 | Freeze supported image bytes, visible-item labels and eligibility before permitted live requests; independent raw-output judging, separate correction burden, no fabricated weight/freshness | Authorized synthetic/consented provider dataset; BEFORE_TESTING complete |
| REC06-P02 | Current model/project/settings, spend isolation, actual token/cost/retry and operation latency evidence; preserve user caps, kill switches and default-off until accepted                    | Exact authorized provider candidate                                      |
| REC06-D01 | Deploy exact checked commit/migration and verify recipe route behavior and environment/token isolation                                                                                       | Separately authorized Hetzner Dev                                        |
| REC06-N01 | Fridge plus cabinet, permission denial/cancel, normalization/multipart, duplicate review, unsupported state and amounts                                                                      | Physical iOS and Android standalone Dev                                  |
| REC06-N02 | Same Meals/Coach state; logged-so-far gaps/unknown context; small/max-font, keyboard, light/dark and VoiceOver/TalkBack                                                                      | Both physical platforms                                                  |
| REC06-N03 | Browse/cancel/portion creates no intake; selected serving editable; Save/reopen/lost-response/app-kill/double tap resolves one operation; deliberate repeat stays explicit                   | Both platforms against exact Dev                                         |
| REC06-N04 | Storage capacity/failure, startup expiry, stale diet/day/goal, export/erase, consent revoke/regrant and late callbacks                                                                       | Both platforms; synthetic owners                                         |
| REC06-N05 | Account switch during provider dispatch and retained Save cannot redirect data; raw images cleaned; deletion retires queued local writes                                                     | Two authorized synthetic owners                                          |
| REC06-V01 | Authorized adult pilot: time to usable suggestion, correction burden, actual cooking/logging/repeat use, abandonment interviews                                                              | Separate participant authorization and privacy-safe evidence             |
| REC06-R01 | Production/Store promotion with existing backup, migration, native/privacy/provider gates                                                                                                    | Separate release milestone                                               |

This protocol authorizes no live provider call, service/configuration change, installation, pilot, deployment or release. [Current evidence](AI_MEAL_RECIPES_REC06_EVIDENCE_2026-10-13.md) records actual checks and the exact remaining first action.
