# ADR-0033: Bounded Community reads during foreground navigation

Date: 2026-10-02. Status: Accepted for the requested Dev loading fix (#168).

Adam reproduced repeated backend fetching on the installed Community pages and asked whether they should load once, directing the fix to account for that behavior. Previously, every focus cleared state and obtained a new backend read. Earlier #168 changes reduced duplicate requests and empty flashes but preserved that cycle.

## Decision

Reuse allowlisted, validated navigation responses in foreground memory for at most ten seconds from the original backend request start. Ordinary route blur retires drafts and captured action authority; the invisible response store may survive that blur. The Community feed may also retain a completed visible snapshot under the bounded exception below. A new route scope checks the actual current Auth session, account, token, caller lifetime and original deadline before consuming a record. Restoring a record never renews its deadline. Simultaneous live reads of the same request/schema share one backend request; one retired caller cannot cancel another current caller.

This supersedes the per-route server-read/hidden-memory retirement wording in ADR-0030's graph amendment, ADR-0031's focus rule, ADR-0032's blur rule and the product contract's protected-read rule **only for still-valid foreground navigation records**. Genuine foreground entry after backgrounding requires new backend reads. Screens keep their existing protected-data clearing and authorization timers; expansion compound results use the earliest original deadline across every consumed response. The decision does not introduce persistent or offline social caching.

The composition owns the store. Global background/inactive, sign-out, principal/token change, known read failure, deliberate Refresh and every mutation invalidate it. Writes invalidate before starting and on all completion paths, including ambiguous or lost replies; navigation records are not used or filled while a write is pending. Invalidation epochs prevent delayed reads from restoring cleared authority.

The allowlist covers profile, feed/activity/reactions, graph, inbox/preferences, feature availability, shared routine lists, comments/mentions and ordinary group/challenge/message read operations. Photos/bytes, private publication previews, search results, invitation tokens, moderation/staff reads and notification destination resolution remain freshly checked at the backend. Mutations always reach the backend and are never replayed by the store. Responses are schema-bound, size-bounded and count-bounded; no content or keys are logged or written to disk. Explicit refresh bypasses reuse.

## Tradeoff and scope

This improves quick route returns; it is not “fetch once forever” and does not prefetch every subpage. Unknown remote revocation or an undetected connectivity loss may remain unseen until the original ten-second deadline. Local changes and known failure invalidate immediately. Extending this bound or implementing push-driven/revision-conditional refresh requires a separate measured decision. No server policy, sharing consent, audience, rollout switch or Production behavior changes.

The same fix removes the selected-group focus-dependency reload, overlaps independent group/comment reads and decouples shared-routine rendering from private-picker loading. Source and automated verification do not establish physical navigation speed or acceptance; these require the newly installed candidate.

## Sources and validation

Primary documentation accessed 2026-10-02: [Expo SDK57](https://docs.expo.dev/versions/v57.0.0/), [Router57 focus hooks](https://docs.expo.dev/versions/v57.0.0/sdk/router/), [React Native0.86 AppState](https://reactnative.dev/docs/0.86/appstate) and [React external-store snapshots](https://react.dev/reference/react/useSyncExternalStore). The ten-second bound is an existing product privacy decision, not a platform recommendation. These sources support separating focus cleanup, global background lifecycle and stable external snapshots.

Required regressions: repeated route scopes reduce two backend reads to one within the lease; expiry/manual refresh/errors/write/background/account/token changes obtain a new read; delayed read and mutation completion cannot repopulate the store; restored compound data retains its original expiry; unsupported sensitive reads and multipart API capabilities remain unchanged. Independent non-author review and fresh `pnpm check` precede commit/install.

## 2026-10-02 amendment — completed Community tab snapshots

Adam's follow-up recording shows the checking placeholder on return from Friends; changing empty-state copy did not fix the page-clearing lifecycle. Native tabs keep React screens mounted. The feed now suspends pending work and retires card action scopes on ordinary blur without clearing a completed snapshot whose original membership/feed-page deadlines, response invalidation epoch, account token, eligibility input and membership generation still match. A valid return reuses that snapshot synchronously, preserving the list and issuing no profile/feed load. Returning creates fresh action scopes; no prior action gains a new lifetime.

The minimum original read deadline still applies, including pagination. An expired/incomplete/error snapshot or background/Auth/token/write/refresh invalidation follows the existing cleared checking/revalidation path. No stale-while-revalidate allowance, persistent/offline cache or longer authorization lifetime is introduced. Membership response epoch metadata prevents an old profile being promoted into a new authority epoch after a feed-only refresh. Cache invalidation does not synchronously revoke a mutation's originating scope before its transport. This is a narrow exception to displayed-state clearing for the retained Community tab.

## 2026-10-23 amendment — 60-second bound, renewal, no deadline on own previews (#265)

Adam reported (2026-10-23, iPhone, Dev) that the bouldering share sheet replaced its preview with "Reload the session preview to check your current Community access." every few seconds, with similar errors elsewhere in Community. Issue #265 had recorded the same class of defect. The ten-second bound was implemented as _retire the display at the deadline_, with no renewal, so ordinary dwell time always reached it. No document recorded why ten seconds was chosen; it was copied forward from the 2026-10-01 expansion commit.

**Decision (Adam, 2026-10-23):** "remove the limit on my things, for other people increase it to 60s".

- **Other people's protected content** (feed, activity detail, comments, profiles, relationships, expansions/messaging, groups, routines, media): `COMMUNITY_READ_LIFETIME_MS` and `COMMENT_AUTHORITY_LIFETIME_MS` are 60 seconds. Unknown remote revocation or undetected connectivity loss may therefore remain visible for up to 60 seconds instead of 10. Content already seen cannot be recalled in either case.
- **The owner's own share previews** (bouldering session and meal share sheets) have no display deadline. They still retire on background, sign-out, account or token change, and the server rechecks Community membership, consent and source version when publishing or unpublishing. Server-side lifetimes are unchanged.
- **Renewal.** Screens start a silent renewal `COMMUNITY_READ_RENEWAL_LEAD_MS` (5 s) before the current deadline. The renewal is an ordinary fresh backend read: the shared store no longer answers, or joins, a read whose remaining life is inside that lead, so a renewal gets a new deadline from its own request start. A successful, still-current renewal replaces the displayed data atomically and re-arms both timers. A renewal preempted by a write or a busy action, or failing transiently, is retried every `COMMUNITY_READ_RENEWAL_RETRY_MS` (0.5 s) until the original deadline. An explicit denial (no session, expired session, HTTP 401/403/404) retires the content immediately. In the expansion hook and the profile and relationship controllers, a renewal whose request started before a read-cache invalidation is dropped and retried; the other screens rely on their own action locks and revisions for local writes, and the shared store refuses to answer across an invalidation. In the groups screen a renewal replaces every protected field or none, so a failed part cannot keep its old value under the new deadline. The original deadline timer remains the safety net, and background/account/token/epoch changes still retire content immediately. No content is shown past the deadline of the response that authorized it.
- Renewal never replays a mutation, discovery query or search, never runs while a mutation is in flight, and preserves local choices (share toggles, picked day, drafts, a selection made from a renewed list).

Feed load-more keeps the cards already shown (inside the existing feed snapshot exception, Adam 2026-10-14) while the prefix is re-read; revoked cards still disappear when the read completes, a transient next-page failure (network or 5xx) keeps the shown cards with an error, and any denial retires them.

Cost: a foregrounded screen issues about one read per 55 seconds per protected request (media re-downloads visible image bytes each cycle). Treating iOS `inactive` as background (`read-lifecycle.tsx`) is unchanged because it also guards the app-switcher snapshot; changing it needs a separate decision.
