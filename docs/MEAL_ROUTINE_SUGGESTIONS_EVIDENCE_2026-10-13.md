# Meal routine suggestions — implementation evidence

Date: 2026-10-13. Package: MRS-01–04 / NUTR-REC-002 / [#242](https://github.com/AdamHikl/mizyun/issues/242). Source is uncommitted over Git baseline `0135228778059dc25c1a4925738f0b6934ed4f0c`; existing dirty meal/recipe/Community/account/cache/analytics work was preserved. See [specification](MEAL_ROUTINE_SUGGESTIONS_PLAN_2026-10-13.md) and [ADR0062](adr/0062-private-recurring-meal-suggestions.md).

## Implemented behavior

Home/Meals share one account-scoped card after exact confirmed intake on three consecutive local days. Explicit copies count, including copies of an automatic source and later photo attachment. Automatic ledger entries never count, including when their marker is removed. Identity preserves unknown versus zero nutrition, exact basic portions, NFC/whitespace and ASCII-only case normalization. History and search are bounded and fail closed.

Auto-log daily creates an owned schedule from tomorrow in one tap. Inline Change previews time/weekdays/first date; timezone conflicts require explicit choice. Atomic server revalidation, current-template equivalent detection, reciprocal manual-create checks, immutable receipts and today's skip prevent duplicate/replayed logging. Paused schedules stay paused and stopped acceptance cannot resurrect. Undo stops only a newly created schedule. Not now, permanent family dismissal, global control/reset, encrypted recovery, logout/account fences, export/erasure and private logging are covered.

## Actual focused verification

- Core:28 tests, including duplicate evidence resource bound and automatic/copy distinction.
- Contracts:38 tests across suggestion, recurring and account schemas.
- API:5 fallback repository and4 suggestion route tests;37 logging/recurring/suggestion/worker tests.
- Supabase adapter:14 suggestion and33 account export tests, including more than500 state/receipt rows and actual primary-key pagination.
- API client:3 real transport/owner-fence tests.
- Final mobile focus:188 tests across12 files passed (80 recurring including17 cleanup and3 mounted-hook regressions;6 auth,28 account,44 Home,30 Meals). Mobile/API/API-client/core/Supabase-adapter typechecks passed. Cleanup regression-first reproduced12 failures before repair.
- Actual local PostgreSQL:60 pgTAP plus5 concurrency assertions passed using a fresh schema-only disposable scratch database. Includes actual TypeScript detector proposal through SQL acceptance, microsecond evidence, authorization/erasure, concurrent same receipt/manual creation/worker/source deletion/account deletion. [Redacted log](evidence/meal-routine-suggestions-2026-10-13/database.log).
- Existing scheduler regressions with the new migration:52 real SQL assertions passed: nullable nutrition, entitlement downgrade, DST gap/fold, occurrence deletion, worker concurrency, skip/tick and Auth erasure. [Redacted log](evidence/meal-routine-suggestions-2026-10-13/legacy-database.log).

Both database harnesses targeted only their own disposable Mac scratch databases, dropped in finally. No Hetzner/Pi mutation, provider calls or shared database reset occurred. Provider integration remains gated by BEFORE_TESTING.

## Candidate and remaining gates

Stable candidate: `/private/tmp/mizyun-mrs-242-candidate`, detached exact baseline above, frozen pre-existing startup source as dependencies plus this package's owned overlay. External installed third-party pnpm package directories are shared read-only; copied workspace and virtual-store links all resolve within candidate. No source workspace dependency resolves to the mutable shared checkout. Initial offline install could not find a cached tarball, so existing dependency links were copied without package/version changes. Candidate source manifests/owned diff document correspondence and exclusions.

Independent High backend review found and then accepted repairs for capped-page exhaustion and unsupported numeric servings. Independent High mobile review found logout reactivation, background impressions and partial operational cleanup; focused repairs passed, including a reproduced foreground activation race; independent High repair review accepted all fixes with no remaining blockers. Final isolated `pnpm check` **PASS**, input SHA-256 `18b2558aaf6a05d00369bbb47c0ac675fa64e0f70dd1cb1a566eea4fda1726ba`. No commit, push, build installation, Dev deployment or Production release is claimed. Dev migration/API/client delivery and iOS/Android native small-screen/max-font/VoiceOver/TalkBack, two-account, travel, relaunch/lost-response and app-closed tomorrow generation remain open. MRS-05 product analytics/pilot/three-versus-five evaluation is deferred; no user benefit or optimal threshold claim is made. Issue #183 retains its existing open native/Dev gates.

## Review repairs

History exhaustion requires an empty cursor page, never a short capped response; repeated/nonadvancing pages, limits and trailing read errors cannot produce an offer. Numeric values above20,000 and unsupported names fail eligibility before producing a wire proposal. Mobile logout deactivates only its current captured session synchronously; a stale callback cannot deactivate a replacement. Foreground/focus refresh serializes after an in-flight detection, blocks old actions/impressions and redetects current timezone. Expected-operation cleanup uses a durable bounded tombstone before deleting chunks, so restart completes partial deletion without parsing removed health content. Unknown attempts remain until explicitly resolved or erased.

The shared checkout received30 unrelated `scripts/recipe-evaluation/` files during final verification. They are excluded from this package and candidate; their formatting/results are not accepted here. Frozen startup dependencies remain intact. The candidate has61 owned source/docs/test paths; all reviewed source remained unchanged after acceptance apart from final test formatting.

## Final full gate

`pnpm check` passed on the frozen candidate after all owned source/focused tests/reviews/formatting settled. Both iOS and Android bundles passed. Mobile:208 files/2,572 tests passed; API:77 files/1,080 tests passed, with3 existing suites/15 tests skipped. All repository check stages completed; skipped provider/credential-dependent tests and native acceptance are not counted as passes. The first runner invocation could not inspect local processes under the sandbox (`ps EPERM`); the same unmodified candidate then completed through approved local execution.

[Full gate log](evidence/meal-routine-suggestions-2026-10-13/full-check.log), [candidate manifest](evidence/meal-routine-suggestions-2026-10-13/candidate-manifest.json), [review decisions](evidence/meal-routine-suggestions-2026-10-13/reviews.md), [188 focused mobile tests](evidence/meal-routine-suggestions-2026-10-13/mobile-focused.log), [86 final candidate recurring/auth tests](evidence/meal-routine-suggestions-2026-10-13/candidate-focused.log), and [navigation check](evidence/meal-routine-suggestions-2026-10-13/navigation.log).

All49 owned source paths still matched the accepted candidate after the gate. Post-gate status/evidence/issue updates are documentation only and outside that input fingerprint. Next exact action: isolate an accepted commit with the necessary existing dependencies, deliver migration/API/client to Dev, then perform the listed both-platform native acceptance. Source verification does not close the Dev/native/pilot exits. No commit or deployment was performed.
