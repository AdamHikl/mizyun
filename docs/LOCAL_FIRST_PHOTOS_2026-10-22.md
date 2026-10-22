# Local-first meal and boulder photos — handoff 2026-10-22

Issue [#321](https://github.com/AdamHikl/mizyun/issues/321). Decision [ADR-0079](adr/0079-local-first-private-photos.md). Follow-ups [#322](https://github.com/AdamHikl/mizyun/issues/322) (progress photos), [#323](https://github.com/AdamHikl/mizyun/issues/323) (export of device-only photos).

## Adam's decisions (2026-10-22)

- Scope: meal and boulder photos. Progress photos stay server-backed.
- Keeping a meal photo on the phone is free; meal backup stays Pro. Boulder backup is free.
- Back up photos starts off for every account; existing backups stay and are saved to the phone when viewed.

## What changed

- Mobile `features/private-photos`: per-account device library (`Documents/private-photos/<account>/<kind>/<uuid>.jpg` + `index.json`), backup preference (SecureStore, default off), background sync bridge, removal of backups after saving locally.
- Meals: Save keeps the 640 px thumbnail on the device; uploads only when backup is on and Pro confirmed. Device copy is shown first without Pro; backups download once. Copy meal copies the device photo. Meal delete and account deletion remove device copies.
- Boulders: attach saves to the device; uploads only with backup on; replacing a backed-up photo while backup is off unlinks and erases the old backup. Both screens show the device copy first; signed URLs are memory-only (no longer default disk cache).
- Settings: Account → Privacy & data → Back up photos.
- API: `GET /v1/photo-backups`, `PUT`/`DELETE /v1/bouldering/ascents/:id/photo` (owner token, no Pro, no migration).
- Privacy policy text updated; it must go live with the release that ships this, together with Store answers (Photos stay declared; optional on Play).

## Evidence

Baseline `2ed5ae9d42bbb36cb64208125327e9a3eaee03d7`, uncommitted working tree.

- Independent Opus review: 9 should-fix findings (no blockers) — account deletion skipped device photos on retry failure; stale device copy could let "Remove backed-up copies" delete a newer backup; removal raced a running upload; background boulder PUT vs queued edits; unfenced background boulder requests; orphaned photos stalling sync; quick-repeat replay blocked by a missing photo; legacy Retry uploading with backup off; stale list leaving a backup on remove. All fixed with regressions. Bounded re-review confirmed them and found one regression (cleanup deletes refused once `isCurrent` turned false) plus an attach/download race; both fixed with tests.
- `pnpm check` PASS, input SHA-256 `6f4b995a00f76c635ff78b7ca10999fa87b46afec6c7aba01aee49d9dbc288c9`: mobile 285 files / 3605 tests; API 1348 passed + 15 skipped (provider-gated); adapter 310; all safeguard and navigation checks. An earlier run went stale because `.env` (ignored, not edited by this session) changed mid-run; the rerun on the unchanged tree passed.
- Not run: real database/RLS for the new adapter query and RPC path, `db:verify` (no migration), device journeys, Dev deploy.

Known residual risks (accepted, documented): boulder "replaced" marker is in memory only, so after a restart with a dropped unlink the old backup can overwrite a newer device-only photo; a lost link-PUT response deletes the uploaded asset (next run re-uploads); deleted-meal photos are retried (≤20 small uploads) after each relaunch because a meal-photo 404 is ambiguous; a device-only copy of a meal is preferred over a different backup when removing backups.

## Open gates

1. Push (committed on main 2026-10-22; Adam asked to commit only — not pushed or deployed).
2. Dev deploy (API routes) and a new Dev app build.
3. Device journeys (iPhone and Android): keep with backup off (no server asset), relaunch offline, turn backup on, second device downloads once, remove backups, account deletion.
4. Privacy policy + Store answers with the shipping release.
