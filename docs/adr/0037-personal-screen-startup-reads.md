# ADR-0037: Personal screen reads at authenticated startup

Date: 2026-10-03. Status: Accepted for local implementation of #182.

Workouts fetched its list, routines, exercise catalog and session sets on every tab focus. Meals and Home restarted their loading state on tab returns. Adam requested startup loading and reuse across the app.

## Decision

The mobile composition decorates its existing API client with a bounded, session-only personal display-data store: at most 512 entries and four million conservatively estimated bytes, five minutes from response completion. Keys include the exact request path/query and require the same schema. Current account/token and caller intent are checked before and after shared work. No health data is persisted by this store. Pending transports abort after twenty seconds, allowing later retries.

Known personal writes clear before and after completion, including failure or lost response. Importing a Community routine also clears personal data; other social commands use their existing social store. Background/inactive, identity/token changes, deliberate Refresh and local day/timezone changes retire personal navigation snapshots. Checking screen versions clears expired records so screen-level reuse cannot extend their deadline. Focused screens refresh on active resume and retain completed content while waiting. Personal screen state is reset and late responses rejected on account changes. Partial workouts remain retryable rather than being marked fully loaded.

October 4 correction (#200): push-token registration (`PUT /v1/beta-pro/push-token`) and separate analytics consent/event writes cannot change personal display data and bypass this invalidation. All other writes retain the existing conservative behavior. A repeated foreground event or same-session profile hydration does not retire pending reads; actual backgrounding retires records once, and the return admits fresh reads regardless of AppState listener order. Account/token changes still clear both records and pending work. Coach automatically reloads on foreground return/token change with current account/caller checks, preserving its selected conversation when still present. No background retries, mutation replay, relaxed authentication or longer retention was introduced.

After authenticated startup, launch independent reads for current Home metrics/week review/recent meal, initial Meals history, workout lists/catalog/sets, body history, profile/active goal, and the latest existing Coach conversation after live readiness succeeds. An adult-eligible active Community member's first feed page can warm through the existing scoped Community store, without extending its ten-second deadline or changing admission/consent. Startup does not block the app shell; navigating before a request completes joins that work. Pagination, searches and user-selected detail pages load on demand.

Authority endpoints (AI readiness, paid nutrient capability, consent), signed media and social data do not receive the five-minute personal lifetime. Photos retain their visible list while obtaining fresh signed URLs. AuthProvider retains its own live, signal-bound profile bootstrap; Account stops requesting it again merely on entry. Preload does not send messages, invoke models, create conversations, enable preferences, enroll in Community, prompt for device permissions or download photos.

## Verification and acceptance

Cache, startup orchestration and rendered screen regressions cover shared startup/focus reads, expiry, stalled transport, failed/lost writes, account changes, partial workout reads, paginated Meals retention and foreground resume. Full checks and qualified outcomes belong in status.md. Installed Dev cold-start/tab-return/edit/refresh/offline/account-switch acceptance remains a separate exit; source and synthetic tests do not establish physical acceptance or Production release.
