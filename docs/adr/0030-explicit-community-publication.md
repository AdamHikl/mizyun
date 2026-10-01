# ADR-0030: Explicit community publication and isolated social authorization

**Status:** Accepted publication architecture, 2026-09-29; design clarification 2026-09-30. This ADR is not pilot, user-validation, deployment or release acceptance. [COMM-01 revision](../COMMUNITY_PRODUCT_CONTRACT.md) is the current product contract; [local implementation evidence](../COMMUNITY_REVIEW_EVIDENCE_2026-09-30.md) records a separate tier.

## Context

Private workouts contain notes, exercise details, load and potentially sensitive measurements. Following a friend must never grant access to the friend's private workout/profile/media tables. Original blanket cross-user wording needs a narrow exception for deliberately created social artifacts while preserving ADR-0001/0002/0012 private isolation and the first-beta follower exclusion.

## Decision

1. Private health/nutrition/workout/profile/Coach/media ownership and signing policies remain closed to other users. Social features never relax their RLS or use private profile joins as directory projections. Staff moderation has no private-health/Coach access.
2. Explicit publication creates a detached `shared_activities` snapshot. Follower projection contains social author identity, generic category enum, selected calendar day, optional deliberately selected duration, card/version/publication metadata. Source workout IDs and retry-ledger state are owner-only; private custom titles, notes, exercises, loads, food/body/location/biometric/media/Coach data are excluded. Sharing and saving are separate transactions and choices.
3. Use separate `community_profiles`, `community_relationships`, blocks, invites, publications, reactions and restricted reports; other preferences/mutes/moderation/inbox/outbox/receipts are added in their owning packages. Tables listed as future work are not claims about deployed schema. Each user-owned table needs RLS, ownership index and constrained role transitions.
4. Author or currently approved active directional follower may read a still-published card only when current principal/generation/eligibility/cohort/feature policy, block/suspension/deletion and expiry checks allow it. Approval includes existing still-published history; reciprocal following requires another approval. Graph is owner-only. Controlled authenticated lookup/invitation/pending-edge projections expose minimal identity; bio needs approval. Author/actor reactor identities are distinct from other followers' aggregate-only projection.
5. Database/RPC authority must hold independently of API DTOs, including direct PostgREST clients. Any security-definer function has explicit grants, a safe fixed/empty search path, qualified names and caller-bound scope. API never trusts an actor ID or approval status supplied by the client. Authorization is independently reviewed by a non-author and proved across real principals/transports.
6. Block severs both edges/requests and suppresses access/delivery. Unfollow/removal invalidates the removed actor's reactions on the author's cards; card revocation/version replacement invalidates all card reactions. Unblock/reapproval never restores old reactions or delivery. Reusable invitation resolution is denied for blocked pairs rather than revoking its use for everyone.
7. Private edits do not silently mutate a shared snapshot; explicit preview/update increments its version. Source deletion/unconfirmation, withdrawal, suspension, ineligibility and accepted account deletion revoke social authority at the transaction boundary. Stable account blocks/sanctions survive re-enrollment; new generation restores no graph/cards/invites.
8. Publication operation identity binds actor, generation, normalized payload and result/version. Same operation can resolve a lost response, but old revoked/deleted operations cannot resurrect publication. Long-lived retry records are minimized after payload purge to digest/generation/version/terminal state/opaque effect reference, not private source payloads. Account deletion/backup restore have bounded erasure barriers.
9. Restricted caller-owned safety/report/contact/appeal/export/withdrawal/account routes survive enrollment loss or feature disable. These exceptions cannot grant social browsing or unrestricted moderator access. Recent abuse reporting uses a bounded authorized interaction receipt rather than arbitrary subject IDs.
10. Pilot caching is memory-only and clears on background/sign-out/account switch; foreground freshness and principal-bound responses are mandatory. Send/open-time delivery checks and generic push payloads prevent health/identity/token disclosure. Immediate denial cannot recall screenshots or information already seen; physical purge/backup expiry are separate obligations.

