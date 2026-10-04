# Quiet Home refresh and recovery (#194)

Implementation baseline: `952757444c07c51772e72d3084b702b7bd5cde26`, shared Mac checkout. Independent helper owns only the new dashboard screen regression suite; coordinator owns runtime, dependency and continuity work. Concurrent CI fixes advanced HEAD to `aa1b743`; a separate Home Steps shortcut and its analytics regression/research were preserved in the same files. No task-only committed SHA is claimed.

## Behavior

- Restore account/day-scoped saved numbers immediately without a warning before the live read completes. Keep visible values during foreground refresh and replace successful sections independently.
- Show compact notices beside failed nutrition, weight, energy or period-review sections. `You’re offline` requires an explicit device disconnection and a failed read; server errors and unknown connectivity say `Couldn’t update`. Keep the notice through retry until that section succeeds. `Saved` denotes local display-copy time, not backend freshness or an AI authorization lease.
- All Retry actions and pull-to-refresh invalidate personal session reads. Actual foreground return and confirmed reconnection retry automatically; restored internet reachability on an already connected network also retries. Minute polling runs only while Home is focused, foreground and not known unavailable. Initial network sampling cannot overwrite a newer listener event. Blur removes listeners/timers and retires pending presentation reads.
- Account/token, local-day/offset and selected review-period changes hide incompatible metrics. The existing version1 persisted snapshot carries optional UTC-offset metadata; Home requires the exact offset used for calculation, so legacy unscoped or mismatched snapshots cannot populate current-day totals. A failed current-day summary cannot fabricate a complete period review. Existing cache lifetimes, write invalidation, secure offline storage, Community authorization and live Coach readiness remain unchanged. No hourly background timer, model call or recommendation generation.

## Failure-first evidence

Helper baseline at 12:28:27 local time: `pnpm --filter @mizyun/mobile exec vitest run src/features/dashboard/dashboard-screen.test.tsx`, exit1, 5 tests: 3 FAIL/2 PASS. Cached startup before a pending read and an HTTP500 weight-only failure both displayed the global `Offline Snapshot`; Retry expected one session-read invalidation and observed zero. Retained data and foreground-resume checks already passed. Baseline outputs are retained in this session's tool transcript; no separate baseline log was saved.

An earlier `pnpm --filter @mizyun/mobile test -- <path>` mistakenly forwarded the path after `--` and ran all130 files (129 PASS/1 FAIL,1357 PASS/3 FAIL); it is not a focused baseline or final acceptance. Later runs use `exec vitest run`.

Timezone review additionally reproduced 2 failures with all13 pre-existing storage tests passing, `/private/tmp/mizyun-home-refresh-timezone-baseline.log`. Exact-offset matching now restores data; a same-date different-offset or legacy-unscoped snapshot is rejected. The independent reviewer accepted this follow-up without findings.

## Verification

Focused first settled pass 6files/96tests PASS, `/private/tmp/mizyun-home-refresh-focused-2026-10-04.log`: screen14, data43, storage15, session-cache16, startup3, analytics5. Mobile typecheck and diff checks PASS. Independent non-author review accepted the actual runtime/cache diff after timezone correction; no remaining findings. A further failure-first check caught unknown network state suppressing minute polling despite a successful API read (14 PASS/1 FAIL). Both UNKNOWN and absent type now retain polling and neutral failure wording; focused screen16/16 PASS. Final fixtures use synthetic nutrition values; a final16-test rerun after fixture sanitization also passed (`/private/tmp/mizyun-home-refresh-synthetic-fixtures-final.log`). Final isolated `pnpm check` PASS(exit0), `/private/tmp/mizyun-home-refresh-isolated-check-final-2026-10-04.log`: mobile1374/API837(15 existing credential-gated skips), contracts203/core373/server-adapter154; navigation116 (0errors/25advisories), formatting, all typechecks, dualHermes exports and all configured safeguards/evaluations. First isolated gate passed before the final known-type correction and was repeated for that change and the final synthetic-fixture cleanup. Config still has3 existing bundle-path skips; actual final iOS/Android Hermes artifacts independently passed the same3purity assertions each (6total). The isolated checkout `/private/tmp/mizyun-home-refresh-194` starts from `aa1b74359d5e5c08e2e724551a8c6175266bcf78` plus these owned changes and the preserved Home Steps shortcut/test; broader concurrent release-label edits are excluded. Its temporary initial Git snapshot091b69c is not a published application commit. Actual runtime/dependency/test hashes exactly match the shared source after the final gate; documentation evidence was updated afterward. This is not full acceptance of the concurrently changing shared worktree. No standalone native/device, live database/provider or deployment evidence is claimed here.

## Standalone device acceptance

Build a new standalone Dev iOS/Android candidate including `expo-network57.0.2`; an older native binary does not establish listener availability. Record exact source/backend SHA, app build and device identifiers.

1. Cold-open online with saved data: numbers appear promptly, no offline warning, then current data replaces them. Return between tabs without clearing content.
2. Enter airplane mode, then attempt refresh: saved values stay visible, notices identify affected sections. Restore connectivity while Home stays open: retry happens automatically and successful notices disappear.
3. Test Wi-Fi without internet, then restore internet on the same network. Test a backend-only failure while the phone has internet: use neutral failure wording rather than offline.
4. Retry and pull-to-refresh during a pending request; rapid taps must not apply stale responses. Background/resume during a pending request; leave Home and confirm no repeated background polling.
5. Log/edit/delete a meal, weight or workout and return: affected values update through existing write invalidation. Cross midnight/timezone and switch week/month offline: prior-scope numbers must not appear as current-scope records.
6. Sign out and switch accounts during pending refresh: no previous-account values or late responses. Check small screens, large text, light/dark, VoiceOver/TalkBack, and44-point Retry targets.

Issue stays open until these exact-candidate device exits are recorded. Local implementation does not deploy Dev, accept devices, or release Production.

## Verified source inputs

Exact SHA256 values of the isolated/shared runtime, tests and dependency inputs:

```json
{
  "apps/mobile/package.json": "95d8e3f84abcdc46f702cecbb1878828d538594db2a579a839ffa21f9d329f0d",
  "pnpm-lock.yaml": "dfb043aaee6e90f0d54aa80082e4581fd29c72c915a4a7b62a2dfd812789b286",
  "apps/mobile/src/features/dashboard/dashboard-screen.tsx": "0ac567a89fd2fb86f974cee2bf0b120e108f424efa5309e44fa70a5e817cc930",
  "apps/mobile/src/features/dashboard/dashboard-screen.test.tsx": "52f1af314a041181137c575e6d7765a870cb8ae4b9a8133bae5e717341ca4d70",
  "apps/mobile/src/features/offline-cache/offline-cache-storage.ts": "3c2ed2475eede4bfe8c1380d12cfcf08431e6097b81a79d177727ea8d0163253",
  "apps/mobile/src/features/offline-cache/offline-cache-storage.test.ts": "9f18c838a88b1b8cc6745a355e731deacaf836ec267e525b84826d50e53d7536",
  "apps/mobile/src/features/analytics/ui-screen-analytics.test.tsx": "f6032acdf7aa4d6fa97e632d562be5e1d743c489475e8d22b1d0ae6813121454"
}
```

iOS Hermes SHA256 `f589b357a56defbd09df9a77b083ea9c30ae304504dbc3c3b3a1e3c1f65f7aa2`; Android `d20e6c0c86632cb5cda1fa66c16f4446ceb80ff8acf7e15401cd56d4221073ef`. Exporting JavaScript bundles does not prove native connection-listener availability on an installed device.
