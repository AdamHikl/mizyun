# Coach false "session expired" fix and Dev delivery (2026-10-15)

## Defect

Adam's iPhone Dev app (15:34 CEST) showed "Couldn't load Coach — Your session
expired. Sign in again." while signed in. Hetzner Dev API logs for the
13:20–14:10Z window show every Coach request (`/v1/coach/status`,
`/v1/coach/conversations`, thread reads) answered 200, with no non-2xx
responses at all. The error was client-side.

Root cause: `SessionReadCache` (`apps/mobile/src/composition/session-read-cache.ts`)
retired in-flight cacheable reads as `{ kind: "no_session" }` whenever its
revision changed (token rotation in `startup-data-bridge.tsx`,
`invalidateSessionReads()` from weekly review, recurring meals and the Home
force refresh, or a write). The Coach screen's own `isCurrent` remained true,
and `coach-data.ts` renders `no_session` as an expired session.

## Fix (commit 190f1ec7)

- Retired cacheable GETs retry (max 3 attempts) for the same account while
  the app is foregrounded and the caller is still current.
- Retries wait for in-flight writes to drain (5s fallback so a long Coach
  reply cannot stall other screens).
- Server denials are recorded per access token and never retried; a new token
  for that owner (re-sign-in) lifts the denial.
- Reads retired by account cleanup (`purgeOfflineCache` on sign-out/erase) are
  never retried. The cache records generations produced by its own write
  purges to distinguish them from cleanup.

Regression tests: `session-read-cache.test.ts` (refresh/rotation retry, write
drain, cap/background/stale caller, token-scoped denial, real denial not
retried) and `personal-read-recovery.test.ts` (cleanup plus coincident
refresh never retried or persisted; own write purge still retried). The new
retry and write-drain tests failed on the previous implementation; the
cleanup tests fail with the cleanup guard disabled.

Reviews: two independent Opus reviews. Medium findings resolved: write race,
cleanup plus refresh race, and long-write stall. Accepted low residuals:

- A fresh read during the sign-out deregister window can repopulate storage
  (pre-existing).
- `ownPurges` grows by one small entry per write purge.
- Own-purge detection relies on the adapter fencing the generation
  synchronously, which `purgePersonalReads` currently does.

## Same delivery

- c5f27e92: unplanned exercises and sets beyond the plan default to normal
  after a warmup (pre-existing uncommitted work, committed at Adam's request).
- 1642d9dd: 20s timeouts for two large-input recurring-meal budget tests that
  exceeded vitest's 5s default under the parallel gate (~1–2s alone).
- Includes e2ee8b3a habit automation (#253–#257), first delivered to Dev here.

## Evidence

- `pnpm check` PASS on the clean candidate tree: 2783 mobile tests;
  1123 API tests passed and 15 skipped.
- `pnpm deploy:dev 1642d9ddb65c031a988b0d4bfb63c4fdbac92c81`: branch pushed,
  migration `20261015130000_recurring_meal_suggestion_weekly` applied,
  public health 200 at 2026-10-15T15:01:08Z.
- iPhone install: see `status.md`.

Open: signed-in device acceptance of Coach loading after foreground/token
refresh, the warmup default, and the habit automation journeys.
