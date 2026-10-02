# Community route-return loading evidence (#168)

Date: 2026-10-02. Baseline: `025ae13c9bac444aef7f76210735e1ddffebe60b`, branch `codex/community-140-145`. Adam reported the recurrence on the freshly installed Dev iPhone. #168 was reopened; prior automatic verification did not establish physical acceptance.

## Observed cause and change

Most Community focus handlers clear their protected UI/controller and fetch again. The earlier #168 fix optimized duplicate lifecycle events and empty-state presentation, but preserved this behavior. Groups also changed its focus callback when selection changed; setting selection after a mutation and explicitly loading could issue a duplicate load. Comments/group reads were serial, and routine rendering awaited the private picker.

[ADR-0033](adr/0033-community-foreground-navigation-reads.md) explicitly amends ordinary foreground navigation: a composition-owned, schema-bound, memory-only store reuses allowlisted read responses for the original ten-second deadline. New route scopes check actual Auth account/token and caller lifetime. Concurrent current scopes coalesce identical reads. Global background/sign-out/account/token changes, known failure, manual refresh and mutations invalidate. Writes clear before/after completion and suppress caching while pending; late replies cannot repopulate invalidated memory. No persistence/offline fallback or mutation replay. Media/bytes, previews, lookup/search/invitations, staff and notification destination resolution remain freshly checked.

Groups keep a stable focus lifecycle, load the chosen group once and overlap independent reads; comments overlap candidates/page reads. Shared routines render before private picker loading finishes, and pagination/mode changes avoid redundant private reads. Restored expansion/group/comment/routine results use the earliest original deadline, not a new lease. Existing UI intent clearing on blur remains intact.

This improves quick returns rather than loading every subpage once indefinitely. Unknown remote revocation or undetected connectivity loss remains bounded staleness within the original ten seconds. Genuine background return and expired routes require new backend reads. Physical photos remain a fresh read on each entry.

## Review and automated evidence

Two helpers owned disjoint group/comment and expansion/routine/media files. The coordinator owns the cache/composition/global lifecycle/core refresh handlers and documentation. Independent non-author review accepted the settled diff after resolving missing multipart API forwarding, pending-write/read races and two missing explicit refresh invalidations.

Focused suites passed: shared cache 10 tests, groups/comments 24, expansion/routine/media 45. These cover ordinary route scopes reducing two backend reads to one, coalescing live callers, original deadlines, foreground/auth/write/error invalidation, deferred mutation/read races, unchanged sensitive reads and multipart capabilities. Mobile typecheck passed. Initial cache-test invocation stopped on an unavailable direct zod dependency; changed the fixture to an existing exported contract schema, then the cache suite passed. No dependency was added.

Fresh final `pnpm check` PASS (exit 0), log `/private/tmp/community-168-navigation-check.log`: mobile 1142/107 files, API783 with15 existing gated skips, contracts159/core351/server-adapter144; all typechecks/navigation/format, iOS+Android Hermes exports and existing safeguard/offline/recovery checks. No full-gate retry was needed. Exact source/install identifiers will be recorded in current status after commit/install. Existing pre-session documentation work is preserved. No database/provider integration reruns, backend deployment or Production operation are part of this mobile-only change.

## Installed-device acceptance still required

On the new standalone candidate, navigate populated Community → detail/Requests/Inbox/Groups/Messages/Routines → Back within and beyond ten seconds; distinguish initial, reused, expired and explicit-refresh behavior. Check real background/offline recovery, account switch, leave/rejoin and partner revocation. Sensitive photos/previews/search/token resolution must remain freshly authorized. Record PASS/FAIL/NOT TESTED and actual timing; installation/process launch alone cannot accept these journeys.

## 2026-10-02 — Community empty-state transition correction

Adam clarified the remaining installed-device symptom: returning from another tab briefly displays “Cheer each other on” before the populated feed. The supplied short recording was inspected locally; exact zero-tolerance video frames show the encouragement widget at 2.40 seconds and the shared workout at 2.45 seconds. This proves the visible transition, not backend request counts. Source establishes the failure: pause/reset represented an unread feed as `idle` with zero items; blur left membership verified, and the historical populated flag could be overwritten by that reset. The render then treated unavailable/unread data as confirmed empty before the focus read settled.

Correction: distinguish `unloaded` from successfully read `idle`; invalidate visible membership on blur, and render a neutral checking placeholder until a feed read completes. The encouragement panel appears only for a completed, successfully empty feed; errors retain recovery. This does not broaden the cache lifetime or expose prior protected cards.

Focused feed-screen25/controller22 tests PASS; the helper demonstrated both newly covered incorrect frames failing before the fix. Independent non-author review accepted. Fresh `pnpm check` PASS (exit0), log `/private/tmp/community-168-empty-flash-check.log`: mobile1145/107files, API783 with15 existing gated skips, contracts159/core351/server-adapter144; typechecks/format/navigation, dualHermes exports and existing safeguards pass. No database/provider integration reruns or backend/Production changes. Updated native installation remains separate from physical acceptance.
