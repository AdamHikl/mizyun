# Health run imports and Log run shortcuts — evidence (2026-10-16)

Issue [#216](https://github.com/AdamHikl/mizyun/issues/216) RUN-06 plus Log run improvements. Decision: [ADR-0065](adr/0065-selected-health-run-imports.md) (Adam chose "Save to account, Dev only" on 2026-10-16). Baseline `25402d40`; author Claude Code coordinator with Sonnet (Log run) and Opus (native, backend) helpers.

## Scope

- **Log run:** 5K/10K/Half/Marathon chips set exact metres (display rounded to 2 decimals); **Same as last run** fills duration, distance, environment and name (not date, effort or notes) and appears only on an empty new form. Imported runs open with date/time/duration/distance locked.
- **Native:** `MizyunHealthConnections` read kind `run` — HealthKit `.running` + `distanceWalkingRunning` via `statistics(for:)`; Health Connect running/treadmill sessions + `READ_DISTANCE`, distance aggregated per session data origin. Missing distance stays null.
- **Mobile:** Workouts → **Import runs** (Dev variant, iOS/Android) — in-memory 30-day picker, Possible duplicate (logged runs, date-only runs, overlapping Health copies), fail-closed when existing runs can't be read, per-run idempotent saves with retry, cleared on leave/background/account change. Run card/detail show source and duration basis. `include=imports` is sent only by Dev builds.
- **Backend:** migration `20261016120000_running_health_imports.sql` (origin union, `durationBasis`, `workouts.source` `health_import`, partial unique index, `run_import`, read-only imported metrics in `run_update`, `run_list` `p_include_imports`); `POST /v1/runs/imports` only when `MIZYUN_ENVIRONMENT=dev`; Coach grounding excludes imports and the Coach workout-edit lookup now excludes runs.
- **Copy:** iOS `NSHealthShareUsageDescription`, Android Health rationale, in-app intro and Coach app knowledge describe selected-run account storage.

## Reviews

- Independent Opus review: no blockers. Five should-fix items resolved: storable IANA zones (Health Connect offsets fall back to the device zone), session no longer reset by token refresh, Dev-only `include=imports` for older APIs, overlapping candidates unselected, fuller storage copy. Nits fixed: inactive ≠ background, background save clears records, manifest comment, chip display.
- Bounded Opus review of the fixes: all correct; background read now also clears; overlap label corrected. Remaining low items tracked in [#275](https://github.com/AdamHikl/mizyun/issues/275).

## Checks (fresh, this session)

- `pnpm check` PASS, input SHA-256 `ea01e3a83ada9d59a58da2798dc673f8bcb6cd16ea31e13d610fe7d253042fab`: mobile 2865, API 1150 + 15 skipped, core, contracts, adapter, config, agent-runtime all pass. The first run failed on the Coach route-ownership check (`import-runs.tsx`), fixed in `app-capabilities.ts` before the passing run.
- Database: helper applied the migration with all 48 pgTAP files inside a rolled-back transaction on the local disposable database — 1,467 assertions, 0 failures (0047: 70). `pnpm db:verify` (reset) **not run**: other local sessions were active on the shared local database.
- Native: Swift `swiftc -typecheck` (iOS 16.4 simulator SDK) and Kotlin compile against Health Connect 1.1.0, both with Expo stand-ins. No Xcode/Gradle build, no device run.
- After the gate, only this file and `status.md` changed (formatting and status limit checked separately).

## Open gates

- `pnpm db:verify` on a free local database; Dev deployment (migration) and a new Dev native build.
- Device acceptance on iPhone and Android: real sources (Apple Watch, Strava/Garmin), exercise-without-distance, revocation mid-read, paging, Health Connect rate limits, VoiceOver/TalkBack, large text.
- Production: privacy policy, Store/Play declarations, variant-specific usage text ([#275](https://github.com/AdamHikl/mizyun/issues/275)); Coach eligibility decision ([#273](https://github.com/AdamHikl/mizyun/issues/273)); export `source` label ([#274](https://github.com/AdamHikl/mizyun/issues/274)).
