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