## COMM-01 selected policy clarification — 2026-09-30

Adult declaration plus conservative private self-reported birth-year cutoff `currentUtcYear - 19` is the selected design. It prevents birthday-boundary assumptions without collecting a new DOB/ID/selfie; it does not independently verify identity and can defer an already-18 boundary-year adult. #142 implements a single server rule; #154 assesses adequate assurance for the actual jurisdictions/distribution before admission. AI consent/admission remains independent.

Discovery and duration sharing default off. Pilot handle is immutable/reserved through withdrawal, with 90-day minimal quarantine after deletion; future rename is explicitly gated. Invitations are reusable, revocable, generation/environment-bound and at most seven days. The product contract owns exact limits, retention, minimal retry/restore barriers, operator responsibilities and pilot thresholds; #151/#153/#154 implement/assess their separate exits. Neither this accepted architecture nor a chosen product retention period asserts legal compliance or operating staff coverage.

## Current local implementation boundary

The forward hardening migration `20260930110000_community_review_hardening.sql` replaces unsafe raw writes/enumeration with caller-bound RPCs, scrubs source identifiers from follower projections and requires a durable terms receipt. Existing active profiles without one are withdrawn for fresh opt-in. Publication operation tombstones, stable blocks/sanctions and generation-bound lifecycle cleanup were locally tested; reviewed handles are immutable/reserved. Subsequent #142–145 sessions implemented the conservative year rule, declaration/current receipt and enrollment/relationship/invitation/publication UI; combined source verification is in the commit evidence. This ADR itself supplies no runtime, device or later-package acceptance.

Current transactional social/private-source transitions share an advisory lock. This serializes the bounded local candidate but may contend with private writes; #153 must accept contention/capacity and fail-closed operational behavior before admission. Do not extrapolate local tests to deployed schema or device acceptance.

## Consequences and verification

The architecture reduces accidental private-source exposure and makes deliberate sharing/revocation auditable. It adds a separate publication/lifecycle transaction boundary, projection endpoints, generation/idempotency state, retention jobs and moderation operations. It cannot guarantee no disclosure bug, perfect account-identity evasion prevention, or erasure of third-party copies.

Required proof: anonymous/owner/approved/pending/unrelated/blocked/withdrawn/ineligible/suspended/deleted/staff principal matrix; hostile overposting; direct transport denial; approval/block and publication/withdrawal races; lost response and restart; scoped graph/reaction/report identity; expiry/purge failure; account switch; restore newer erasure state before serving. Runtime packages use focused regressions and `pnpm check`; primary-source research, human validation, native acceptance, Dev deployment and explicit Production promotion remain separate gates.

## Sources

- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [PostgreSQL row security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html), [OWASP API Security](https://owasp.org/www-project-api-security/): architecture sources accessed 2026-09-29; local review consequences recorded 2026-09-30.
- [Apple App Review Guidelines, UGC](https://developer.apple.com/app-store/review/guidelines/), [Google Play UGC](https://support.google.com/googleplay/android-developer/answer/9876937?hl=en), [Google child safety scope](https://support.google.com/googleplay/android-developer/answer/14747720?hl=en): accessed 2026-09-30. Filtering, report/block/contact and staffed review are pilot gates; adult gating does not exempt an in-scope category.
- [Dated research and access limitations](../RESEARCH_LOG.md); Mizyun ADR-0024/0028 and COMMUNITY-01–16.

## COMM-04 retry and owner graph amendment — 2026-09-30

Public follow requests require caller-bound operation UUIDs; each renewed request gets a fresh relationship ID. Durable minimal retry receipts retain an opaque incarnation and hashed target binding so a deleted/replaced edge cannot be resurrected or an operation rebound. HTTP unfollow/remove-follower require the displayed relationship ID. Quotas and cooldowns remain independent of live graph deletion, under the existing transaction lock. Daily limits use server UTC dates. Member-facing availability is neutral across missing/inactive/blocked identities; the block-specific public RPC is revoked.

Owner graph lists use scoped bounded cursors. Mute is private, filters feed preference and never grants or revokes audience authority; future delivery must consult it again. Mobile graph state is memory-only and retired on background/unfocus, principal/generation change or denied access. Reporting/delivery/monitored retention/restore and exact device acceptance remain separate gates; no new admission or Production release follows from these controls. See [COMM-04 evidence](../COMMUNITY_RELATIONSHIPS_EVIDENCE_2026-09-30.md).

## COMM-09 authority and evidence amendment — 2026-09-30

Safety intake survives enrollment loss through caller-owned, server-issued opaque receipts with a strict 30-day authorization deadline and minimal authorized social snapshots. Invalid supplied references never silently regain access. Reports and appeals accept bounded confidential quotes rather than applying publication filters to abuse evidence. Duplicate open cases append bounded evidence without consuming another new-case quota.

Staff authority uses named authenticated MFA sessions (`aal2`), an API UUID allowlist and an independently checked service-managed database registry. No default/shared secret, client operator header or broad private-health role grants authority. Restricted RPCs serialize report/quota, assignment, sanction and audit. Appeal reviewers cannot adjudicate their own decision, their own report or their own sanction. Expiry/reversal removes only a matching sanction; deliberate fresh consent is needed to reenroll, with no restored cards or graph. Contact/rules remain configurable and unavailable until actually verified.

[Source and local verification evidence](../COMMUNITY_MODERATION_EVIDENCE_2026-09-30.md) records remaining staffing/contact, retention/restore, delivery, Dev and native acceptance; user explicitly deferred staffed operational acceptance on 2026-09-30 until Community functionality is exercised. Admission remains closed.

## Final review amendment — 2026-09-30

Community defaults fail closed at API and database boundaries; the service must explicitly activate growth flags and an admitted cohort. Global disablement or cohort removal revokes social browsing/delivery as well as growth, while separate owner safety/account controls retain reporting, blocking, muting, unreact, cancel/decline/unfollow, unpublish, withdrawal and export/delete. Direct RPCs cannot bypass discovery controls. Auth cascades acquire the social transaction lock before parent-row locks to prevent inbox FK/deletion deadlocks.

Caller-owned safety evidence uses exact live-snapshot deduplication and120 new receipts/UTC day plus1000 live receipts/owner. Quota skips automatic evidence capture rather than blocking privacy reductions; an existing receipt can still report. Erasure also minimizes duplicated moderation audit text and deleted target references, retaining necessary action/time/case metadata without extending its existing deadline. Notifications deny expired publications immediately, independent of maintenance. Serial delivery claims each short lease only when ready to dispatch; at most20 jobs per tick.

## Founder Dev functional testing amendment — 2026-09-30

Adam explicitly authorized interactive Community testing on the latest Dev backend/iPhone, excluding Production. This limited exception opens client enrollment only for the validated Dev variant and exact Dev targets, backed by service-managed single-principal cohort admission. Cohort_required remains true and delivery false. Consent/profile/follows/publication remain deliberate user actions. A Dev-only no-delivery maintenance timer processes withdrawal and retention so leave/rejoin can be tested. This does not authorize broader pilot admission or waive participant, operator/contact, legal, restore, push or device acceptance. [Exact source and operational evidence](../COMMUNITY_DEV_TESTING_2026-09-30.md) supersedes older closure statements only for this named Dev functional scope.

## 2026-10-01 clarification — follow back (#166)

An approved follower may receive a separate follow-back request from the person they follow, including when handle search is disabled. This established owner graph capability grants no search visibility or automatic reciprocal approval. The existing locked request RPC enforces current eligibility, bilateral blocking, operation replay, cooldowns and quotas. Pending/removed followers provide no additional capability. The Followers UI reads the complete bounded outgoing graph before displaying Follow back, Requested or Following.
