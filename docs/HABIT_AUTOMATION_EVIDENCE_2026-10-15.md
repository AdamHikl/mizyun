# Habit automation evidence (#253–#257), 2026-10-15

Source commit `e2ee8b3ab5acfc602eb4e2e95236850f913072fd` on `feat/248-weekly-calorie-review` (parent `4cdf98e3`). Not pushed or deployed at the time of writing. Another session's uncommitted workout edits (`log-workout-screen.tsx`, `one-time-workout-screen.test.tsx`, `planned-set-types.ts`) were excluded from the commit and the gate.

## Scope

- **#253 weekday meal rhythms:** `weekly_pattern` / `mrs-weekly-2w-v1` proposals for identities logged on both occurrences of 2–6 weekdays over 14 days. A clean rhythm (no weekday seen only once) beats a 3-day daily chain; daily proposals are byte-identical otherwise. New security-definer `recurring_suggestion_validate_weekly` and dispatch (`supabase/migrations/20261015130000_recurring_meal_suggestion_weekly.sql`), adapter and in-memory API windows widened to 14 days, contract reason/evidence updates, card copy ("Auto-log these days", spoken day names), ADR-0062 amendment.
- **#254 quick-add:** `packages/core/src/meal-quick-add.ts` ranks 30-day frequency weighted to the current time of day; log-meal shows up to six chips with "Usual now".
- **#255 workouts:** repeat last completed workout (routine sessions restart the routine; one-time sessions reseed exercises without stale loads), save-as-routine suggestion for an exercise set completed 3+ times in 28 days (explicit save with `clientOperationId`, 30-day per-user dismissal cleared on account deletion), one shared start guard.
- **#256 weight:** last value as placeholder/hint with explicit "Same as last"; opt-in weigh-in reminder (default Mon/Thu 07:30 when enabled, neutral copy, owner-fenced scheduling, sign-out suspend, deletion clear, owner-checked tap routing).
- **#257 learned reminders:** `packages/core/src/reminder-timing.ts`; first-meal and evening cards offer Apply/Dismiss for learned times (≥5 logged days, ≥30 min difference); evening save now respects a logged evening meal.

## Verification

- Focused suites by helpers and coordinator (core, contracts, adapter, API, mobile recurring-meals/log-meal/log-weight/settings/workouts/composition) passed; `pnpm db:verify` on the local disposable DB passed with 0044 and new 0046 (47 files, 1397 tests) before the core-only priority refinement (SQL unchanged afterwards).
- Independent Opus reviews: weekly SQL/parity (400 core→SQL proposals across 9 zones incl. Lord_Howe DST validated; 60k-case daily differential identical; tamper probes rejected) and reminders/workouts/quick-add. No blockers. Fixed: routine suggestion suppression and idempotent save, shared start guard, repeat row hidden while active, quick-add formatter cache, recovered-draft weigh-in marking, spoken weekday labels, Coach capability copy.
- Full gate on an isolated clean worktree of `e2ee8b3a`: `[check] PASS` (input SHA-256 `a6bdae95…05ce`); mobile 229 files / 2773 tests, API 1123 passed + 15 skipped.

## Open gates

- Push, Dev deploy and a Dev app rebuild; native/device acceptance for every feature; VoiceOver/large text; Android.
- **Release ordering:** app builds before this commit parse only daily proposals and hide the card when the server's best offer is weekly. Ship the mobile build before (or gate weekly by client version for) any Production backend promotion.
- Deferred lows: evening reminder save has no owner fence during sign-out (pre-existing); reminder Apply also saves other unsaved picker edits; weigh-in runtime activation does not retry after a thrown sweep; suggestion history fetch lacks `expectedUserId`; failed routine "Not now" is silent; quick-add deliberately excludes auto-logged recurring meals.
