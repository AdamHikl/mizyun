# ADR-0048: Connected Community navigation and bounded social reads

Date: 2026-10-07. Status: Accepted for COMMUNITY-UI-001 / #224; deployed to Dev at `7d5c9d0ecfd52629995af25d896dd6cdfef1abaf`; native acceptance pending.

## Context

The Community interface exposed separate management forms without a connected person-profile or conversation journey. A complete redesign needs real author timelines and conversation summaries. Filtering an ordinary feed in the client cannot produce a complete author timeline, and fetching every contact's messages separately cannot produce a bounded conversation list.

## Decision

Use Feed, People, Messages and Me as persistent local destinations inside the existing Community app tab. A nested Expo Router JavaScript Tabs navigator retains each root while a shared accessible navigation row renders the controls. Standalone task routes use a common page shell with an explicit parent Back fallback. Keep existing URL aliases and the five primary app tabs. Protected results and drafts still retire on blur, background, account/token change, known denial and the original authorization deadline; preserving harmless selection or scroll does not preserve authorization.

Add an author-filtered read at the database query boundary. The API validates the current caller's outgoing approved access, or ownership, before loading the timeline. The RPC independently preserves admission, enrollment generation, audience, bilateral blocks, mute, revocation and the 365-day publication bound. Filter the author before pagination; use a publication timestamp/UUID cursor and at most 50 public records with one internal lookahead. Common owner and peer timeline projections omit private source identifiers. An owner-only management endpoint separately validates both card ownership and the live completed source before returning an editable source reference.

Add bounded `threads` and newest-first-page `latest` messaging reads. They retain current participant, mutual following, preferences-generation, blocking and 90-day visibility predicates. Conversation pages display oldest-to-newest within the returned newest page and use complete timestamp/UUID cursors for older pages. A deleted latest message has an honest tombstone preview. Summaries come from one authorized database query. The previous messaging implementation is internal; all existing commands delegate through the new wrapper. No unread count, presence, read receipt, per-thread mute or invented conversation removal is introduced.

Extend already-authorized routine and photo projections with optional stable public author IDs for profile navigation. Existing RPC authorization and internal DTO helper grants remain unchanged. Older compatible responses without IDs retain the textual attribution.

Extend ADR-0033's foreground-memory allowlist only to validated profile/timeline and thread/latest reads. Preserve nested cursor fields in request identity. Auth eagerly invalidates same-account reads when the token changes before newly mounted destinations capture their epoch. Display lifetimes remain bound to token, principal, target, focus and the original ten-second deadline. Definitive message authority denial retires draft, pending send and peer intent; uncertain transport failure retains the same immutable operation UUID for retry. Reporting rechecks authority on return after deliberate receipt capture retires cached reads.

Local read retirement returns `context_changed`, optionally retaining the original transport failure as its cause. Reserve `no_session` for genuinely absent or incompatible authentication. Humanize the original failure and classify definite message denials through that cause, while still rejecting retired values and protected intents. People explicitly revalidates membership on focus, retry and refresh before loading its graph once; membership failure must not permanently disable recovery. A settled profile failure cancels its loading timer.

## Consequences and evidence

The presentation keeps deliberate sharing, directional follow approval, separate feature preferences, quarantine, owner erasure and contextual safety controls. Saving a private workout never publishes it. Photo moderation staff controls require an actual capability signal and are not offered to ordinary members.

Three forward migrations add the reads and author projection fields; no new user-owned table or broader audience policy is introduced. Focused API, contract, adapter and mobile tests, non-author sensitive review, isolated local SQL/concurrency evidence and the final gate are recorded in [implementation evidence](../COMMUNITY_UI_REDESIGN_EVIDENCE_2026-10-07.md). These do not prove deployed transport, native layout or physical standalone acceptance.

## Primary sources

Checked 2026-10-07: [Expo Router SDK57](https://docs.expo.dev/versions/v57.0.0/sdk/router/), [Expo JavaScript tabs](https://docs.expo.dev/router/advanced/tabs/), [React Native accessibility](https://reactnative.dev/docs/accessibility), [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [PostgreSQL17 CREATE FUNCTION](https://www.postgresql.org/docs/17/sql-createfunction.html). Implementation consequences and design research are in [the research log](../RESEARCH_LOG.md#community-ui-rebuild-research--2026-10-07).
