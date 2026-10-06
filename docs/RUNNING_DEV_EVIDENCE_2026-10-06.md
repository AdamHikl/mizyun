# Running Dev implementation evidence — 2026-10-06

Current accepted Dev/source evidence and remaining native gates: [delivery follow-up](RUNNING_DEV_DELIVERY_2026-10-06.md). Earlier snapshots below are historical.

## Candidate and scope

Isolated managed worktree: `/Users/adam/.codex/worktrees/running-dev/mizyun`, baseline `f40e8941afc5307efce6d5c5909c0146ed1f3dda`. Implements manual running RUN-01–05 from [the researched plan](RUNNING_IMPLEMENTATION_PLAN_2026-10-06.md); [ADR-0046](adr/0046-manual-running-authority.md). Concurrent root health-preview and simulator changes are excluded and preserved. Imports, GPS recording, routes and structured running programs retain separate stages.

Workouts has direct Log run, required elapsed duration (minutes and seconds, including pauses), optional distance in km/miles, derived average pace, calendar date, environment, effort and notes. History has All/Strength/Running filters, weekly totals, pagination and View/Edit/Delete. Day-only creation does not invent a start time; edits preserve any accepted observed instant and exact canonical distance. Secure per-account drafts persist immutable pending operations before dispatch. Back saves a meaningful draft; pending creates can be cancelled safely. Hydration uncertainty fails closed.

The typed API stores one existing-workout session with a strict runSummary and atomically commits private operation receipts. CAS edits, deletes and pending-create cancellation reject stale resurrection. Generic strength writes, attached sets and Community publication cannot bypass invariants. Account export includes full summary and minimal owner receipts; erasure cascades receipts and clears local drafts. Resistance progression/counts and calorie credit exclude runs; bounded Coach context and the versioned app guide describe running separately. No new native permission or provider is introduced.

## Verification so far

- Core running13 and contracts13 passed; core energy25, Coach/energy/account71 passed before later account regression.
- Account export regression21 passed including preserving live/deleted receipts through export and rejected stale-create replay; local account cleanup15 passed.
- Backend focused runs/workouts/sets/community68; adapter run/workout12 and account21 passed. API/adapter/mobile typechecks passed at the reported snapshots.
- Mobile focused109 passed across9 files: storage/readfailure, lost response exact replay, cancellation supersession, CAS conflict, late-account completion, token refresh, precision preservation, form/detail/hub/cache/startup.
- `pnpm db:verify` passed on local disposable `supabase_db_mizyun`, port54322: reset through migration20261006120000, lint clean,33 SQL files/893 assertions. Existing Hetzner/Production databases were not touched by this check.
- Follow-up `0033_manual_running.test.sql`:40 assertions passed, adding denied anon/service mutation grants, denied authenticated receipt writes and direct set, publication, routine and challenge attachment rejection.
- Real simultaneous local transactions passed create/cancel in both advisory-lock orders and two-device CAS: one edit accepted, no resurrection. Synthetic Auth account/rows/receipts removed after verification. Coordinator probe `/tmp/mizyun-running-concurrency.py` used only the named local container.
- Independent High nonauthor source review resolved SQL explicit-null bypass, export clearing receipts, observed-start loss, imperial rounding loss and stale busy state. Final settled source review approved; the last Hub identity delta is undergoing confirmation. Full gate is recorded below when complete.
- Native iOS/Android Dev scaffolding generated; iOS CocoaPods installed. No native feature journey has been accepted yet.

## Open acceptance

These gates were pending at the initial snapshot; they have now passed on Dev938efc5, as recorded in the delivery follow-up. Physical iPhone/Android forms, keyboard/date editing, narrow/large text, VoiceOver/TalkBack, themes, offline/restart/lost response and signed-in Coach/run history journeys require exact installed-candidate acceptance. Production and Store delivery remain separate. Issue #216 remains active until its selected stage exits are accepted; later import/GPS stages are not claimed complete.

## Final source verification

All authors settled; final High nonauthor review approved, including the two-file owner-bound Workouts hub delta. Reviewed62-file digest `e262ea9ece77286190ecf592f15c04a1a58fe47fe2d7e9525238cf1b8653298c`; subsequent formatter-only changes have no semantic delta.

Coordinator final focused suites:238 tests passed (contracts13, core38, adapter27, API36, mobile124 including local account cleanup). Final SQL focused suite40 passed, including grant/receipt-write/set/publication/routine/challenge rejection. First full gate stopped only at two formatting failures; corrected owned files, reran adapter6 and full gate.

`pnpm check` PASS, input SHA-256 `5ea7f125a72a3977b27c68847d7e147af24faf72adc69d1103e9b34ec255e94d`: mobile1526, API860 plus15 existing integration-gated skips; both iOS/Android exports, typechecks, formatting, navigation117 tests, offline AI and all operational/build safeguards passed. Config81 tests has3 existing bundle-path skips (#179); bundle exports themselves completed. External-provider/Auth/Storage and native acceptance are not inferred from these skips.

Commit/Dev delivery and installation are recorded in the delivery follow-up. The baseline source is isolated from root concurrent health-preview/simulator edits; no Production promotion is authorized by this record.

## Live transport repair

Initial Dev2ea23093 accepted create/replay/pagination/owner isolation, but a stale edit raised40001 and PostgREST retried until500. Forward migration20261006183000 changes only run_create/update/cancel domain conflicts toPT409; adapter recognizes that code. Initial harness also used PATCH instead of PUT and an empty JSON body; corrected without runtime changes. All four synthetic accounts from those probes were deleted through the account lifecycle API. Further exact-candidate gate and live acceptance are recorded in the delivery follow-up.
