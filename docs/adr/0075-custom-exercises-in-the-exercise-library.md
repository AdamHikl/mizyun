# ADR-0075: Custom exercises in the Exercise library

Date: 2026-10-19. Status: accepted by Adam on 2026-10-19 (scope "Create + edit + delete"; keep the routine editor's inline "Custom name" field). Package [#308](https://github.com/AdamHikl/mizyun/issues/308).

## Context

The Exercise library only listed the built-in catalog. Users could type a free-text name in the routine editor, and Log activity created name-only records, but they could not create an exercise with a tracking type, find it again in the library or edit or delete it. Saved exercises already live per user in `public.exercises` (RLS, `user_id` index, account export and deletion coverage), with a free-form `metadata` object that `resolveExerciseTrackingMode` reads (ADR-0068).

## Decision

1. **Storage.** A custom exercise is an ordinary `public.exercises` row. The library writes `metadata = { custom: true, trackingMode }`. Edits re-read the record first and keep unrelated keys (such as a target load saved meanwhile). No migration, contract or RLS change.
2. **What counts as custom.** `isCustomExerciseRecord` (`packages/core/src/custom-exercise.ts`): a saved record with no known `metadata.catalogId` and no exact catalog name or previous name. Older name-only rows (routine "Custom name", Log activity) therefore also appear under **My exercises** and can be edited.
3. **Names.** Names are trimmed and inner whitespace collapsed (max 120). A name that exactly matches a catalog entry is rejected so the user picks the catalog entry and keeps its history; a case-insensitive duplicate of another saved exercise is rejected. An edit that keeps the name skips both checks, so older records that already share a name stay editable. Notes are optional (max 4,000). The checks need the complete saved list, so **Create** stays off while it loads, after a failed load and when the 200-row API cap is reached (fail closed).
4. **Library.** Under the All filter, **My exercises** lists matching custom exercises above the catalog with their tracking type. **Create exercise** prefills the name from the search text. In a picker, a newly created exercise is selected (or added immediately in add-on-tap mode). The list reads at most 200 saved exercises (the API cap) and says so when truncated.
5. **Renames.** Routines and sessions plan custom exercises by name. A rename therefore stores the earlier name in `metadata.previousNames` (newest first, at most 10). The live session resolves a planned name to an exact current name first and then to a custom exercise's earlier name (`findSavedExerciseByName`), so routines that still list the old name keep logging to the same record.
6. **Selection.** The library's selection callback receives catalog entries and saved `Exercise` records in tap order (`LibraryExercise`, `features/workouts/library-exercise.ts`). Live and past workouts use the saved record as is, without creating another. Routines plan it by name with no catalog id, matching the existing "Custom name" behaviour; the live session resolves the name to the saved record. An exercise already in the open live or past workout opens read-only in the library, so the screen's copy of it cannot go stale. Past workouts record weight and reps only (WO-08), so they refuse timed custom exercises and point to Log activity.
7. **Edit and delete safety.** The editor asks `GET /v1/exercises/:id/recent-sets?limit=1` whether any set references the exercise. While checking, after a failed check or once sets exist, the tracking type is fixed and delete is unavailable. The server enforces both:
   - `PUT /v1/exercises/:id` returns 409 `CONFLICT` when the resolved tracking mode would change while the user has a set for the exercise.
   - `workout_sets` keeps its foreign key without `ON DELETE`, so the database still refuses a racing delete. The Supabase adapter maps SQLSTATE 23503 to `ExerciseInUseError`, and `DELETE /v1/exercises/:id` returns 409 `CONFLICT` with a fixed message instead of 500.

## Consequences

- Routine rows keep the name they were planned with; they resolve through `previousNames` after a rename. Deleting an unused custom exercise leaves those rows, and logging one creates a new weight-and-reps exercise (the delete confirmation says so). Storing an exercise id on routine rows would remove the name dependency and is left for later.
- Duplicate and catalog-name checks run in the app, not the server. Earlier names only link rows that were not planned from a catalog entry; when two records share an earlier name, the first listed wins, and a current name always beats an earlier one.
- The server's tracking-type check reads sets and then updates, which is not atomic; a set logged from another device in between can slip past it. This is accepted for a single user's own data.
- Custom exercises have no movement pattern, muscles or equipment, so they are hidden under movement filters and are not used by catalog-only features (prescriptions, evening stretches, Coach catalog search).
- Routine time and distance targets for timed exercises remain in [#280](https://github.com/AdamHikl/mizyun/issues/280).
- Old app builds are unaffected: they have no exercise delete action, and their only exercise `PUT` (target load) re-reads the record and spreads its metadata, so the resolved tracking mode does not change and the new 409 cannot fire.

## Sources

[React Native Modal](https://reactnative.dev/docs/modal) and [Alert](https://reactnative.dev/docs/alert) (0.87 docs), checked 2026-10-19. The Modal page does not document a modal opened from inside another one, so the editor follows the library's existing nested progression sheet and needs an iPhone check. [PostgreSQL 18 error codes (23503 foreign_key_violation)](https://www.postgresql.org/docs/current/errcodes-appendix.html), checked 2026-10-19. See the [research log](../RESEARCH_LOG.md).
