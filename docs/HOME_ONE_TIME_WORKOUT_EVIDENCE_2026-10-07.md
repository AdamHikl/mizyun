# Home one-time workout shortcut — 2026-10-07

Issue: #223; requirement: WO-07; related feature: #187.

## Source and scope

Uncommitted client correction on HEAD `3984c35fe922f3ebd16abff850dc1302550da9e8`. The shared tree already contains first-meal, meal-photo, running and Health work; those changes are preserved. Only the task additions in dashboard screen/test and this session's documentation are owned by this work package. No commit, push, backend deployment, mobile install or Production release was performed.

Home “Start workout” now calls the same public `createBlankWorkout("One-time Workout", operationId)` function as Workouts, then opens `/log-workout` with the exact returned ID. It bypasses the old name/notes form and bare-route unfinished-session selection. Active-session Resume remains direct. An immediate in-flight guard blocks duplicate taps; the UUID survives errors/throws and token refresh for the same account; late old-account responses cannot navigate or display an error. Busy/disabled state and “Starting…” feedback remain accessible.

Source hashes before full verification:

- `apps/mobile/src/features/dashboard/dashboard-screen.tsx`: `7bc37979da7257470b9ae4717bc6afd66f66105be7e794b8e7af75ad86cd5a9c`
- `apps/mobile/src/features/dashboard/dashboard-screen.test.tsx`: `7dd9f69ad022562c4de26a2434f397ef5e2f9b9a8d0acf8049f29d88337e3366`

## Verification

- Failure demonstrated before implementation: dashboard suite had 4 failures and 23 passes; Home pushed bare `/log-workout` instead of calling one-time creation. Existing Resume passed.
- Final focused command: `pnpm --filter @mizyun/mobile test src/features/dashboard/dashboard-screen.test.tsx src/features/analytics/ui-screen-analytics.test.tsx src/features/workouts/workouts-hub-screen.test.tsx src/features/workouts/workouts-hub-data.test.ts src/features/log-workout/one-time-workout-screen.test.tsx` — 85/85 passed across 5 files.
- `pnpm --filter @mizyun/mobile typecheck` — passed.
- Independent GPT-6.1 Sol Medium helper reviewed the actual task-only diffs against pre-edit snapshots, found no actionable issues, and independently reran dashboard 27/27. Helper made no edits.
- Fresh full `pnpm check` — passed on the current combined working tree; input SHA-256 `169590ee8847101588b5d30dd69d4a8124ab40a5bb9cc33dfff1b9f1aedf4947`. Mobile1589/146 files, API867/60 files; 15 credential-gated Auth/persistence/account-deletion e2e tests remain skipped. iOS and Android Metro bundles and all remaining quality/tooling gates passed. Live-provider, disposable-database and native-device acceptance were not run. Log: `/private/tmp/home-one-time-workout-check.log`. Task source hashes above remained unchanged after completion. Historical first-meal gates were not reused for this correction.
- Initial sandboxed full-gate launch stopped before checking with `spawnSync ps EPERM`; the authorized unrestricted canonical rerun passed. Only evidence/status text was finalized after the passing source gate; formatting/navigation/diff checks were rerun for those documentation changes.

## Remaining acceptance

Include this correction in the next Dev mobile candidate and accept Home start → empty one-time session → add exercises before first set → log → finish/history, plus active Resume, failed-start retry and accessibility on device. Native, Dev install/deployment and Production gates are unrun. #223 remains open for exact-candidate device acceptance.
