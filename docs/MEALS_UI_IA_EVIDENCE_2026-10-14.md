# Meals interface and hierarchy — 2026-10-14

Issue #203. Baseline `d7e2055b260552c785325414756c6beeea1b7d8c`. Source implementation only; Dev delivery and native acceptance remain open.

## Result

Move Log meal into a wrapping title row and remove the oversized duplicate logging card and explanatory subtitle. Recipes and recurring meals become bordered, descriptive shortcut cards with visible chevrons, full-card tap targets and wrapping layout. Group nutrient expansion with Meal history, label its weekly/meal scope and expose its expanded state to assistive technology. Reduce content gaps and day-card padding so the actual log is reached sooner. The account bar remains outside scrolling content. Routes, feature availability, consent, data loading, ownership, search/pagination, partial/unknown nutrition labels, date-specific adding, grouping and meal operations retain their existing behavior.

Owned source: `apps/mobile/src/features/log-meal/meal-list-screen.tsx` and its screen test. No backend, schema, domain calculation, dependency or native-build changes.

## Verification and review

- Focused `pnpm --filter @mizyun/mobile test src/features/log-meal`: 26 files / 412 tests PASS, including new primary/recurring navigation and nutrient expansion regressions.
- `pnpm --filter @mizyun/mobile typecheck`: PASS.
- `git diff --check`: PASS.
- Fresh Sol Medium read-only helper explored IA/accessibility, then a separate fresh Sol Medium reviewer inspected the settled diff and unchanged path hashes: no blockers or adjacent findings. This is source review, not native acceptance.
- Screen SHA256 `6a0f3bcdc8a8611b165e633e55665a22a3897ee463b6fb29f813ef07465e181f`; test SHA256 `966545af9aec11da949846f3b0c2e73141746e7f3fe3cb0fb27b4508f26eaf8d`.
- Full `pnpm check`: PASS on `/private/tmp/mizyun-meals-ui-20261014-01a139bf-v2`, input SHA256 `bd69eaf3977e5d8424d1372f7eea151a8b33214d06fa39b37a66e7607af877c4`. Both native bundle exports, all typechecks, 2,586 mobile tests, 1,109 API tests and tooling/evaluation safeguards passed. Fifteen credential-gated API tests / three suites skipped, not passed. [Full gate](evidence/meals-ui-2026-10-14/full-check.txt), [focused check](evidence/meals-ui-2026-10-14/focused-check.txt), [manifest](evidence/meals-ui-2026-10-14/candidate-manifest.json). The frozen exact baseline includes the two reviewed source overlays, package documentation and required current continuity/policy documentation dependencies; concurrent recipe UI source/tests and feature-map metadata are excluded. Third-party dependencies are reused with36workspace links rebound into the frozen candidate. Git metadata, tracked native scaffolding, source hashes, formatting, links, focused tests and mobile typechecking were checked before the broad gate. Earlier Dev delivery does not include this UI. This final result paragraph and evidence receipts are post-check records; their document checks are run separately. No source changed after the review or gate.
- An optional synthetic HTML serialization was generated with fake meals. Browser local-file policy prevented visual inspection; it is not visual or native acceptance evidence.

## Next acceptance

Deliver this source to Dev and inspect Meals on the installed Dev app: primary logging, both shortcuts, nutrient expansion/collapse, history search/clear, current/historical/partial days, grouping/cancel and date-specific adding. Check small screens, dark/light themes, maximum font size, VoiceOver/TalkBack, keyboard scrolling and bottom-tab clearance on iOS/Android. Issue remains open until its installed Dev acceptance criteria pass. Production release remains separate.
