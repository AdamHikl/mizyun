# Offline cache phase 2 — 2026-10-23

Issue [#329](https://github.com/AdamHikl/mizyun/issues/329), requested by Adam on 2026-10-23. It builds on the uncommitted [phase 1](OFFLINE_CACHE_PHASE1_2026-10-23.md) (#327) over baseline `ac3cb89860fec3f1167bdebacbbc99bfe9d698ef`.

## Change

- **Fewer query variants.** Home's latest weight (`dashboard-data.ts`) and Goal settings (`goal-settings-data.ts`) now read `/v1/body-measurements?limit=200`. That is the body history read, newest first (the repository orders by `measured_at` descending), so one cached request serves all three. Startup no longer warms an unused `food-entries?limit=5` read. Not consolidated, because local-day boundaries could give wrong totals:
  - the Home workout count (date range vs the hub's full list);
  - yesterday's meals (day range vs the history list);
  - the day vs range food summaries.
- **Freshness.** Goals and the exercise library stay fresh for 30 minutes. This account's edits on this device forget them (see `affectedReads`). An edit on another device shows within 30 minutes or on pull-to-refresh. No server job writes them. The profile stays at 5 minutes because it carries `planTier`, which Beta Pro admin grants change outside the app.
- **API conditional GET and no-store** (`apps/api/src/plugins/conditional-get.ts`, registered in `app.ts`):
  - Every `/v1/` response without a route-set `Cache-Control` gets `no-store`.
  - GET 200 JSON gets a strong ETag, `"sha256:<32 base64url>"`, computed over the exact bytes.
  - A matching `If-None-Match` gets a 304 with no body.
  - The hook runs in `onSend`, after authentication, authorization and the handler, so 401/403/404 are never converted.
  - The helper authored this part.
- **api-client:**
  - `RequestOptions.ifNoneMatch` is sent as `If-None-Match`.
  - Results carry `etag` on a 200 and `notModified: true` on a 304; `isNotModified` and `resultEtag` read them.
  - On iOS, expo/fetch uses the shared `URLCache`, which can merge a 304 into a response an older build cached. So a conditional 200 whose ETag names the sent tag counts as not modified. A conditional 200 without a tag is re-asked once without the validator.
- **Mobile cache.** A stale record from a 200 in this process keeps its validator in memory and is revalidated with `If-None-Match`. A 304 re-caches the held value as fresh, under the same revision, write, generation and owner fences as a 200. Validators are never saved on the device, so an unchanged tag cannot confirm a value parsed by an older app build. Results returned to screens carry no validator.

## Request budget

Measured by `request-budget.test.ts`, which now enforces these numbers. The old cache cleared everything on background, so every resume repeated the full preload.

| Journey                       | Baseline | Phase 1 | Phase 2 |
| ----------------------------- | -------- | ------- | ------- |
| Cold start                    | 19       | 19      | 17      |
| Resume after 30 s             | 19       | 2       | 2       |
| Same-account token refresh    | 19       | 2       | 2       |
| Log a meal, then revisit tabs | 20       | 8       | 7       |
| Relaunch after 2 min          | 19       | 11      | 10      |
| Resume after 10 min           | 19       | —       | 15      |

A 304 is still a request; it saves the download and parse, not the round trip. The test transport sends no ETags, so these counts do not reflect 304s.

## Privacy finding

Before this change, personal `/v1/` JSON had no cache headers:

- **Android:** React Native's OkHttp disk cache (`cacheDir/http-cache`, 10 MiB) stores any 200 without `no-store`.
- **iOS:** Cache.db is likely to hold these responses too (not verified).

`no-store` stops new entries once the backend is deployed, but it does not remove existing ones. That cleanup is tracked in [#330](https://github.com/AdamHikl/mizyun/issues/330).

## Review and verification

- **Independent Opus review:** no blockers. Two should-fix items, both repaired: the iOS URLCache merge, and an older app build's parsed value being pinned by a saved validator. Nits addressed:
  - profile lifetime back to 5 minutes;
  - a regression for a 304 that arrives after a write;
  - the `app.ts` comment.
- **Phase 1 adapter:** `replace` gained unit tests (rejects on failure; a queued replace does not write after cleanup starts). The fence test fails without the generation check.
- **Focused tests:**
  - mobile composition, offline-cache, dashboard, settings, log-meal and log-weight: 84 files, 1205 tests;
  - api-client: 88 tests;
  - API: the plugin's 12 tests plus the helper's full API run (1377 passed, 15 skipped);
  - `tsc` clean for mobile, api-client and API.
- **Full gate:** `pnpm check` PASS (EXIT 0) for input SHA-256 `2c5adc997a7a45a7f5c94985a88f0684509dbec84eba856575056d54b3410dd4` (phase 1 + phase 2 uncommitted on `ac3cb898`): mobile 288 files / 3707 tests, API 1377 passed / 15 skipped (e2e), api-client 88. status.md and this line are post-check records.
- **Research:** see the [research log](RESEARCH_LOG.md) entry of the same date (RFC 9110/9111, Fastify hooks, expo/fetch, OkHttp). The iOS claim there was corrected after the review.

## Open

- Not committed or deployed.
- The ETag and `no-store` behaviour needs a Dev backend deploy. It is backward compatible both ways: old apps ignore the ETag, and a new app against an old API stores no validator.
- Device checks, in addition to the phase 1 list:
  - after a resume past the lifetime, a stale read returns 304 (watch the API logs) and the screen keeps its data;
  - iOS through expo/fetch and Android through OkHttp;
  - Home's latest weight equals the first row of weight history;
  - a goals edit on another device shows within 30 minutes or on pull-to-refresh.
- The meal-visuals 20 s check is unchanged and needs an ADR-0053 decision from Adam.
