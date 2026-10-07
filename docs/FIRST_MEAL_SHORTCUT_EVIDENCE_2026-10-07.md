# First-meal dashboard shortcut evidence — 2026-10-07

Tracking: [#222](https://github.com/AdamHikl/mizyun/issues/222), follow-up to [#118](https://github.com/AdamHikl/mizyun/issues/118).

## Scope and behavior

Local uncommitted correction on baseline `3984c35fe922f3ebd16abff850dc1302550da9e8`. Preserve all pre-existing workspace changes; this package owns four dashboard files and adds only the `fetchFoodDateHistory` mock in the already-dirty analytics UI test. Coordinator owns research/status/evidence documentation. No commit, push, deployment, installation or Production release was performed.

The card reads the complete previous local calendar day through the existing `fetchFoodDateHistory` loader. That loader follows pagination, queries a UTC superset, filters exact local-midnight bounds, and discards partial results on failure. The selector chooses the earliest valid `consumedAt` with a nonblank name, independent of input ordering and creation time. Empty/unavailable yesterday retains Log a meal/reminder actions without an older suggestion. A day/scope change clears the previous suggestion while the new read is pending. Copy to Today receives the selected entry.

## Verification

- Helper GPT-6.1 Sol / Medium owned only selector regressions: before fix **3 failed / 43 passed**; after fix **46 passed**. Synthetic regression cases cover descending/shuffled chronology, late-created early meals, empty/blank names and invalid timestamps.
- Coordinator final focused command: `pnpm --filter @mizyun/mobile test src/features/dashboard/dashboard-data.test.ts src/features/dashboard/dashboard-screen.test.tsx src/features/log-meal/meal-lifecycle-data.test.ts src/features/analytics/ui-screen-analytics.test.tsx` — **96 passed**, exit 0. Screen regressions cover nine entries, previous local day at month rollover, selected-entry copy, empty state, rollover pending read and read failure. Existing loader suite covers pagination, exact day boundaries, later-page failure and repeated cursors.
- Supplemental `TZ=Europe/Bratislava` screen/loader run — **45 passed**, exit 0, exercising the existing spring DST date fixture and local-day screen behavior. Final copy assertion was added afterward and passed in the final 96-test run.
- Scoped Prettier and `git diff --check` pass.
- Fresh serialized `pnpm check` — **PASS**, exit 0, input SHA-256 `11b95f00d13bb3b1b4e722e78ffcf1ffd05244745c52c8bb3ae477141ab965c4`. Whole current workspace passed, including **1,584 mobile tests** and **867 API tests**; API **15 tests / 3 files skipped** in opt-in Auth, persistence and account-deletion E2E suites because their configured/reachable Supabase-stack guards were not enabled. Live-provider evaluation remains separately gated. Initial sandbox invocation could not inspect processes (`spawnSync ps EPERM`); the approved rerun completed all gates. No source/test changes followed the passing gate; only this handoff and status/research tracking were finalized afterward and separately format/navigation checked.
- Helper read-only integration review: no blocking findings; suggested copy-button assertion added and passed before the full gate.

## Exact source correspondence

SHA-256 of final owned source/tests before full gate:

| File                                                                                    | SHA-256                                                            |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `dashboard-data.ts`                                                                     | `108055ddbf119a686602da423439b55b0b1639d77e1ccf6798e0f8cc774c250c` |
| `dashboard-data.test.ts`                                                                | `38f5a4fbc44cf5e13b076e8871b5be56b255d6b8269bf6002fab304ce79129a4` |
| `dashboard-screen.tsx`                                                                  | `9e490e560e8dfe9f826fc39d7ce5033de8d2609453ffb2c8148eedb6dafd093b` |
| `dashboard-screen.test.tsx`                                                             | `2a1a82d2d0077a6da5d567e4931b50227b3492443fd6eb589a0e25ec30b2edb1` |
| `analytics/ui-screen-analytics.test.tsx` (includes preserved pre-existing variant mock) | `85083a065d0c5b7ef115686bfa1fd0839b708fc6af74beb668a6914330d5e33c` |

## Delivery boundary

Local implementation and automated evidence are separate from delivery. This fix has not been built or installed on the iPhone. Next: include this source in an authorized Dev mobile candidate and accept the empty-today/yesterday-multiple-meals journey, earliest-meal Copy to Today and empty-yesterday state on the installed device. Provider integration, database/live services, native installs and Store actions were not run for this client-only selector fix.
