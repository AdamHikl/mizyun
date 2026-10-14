# All-local separate-commit delivery — 2026-10-14

## Authorized scope and baseline

Adam requested committing and pushing all current changes in separate commits. Baseline is main/origin/main `0135228778059dc25c1a4925738f0b6934ed4f0c`; initial fetch found zero divergence. The initial inventory contains 425 changed/new nonignored files, including source, migrations, tests, plans and qualified local evidence. Ignored credentials/native artifacts are excluded. Secret-pattern checks found no potential private-key/API-key/token literals; the sole new raster is an aggregate registration chart with no account identities or health values.

Prior individual acceptance remains dated: [Oct11 all-local source](ALL_LOCAL_MAIN_INTEGRATION_2026-10-11.md), Community meals#238, consent reminders#239, registration zero days#240, photo copy#237, first-render cache#182, recipeREC01–06#241 and routine suggestions#242. Earlier isolated gates intentionally excluded concurrent packages. This delivery requires fresh combined-source review and verification; it does not turn those older results into current acceptance.

## Commit grouping

1. Engineering workflow rules: bounded agents, stable candidates and review scheduling.
2. Registration analytics: UTC zero-filled daily registration series and evidence.
3. Coupled nutrition/runtime integration: private Community meal sharing, recipe flow/budgets, routine suggestions, copied-photo recovery, first-render caches, account export/erase and shared API composition.
4. Recipe offline evaluation: frozen corpus/thresholds, scorer, CLI and synthetic safety tests.
5. Product plans, requirements, ADR/research/feature-map documentation and delivery receipts, with this consolidated handoff.

The shared account, meal, auth, cache and composition files contain multiple features. Whole-file staging keeps that integration intact; no feature is claimed as independently separable from those shared runtime changes. Everything is pushed only after the final combined tree is verified. No force push, deployment, installation, live provider call, new credentials or Production release is part of this request.

## Stable candidate and verification

Candidate `/private/tmp/mizyun-all-local-20261014-01a12b31` derives from baseline above and contains all tracked source plus all nonignored untracked files present at capture. Initial 2,335 source files matched root bytes exactly, with 36 workspace links rebound. Installed third-party libraries are reused; workspace imports resolve into the frozen candidate. Required tracked native-module scaffolding and Expo/Sharp dependencies are present; generated physical-native projects are not required or accepted by bundle checks. Formatting and navigation prechecks passed. Static navigation unresolved-import warnings remain advisory; actual type/bundle checks remain required.

Focused combined checks passed 204 API / 1,004 mobile tests plus the affected core/contracts/client/providers/adapters, six public recipe boundaries, 69 analytics-dashboard tests and 11 scorer / 81 reference checks. Backend integration review accepted 23 frozen shared paths. Mobile integration review accepted the remaining joins but reproduced two local-erasure races: meal completion receipts and analytics reminder preferences could reappear after actual deletion while native writes were delayed. Both were repaired inside this delivery, with regression failures demonstrated first. The settled repair check passed 104 tests / 7 files and mobile typecheck. Fresh non-author High repair-only review accepted both fixes with unchanged hashes and no findings. Final combined `pnpm check` PASS, input SHA-256 `9e712a1fa9255c7a69c9bde4a0c2ede556731e2107838f8e184ee43da92a8216`. Both bundle exports, typechecks, workspace tests and required tooling safeguards passed. Fifteen credential-gated API tests/three suites were skipped, not passed. [Gate summary](evidence/all-local-separate-commits-2026-10-14/full-check-summary.txt), [manifest](evidence/all-local-separate-commits-2026-10-14/candidate-manifest.json) and [reviews](evidence/all-local-separate-commits-2026-10-14/integration-review.txt) record the exact source scope. [Commit mapping](evidence/all-local-separate-commits-2026-10-14/commit-mapping.json) records the source commits; the documentation commit contains this record. Remote correspondence is verified after the normal push and reported in the delivery response. Runtime hashes remain fixed. Source commits preserve separate Dev/native/provider/qualified-review and Production/Store gates.

## Remaining acceptance

Current Dev and Production authorities remain those in `status.md`; pushing source does not deploy them. Existing credential-gated Auth/persistence/deletion suites, both-platform standalone native/accessibility/lifecycle checks, qualified recipe nutrition/food-safety review, authorized provider/cost/latency/aggregate-spend acceptance, routine tomorrow/app-closed behavior, and participant/Store gates remain open. Live recipes stay disabled. Community simulator work previously deferred by Adam is not resumed by this Git request.

The Oct14 [iPhone installation](DEV_IPHONE_LOCAL_DELIVERY_2026-10-14.md) arrived as a concurrent post-check record and is included in the documentation commit. Its source manifest predates the two runtime erasure repairs; it does not accept this final Git source or prove backend delivery. An initial full-gate attempt stopped at a missing link to that newly arrived record before expensive checks; the complete documentation inventory was reconciled and navigation/formatting passed before rerunning the settled gate.

## Source commits

- `73778668ae63e3cf3e76cf44a6ecb6ef72b7b023`: chore(agents): bound delegation and stable verification (#236)
- `d0276cdc38315e6f606749227b39bba92dd0933a`: fix(analytics): include zero-registration days (#240)
- `e2452f01d7e49369de3145fad8e096c01ad99f8d`: feat(nutrition): integrate recipes, meal sharing and routines
- `428c317448dbfdbf7a801aff82ca4fd0b81f6728`: test(recipes): freeze offline corpus and safety evaluation (#241)

The fifth commit contains the documentation and qualified evidence. All runtime source remains byte-for-byte equal to the reviewed combined candidate. Final push verification belongs to the delivery response so this record does not require a self-referential commit SHA.
