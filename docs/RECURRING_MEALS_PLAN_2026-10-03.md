# Recurring meal logging — 2026-10-03

User-authorized implementation under [#183](https://github.com/AdamHikl/mizyun/issues/183), extending NUTR-01/NUTR-02 with NUTR-REC-001. Baseline `5bdefa50220e890113642d88c41d0769d00a356c`, clean working tree; branch `codex/recurring-meals`. No roadmap sequencing or pricing change.

## Accepted behavior

A user chooses Repeat on a saved, confirmed meal, sets a local time (morning, evening, or custom), chooses every day or selected weekdays, and explicitly saves automatic logging. The schedule displays its IANA timezone. It stays anchored to that timezone while travelling until edited. A schedule snapshots the saved meal's foods/portions/nutrition; later edits to an individual entry do not silently change the routine.

Meals log on the backend while the app is closed, without AI calls or notifications permission. Generated entries display an automatic label and retain ordinary edit/delete. Users can change time/days, pause/resume, skip today, or stop. To change foods/portions, create a new routine from an edited saved meal and stop the old one. Creating, resuming or editing applies prospectively and never rewrites previous logs. Skip removes today's generated entry if present, and prevents later recreation. Pausing/stopping preserves existing history.

## Implementation sequence and ownership

1. Contracts, pure port, authenticated CRUD/skip API and isolated tests: backend helper owns the new feature files and package exports.
2. Forward SQL schedules/occurrence ledger, RLS, atomic user mutations and privileged materialization; Supabase adapter, server worker and account export integration: coordinator owns these files.
3. Meals Repeat entry point, schedule management screen, automatic label and retry/error states: mobile helper owns mobile files.
4. Independent non-author review of SQL, authorization, worker, export/deletion and final integrated diff: read-only reviewer. Coordinator resolves findings, verifies actual diffs, runs serialized final checks, and owns evidence/issues.

## Durable rules

- API and SQL derive ownership from the authenticated principal. Both tables have owner indexes and RLS; mutations are RPC-only.
- Schedule IDs are stable across request retries; creation replays the same operation and rejects a changed payload. A stopped schedule ID cannot be recreated.
- A unique schedule/local-date ledger and one atomic transaction prevent duplicates under retries, restart or simultaneous workers. Ledger survives ordinary meal deletion.
- Tick uses database time and local date with named-zone conversion. Recovery logs only the current local day, never earlier missed days. Spring DST gaps shift forward; repeated autumn times select the later standard-time instant. Maximum one occurrence per schedule/local date.
- Schedule mutation and tick lock the same schedule row. Account deletion admission blocks new materialization. Auth erasure cascades both tables.
- Meal snapshots come only from owned confirmed saved entries. Unknown nutrients remain null. Current advanced-nutrition entitlement is rechecked by the worker; expired access logs basic nutrients and leaves advanced fields null.
- Existing food source enum stays compatible; an additive details marker carries schedule/date/timezone provenance. Automatic entries are explicitly authorized by the routine, but are not independent confirmation that the person ate that meal.
- User export includes all schedule snapshots and occurrence records, including stopped schedules and skipped/deleted occurrences.

## Acceptance

Automated: schema validation, denied access, two-user ownership, lost-response retry and changed-payload conflict, pause/edit/skip/stop, worker overlap/shutdown/retry, nullable snapshots, entitlement lapse, real PostgreSQL RLS and direct-RPC validation, tick concurrency, deletion-resurrection prevention, account export/cascade, DST gaps/folds, then fresh `pnpm check` and navigation/diff checks.

Delivery: deploy the exact verified candidate to Dev and verify migrations/worker; install standalone Dev app and test creation at an upcoming minute with the app closed, reopen/totals/automatic label, correction, pause/resume, skip, stop, timezone display, network loss and two-account isolation. These are separate evidence tiers. Production promotion is not authorized by this implementation request.

## Evidence

Forward migration `20261003100000_recurring_meals.sql` passes on local PostgreSQL17.6 in a fresh schema-only disposable database. `python3 scripts/test-recurring-meals-db.py` passes **52 assertions**, including permissive default ACL denial, owner RLS/RPC denial, changed-payload retry conflicts, direct-RPC validation, snapshot nulls, deletion-resistant ledger, pause/prospective resume/edit retry, weekday/time, skip before/after, DST gap/fold, paid/lapsed advanced entitlement, four concurrent worker calls, skip/tick race, deletion/tick race and auth-user cascade. Only synthetic accounts are inserted; scratch database is removed in finally. Log `/private/tmp/mizyun-recurring-db-2026-10-03.log`. The earlier schema-only restore encountered unrelated extension ACL permissions; the reproducible runner excludes those and explicitly tests permissive Supabase default function grants. No shared/remote database was reset or migrated.

Focused checks: contracts22/core3; API recurring/account63 plus the final default-availability regression (routes18); persistent adapter/account30; dashboard data43; mobile recurring/meal/cache17files/183tests. Helpers implement disjoint API/mobile files. Independent non-author source review reproduced and resolved default function ACL exposure, owner lock ordering, entitlement statement race and in-memory erasure; UI review identified stale source preparation, overlapping retry writes, pagination boundary/race and inconsistent energy cache lifetime for same-session correction. Route tests use verified-principal fixtures, SQL tests impersonate actual PostgreSQL roles; neither proves a live Auth/PostgREST or installed-device journey. Final fresh `pnpm check` **PASS (exit0)** after all runtime writes settled, log `/private/tmp/mizyun-recurring-check-2026-10-03.log`: mobile1228/API821 (15 existing gated Auth/persistence/deletion E2E skips), contracts187/core354/server-adapter154, navigation116, all workspace typechecks, formatting, dual iOS/Android Hermes exports and all existing deployment/build/operations/AI-screener safeguards. Navigation ownership and `git diff --check` pass. Independent non-author review has no unresolved blocking finding. Same-session final review also rejects PostgreSQL system/POSIX timezone names that the wire contract cannot render; comparison of the remaining SQL-accepted names against current Node Intl has no mismatch. The final SQL runner includes all three direct-RPC denial regressions.

Dev backend migration/worker deployment, standalone mobile installation and physical app-closed acceptance are **not tested** by this session. Production is unchanged. Live-provider suites remain disabled under BEFORE_TESTING; recurring logging makes no provider call.
