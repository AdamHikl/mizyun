# ADR 0067: Explicit Community bouldering publication

Date: 2026-10-16

Status: Accepted for implementation (BLD-05, [#276](https://github.com/AdamHikl/mizyun/issues/276)); implemented on the server side only. Mobile, simulator-pair, independent review, Dev deployment and release acceptance remain separate.

## Context

[ADR-0066](0066-indoor-bouldering-sessions.md) §9 promised session sharing with followers. Bouldering sessions are `workouts` rows, but they carry gym names, notes, photos, hold colours, attempts and times that the strength card path would not filter, so BLD-02 blocked them from every Community surface.

## Decision

Extend [ADR-0030](0030-explicit-community-publication.md) and [ADR-0056](0056-explicit-community-meal-publication.md) with a third `shared_activities.activity_kind`, `bouldering`, instead of a new social system. A bouldering card references the session through `source_workout_id` (one card per session through the existing unique index), stores `bouldering_details`, has category `other` and no duration, workout or meal fields.

- **Allowlist (COMMUNITY-07, BOULDER-05).** Exactly `activityDate` (the session's local day), `topGrade` (Font code of the hardest send or null), `sends`, `flashes` and `gradeBreakdown` (sends per grade, hardest first, or null). The breakdown is a separate opt-in that starts off. Gym name, notes, photos, hold colours, per-boulder attempts, times and projects are never shared.
- **Exact preview.** `GET /v1/community/bouldering-sessions/:id/preview` returns both server projections. `community_publish_bouldering_activity` recomputes the projection in SQL and accepts only an identical snapshot, the session's own local day (no ±1 day tolerance, because `activityDate` is already the user's calendar day) and only a completed session owned by the caller. Publication reuses the operation ledger, enrollment generation, version and revoked-state fences, so a lost response replays and a changed payload conflicts.
- **Revocation.** Any change to the session row, deleting it, adding or deleting one of its boulders, or editing a boulder's grade or result revokes the card (note, colour, attempts, photo and project edits never reach the card and do not revoke it); a fresh preview and explicit action are required to publish again. Replacing a live snapshot records an ADR-0052 activity event without climbing data. Session deletion and account erasure cascade-delete the card; the generic source tombstone still applies.
- **Boundaries.** The strength publish and duration-edit RPCs refuse bouldering sessions and cards. Routine shares and challenge contributions stay blocked until BLD-06. Recipients see the masked source identifier like workout cards. Audience, comments, reactions, reports, block/mute, withdrawal, retention, export and erasure are unchanged. With `MIZYUN_BOULDERING_ENABLED` off, the two routes answer `FEATURE_DISABLED`; existing cards follow the common lifecycle.

- **Installed clients.** Builds from before this change reject a whole feed page on an unknown `activityKind`. Feed and profile timelines therefore include bouldering cards only for clients that send `x-mizyun-activity-kinds: bouldering`; older builds simply don't see them. Later kinds should use the same negotiation.
- **Locking.** Publication takes the per-user bouldering lock before `community_lock()`, matching the bouldering RPCs, so a concurrent boulder write cannot deadlock a first publish. A statement-level `community_lock` on `boulder_ascents` serialises boulder writes with Community operations, as for workout sets; acceptable at pilot scale.
- **Flag scope.** The feature flag is enforced in the API, as for running and meals; the RPCs remain granted to authenticated users. A card created by a direct RPC call still follows the allowlist, audience and kind negotiation.

Photos on cards need a separate decision (BLD-06).

## Verification

pgTAP `0050_community_bouldering_sharing` covers the follower, non-follower, unenrolled, blocked and withdrawn audiences, replay, conflicts, tampered details, unfinished and foreign sessions, strength/routine/challenge refusals, revocation on boulder edit/add/remove and session delete, export, report snapshots and erasure. API tests cover preview, publish, replay, conflict, tampering, revocation and feed visibility. An independent non-author review (2026-10-16) found no privacy blocker; its installed-client and lock-order findings are resolved above. The two-simulator journey remains open.

## Sources checked

- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [PostgreSQL trigger behaviour](https://www.postgresql.org/docs/current/trigger-definition.html)

Accessed 2026-10-16.
