# Copied-meal routine suggestion refresh — 2026-10-14

User report: a meal copied to today did not show a recurring suggestion. Package: NUTR-REC-002 / [#242](https://github.com/AdamHikl/mizyun/issues/242). Baseline: `d7e2055b260552c785325414756c6beeea1b7d8c`, already delivered to Dev with migration20261013120000. See [original implementation/acceptance](MEAL_ROUTINE_SUGGESTIONS_EVIDENCE_2026-10-13.md) and Dev delivery.

## Verified findings

Copies preserve name/basic macros/grams, remove the automatic marker and are confirmed by the existing food creation route. They record `consumedAt` at the action time. The existing detector requires matching servings on today/yesterday/day-before with a90-minute total local-time spread. A copy two hours later than the prior entries therefore does not qualify. That policy was not changed; no old food timestamps or nutrition were mutated.

A real client refresh race was separately reproduced. Live food history updates during focus/foreground detection were discarded by the foreground-readiness action gate. When a detection was already pending in the ready state, refresh awaited the old request and returned without a post-copy read. A successful copy could therefore leave the old no-suggestion result visible until a later foreground/focus refresh.

These findings do not identify the exact cause for the user's meal. The requested meal/app/timing information remains necessary to distinguish eligibility, app delivery and the reproduced race. No personal meal data was read or changed and no Dev feature was disabled.

## Repair and verification

Only two source files are owned: `recurring-meal-suggestion-data.ts` and `recurring-meal-suggestion-hook.test.ts`. Read invalidations are admitted while route-visible/focused/app-active even when suggestion actions remain held. They force a trailing fresh detection, join concurrent waiters and advance activation fencing so older completions cannot restore display/impressions/actions. Events arriving during the trailing read queue another read. Suggestion reads do not feed the subscribed food/schedule cache events.

Two new mounted-hook regressions first failed, then passed: copy/history updates during initial focus and an already-pending detection; duplicate updates with delayed fresh storage; no early display, impression, acceptance or retry; one trailing fresh offer. All82 recurring tests and mobile typecheck passed. An independent non-author Sol High review accepted the exact frozen two-file diff without blockers; it did not claim independent rerun or native acceptance.

Stable candidate: `/private/tmp/mizyun-mrs-copy-20261014`, detached baseline above plus only the two owned paths. All pre-existing dirty Meals/recipes/policy/operational/continuity changes are excluded. Installed third-party package directories are shared; all workspace links resolve inside candidate. Formatting, navigation, diff whitespace and final candidate82-test focus passed. [Candidate hashes](evidence/meal-routine-copy-refresh-2026-10-14/candidate.json), [owned diff](evidence/meal-routine-copy-refresh-2026-10-14/owned.diff), [focused log](evidence/meal-routine-copy-refresh-2026-10-14/focused.log).

Full isolated `pnpm check` **PASS**, input SHA-256 `e088eb59049a9e32e91ec2351026d3e8a092a797956a930998c08a683d9f42b7`. Both mobile bundles passed;2,586 mobile and1,109 API tests passed, with15 existing gated API tests skipped. [Full gate](evidence/meal-routine-copy-refresh-2026-10-14/full-check.log), [navigation](evidence/meal-routine-copy-refresh-2026-10-14/navigation.log). All owned source hashes still match after the gate. Post-gate evidence/status/issue updates are outside the immutable candidate fingerprint. The repair is local/uncommitted and is not in the installed Dev app. No push, deployment, installation, provider call or database operation was performed. Next: accepted source delivery/client update, then native Copy to today with known eligible history and confirmation of the reported meal's eligibility. Original both-platform/travel/recovery/AX/pilot/Production exits remain open.
