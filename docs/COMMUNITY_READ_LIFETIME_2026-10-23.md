# Community read lifetime: 60 s, renewal, no deadline on own previews (#265)

Date: 2026-10-23. Commit `ca9a0955bc7a1d2d74f91d0b47da033b8cc3ab11` on `main`.

## Report and decision

Adam (iPhone, Dev): the bouldering share sheet replaced its preview with "Reload the session preview to check your current Community access." about every 5 seconds, and similar errors appeared across Community. Cause: protected Community reads were retired at a 10-second deadline with no renewal. No document recorded why 10 seconds was chosen.

Adam's decision (2026-10-23): "remove the limit on my things, for other people increase it to 60s". Recorded in the [ADR-0033 amendment](adr/0033-community-foreground-navigation-reads.md).

## Change

- Own bouldering and meal share previews: no display deadline, renewal or read-epoch check. They still retire on background, account or token change, and the server rechecks at publish.
- Other people's protected content: `COMMUNITY_READ_LIFETIME_MS` and `COMMENT_AUTHORITY_LIFETIME_MS` are 60 s. Screens renew silently 5 s before the deadline and retry every 0.5 s after a preempted or transient renewal. A denial (no session, expired session, 401/403/404) retires the content at once. The original deadline stays as the safety net.
- Covered screens: share sheets, activity detail, comments, profiles, relationships, expansions/messaging/challenges, groups, routines, media, plus feed load-more.
- This work started in another session (renew-before-deadline at 10 s) and was finished here after Adam asked to continue in this session.

## Evidence

- Reviews: an independent review of the 10 s renewal work found 4 should-fix items. A second independent Opus review of the final source found 1 blocker (groups partial renewal) and 4 should-fix items, all fixed. A third, bounded review confirmed the fixes with no blockers.
- Focused: `pnpm exec vitest run src/features/community` 57 files / 767 tests passed; `tsc --noEmit` clean.
- Full gate: `pnpm check` PASS (input SHA-256 `5fe0af58…`): mobile 3656 passed, API 1365 passed + 15 skipped.
- Dev: `pnpm deploy:dev ca9a0955…` succeeded 13:24Z, no new migrations, `/v1/health` 200.
- iPhone: build ca9a0955 Release installed and launched 13:56Z on 00008140-001114501A86801C (PID 85043); the first install attempt failed while the phone was unreachable (CoreDevice 4016).

## Open

- Device acceptance by Adam: leave each share sheet open for over a minute; browse feed, activity detail, comments and profiles for over a minute. Expected: no "Reload…"/"Refresh to check…" errors and no blank flashes.
- #324: a persistently failing groups inbox read still retires the group screen on renewal (fail-closed).
- Unchanged: iOS `inactive` counts as background (`read-lifecycle.tsx`); changing it needs a separate decision.
- Production unchanged; the mobile change ships with the next app build.
