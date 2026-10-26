# History import (#333, GTM-02) — 2026-10-26 handoff

Design: [ADR-0083](adr/0083-history-import-batches.md). Research: [research log 2026-10-26](RESEARCH_LOG.md). Export/erasure: [inventory §2.5b](ACCOUNT_EXPORT_INVENTORY.md).

## Implemented (source only)

- **Parsers** (`packages/core/src/history-import-*.ts`, pure): Hevy CSV (kg/lbs, km/miles, set types incl. `dropset`), Strong CSV (comma and quoted-semicolon variants, unit suffixes and per-row unit columns, `W`/`D`/`F` set orders, `1h 5m` durations, Rest Timer rows skipped), Strava `activities.csv` (positional duplicate columns, Run/Trail Run/Virtual Run only, other types counted), generic CSV. Row-level issues with line numbers, DST-correct local→UTC, limits. Exercise matcher (exact, "Name (Equipment)" reorder, aliases, token key, explicit Hevy/Strong alias table, suggestion). Write plan with catalog/custom/skip mapping. Fixtures for all four formats in `packages/core/fixtures/history-import/`.
- **SQL** `20261026160000_history_imports.sql`: `history_import_batches` (owner select RLS, `user_id` index, RPC-only writes), `workouts.import_batch_id`/`import_key` with a per-user partial unique index, `source = 'file_import'`, provenance guard trigger, `file_import` run origin in `run_validate`/`run_workout_guard`/`run_update`, `run_list(..., p_include_file_imports)`, RPCs `history_import_begin/exercises/write/finish/delete/check`.
- **API** `/v1/history-imports`: `POST /preview`, `POST /` (confirm, 26 MiB body limit with authentication before the body is read, chunks of ≤200 records and ≤2,500 sets, idempotent by batch id + request digest, resumes after a lost response by chunk index), `GET /`, `DELETE /:id` (undo in slices of ≤100 records / ≈5,000 sets). Preview/confirm need `MIZYUN_ENVIRONMENT=dev` or `MIZYUN_HISTORY_IMPORTS_ENABLED=true`. `GET /v1/runs?include=all_imports` adds file-imported runs; `include=imports` is unchanged for installed builds. Account export adds `historyImports { batches, records }`. The workout adapter no longer rewrites `source` on update.
- **Mobile** Workouts → Import history (Dev): pick file (expo-document-picker), preview, map exercises, confirm, result, undo; previous imports with undo. Runs list asks for `all_imports` when enabled; file-imported runs show "Imported from Strava export" with locked metrics.

## Review

Independent Opus review of the write path (author ≠ reviewer), then two bounded re-reviews of the fixes; final result: no blockers or should-fix findings. Fixed from the first review: chunks and undo exceeded the 8 s `authenticated` statement timeout at the file limits (now set-budgeted chunks and sliced undo); quadratic overlap scans (index-bounded window); NUL/control characters and split surrogates in file text (stripped, code-point slicing); unmapped DB errors as 500 (now 422/503); a late replay of a finished batch answered 409 (now a no-op); null-unsafe SQL validation and special timestamps; cross-user scan in exercise cleanup; non-atomic in-memory chunks. From the re-review: overlap with date-only runs and parser bounds matching the new SQL limits. Documented instead: zone-dependent dedupe keys, brief global Community lock per chunk, exercise reuse ignoring tracking type, the `all_imports` deploy order.

## Evidence

Focused checks on the final tree (the full gate result is in `status.md`):

- Core `pnpm --filter @mizyun/core test`: history-import suites 62 tests plus plan/run-origin tests; whole package green.
- API `src/modules/history-imports`: 15 tests (two-user isolation, replay/conflict, lost-response resume over 205 workouts, late replay after completion, atomic chunk rejection, control-character stripping, duplicates and overlaps, Strava runs and legacy `include=imports`, read-only run metrics, undo, export, 401-before-body/413/422 limits, disabled routes).
- SQL: disposable `supabase/postgres:17.6.1.143` container (not the shared local Supabase DB) with storage/auth stubs and every migration applied: all 54 pgTAP files, 1,781 passing assertions; `0054_history_imports` 89/89, `0047_running_health_imports` 70/70. Two failures (`0004` test 7, `0005` test 7) are grant artefacts of the stub image and fail identically without this migration. `plpgsql_check` clean for the new functions. Under the real 8 s timeout: 2,500-set chunk 0.23 s, undo slice 0.08 s, 10,000-record preview check 0.07 s (local Mac; Hetzner CX23 will be slower). `pnpm db:verify` (Supabase CLI) was not run because it resets the shared local database.

## Open

- Real exports from Adam's Hevy, Strong and Strava accounts: confirm date formats, Strong set-order letters and that Strava `Activity Date` is UTC.
- Deploy the Dev API (migration `20261026160000`) before installing a build with history import: that build asks for `include=all_imports`, which an older API rejects. New Dev binary (expo-document-picker is native), iPhone pick/preview/map/confirm/undo and large-text/VoiceOver acceptance.
- Privacy policy and Store disclosure text before any Production enablement.
- Strava rides, swims and walks are counted but not imported.
