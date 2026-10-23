# Offline cache phase 1 — 2026-10-23

Issue [#327](https://github.com/AdamHikl/mizyun/issues/327). Adam approved phase 1 on 2026-10-23: fewer server requests and lower latency from the personal read cache, with features unchanged. Baseline: main `ac3cb89860fec3f1167bdebacbbc99bfe9d698ef`.

## Problem

`SessionReadCache` threw away its records far more often than the data changed:

- every write cleared all memory and purged the device copy;
- backgrounding cleared memory;
- a same-account access-token refresh cleared it, in the cache and in `StartupDataBridge`;
- records loaded from the device were always treated as expired;
- every return to the app re-ran the full startup preload, including the live Community and Coach checks.

## Change (mobile only, no backend or migration)

- **Targeted write invalidation.** `affectedReads(method, path)` maps each write to the cached reads it can change:
  - food and recurring meals → food entries and energy;
  - workouts, exercises, runs, bouldering and routine import → training and energy;
  - body measurements, profile, goals and weekly-review decisions → body, profile, goals and energy;
  - AI consent → Coach conversations plus body (a grant can save the birth year);
  - Coach conversation create/delete → conversations;
  - drafts, media, feedback and memories → none.

  Coach messages (their tools log meals and edit workouts), account routes and any unlisted write keep the full clear and purge. Affected records are forgotten in memory and on the device before the write is sent. The device copy is updated with the new `PersonalReadStorage.replace`, which rejects on failure so the write fails closed, as the old purge did.

- **Background.** Backgrounding retires in-flight reads but keeps records. The next read re-checks account, day and timezone.
- **Token refresh.** Cache identity is the account, not the token. The bridge clears only on an account change or sign-out, and its effect is keyed by user id. Writes still compare account and token.
- **Relaunch.** On the first hydration after launch, a record saved within its lifetime (60 s for food and energy, 5 min otherwise) counts as fresh. After any explicit clear (pull-to-refresh, account change, full invalidation), saved records are shown and revalidated as before. Hydration never replaces a newer in-memory record.
- **Resume preload.** The preload skips the live Community and Coach warm-up when one ran less than 5 minutes ago. Those screens revalidate on foreground themselves. A reconnect or a later resume repeats it.
- **Advanced nutrition capability.** A grant is reused in memory for 5 minutes per account and token on Meals focus and on the log/edit screens' mount. Pre-save gates still call `refresh()`, and the API and database trigger enforce Pro (ADR-0029). The helper authored this part.
- **Not changed:** the meal-visuals 30 s lease and 20 s revalidation. ADR-0053 and the Oct 9 evidence fix them, so lengthening them needs Adam to amend the ADR.

## Request budget

`apps/mobile/src/composition/request-budget.test.ts` counts transport requests behind the cache for five journeys and enforces the result.

| Journey                       | Before | After |
| ----------------------------- | ------ | ----- |
| Cold start                    | 19     | 19    |
| Resume after 30 s             | 19     | 2     |
| Same-account token refresh    | 19     | 2     |
| Log a meal, then revisit tabs | 20     | 8     |
| Relaunch after 2 min          | 19     | 11    |

[Baseline log](evidence/request-budget-2026-10-23/baseline.log). These are model journeys, not device telemetry, and screen-specific live requests outside the preload are not counted.

## Review and verification

- An independent Opus non-author review found 2 blockers and 2 should-fix items. Both blockers are repaired:
  - pull-to-refresh was served from fresh-from-disk records;
  - the AI-consent write can change profile and energy.

  The should-fix items were token scope on the log/edit screens and an unwired forget claim. A nit (the budget was not enforced) is fixed too. The pull-to-refresh regression fails without the repair.

- Focused: composition, offline-cache and log-meal suites, 48 files and 744 tests passed. Mobile `tsc --noEmit` passed.
- Full gate: `pnpm check` PASS (EXIT 0) for input SHA-256 `2f48cacb37b3694351859f66f7fbcd735c87da671556cf6b348ddc00c3ad9989` on baseline `ac3cb898` plus this uncommitted diff: mobile 288 files / 3700 tests, API 1365 passed / 15 skipped (e2e suites). status.md, its archive move and this line are post-check records.
- No new platform API was used (existing AppState, SecureStore and expo-image behaviour), so no new primary-source research applied.

## Open

Not committed, deployed or device-accepted. Next, on a Dev iPhone:

- cold launch, then visit every tab;
- quick resume, and resume after more than 1 hour;
- log a meal, then visit Workouts (no reload) and Meals/Home (refreshed);
- pull-to-refresh on Home;
- account switch and sign-out;
- offline relaunch;
- consent grant, then Home energy.
