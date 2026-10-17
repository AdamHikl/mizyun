# Log past strength workouts — evidence (WO-08, #279)

Date: 2026-10-17 (Claude Code). Base `d175da95cd6505c707324d156bc6d94235bdaf5a`. Status: implemented locally; **not committed, deployed or device-accepted** at the time of writing.

## Request and decisions

Adam asked to log workouts completed earlier without a phone, from memory, without a live session. Decisions (2026-10-17):

- One form under Workouts → **Log past workout**, saved once; the draft survives restarts and nothing reaches history until Save.
- History/Home/progression only; past entries cannot fill an _earlier_ Community challenge day. The challenge picker keeps offering workouts completed on the challenge's local today, so a past entry dated today (e.g. a morning workout logged in the evening) is offered for today, matching the option as worded. The contribute RPC still accepts days up to 7 back for any completed workout, as before; enforcing `entryMode` server-side would need a challenge RPC migration and is not part of this package.

## Implementation

- `apps/mobile/src/features/log-past-workout/`: `past-workout.ts` (draft guard, validation, request building, resumable save, edit/discard release), `log-past-workout-screen.tsx`, route `app/log-past-workout.tsx`, modal registration in `app/_layout.tsx`, hub row and "Past workout saved" notice in `workouts-hub-screen.tsx`.
- Workout is created already completed (`startedAt` = local date + start time, `completedAt` = + duration; sets use `completedAt`), `details.sessionMode: "one_time"`, `entryMode: "past"`, lifecycle `session`. It never becomes the active workout and has no Health export marker (remembered, not observed times).
- Validation: valid local date/time (DST-gap times rejected), duration 1–720 min, must end before now (device clock), ≥1 exercise with a set, ≤100 sets, reps whole numbers, plain/comma decimals for weight, imperial converted to kg.
- Durability: SecureStore draft kind `past-workout` (wiped by sign-out/account deletion). Pending state stores only `{operationId, startedAt, completedAt, workoutId}`; bodies are rebuilt from the locked form so retries replay identical payloads and the stored value stays small (see RESEARCH_LOG SecureStore note). Workout create is idempotent by `clientOperationId`; sets are reconciled by `sequence` after a GET, so lost responses/restarts don't duplicate. Edit/Discard of a pending save deletes server remnants first (replaying the create to learn a lost id); a device-only escape exists only before a workout id was confirmed, with a warning.
- Previous performance (`recentForExercise`, Supabase + in-memory) now orders by `completed_at desc nulls last, created_at desc`, so backdated sets don't become the "last session". Port doc updated in `packages/core`.
- No migration, API route, schema or native dependency change.

## Verification (local, this worktree)

- Mobile `tsc --noEmit`: pass.
- `vitest` mobile `src/features/log-past-workout src/features/settings/account-data-management.test.ts src/features/workouts`: 20 files / 273 tests pass (past-workout logic 22: lost create response, partial resume, deleted remnant, account change, frozen instants, edit/discard release incl. history-edited 409, replay-then-failed-delete, offline/unconfirmed warned device-only release, reload after stricter validation; screen 3: empty save, restored save + navigation, set failure keeps pending/locked).
- `vitest` API `src/workout-set-repository.test.ts src/modules/workout-sets src/modules/workouts src/modules/coach/exercise-history.test.ts`: pass. The new route test (backdated create + replay + explicit-sequence sets + duplicate 409 + recent-sets) **failed under the old `created_at` ordering** and passes with the fix.
- Adapter `workout-set-repository.test.ts` 5/5; core `workout-set.test.ts` 27/27.
- Reviews (Opus, independent of the author): full review → permanent-failure lock, set-phase 409 copy, offline discard, late profile unit, strict numbers, draft size fixed; challenge finding resolved by the decision wording above. Bounded fix review → workout-phase 409 dead end (blocker) and replay-then-failed-delete orphan fixed. Second bounded review → all repairs confirmed; reload-after-stricter-validation dead end and duplicate warnings fixed.
- `pnpm check` on the settled uncommitted candidate (base `d175da95` + this diff), 2026-10-17: **PASS** — mobile 250 files / 3071 tests; API 81 files / 1186 passed, 15 skipped (credential-gated `auth`/`persistence`/`account-deletion` e2e suites); 27 navigation warnings (pre-existing review-SHA/startup-size advisories). Earlier runs failed on a missing feature-map directory owner and a missing Coach capability route; both fixed before this run. Coach `workouts` capability guidance now describes Log past workout.

## Open gates

- Dev deployment of the mobile candidate (no backend change required beyond the recent-sets ordering in the API).
- iPhone Dev acceptance: Workouts → Log past workout → Yesterday, 18:00, 60 min → Add exercise → sets → Save → History shows it on that date; open review; restart mid-draft; airplane-mode save then Retry; Edit/Discard pending; large text and VoiceOver; imperial account.
- Not proven: native keyboard behaviour, real Postgres `nulls last` ordering (mocked adapter test only), server-side future-date or challenge enforcement.
