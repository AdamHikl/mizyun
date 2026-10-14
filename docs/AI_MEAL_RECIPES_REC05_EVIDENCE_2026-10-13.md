# AI meal recipes — REC-05 flow and consumed-serving evidence

> Local work under [#241](https://github.com/AdamHikl/mizyun/issues/241), baseline `0135228778059dc25c1a4925738f0b6934ed4f0c` plus accepted REC-01–04 dependencies and owned overlays. Source is uncommitted. No push, deployment, live provider request, native installation or Production release.

## Implemented behavior

Meals and Coach share **What can I cook?**. Confirmed typed/photo ingredients require explicit catalog and preparation choices before suggestions. Preferences include prep time, meal size and exclusions. Cards and details label estimated nutrients and logged-so-far context; unknown context shows **Macro fit unavailable**. Portion changes scale original reference values and declared cooked yield in core and rerank without a model. Current server revalidation gates cooking and recipe-derived drafts after expiry or input/constraint changes. Offline failure preserves archival details and ordinary manual logging.

[ADR0061](adr/0061-recipe-session-and-consumed-meal-handoff.md) records provider-free owner-scoped context/revalidation, strict bounded 24-hour encrypted recovery, startup pruning, export/erase and lifecycle fences. Raw photos are excluded. Selection persists its operation before staging an editable meal draft. Every unrelated saved form, including advanced-only or blank forms, needs explicit replacement; an unresolved submission cannot be replaced. Only Save creates intake. Frozen submitted bodies survive lost response, restart, Clear, age, recipe expiry and AI revocation. Bounded completed-operation receipts prevent old selections from restaging changed timestamps; explicit separate consumption creates a new identity. Required storage failures block dispatch or navigation and offer retry.

Explicit current remote adult consent plus successful local persistence remounts the flow through an owner grant event. Cached readiness, failed/local-only saves and retired writes cannot restore AI access. The consumed meal's originating owner/session scope reaches the real HTTP transport separately from the frozen payload; delayed authentication cannot send that payload under the next account.

## Automatic verification

The settled isolated candidate passed `pnpm check`, including formatting, navigation, types, iOS/Android bundle exports, workspace tests and required tooling safeguards. Input SHA-256: `d5c2964b2e85ce5762d963f66e76b67eb8e39c616e79ef0d94e6dd40360ba861`. [Receipt](evidence/meal-recipes-rec05-2026-10-13/verification-receipt.json), [full-gate summary](evidence/meal-recipes-rec05-2026-10-13/full-check-summary.txt) and [candidate/source hashes](evidence/meal-recipes-rec05-2026-10-13/candidate-manifest.json) define the exact scope. Three credential-gated API suites/15 tests were skipped, not passed; provider integration was not run.

Focused candidate mobile checks passed 491 tests/30 files before the final collision repair; the changed collision tests then passed 8 tests/1 file. Save transport repair passed 94 tests/3 files, and both required-read analytics mock repairs passed. These overlapping runs are not additive. The final full gate includes all settled tests and the collision repair.

Fresh independent non-author High reviews accepted backend/contracts/client, meal durability, shared flow/privacy, consent recovery, Save transport and the final collision repair. [Review record](evidence/meal-recipes-rec05-2026-10-13/independent-review.txt) records findings, repairs and fixed hashes. Catalog-reference invalidation, local-midnight freshness, delayed account-switch dispatch and advanced-only draft preservation defects were repaired inside REC-05. The retained-Save race was reproduced against HEAD: one next-account POST; repaired source rejects before fetch.

Earlier gate attempts exposed a reused REC-04 receipt formatting issue and two analytics mock failures; both were repaired. A run stopped safely for consent recovery, and a later passing run preceded the final collision fix. The fingerprint above supersedes those earlier results. No gates, assertions, timeouts, isolation or thresholds were relaxed. Post-gate handoff changes are documentation only; [handoff checks](evidence/meal-recipes-rec05-2026-10-13/handoff-check-summary.txt) and unchanged runtime hashes preserve acceptance.

## Candidate and acceptance boundaries

Candidate: `/private/tmp/mizyun-rec05-20261013-01a12b31`, exact baseline `0135228778059dc25c1a4925738f0b6934ed4f0c`, accepted REC-04 dependency fingerprint `e877a50ffff34f48812db4df17e1fb84cf28a273bc65084260dba4a76095bd0f`. It contains 63 whole overlays,10 shared owned ranges and public core/contracts exports across 75 source paths, with 36 workspace links rebound. Whole runtime overlays match source bytes; shared files preserve dependency context and include only owned changes. Concurrent Community/cache/analytics/meal-copy/Coach runtime, unrelated migrations and continuity work remain preserved in the shared tree and excluded from this candidate's runtime scope.

Native SecureStore capacity, photo/multipart, app-kill/restart, small/max-font/themes/VoiceOver/TalkBack and signed-in iOS/Android journeys remain open. Qualified nutrition/food-safety review and REC-06 permitted provider/cost/latency and Dev acceptance remain open. Bundle exports and synthetic races do not accept those journeys. Live recipes remain disabled. #241 stays open; local engineering is automatically verified.

## Next exact action

Implement the offline REC-06 evaluation package from the [plan](AI_MEAL_RECIPES_PLAN_2026-10-12.md#rec-06--evaluation-dev-acceptance-and-product-validation): freeze at least 40 deterministic recipe/context fixtures and 20 synthetic ingredient-photo scenarios and thresholds before observing live results. Live provider calls, installs, deployment, pilot and Production release remain separate authorized milestones.
