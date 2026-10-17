# Log activity: runs, free-text activity, any date, description drafts (#288)

Date: 2026-10-17 (Claude Code). Baseline `efdeb957c5a62047fa543184027a703467f93635`; committed as `47c814e5554d6e1dfc5480b79bdd150bbe9b1094` on main.

## Requested behaviour

- Workouts hub no longer shows **Log run**; running is logged from **Log activity** and saved through `POST /v1/runs` (idempotent `clientOperationId`). `/log-run` remains for editing or resuming existing runs; Log activity links to an unfinished run-editor draft.
- Activity is typed. `resolveActivityName` (core) maps everyday words and catalog names to running, a catalog activity, a sets-and-reps exercise (refused, use Log workout) or a custom activity (exercise found by exact name or created with `trackingMode: duration_distance`; a same-named sets-and-reps record is refused).
- Date: calendar picker for any past date (future days disabled) plus optional start time ("19:00", "7pm"). Without a time, today ends now and earlier days start at noon (unchanged estimate rule).
- **Describe it**: `draftActivityFromDescription` (core, deterministic, on-device; no AI provider, no network) fills activity, duration, distance, date, start time, run environment and a place note for review before Save. "Just" with a known duration sets the start time that long ago.

## Decision

Rule-based parser instead of a Gemini draft: the user's examples are covered without AI consent, cost, server deploy or sending health text off-device. AI drafting is tracked as an option in #289.

## Verification

- Focused: core `activity-description` + `exercise-tracking` 55 passed; mobile log-activity, running, workouts hub 94 passed; core and mobile `tsc` clean.
- `pnpm check` PASS on baseline + this diff: mobile 3138, API 1186 passed / 15 skipped (provider-gated), core 745.
- Reviews: independent Opus review (no blockers; 14 nonblocking findings, 1–13 fixed); bounded fix review (no blockers; edge cases for thousands separator, "for 400m", "in 45:30", strength distance field, stale notice, catalog load_reps record fixed with tests).

## Open

- Deployed to Hetzner Dev `47c814e5` (deploy:dev re-ran the gate; migrations up to date; public health 200 at 2026-10-17T13:05:22Z). The change is client-side: the installed iPhone Dev app needs a new build (`pnpm mobile:founder-dev:ios`) before acceptance. No device acceptance yet.
- #289: durable pending run across app restart, DST nonexistent start time, optional AI drafting. Known parser limits: earliest-named activity wins ("walked the dog then ran 5k" → Walking); standalone "seventy"/"eighty".
