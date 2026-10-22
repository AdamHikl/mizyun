# Bouldering grade-row sends list (2026-10-22)

Adam asked that tapping anything in a "Sends by grade" row on Bouldering progress open every boulder at that grade, with details, hold colour and photo.

## Behaviour

- Each pyramid row (grade, bar or count) is one button with a chevron. It opens `/bouldering/grade?grade=<code>&window=<30d|90d|all>` with the window the progress screen is showing.
- The screen lists that grade's sends (Flash and Sent), newest session first and in log order within a session. Sends are grouped under "<date> · <gym>" and show result/attempts, hold colour, note and a private photo thumbnail. "Not yet" boulders are not listed because the row counts only sends; they remain under Projects.
- Tapping a boulder opens a read-only sheet with a large photo, result, hold colour, session date/gym and note. **Open session** goes to the existing session history screen, where the boulder can be edited or deleted.
- An invalid or missing grade shows "Grade not found". Offline, error and disabled states match the progress screen.

## Design

- `GET /v1/bouldering/progress/grade?window=&grade=` (`boulderGradeSendsQuerySchema` / `boulderGradeSendsResponseSchema`). It loads data the same way as `/progress` (`loadProgressHistory`), so it adds no new queries, migrations or indexes. Results are owner-scoped through the existing repository methods.
- `boulderGradeSends` in `packages/core` applies the same window cutoff and send rule as `boulderGradePyramid`, so the list always matches the row's count. Like the pyramid, it includes sends from a session that has not been finished.
- The query rejects whitespace in the grade, so an unencoded `6A+` (decoded as `6A `) returns 400 instead of the 6A list. The mobile client URL-encodes the grade.
- Mobile: only the newest load updates the screen. An account switch clears status, photos and selection. Photos are signed through `/v1/media/sign` and are not signed again on refocus.

## Verification

- Focused: contracts 12, core 31, API bouldering routes 26 and mobile bouldering 83 tests pass. API and mobile `tsc` pass.
- Tests cover window-boundary parity with the pyramid, count/flash parity, newest-first ordering, lowercase and encoded `+`, raw `+` returning 400, owner isolation in both directions, invalid query (400), unauthenticated access (401), the encoded client path and pyramid row selection.
- Independent Opus review: no blockers. Fixed: stale overlapping loads, re-signing photos, raw-param title and invalid links, the raw `+` query, and non-selectable rows announced as dimmed. Not changed: sequential photo signing (same as the session screen) and Modal-close plus push timing (needs a device check).
- Full gate: recorded in `status.md` and the commit.

## Delivery (post-gate record)

- Commit `4645debebb4c2e02a28ea7b193b3dcaf5e28687f`, pushed to `origin/main`. The pre-commit gate passed on an isolated candidate (`ba07b1f6` + owned files, input SHA-256 `82b99bab…`).
- `pnpm deploy:dev 4645debe…` re-ran the gate (PASS, input SHA-256 `4e1ed34d…`), reconciled migrations (no new migration) and restarted the Dev API. Public `/v1/health` returned 200 at 2026-10-22T19:41:28Z. Unauthenticated `GET /v1/bouldering/progress/grade` returns 401; an unknown sibling path returns 404.
- Mizyun Dev (`com.mizyun.development`), Release build from clean HEAD `4645debe` after a clean prebuild from the Production native project. Installed at 19:45:56Z on Adam's iPhone `00008140-001114501A86801C`. The first launch was refused because the phone was locked; a manual `devicectl` relaunch succeeded.

## Open

- Device: tap 6A, 6B and 5+ rows in each window, open a boulder with a photo, check that Open session works and the sheet dismisses smoothly, and check VoiceOver row labels and hints.
