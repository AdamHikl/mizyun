# Mizyun community implementation plan

> COMMUNITY-001 · parent [#137](https://github.com/AdamHikl/mizyun/issues/137) · planned 2026-09-29 · planning only. No runtime implementation, migrations, native builds, deployment or store submission performed.

Subsequent implementation/review state is in [the 2026-09-30 quality evidence](COMMUNITY_REVIEW_EVIDENCE_2026-09-30.md). This document retains the original planning baseline; its proposed scopes and launch gates are not completion evidence.

## COMM-01 decision revision — 2026-09-30

The [revised product contract](COMMUNITY_PRODUCT_CONTRACT.md) is the authoritative design above this document's September 29 proposed defaults. It provides the complete permission matrix, eight small-screen prototypes/copy, all journey/failure owners, threat model and bounded policy schedule. [Target-user validation](COMMUNITY_UX_VALIDATION_2026-09-30.md) is prepared but unrun; #140 remains open for actual feedback including a voluntary decliner. Documentation completion is not implementation or pilot acceptance.

Selected rules: conservative private birth-year check `year - 19` plus explicit adult declaration and separate #154 assurance acceptance; directional approval includes still-published history; discovery and duration default off; owner graph and minimized reaction identity; immutable pilot handles with lifetime reservation through withdrawal and 90-day deletion quarantine; reusable revocable seven-day generation/environment-bound invitations. #142's future rename extension must retain 30-day cooldown, old-link invalidation and fresh native copy rather than silently advertising an unsupported pilot action.

Limits: admitted cohort 10 then at most 30, following/follower caps 30, requests 50/day and 10/minute with 20 outgoing/50 incoming pending and 48-hour terminal cooldown; invitations 20 active/20 created per day; combined lookup/resolve 30/minute and 120/day; publications/updates 20/day; reactions 30 mutations/minute; reports 10/day with always-available safety contact; lists default 20/max 50. Implementation and concurrency checks remain in the owning child packages.

Retention: publication max 365 days with deadline read denial; revoked payload max 30 days; invalidated reactions/token cleanup within 24 hours; inbox 90 days, outbox TTL 24 hours, content-free diagnostics 30 days; closed necessary case evidence 180 days with individually justified hold review every 90 days; source-free minimal retry tombstones bind old UUIDs; current-account safety/reservation records persist through withdrawal; live account deletion purge max 30 days with a 90-day encrypted-archive restore barrier. Full details, purposes and owners are in contract section 5; #151/#153 implement and #154 accepts legal/disclosure purposes before admission.

Founder Adam Hikl owns operator acceptance; named trained backup, verified contact, report/appeal coverage and scoped staff tooling remain #148/#153 prerequisites. Ordinary first review target 24 hours, urgent concerns four hours under accepted coverage. Four-week pilot: five independent friend pairs, half of study-consenting cohort returns in two weeks including week four, complete critical comprehension among study-consenting assessed participants (unassessed members recorded separately), timely reports, no unauthorized/private-source access or unresolved deletion/restore defects. No statistical/public-launch claims follow from these thresholds. The narrow private-source/social-artifact wording in goals is reconciled; first-beta exclusion and post-MVP sequencing remain unchanged, so plan.md and BUSINESS_ALIGNMENT.md do not change.

## COMM-10–16 implementation revision — 2026-09-30

#149–153 source work proceeds on the preserved coherent dirty candidate; #154/#155 prepare disclosure/acceptance evidence. New notification180000, operations190000 and lifecycle200000 migrations add durable inbox/session registry/outbox, independent database controls/cohort and withdrawal/deletion/export/expiry boundaries. Withdrawal now blocks re-enrollment until generation cleanup finishes; tests explicitly exercise the barrier rather than silently resetting generation. Current-source review preserves same-day abuse counters, reporter confidentiality and minimal active-sanction appeal identity. The13-category Community export is independently versioned/live-keyset, not a database snapshot.

[Acceptance register](COMMUNITY_ACCEPTANCE_EVIDENCE.md), [legal/store gate](COMMUNITY_LEGAL_STORE_CHECKLIST.md) and [operations runbook](tutorials/COMMUNITY_OPERATIONS_RUNBOOK.md) track exact remaining exits. Source implementation does not close physical/provider/Dev/restore/operator/legal/admission gates. Admission and delivery stay closed; Production/Store and a larger Dev cohort remain separate decisions.

## A. Context and scope

The request is to follow friends and see their activity. Build an optional friends experience first, then expand only when users value it and operations can support it. A working community needs identity, consent, relationships, discoverability, useful shared activity, encouragement, safety, staffed moderation, notifications, portability, reliable operation and evidence of voluntary return.

Existing `goals.md` excludes followers/public photo feeds from the first beta and `docs/BUSINESS_ALIGNMENT.md` places community after private-product retention. This plan prepares that post-MVP work; it does not move the October 2–3 InVenture milestone or first-beta gates. COMM-01 has reconciled a narrowly scoped opt-in social-artifact permission exception in the revision above. Current blanket cross-user-denial language still applies to all private records. The user authorized planning and GitHub work splitting, not an accelerated launch or code implementation.

The first complete release covers COMM-01–16. COMM-17–23 cover later conversation, groups, challenges, messaging, media, routine sharing and broader discovery. Those extensions are individually gated and are not prerequisites for the initial follow-friends request. No marketplace, advertising, health-data monetization, competitive body rankings, professional coaching platform, unsolicited messaging or minors’ community is planned.

### September 29 proposed defaults (historical; revision above controls)

- Optional participation; enrolled adults only (18+ proposed, with community eligibility checked server-side independently of AI consent); unknown/ineligible age cannot enroll. No birth date/year exposed socially and no new collection without necessity review.
- A separate social handle/display identity is selected deliberately. Existing users remain unenrolled. Handle search is separately opt-in; no email/phone/contact/proximity lookup in the pilot.
- Directional approved follows: A requests B; B approves; A sees B’s still-published cards. Following back requires another approval. Pending/declined requests grant no activity access. A removed follower must request again. Lists are visible only to their owner; no public graph/counts.
- Exact audience: owner and currently approved followers, subject to both-sided blocks, suspension/deletion and community eligibility. Approval may expose previously deliberately published history; the enrollment/approval/share copy explains this. Never backfill private history automatically.
- Pilot shared card: generic confirmed-workout completion and selected day; optional duration only after preview. No arbitrary captions, notes, exercise details, meals/calories, weight/body/goal data, photos, location, device-health steps, Coach content or memory. Device-only steps under ADR-0028 stay device-only.
- Publish is separate from saving a workout. No automatic sharing setting in the pilot. The stored publication is a field-limited snapshot, not access to its source. Private edits do not silently update it; explicit refresh produces a new version. Deleting the source or changing it to incomplete/unconfirmed revokes its card immediately. Explicit refresh clears reactions from the earlier version and suppresses their queued notifications. Date-only sharedDay remains the author-selected calendar day; publication timestamps render in viewer timezone.
- Predefined supportive reactions only. Handles/display text still count as UGC and need filtering/reporting/moderation. Comments and uploads stay off until their own acceptance.
- In-memory friend-activity cache only; foreground requires authorization refresh. No promise to erase screenshots or content someone already saw. Withdrawal must stop new access/delivery and clear controlled caches. Enrollment generation binds cleanup and retries; re-enrollment never restores old graph/publications. Blocks and active suspensions/bans bind stable account identity and survive enrollment changes; withdrawal cleanup never erases another participant’s block. Full-account deletion/new-identity evasion needs a separate lawful abuse policy, not a promise of perfect prevention. Follower removal/block permanently invalidates old reactions/delivery, even after reapproval.
- Social refusal works with free-tier private tracking, without AI consent, health permission, push permission or optional analytics consent. Safety/export/deletion are never premium-gated.

### User journeys and visibility

1. Private user declines community and continues logging unchanged.
2. Eligible user joins, accepts current rules, chooses identity and optionally enables handle lookup.
3. User invites a known friend via a revocable link or searches an opted-in exact handle; login continuation revalidates identity and never follows automatically.
4. Recipient approves/declines; requester can cancel/unfollow; author can remove a follower. Repeated rejected requests are rate-limited.
5. Author previews and publishes selected completed workout activity; follower sees a chronological card and reacts.
6. Author edits/unpublishes or deletes the source; future access and delivery stop. A future approved follower receives only permitted still-published history.
7. Participant mutes, blocks or reports. Blocking wins over every relationship/interaction path; recent abuse can still be reported safely. Operator handles, audits and can appeal a decision.
8. User disables discovery or leaves community, or exports/deletes the whole account. Private tracking survives community withdrawal; deletion hides immediately and cleans durably.

| Viewer/state                                              | Social identity                              | Published activity               | Relationships               | Mutation/safety                                                               |
| --------------------------------------------------------- | -------------------------------------------- | -------------------------------- | --------------------------- | ----------------------------------------------------------------------------- |
| Anonymous or community-ineligible                         | No app directory/activity access             | Denied                           | Denied                      | Login/help/contact only                                                       |
| Owner, active participant                                 | Own full social settings                     | Own cards                        | Own incoming/outgoing lists | Own edits, withdrawal, safety                                                 |
| Unrelated or pending follower                             | Minimal opted-in lookup/invite identity only | Denied                           | Denied                      | Request within quota; report recent abuse                                     |
| Approved active follower                                  | Minimal social identity                      | Selected still-published cards   | Own edge only               | Permitted reaction; mute/block/report                                         |
| Blocked either direction, suspended, withdrawing/deleting | Neutral unavailable                          | Denied                           | No third-party disclosure   | No new interaction; owner safety/lifecycle and bounded abuse reporting remain |
| Staff with audited scoped role                            | Necessary social case data only              | Necessary reported evidence only | Only if needed for case     | Explicit moderated action; no blanket health-diary access                     |

Counts, inbox previews, deep links, cursors, queries, direct DB access and delivery workers obey the same visibility policy. The table describes proposed social exceptions only; private health tables/media remain strictly owner-scoped.

## B. Baseline and constraints

- Source inspected: `877d1898e9205c4be19c6344e1cf1d533f4ff312`; tree clean at start. Latest local commit records Dev deployment/device installation, which does not prove community acceptance.
- No implemented community/follow module found in focused `apps`, `packages` or migrations searches. Existing private profile adapter includes birth year, height, coaching preferences and tier, so it must not become the social DTO.
- Existing entry points: `packages/contracts/src/index.ts`, `packages/core/src/profile.ts`, `packages/adapters/supabase-server/src/profile-repository.ts`, `apps/api/src/app.ts`, `apps/api/src/modules/profile/routes.ts`, `apps/mobile/src/components/app-tabs.tsx`, `apps/mobile/src/app/_layout.tsx`, Account settings catalog, and current workouts feature. The app has five tabs; plan Account → Community plus root-stack screens first.
- Lifecycle: `packages/contracts/src/account.ts`, `packages/core/src/account.ts`, `packages/adapters/supabase-server/src/account-repository.ts`, `apps/api/src/modules/account/routes.ts`, `apps/mobile/src/features/settings/account-data-management.ts`, `principal-state.ts` and `docs/ACCOUNT_EXPORT_INVENTORY.md`. Existing #25/#26 lifecycle acceptance remains open; social work extends it, never marks it passed by inference.
- Existing push-token endpoint is in `apps/api/src/modules/account/beta-pro-routes.ts`; inventory and separate a reusable delivery port before generalizing it. Generic feedback routes are a reference, not a staffed moderation queue.
- Installed manifests: Expo `~57.0.23`, React Native `0.86.3`, expo-router `~57.0.21`, expo-notifications `~57.0.19`, Supabase CLI `2.109.1`, pnpm `10.33.0`. Recheck versioned official docs before each implementation segment.
- Domain rules stay in pure `packages/core`; versioned schemas in contracts; vendor-neutral ports; Supabase in adapters; API composes dependencies; mobile owns presentation. Public exports only, no cross-feature internal imports. Table row shapes extend `Record<string, unknown>`.
- Hetzner is Dev/Production authority; Pi recovery only. No production deployment from this plan. No destructive remote DB checks. Existing isolation, account lifecycle, signed artifacts and exact-device acceptance gates (#21, #25, #26, #27, #32) continue to apply. AI provider suites remain gated by `docs/BEFORE_TESTING.md`.

### Proposed data and API shape

Use separate `community_profiles`, `community_preferences`, `community_relationships`, `community_blocks`, `community_mutes`, `shared_activities`, `community_reactions`, `community_reports`, restricted moderation action/evidence tables, `community_invitations`, `community_notifications`, token-registry and outbox tables as needed after COMM-01. Avoid premature group/message/media schema. Every user-owned table gets `user_id`, RLS and leading ownership index; relations also need incoming/subject indexes, unique actor-target keys, actor-owned columns and controlled transitions. Staff authority is server-controlled; privileged jobs are not a substitute for caller authorization. Define lifecycle states/timestamps and FK/cascade versus retained-evidence behavior explicitly.

Proposed transport families under `/v1/community`: participation/preferences, social profile, discovery/invites, relationships, blocks/mutes, publications, feed/activity detail, reactions, reports, own inbox and scoped staff moderation. Verify principal server-side; never trust body `userId`, audience expansion or approval status. Use operation IDs/version checks, bounded cursor pagination, stable API error envelope and neutral unavailable responses. Unauthorized direct Supabase clients must fail independently of API checks. Social read exceptions do not relax source-table RLS. Query-on-read chronological feed and durable transaction/outbox delivery are initial design proposals; accept ADR/SQL boundaries in COMM-01/02 before implementation.

## C. Staged implementation and dependencies

Implementation issue labels are P2 because this is post-MVP expansion; importance within community is expressed by mandatory gates, not by relabeling everything an MVP emergency. Original planning disposition: COMM-01 was ready and other packages depended on its contracts/evidence. Current issue status and the September 30 revision supersede that snapshot. Being blocked does not authorize launch or mean research cannot proceed. Reuse existing areas; no new area label required.

Sequence: product/security contract → contracts/policies → identity → follow/block → discover/share → feed/reactions/moderation → inbox/mobile → lifecycle/reliability/operations/legal → exact-candidate pilot. Independent schema/UI research can occur under disjoint ownership after the contract is stable. Operator staffing and legal assessment start early and must be complete before admission. Future expansion packages begin only after the friends pilot and their own recorded go/no-go.

| Package | Deliverable                                                                | Stage                     | Depends on                                                                                                                            | Issue                                                 |
| ------- | -------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| COMM-01 | Define community product contract, privacy rules and UX                    | Foundation                | —                                                                                                                                     | [#140](https://github.com/AdamHikl/mizyun/issues/140) |
| COMM-02 | Build community contracts, domain ports and database isolation             | Foundation                | COMM-01                                                                                                                               | [#141](https://github.com/AdamHikl/mizyun/issues/141) |
| COMM-03 | Add separate opt-in social profiles and identity controls                  | Friends pilot             | COMM-02                                                                                                                               | [#142](https://github.com/AdamHikl/mizyun/issues/142) |
| COMM-04 | Implement follow requests, follower management, blocking and muting        | Friends pilot             | COMM-03                                                                                                                               | [#143](https://github.com/AdamHikl/mizyun/issues/143) |
| COMM-05 | Add privacy-preserving friend discovery and invitation links               | Friends pilot             | COMM-03, COMM-04                                                                                                                      | [#144](https://github.com/AdamHikl/mizyun/issues/144) |
| COMM-06 | Publish selected workout activity with preview and withdrawal              | Friends pilot             | COMM-02, COMM-03, COMM-04                                                                                                             | [#145](https://github.com/AdamHikl/mizyun/issues/145) |
| COMM-07 | Build chronological following feed and shared-activity detail              | Friends pilot             | COMM-04, COMM-06                                                                                                                      | [#146](https://github.com/AdamHikl/mizyun/issues/146) |
| COMM-08 | Add reversible encouragement reactions                                     | Friends pilot             | COMM-04, COMM-06, COMM-07                                                                                                             | [#147](https://github.com/AdamHikl/mizyun/issues/147) |
| COMM-09 | Build reporting, content filtering and staffed moderation                  | Friends pilot gate        | COMM-01, COMM-02, COMM-03, COMM-04, COMM-06                                                                                           | [#148](https://github.com/AdamHikl/mizyun/issues/148) |
| COMM-10 | Implement community inbox, notification preferences and safe push          | Friends pilot             | COMM-04, COMM-06, COMM-08, COMM-09                                                                                                    | [#149](https://github.com/AdamHikl/mizyun/issues/149) |
| COMM-11 | Integrate accessible community journeys into mobile navigation and Account | Friends pilot             | COMM-03, COMM-04, COMM-05, COMM-06, COMM-07, COMM-08, COMM-09, COMM-10                                                                | [#150](https://github.com/AdamHikl/mizyun/issues/150) |
| COMM-12 | Integrate social export, withdrawal, deletion and retention                | Friends pilot gate        | COMM-02, COMM-03, COMM-04, COMM-06, COMM-08, COMM-09, COMM-10                                                                         | [#151](https://github.com/AdamHikl/mizyun/issues/151) |
| COMM-13 | Harden retries, social cache privacy and account switching                 | Friends pilot gate        | COMM-04, COMM-05, COMM-06, COMM-07, COMM-08, COMM-10                                                                                  | [#152](https://github.com/AdamHikl/mizyun/issues/152) |
| COMM-14 | Add community operations, capacity controls and consent-respecting metrics | Friends pilot gate        | COMM-02, COMM-09, COMM-10, COMM-12, COMM-13                                                                                           | [#153](https://github.com/AdamHikl/mizyun/issues/153) |
| COMM-15 | Accept community legal, privacy and store-disclosure gates                 | Friends pilot gate        | COMM-01, COMM-09, COMM-12, COMM-14                                                                                                    | [#154](https://github.com/AdamHikl/mizyun/issues/154) |
| COMM-16 | Verify and run the exact-candidate friends pilot                           | Friends pilot acceptance  | COMM-01, COMM-02, COMM-03, COMM-04, COMM-05, COMM-06, COMM-07, COMM-08, COMM-09, COMM-10, COMM-11, COMM-12, COMM-13, COMM-14, COMM-15 | [#155](https://github.com/AdamHikl/mizyun/issues/155) |
| COMM-17 | Add moderated comments and controlled mentions after pilot                 | Expansion                 | COMM-16, COMM-09, COMM-10, COMM-12, COMM-13                                                                                           | [#156](https://github.com/AdamHikl/mizyun/issues/156) |
| COMM-18 | Build private community groups with roles and membership safety            | Expansion                 | COMM-16, COMM-09                                                                                                                      | [#157](https://github.com/AdamHikl/mizyun/issues/157) |
| COMM-19 | Add safe opt-in cooperative fitness challenges                             | Expansion                 | COMM-16, COMM-18                                                                                                                      | [#158](https://github.com/AdamHikl/mizyun/issues/158) |
| COMM-20 | Evaluate and build consent-based direct messaging                          | Expansion, decision gated | COMM-16, COMM-09, COMM-12, COMM-14, COMM-15                                                                                           | [#159](https://github.com/AdamHikl/mizyun/issues/159) |
| COMM-21 | Create a separate safe community media pipeline                            | Expansion, decision gated | COMM-16, COMM-09, COMM-12, COMM-14, COMM-15                                                                                           | [#160](https://github.com/AdamHikl/mizyun/issues/160) |
| COMM-22 | Add explicit routine sharing with provenance and independent copies        | Expansion                 | COMM-16, COMM-09, COMM-12                                                                                                             | [#161](https://github.com/AdamHikl/mizyun/issues/161) |
| COMM-23 | Evaluate broader discovery, public visibility and contact matching         | Expansion, decision gated | COMM-16, COMM-09, COMM-14, COMM-15                                                                                                    | [#162](https://github.com/AdamHikl/mizyun/issues/162) |

### Ownership and coordination

One coordinator owns continuity documents, GitHub inventory, integration, commits/deployment and final checks. Helpers get disjoint module ownership and must not push, change secrets, run shared native builds or destructive checks. Independent non-author review is required for authorization/RLS, deletion/export and deployment. Shared SQL/composition/public-index changes are serialized or coordinator-integrated; child issue ownership is a planning boundary, not permission for concurrent edits to the same file.

### Work-package implementation plans

### COMM-01 — Define community product contract, privacy rules and UX

**Stage:** Foundation. **Dependencies:** None; first design package.

Turn following friends into an explicit, testable product contract before building the data model.

**Current design deliverables:** revised contract, requirements, ADR, narrow goals reconciliation and validation pack. Design rules are selected; target-user validation remains pending. #140 is not closed by the local foundation tests or this document.

**Implementation steps**

1. Define COMMUNITY-01–16 requirements, audience/permission matrix, approved directional following versus mutual friendship, historical-card visibility, profile/graph visibility and community age eligibility independent of AI consent.
2. Produce small-screen wireframes and copy for enrollment, discovery, request approval, sharing preview, feed, safety and withdrawal; validate with adult target users including a person who declines community.
3. Resolve the current first-beta follower exclusion and blanket cross-user-read language through a narrowly scoped social-artifact exception before implementation; retain private health policies. Record an ADR for the new publication/authorization boundary and a threat model.
4. Specify limits, retention periods, handle reuse/cooldowns, moderator ownership, pilot success thresholds, and decisions in the master plan. Do not silently change first-beta sequencing.

**Files and ownership**

- [MODIFY] docs/PRODUCT_REQUIREMENTS.md
- [NEW] docs/adr/<next-id>-explicit-community-publication.md
- [NEW] docs/COMMUNITY_PRODUCT_CONTRACT.md and wireframes
- [MODIFY, only after a recorded product decision] goals.md / docs/BUSINESS_ALIGNMENT.md; plan.md only for an actual sequencing decision

**Acceptance and verification**

- [ ] Every user journey has a permission rule, failure state and owning issue.
- [ ] The approved scope expressly preserves private tracking and separates social, AI, analytics and health permissions.
- [ ] No unresolved age/audience/retention/ownership decision can be treated as an approved launch default.
- [ ] Record source/commands/outcomes/skips; run applicable focused tests and `pnpm check` for runtime changes. Independent non-author authorization/lifecycle review where affected; real local database/storage proof where affected; device acceptance is separate.

### COMM-02 — Build community contracts, domain ports and database isolation

**Stage:** Foundation. **Dependencies:** [COMM-01](https://github.com/AdamHikl/mizyun/issues/140).

Create an isolated social data boundary with enforced authorization and portable contracts.

**Implementation steps**

1. Add versioned schemas, pure visibility/transition rules and provider-neutral repository ports through public package exports.
2. Add forward migrations for social profiles, directional follow edges, blocks/mutes, published cards, reactions, reports/moderation records, inbox/preferences, invitations and delivery outbox as needed; reserve future schemas for their own packages.
3. Define user_id ownership indexes, incoming-edge indexes, FK behavior, uniqueness/check constraints, transaction/RPC transitions and grants. Block/suspension/deletion/feature eligibility override audience permissions. Views/functions must not bypass RLS accidentally.
4. Build a real local multi-principal pgTAP/PostgREST matrix covering anonymous, owner, approved follower, unrelated, pending, blocked and staff identities. Review custom RPC privileges/search_path and privileged adapter paths independently.

**Files and ownership**

- [NEW] packages/contracts/src/community/*.ts
- [NEW] packages/core/src/community/*.ts
- [NEW] packages/adapters/supabase-server/src/community/*.ts
- [MODIFY] package public index.ts files
- [NEW] supabase/migrations/<timestamp>_community__.sql and supabase/tests/database/<next>_community_.test.sql
- [MODIFY] docs/feature-map.json

**Acceptance and verification**

- [ ] API and direct database access deny every disallowed read/write/transition; private-source RLS stays unchanged.
- [ ] Relationship participants cannot forge the other participant’s approval, staff authority or another user’s ownership.
- [ ] Independent authorization review and local disposable database checks pass; no remote reset is run.
- [ ] Record source/commands/outcomes/skips; run applicable focused tests and `pnpm check` for runtime changes. Independent non-author authorization/lifecycle review where affected; real local database/storage proof where affected; device acceptance is separate.

### COMM-03 — Add separate opt-in social profiles and identity controls

**Stage:** Friends pilot. **Dependencies:** [COMM-02](https://github.com/AdamHikl/mizyun/issues/141).

Give participants a minimal social identity without exposing their health profile.

**Implementation steps**

1. Implement enable/disable enrollment with an enrollment generation/version, versioned community terms acceptance and separate handle/display identity; never publish an existing private display name automatically.
2. Use atomic normalized handle uniqueness, bounded display text, reserved/prohibited-name rules, rename cooldown and reuse policy; start with generated initials rather than uploaded avatars.
3. Expose only allowlisted profile fields to the approved viewers. Owner controls discoverability; graph lists are owner-only initially, no popularity counts or last-seen/location/birth data.
4. Represent disabled, suspended, deleting and unavailable profiles neutrally. Re-enrollment starts a new generation after the cleanup barrier; old follows/invites/cards never resurrect. Blocks and active suspensions/bans bind stable account identity, survive enrollment changes and cannot be erased by another participant’s cleanup. Community denial preserves core tracking.

**Files and ownership**

- [NEW] apps/api/src/modules/community/profile-routes.ts
- [NEW] apps/mobile/src/features/community/profile/*
- [MODIFY] community domain/contracts/adapter under COMM-02 contracts

**Acceptance and verification**

- [ ] Existing users remain unenrolled and undiscoverable until explicit opt-in.
- [ ] Concurrent equivalent handles cannot be claimed twice; renamed/deleted handles cannot silently impersonate an old invitation. A blocked participant who withdraws/re-enrolls stays blocked; a suspended participant cannot evade sanctions by re-enrollment.
- [ ] Social DTOs never include email, birth year, height, goals, plan tier or coaching limitations.
- [ ] Record source/commands/outcomes/skips; run applicable focused tests and `pnpm check` for runtime changes. Independent non-author authorization/lifecycle review where affected; real local database/storage proof where affected; device acceptance is separate.

### COMM-04 — Implement follow requests, follower management, blocking and muting

**Stage:** Friends pilot. **Dependencies:** [COMM-03](https://github.com/AdamHikl/mizyun/issues/142).

Let people approve followers and stop interaction reliably.

**Implementation steps**

1. Implement directional none → pending → approved transitions, decline/cancel, unfollow and remove-follower. Following back is a separate request; accepting never establishes reciprocity.
2. Implement bilateral block precedence in all permission helpers, transactional removal of both follow edges/pending requests, unblock without restoration, and mute as feed/delivery preference.
3. Add request idempotency, version/concurrency control, actor checks, bounded counts, reject/re-request cooldowns and quotas; block status is not disclosed to the other party.
4. Keep own incoming/outgoing lists paginated; no graph browsing by third parties. Expose safety/report entry points even after blocking.

**Files and ownership**

- [NEW] apps/api/src/modules/community/relationship-routes.ts
- [NEW] apps/mobile/src/features/community/relationships/*
- [MODIFY] community rules/repositories and relationship SQL tests

**Acceptance and verification**

- [x] Crossed requests remain two independent approvals; duplicate requests produce one edge.
- [x] Accept racing cancel/block/deletion cannot leave an approved forbidden edge.
- [ ] Block revokes viewing/discovery/reactions/notifications in both directions; mute does not grant/revoke authorization. Removing a follower/blocking permanently inactivates prior reactions/delivery; reapproval requires fresh interaction.
- [ ] Record source/commands/outcomes/skips; run applicable focused tests and `pnpm check` for runtime changes. Independent non-author authorization/lifecycle review where affected; real local database/storage proof where affected; device acceptance is separate.

Local implementation progress 2026-09-30: request controls, owner graph UI, blocking/muting and retry protections are implemented and independently reviewed. Combined forward migrations pass 283 local SQL assertions plus seven transaction-race checks. [Evidence](COMMUNITY_RELATIONSHIPS_EVIDENCE_2026-09-30.md). Reporting after block, durable delivery invalidation, monitored cooldown purge and physical candidate acceptance remain #148/#149/#151/#155 dependencies; #143 stays open until those stated exits can be exercised.

### COMM-05 — Add privacy-preserving friend discovery and invitation links

**Stage:** Friends pilot. **Dependencies:** [COMM-03](https://github.com/AdamHikl/mizyun/issues/142), [COMM-04](https://github.com/AdamHikl/mizyun/issues/143).

Help known friends connect without uploading contacts or exposing account existence.

**Implementation steps**

1. Implement exact normalized-handle lookup only for opted-in searchable profiles; cap results and rate-limit per actor and abuse source. No email/phone/proximity lookup or graph recommendations.
2. Issue opaque high-entropy expiring/revocable environment-bound profile invitation tokens; links suggest the intended profile but never approve or follow automatically.
3. Implement share-sheet/QR rendering, signed-out login continuation, expired/revoked/deleted/suspended states and post-login revalidation. Use current approved app/universal-link routing; any new web fallback is a separate coordinated change in mizyun-website.
4. Prevent enumeration via errors/counts/timing where practical, open redirects, token logging, replay to reused handles, block bypass and notification spam.

**Files and ownership**

- [NEW] apps/api/src/modules/community/discovery-routes.ts and invitation-routes.ts
- [NEW] apps/mobile/src/features/community/discovery/*
- [NEW] apps/mobile/src/app/community/invite.tsx
- [MODIFY] apps/mobile/src/app/_layout.tsx and approved linking configuration only as needed

**Acceptance and verification**

- [ ] An expired/revoked/foreign-environment invitation cannot connect an unintended account.
- [ ] Opening a link as another logged-in account displays the current principal and requires deliberate follow action. Disabling handle search does not revoke invitations; invitation revocation is a separate explicit control.
- [ ] Non-searchable profiles are absent from handle lookup; a valid owner-shared invitation may reveal minimal identity to an eligible recipient. Block, expiry, withdrawal and deletion checks still apply.
- [ ] Record source/commands/outcomes/skips; run applicable focused tests and `pnpm check` for runtime changes. Independent non-author authorization/lifecycle review where affected; real local database/storage proof where affected; device acceptance is separate.

### COMM-06 — Publish selected workout activity with preview and withdrawal

**Stage:** Friends pilot. **Dependencies:** [COMM-02](https://github.com/AdamHikl/mizyun/issues/141), [COMM-03](https://github.com/AdamHikl/mizyun/issues/142), [COMM-04](https://github.com/AdamHikl/mizyun/issues/143).

Share a deliberately selected workout summary without granting access to the private workout.

**Implementation steps**

1. Build a server allowlist projection from an owner’s confirmed completed workout: generic completion label, selected day and optional duration, plus separately opt-in exercise names and completed set types/reps/weights/set durations authorized on 2026-10-01 (#167); preview exact fields/audience before explicit publish. Exclude free-text workout title/notes and private measurements/media/Coach/device-health data. Existing minimal cards remain minimal.
2. Store a distinct versioned published artifact with owner, opaque ID, source reference, field choices, consent/audience version and lifecycle. No automatic completion sharing or historical backfill. Bind operation IDs to the enrollment generation; preserve author-selected date-only sharedDay separately from published_at.
3. Implement idempotent publish, narrow edit and unpublish. Ordinary private edits do not silently change the snapshot; loss of confirmed/completed eligibility or source deletion invalidates it immediately. Explicit refresh creates a new content version, clears prior reactions and suppresses old reaction notifications; it does not generate a new broadcast automatically.
4. Audience is approved followers at read time; newly approved followers can see still-published history only after this is clearly explained to the owner. Withdrawal revokes delivery and visible metadata/counts.

**Files and ownership**

- [NEW] apps/api/src/modules/community/publication-routes.ts and publication-service.ts
- [NEW] apps/mobile/src/features/community/share/*
- [MODIFY] workout completion UI using public community exports
- [MODIFY] private workout deletion boundary for transactional revocation/outbox through an explicit port

**Acceptance and verification**

- [ ] Sharing preview and received card match the same allowlist; B cannot fetch A’s underlying workout.
- [ ] Lost response + retry creates one card and one logical event.
- [ ] Unpublish/source-delete/withdrawal racing feed or notification prevents subsequent authorized delivery; private diary remains intact.
- [ ] Record source/commands/outcomes/skips; run applicable focused tests and `pnpm check` for runtime changes. Independent non-author authorization/lifecycle review where affected; real local database/storage proof where affected; device acceptance is separate.

### COMM-07 — Build chronological following feed and shared-activity detail

**Stage:** Friends pilot. **Dependencies:** [COMM-04](https://github.com/AdamHikl/mizyun/issues/143), [COMM-06](https://github.com/AdamHikl/mizyun/issues/145).

Show approved friends’ selected activity with predictable visibility and pagination.

**Implementation steps**

1. Implement pull-to-refresh chronological feed and author-card list/detail with bounded keyset pagination (published_at, id), stable cursor format, payload caps and appropriate indexes.
2. Re-evaluate audience/block/suspension/deletion on every list/detail/count query and before return; signed/opaque cursors must not confer access or accept another user’s scope.
3. Render loading/empty/error/end states and clear invitation guidance without fabricated posts. Preserve author-selected sharedDay without timezone conversion; render publication instants in viewer timezone and duration units accessibly, with activity labels and neutral unavailable content states.
4. Start with query-on-read over published artifacts; no public Explore, algorithmic feed, permanent per-follower copies or mandatory Realtime. Coordinate cache behavior with COMM-13.

**Files and ownership**

- [NEW] apps/api/src/modules/community/feed-routes.ts
- [NEW] apps/mobile/src/features/community/feed/*
- [MODIFY] community query adapter and keyset tests

**Acceptance and verification**

- [ ] Equal timestamps, inserted/deleted cards and refresh/pagination produce no unintended duplicate/leaked cards.
- [ ] Old cursor/detail URL cannot bypass an intervening block or withdrawal.
- [ ] Empty feed and backend disablement leave normal workouts and food logging reachable.
- [ ] Record source/commands/outcomes/skips; run applicable focused tests and `pnpm check` for runtime changes. Independent non-author authorization/lifecycle review where affected; real local database/storage proof where affected; device acceptance is separate.

### COMM-08 — Add reversible encouragement reactions

**Stage:** Friends pilot. **Dependencies:** [COMM-04](https://github.com/AdamHikl/mizyun/issues/143), [COMM-06](https://github.com/AdamHikl/mizyun/issues/145), [COMM-07](https://github.com/AdamHikl/mizyun/issues/146).

Let friends encourage activity without introducing unmoderated free-text replies.

**Implementation steps**

1. Provide a small fixed supportive reaction set with one active reaction per viewer/card and explicit remove/change; no downvotes or body comparisons.
2. Enforce card visibility at mutation and read time; unique constraints and idempotency prevent retry inflation. Counts include only currently permitted actors; removed/block-invalidated reactions never return on reapproval. No third-party reactor graph.
3. Publish bounded deduplicated notification events through the outbox and remove/update them when reactions/cards/users are revoked.
4. Keep comments, mentions, custom emoji and comment media disabled until COMM-17 acceptance.

**Files and ownership**

- [NEW] apps/api/src/modules/community/reaction-routes.ts
- [NEW] apps/mobile/src/features/community/reactions/*
- [MODIFY] community reaction adapter/outbox contracts

**Acceptance and verification**

- [ ] Rapid taps, lost response and restart create at most one active reaction and one logical notification.
- [ ] Removed/blocked viewers cannot react via a stale screen or direct API.
- [ ] Deleting/unpublishing a card removes or hides dependent counts and reactions.
- [ ] Record source/commands/outcomes/skips; run applicable focused tests and `pnpm check` for runtime changes. Independent non-author authorization/lifecycle review where affected; real local database/storage proof where affected; device acceptance is separate.

### COMM-09 — Build reporting, content filtering and staffed moderation

**Stage:** Friends pilot gate. **Dependencies:** [COMM-01](https://github.com/AdamHikl/mizyun/issues/140), [COMM-02](https://github.com/AdamHikl/mizyun/issues/141), [COMM-03](https://github.com/AdamHikl/mizyun/issues/142), [COMM-04](https://github.com/AdamHikl/mizyun/issues/143), [COMM-06](https://github.com/AdamHikl/mizyun/issues/145).

Make community safety usable and operational before any social pilot admission.

**Implementation steps**

1. Implement profile/card reporting (later comments/messages/groups too), reason taxonomy, acknowledgement and follow-up status; permit a recent-interaction report after blocking or removal without granting ongoing content access.
2. Filter permitted user text before publication (including handles/display names); define prohibited harassment, body shaming, dangerous fitness advice, scams, spam, impersonation, sexual exploitation/content and illegal content. Do not route health content to AI moderation without a separately accepted provider/data decision.
3. Build a staff-authenticated queue with least privilege, assignment, priority, restricted evidence, warn/remove/suspend/ban decisions, reasons, appeal and audit. Separate report submission from generic feedback and avoid arbitrary report-ID access.
4. Name primary/backup operators, measurable response/escalation targets, published contact route and abuse/child-safety emergency procedure; exercise report-to-resolution and operator-access drills.

**Files and ownership**

- [NEW] apps/api/src/modules/community/report-routes.ts and moderation-routes.ts
- [NEW] staff moderation CLI/UI plus operator runbook
- [NEW] apps/mobile/src/features/community/safety/*
- [NEW] docs/COMMUNITY_STANDARDS.md
- [MODIFY] restricted moderation adapter/policies

**Acceptance and verification**

- [ ] Reported person/export cannot see reporter identity or staff notes; unauthorized staff/user cannot act on a queue item.
- [ ] A removed card remains reportable through bounded evidence without becoming publicly readable.
- [ ] Named operator resolves and audits a synthetic report, escalation and appeal within the declared target; an unattended queue fails launch acceptance.
- [ ] Record source/commands/outcomes/skips; run applicable focused tests and `pnpm check` for runtime changes. Independent non-author authorization/lifecycle review where affected; real local database/storage proof where affected; device acceptance is separate.

Local progress2026-09-30: COMM-09 source implementation and independent authorization review completed; [evidence](COMMUNITY_MODERATION_EVIDENCE_2026-09-30.md) records caller-owned receipts, deterministic filtering, MFA staff/assignment/audit, atomic decisions, independent appeals and mobile restricted safety. Empty scratch passes399 SQL assertions plus quota/claim races. Adam deferred trained backup/contact acceptance until Community functionality is exercised. #148 stays open for physical Dev/both-platform, staffed/contact, retention/delivery and admission dependencies; no pilot or Production release implied.

### COMM-10 — Implement community inbox, notification preferences and safe push

**Stage:** Friends pilot. **Dependencies:** [COMM-04](https://github.com/AdamHikl/mizyun/issues/143), [COMM-06](https://github.com/AdamHikl/mizyun/issues/145), [COMM-08](https://github.com/AdamHikl/mizyun/issues/147), [COMM-09](https://github.com/AdamHikl/mizyun/issues/148).

Notify participants usefully while protecting activity and respecting opt-out.

**Implementation steps**

1. Create owner-only inbox events for request/approval/reaction/moderation outcomes with bounded pagination, durable dedupe, unread/read and retention. Merge preferences with per-category opt-out, mute and quiet hours using user timezone.
2. Use a generic lock-screen message and opaque event ID; server delivery worker rechecks eligibility, audience, block, mute, suspension and deletion at send time.
3. Inventory existing Beta Pro push-token flow before adding a reusable token registry/delivery port; do not make push registration submit a tier request or reuse privileged Beta Pro semantics.
4. Handle denial/token rotation/multiple devices/sign-out/account switching, delivery errors/backoff/expiry, taps after content removal and warm/cold start. In-app functionality works without push permission; push readiness is evidenced separately.

**Files and ownership**

- [NEW] apps/api/src/modules/community/notification-routes.ts
- [NEW] notification domain port / token registry / outbox worker in appropriate core/adapters/API roots
- [NEW] apps/mobile/src/features/community/notifications/*
- [MODIFY] existing principal/token lifecycle and app entry routing through explicit public interfaces

**Acceptance and verification**

- [ ] Denied notification permission does not block following/feed/inbox.
- [ ] Restarted worker produces no duplicate logical inbox events; external push is at-least-once with documented dedupe limits.
- [ ] Queued event after block/logout/delete is suppressed; notification tap re-authorizes and contains no health detail on lock screen.
- [ ] Record source/commands/outcomes/skips; run applicable focused tests and `pnpm check` for runtime changes. Independent non-author authorization/lifecycle review where affected; real local database/storage proof where affected; device acceptance is separate.

### COMM-11 — Integrate accessible community journeys into mobile navigation and Account

**Stage:** Friends pilot. **Dependencies:** [COMM-03](https://github.com/AdamHikl/mizyun/issues/142), [COMM-04](https://github.com/AdamHikl/mizyun/issues/143), [COMM-05](https://github.com/AdamHikl/mizyun/issues/144), [COMM-06](https://github.com/AdamHikl/mizyun/issues/145), [COMM-07](https://github.com/AdamHikl/mizyun/issues/146), [COMM-08](https://github.com/AdamHikl/mizyun/issues/147), [COMM-09](https://github.com/AdamHikl/mizyun/issues/148), [COMM-10](https://github.com/AdamHikl/mizyun/issues/149).

Make the complete friends experience reachable on iOS and Android without slowing tracking.

**Implementation steps**

1. Follow Adam’s authorized 2026-09-30 navigation decision (ADR-0031): Home / Workouts / Meals / Coach / Community, with Account in header avatars. Put optional joining/profile/consent directly in Community; retain Account privacy entry and root-stack settings as secondary management routes. Original target-user and platform acceptance remains open. Respect #133 settings catalog/navigation patterns.
2. Integrate enrollment, identity, requests/lists, find/invite, share preview, feed, report/block/mute, notification preferences and leave-community screens.
3. Provide meaningful empty/loading/error/retry/disabled states, confirmation for destructive withdrawal, request status feedback, keyboard safety and accessible non-gesture alternatives.
4. Verify VoiceOver/TalkBack, large text, dark/light, small phones/iPad, RTL-ready layout, metric/imperial and timezone boundaries. Do not add permission prompts at signup for optional community.

**Files and ownership**

- [NEW] apps/mobile/src/features/community/index.ts and screens/components
- [NEW] apps/mobile/src/app/community/*.tsx
- [MODIFY] apps/mobile/src/app/_layout.tsx
- [MODIFY] Account/settings catalog through existing feature public exports

**Acceptance and verification**

- [ ] Two synthetic users complete enroll → invite → approve → publish → see → react → report/block → withdraw on both platforms.
- [ ] Screen-reader users can discover and operate every primary/safety control.
- [ ] Unenrolled, disabled or offline community never blocks core logging/Account privacy controls.
- [ ] Record source/commands/outcomes/skips; run applicable focused tests and `pnpm check` for runtime changes. Independent non-author authorization/lifecycle review where affected; real local database/storage proof where affected; device acceptance is separate.

### COMM-12 — Integrate social export, withdrawal, deletion and retention

**Stage:** Friends pilot gate. **Dependencies:** [COMM-02](https://github.com/AdamHikl/mizyun/issues/141), [COMM-03](https://github.com/AdamHikl/mizyun/issues/142), [COMM-04](https://github.com/AdamHikl/mizyun/issues/143), [COMM-06](https://github.com/AdamHikl/mizyun/issues/145), [COMM-08](https://github.com/AdamHikl/mizyun/issues/147), [COMM-09](https://github.com/AdamHikl/mizyun/issues/148), [COMM-10](https://github.com/AdamHikl/mizyun/issues/149).

Make social participation reversible and include it in the account lifecycle.

**Implementation steps**

1. Extend versioned export inventory/manifest/pagination for social identity, own graph/preferences/posts/reactions/inbox and permitted report records; define per-category consistency/completeness and avoid others’ private data or reporter disclosure.
2. Implement leave-community independent of account deletion: immediately hide profile/shares, revoke invitations/graph delivery and pending writes, then durable cleanup keyed to the captured enrollment generation; block re-enrollment until cleanup finishes or prove generation-scoped cleanup cannot delete new data. Retain private diary and account.
3. Extend the tombstoned account deletion worker with incoming/outgoing edges, references, notifications/outbox, tokens and media as introduced; use resumable bounded batches and barriers that exclude new writes immediately.
4. Specify time-bounded restricted moderation/legal retention with lawful basis, access and expiry, backup RPO/retention and restore replay so revoked social data never becomes visible again. Integrate #25/#26 rather than claiming their existing gates passed.

**Files and ownership**

- [MODIFY] packages/contracts/src/account.ts and packages/core/src/account.ts
- [MODIFY] packages/adapters/supabase-server/src/account-repository.ts
- [MODIFY] apps/api/src/modules/account/routes.ts
- [MODIFY] apps/mobile/src/features/settings/account-data-management.ts and principal-state.ts
- [MODIFY] docs/ACCOUNT_EXPORT_INVENTORY.md / retention runbooks
- [NEW] social lifecycle regression suites

**Acceptance and verification**

- [ ] Deleting a high-degree user resumes after lease loss/restart without orphan visible data, incoming edges or queued delivery.
- [ ] Export includes all declared own social categories with no secret/reporting identities.
- [ ] Withdraw/account-delete/sign-out purge local state; delayed cleanup followed by re-enrollment/retry cannot delete new-generation data or resurrect old shares. Restore retains deletions/blocks and never republishes revoked cards.
- [ ] Record source/commands/outcomes/skips; run applicable focused tests and `pnpm check` for runtime changes. Independent non-author authorization/lifecycle review where affected; real local database/storage proof where affected; device acceptance is separate.

### COMM-13 — Harden retries, social cache privacy and account switching

**Stage:** Friends pilot gate. **Dependencies:** [COMM-04](https://github.com/AdamHikl/mizyun/issues/143), [COMM-05](https://github.com/AdamHikl/mizyun/issues/144), [COMM-06](https://github.com/AdamHikl/mizyun/issues/145), [COMM-07](https://github.com/AdamHikl/mizyun/issues/146), [COMM-08](https://github.com/AdamHikl/mizyun/issues/147), [COMM-10](https://github.com/AdamHikl/mizyun/issues/149).

Prevent stale visibility and replayed social mutations during failures.

**Implementation steps**

1. Use operation IDs and semantic idempotency for request/publication/reaction/report mutations, bounded retry classes, optimistic rollback and conflict handling. Privacy mutations require confirmed server acknowledgement with honest pending/error UI.
2. Pilot caches other people’s activity in memory only; clear on background, logout, account switch and visibility refresh. Offline reopening shows unavailable state rather than persisted friend health cards. Preserve owner drafts separately with account binding.
3. Revalidate on foreground/detail/pagination and cancel in-flight requests on principal change. Never replay queued publication/reaction after withdrawal/logout/block/source deletion; every retry rechecks current authority and enrollment generation.
4. Test lost response, timeout after commit, restart, wrong-account queue reuse, out-of-order response, stale notification and device A revocation while device B resumes. No client can erase screenshots or information already viewed; communicate this limit.

**Files and ownership**

- [NEW] apps/mobile/src/features/community/state/* and mutation/cache tests
- [MODIFY] community API client implementations and disabled client
- [MODIFY] principal teardown through existing public interfaces
- [NEW] API concurrency/idempotency tests

**Acceptance and verification**

- [ ] Retry after committed-but-lost response yields one durable effect.
- [ ] Old request result cannot render under a new principal.
- [ ] Foreground after remote revocation clears stale activity before showing it; no persisted shared health data survives account switch.
- [ ] Record source/commands/outcomes/skips; run applicable focused tests and `pnpm check` for runtime changes. Independent non-author authorization/lifecycle review where affected; real local database/storage proof where affected; device acceptance is separate.

### COMM-14 — Add community operations, capacity controls and consent-respecting metrics

**Stage:** Friends pilot gate. **Dependencies:** [COMM-02](https://github.com/AdamHikl/mizyun/issues/141), [COMM-09](https://github.com/AdamHikl/mizyun/issues/148), [COMM-10](https://github.com/AdamHikl/mizyun/issues/149), [COMM-12](https://github.com/AdamHikl/mizyun/issues/151), [COMM-13](https://github.com/AdamHikl/mizyun/issues/152).

Keep a working community affordable, observable and recoverable.

**Implementation steps**

1. Add environment/cohort kill switches for enrollment/discovery/publish/engagement/delivery; turning community off still permits reporting, block/unpublish/withdraw/export/delete and private tracking.
2. Bound follow/invite/post/reaction/report rates, feed page and graph sizes, payloads, retry/outbox growth and worker concurrency. Protect suspicious traffic without making essential privacy controls unavailable.
3. Measure aggregate latency/errors/queue age/reports/response targets/storage and per-active-user cost without handles, graph edges, text, tokens, workout values or sensitive IDs in routine logs/analytics.
4. Measure opt-in enrollment, approved friend pairs, deliberate first share, voluntary community return and core logging retention separately; optional analytics refusal/failure must work. Define load fixtures, query plans, budget/alert thresholds, backup restore, rollback and incident runbooks on Hetzner.

**Files and ownership**

- [MODIFY] packages/config and apps/api/src/app.ts composition
- [NEW] community operational metrics / load fixtures / runbook
- [MODIFY] first-party analytics schemas and event inventory only after OBS review
- [MODIFY] existing backup/restore evidence coverage and worker scheduling

**Acceptance and verification**

- [ ] Proposed pilot load: 30 users, up to 100 approved follows/user and 20 cards/page; record dataset/hardware, no full scan or unbounded fanout. Set measured latency/error targets before admission.
- [ ] Kill-switch drill stops publishing/delivery while safety and private records remain usable.
- [ ] Synthetic outage/restart/restore and queue backlog drill pass; moderation alerts reach the named operator.
- [ ] Record source/commands/outcomes/skips; run applicable focused tests and `pnpm check` for runtime changes. Independent non-author authorization/lifecycle review where affected; real local database/storage proof where affected; device acceptance is separate.

### COMM-15 — Accept community legal, privacy and store-disclosure gates

**Stage:** Friends pilot gate. **Dependencies:** [COMM-01](https://github.com/AdamHikl/mizyun/issues/140), [COMM-09](https://github.com/AdamHikl/mizyun/issues/148), [COMM-12](https://github.com/AdamHikl/mizyun/issues/151), [COMM-14](https://github.com/AdamHikl/mizyun/issues/153).

Align actual community behavior with disclosures and applicable legal/store obligations.

**Implementation steps**

1. Review data map, purpose/lawful basis, special-category fitness/health implications, withdrawal and retention, controller/provider roles, and DPIA/DSA applicability with qualified review where needed; do not treat a share button as complete legal approval.
2. Publish versioned community terms/standards/contact/privacy updates and acceptance flow. Assess Google Child Safety Standards applicability from final app functionality/category even for an adult pilot; document regional escalation and child-safety point of contact when applicable.
3. Update Apple privacy labels/age rating/review notes and Google Data safety/content rating/health declarations to match the enabled scope; include synthetic reviewer accounts that demonstrate report/block and private-versus-shared separation.
4. Keep website changes in the separate mizyun-website checkout; coordinate approved copy and link checks there. No store submission or Production promotion is authorized by this planning issue.

**Files and ownership**

- [MODIFY] apps/api/src/modules/legal and mobile legal/consent screens
- [NEW] docs/COMMUNITY_LEGAL_STORE_CHECKLIST.md
- [MODIFY, separate coordinated checkout] mizyun-website privacy/terms/support pages
- [MODIFY] store submission preparation artifacts

**Acceptance and verification**

- [ ] Disclosure matrix matches live enabled behavior and has named approver/source dates.
- [ ] Terms acceptance precedes UGC creation; refusal leaves private tracking available.
- [ ] Working contact/report/block demonstration and applicable safety declarations are verified; uncertain applicability stays an explicit launch blocker.
- [ ] Record source/commands/outcomes/skips; run applicable focused tests and `pnpm check` for runtime changes. Independent non-author authorization/lifecycle review where affected; real local database/storage proof where affected; device acceptance is separate.

### COMM-16 — Verify and run the exact-candidate friends pilot

**Stage:** Friends pilot acceptance. **Dependencies:** [COMM-01](https://github.com/AdamHikl/mizyun/issues/140), [COMM-02](https://github.com/AdamHikl/mizyun/issues/141), [COMM-03](https://github.com/AdamHikl/mizyun/issues/142), [COMM-04](https://github.com/AdamHikl/mizyun/issues/143), [COMM-05](https://github.com/AdamHikl/mizyun/issues/144), [COMM-06](https://github.com/AdamHikl/mizyun/issues/145), [COMM-07](https://github.com/AdamHikl/mizyun/issues/146), [COMM-08](https://github.com/AdamHikl/mizyun/issues/147), [COMM-09](https://github.com/AdamHikl/mizyun/issues/148), [COMM-10](https://github.com/AdamHikl/mizyun/issues/149), [COMM-11](https://github.com/AdamHikl/mizyun/issues/150), [COMM-12](https://github.com/AdamHikl/mizyun/issues/151), [COMM-13](https://github.com/AdamHikl/mizyun/issues/152), [COMM-14](https://github.com/AdamHikl/mizyun/issues/153), [COMM-15](https://github.com/AdamHikl/mizyun/issues/154).

Close the friends feature only after real end-to-end safety and product acceptance.

**Implementation steps**

1. Run settled-source pnpm check, meaningful multi-principal local database/RLS/API suites and independent authorization/lifecycle review; retain existing #21/#25/#26/#27/#32 acceptance dependencies where affected.
2. Deploy only an accepted exact SHA to Dev under the deploy skill in a separately authorized implementation session; verify Dev/Production token rejection both ways, older-client compatibility and devices without Metro.
3. Exercise two synthetic accounts plus unrelated/blocked principal on physical iOS/Android: invitations, requests, publish/withdraw, feed/reaction, report/moderation/appeal, denial, account switching, export/delete and offline recovery.
4. Run named-operator drill, rollback/restore and kill switches; then record founder go/no-go, separately accepted pilot environment and admission policy for an eligible opt-in 10–30-person pilot. Existing Dev approval is founder/testing-partner only; its shared-Gemini exception does not authorize this larger cohort. Assess interviews, return, support/abuse load and cost against thresholds fixed in COMM-01, including users who opted out.

**Files and ownership**

- [NEW] docs/COMMUNITY_ACCEPTANCE_EVIDENCE.md
- [NEW] targeted API/database/device acceptance fixtures
- [MODIFY, coordinator only] status.md and GitHub issue evidence/status

**Acceptance and verification**

- [ ] Source SHA, migration versions, environment, device/build IDs, commands/results/skips and operator evidence are recorded separately.
- [ ] No unresolved privacy/authorization/safety P0/P1; no unrun/credential-gated check counted as pass.
- [ ] Implementation, automatic checks, Dev deployment, device acceptance, pilot admission and Production/store release are separately evidenced; #137’s initial scope closure does not imply all expansions shipped.
- [ ] Record source/commands/outcomes/skips; run applicable focused tests and `pnpm check` for runtime changes. Independent non-author authorization/lifecycle review where affected; real local database/storage proof where affected; device acceptance is separate.

### COMM-17 — Add moderated comments and controlled mentions after pilot

**Stage:** Expansion. **Dependencies:** [COMM-16](https://github.com/AdamHikl/mizyun/issues/155), [COMM-09](https://github.com/AdamHikl/mizyun/issues/148), [COMM-10](https://github.com/AdamHikl/mizyun/issues/149), [COMM-12](https://github.com/AdamHikl/mizyun/issues/151), [COMM-13](https://github.com/AdamHikl/mizyun/issues/152).

Allow conversation only after the pilot proves moderation capacity.

**Implementation steps**

1. Add bounded plain-text comment/reply schemas, author edit/delete, thread pagination and per-post author disable controls; no rich links or attachments initially.
2. Apply publish-time filtering, report/block/moderation/appeal and lifecycle/export to every comment; prevent block bypass through thread previews/counts.
3. Limit mentions to permitted consenting participants, deduplicate and cap notifications, and handle deleted accounts or withdrawn posts without revealing hidden text.
4. Re-evaluate threat model, response coverage and metrics before enabling; comments have a separate release flag and are not part of initial friends acceptance.

**Files and ownership**

- [NEW] community comment domain/contracts/schema/routes/UI/tests
- [MODIFY] safety, notifications, export/deletion via public ports

**Acceptance and verification**

- [ ] Comment edit/delete/report works after partial failure and moderation removal.
- [ ] Mention spam, cross-thread ID forgery, hidden parent post and blocked-author cases fail safely.
- [ ] Operator drill and both-platform thread accessibility pass before enabling.
- [ ] Record source/commands/outcomes/skips; run applicable focused tests and `pnpm check` for runtime changes. Independent non-author authorization/lifecycle review where affected; real local database/storage proof where affected; device acceptance is separate.

### COMM-18 — Build private community groups with roles and membership safety

**Stage:** Expansion. **Dependencies:** [COMM-16](https://github.com/AdamHikl/mizyun/issues/155), [COMM-09](https://github.com/AdamHikl/mizyun/issues/148).

Support small gym/friend communities without widening diary access.

**Implementation steps**

1. Define private group discoverability, create/join/request/invite/leave and owner/moderator/member permissions; cap membership and implement owner transfer/last-owner behavior.
2. Keep group publication an explicit separate audience with clear past-history visibility; define interaction between bilateral blocks and shared-group membership.
3. Add group rules, membership removal/bans, group reports/appeals, moderator abuse handling, export/deletion and notifications.
4. Version contracts/policies and test actual RLS for membership change/revocation; group text must pass COMM-09 filtering/report/appeal capability and its own acceptance, independent of comments. No commercial coaching team roles assumed.

**Files and ownership**

- [NEW] community groups domain/contracts/migrations/API/mobile flows/tests
- [MODIFY] publication audiences, safety and lifecycle ports

**Acceptance and verification**

- [ ] Role escalation and removed-member historical access fail under direct database/API access.
- [ ] Owner deletion/transfer, disbanding, moderator removal and blocked members have defined recoverable behavior.
- [ ] Group report/moderation/leave workflows pass real device acceptance.
- [ ] Record source/commands/outcomes/skips; run applicable focused tests and `pnpm check` for runtime changes. Independent non-author authorization/lifecycle review where affected; real local database/storage proof where affected; device acceptance is separate.

### COMM-19 — Add safe opt-in cooperative fitness challenges

**Stage:** Expansion. **Dependencies:** [COMM-16](https://github.com/AdamHikl/mizyun/issues/155), [COMM-18](https://github.com/AdamHikl/mizyun/issues/157).

Help friends build consistency without harmful competition.

**Implementation steps**

1. Start with voluntary workout-consistency/team goals; no weight-loss/calorie-deficit/body-comparison competition, prizes/payments or HealthKit/Health Connect data import.
2. Define consent, join/leave, bounded dates/timezones, missing data, edits/deletions, progress provenance, duplicate prevention and equitable rest/accessibility alternatives.
3. Use deterministic scoring over separately opted-in challenge artifacts; no direct access to another person’s diary, retroactive ingestion or authoritative health changes.
4. Support moderation, withdrawal, canceled challenge, notifications, export/delete and anti-cheating/report handling; validate benefit before expanding leaderboards.

**Files and ownership**

- [NEW] challenge core rules/reference tests/contracts/schema/API/mobile flows
- [MODIFY] groups, publication, safety, notification and lifecycle ports

**Acceptance and verification**

- [ ] Timezone/DST, late sync, duplicated workouts and source edit/delete do not inflate progress.
- [ ] Leave/block/group removal revokes future contribution/display without corrupting private logs.
- [ ] Safety review, accessible alternative and real-group pilot pass before enablement.
- [ ] Record source/commands/outcomes/skips; run applicable focused tests and `pnpm check` for runtime changes. Independent non-author authorization/lifecycle review where affected; real local database/storage proof where affected; device acceptance is separate.

### COMM-20 — Evaluate and build consent-based direct messaging

**Stage:** Expansion, decision gated. **Dependencies:** [COMM-16](https://github.com/AdamHikl/mizyun/issues/155), [COMM-09](https://github.com/AdamHikl/mizyun/issues/148), [COMM-12](https://github.com/AdamHikl/mizyun/issues/151), [COMM-14](https://github.com/AdamHikl/mizyun/issues/153), [COMM-15](https://github.com/AdamHikl/mizyun/issues/154).

Offer private conversation only if users need it and operations can support it.

**Implementation steps**

1. Validate demand and document a threat model plus honest retention/encryption/access model; do not claim end-to-end encryption without implementing and verifying it.
2. Require mutual approved relationship and recipient messaging opt-in; add mute/block/report, abuse limits and no unsolicited/anonymous/random messaging. Start text-only, using COMM-09 text-safety/reporting capability with messaging-specific acceptance; comments need not ship first.
3. Specify message ordering/delivery retry, edit/delete semantics for both participants, report evidence/appeals, account deletion and export without another user’s private unrelated data.
4. Keep lock-screen notifications generic and omit read receipts/online status initially; plan sockets/background delivery only after installed-platform research and bounded operational budgets.

**Files and ownership**

- [NEW, after go/no-go] messaging domain/contracts/adapters/schema/API/mobile tests
- [MODIFY] safety/lifecycle/notification boundaries

**Acceptance and verification**

- [ ] Recipient opt-out/block/suspension prevents new delivery through all API/background paths.
- [ ] Lost response, reconnect, participant deletion and moderation evidence retention have testable semantics.
- [ ] Messaging-specific legal/moderation/security review and both-device acceptance pass before enabling.
- [ ] Record source/commands/outcomes/skips; run applicable focused tests and `pnpm check` for runtime changes. Independent non-author authorization/lifecycle review where affected; real local database/storage proof where affected; device acceptance is separate.

### COMM-21 — Create a separate safe community media pipeline

**Stage:** Expansion, decision gated. **Dependencies:** [COMM-16](https://github.com/AdamHikl/mizyun/issues/155), [COMM-09](https://github.com/AdamHikl/mizyun/issues/148), [COMM-12](https://github.com/AdamHikl/mizyun/issues/151), [COMM-14](https://github.com/AdamHikl/mizyun/issues/153), [COMM-15](https://github.com/AdamHikl/mizyun/issues/154).

Support social avatars/photos without republishing private progress media.

**Implementation steps**

1. Decide permitted media/audiences and validate a moderation-capacity/data-processing plan; first beta body-photo privacy remains intact and private progress assets are never relabeled public.
2. Create separately uploaded derived assets in private community buckets with MIME/signature/decode/size/dimension checks, EXIF/location stripping, moderation quarantine and authenticated authorization-aware delivery.
3. Handle interrupted uploads, orphan cleanup, unpublish/block/delete, thumbnail revocation and backup restoration. A signed URL may outlive ACL change; choose proxy authorization or document/test a strict maximum access window before launch.
4. Include alt text/accessibility, image abuse reporting, legal rights and explicit no-auto-crossposting consent. No AI vendor transfer without a separate accepted provider decision.

**Files and ownership**

- [NEW] community-media storage adapter/contracts/migrations/API/mobile upload flows
- [MODIFY] safety/export/deletion/cleanup workers; existing private body-media policies remain unchanged

**Acceptance and verification**

- [ ] Unauthenticated/unrelated/blocked users cannot fetch originals or thumbnails.
- [ ] EXIF stripping, malicious/oversized files, stale URLs and orphan/restart cleanup pass real Storage tests.
- [ ] A private body photo never becomes shared by enrollment, publishing a workout or changing a profile.
- [ ] Record source/commands/outcomes/skips; run applicable focused tests and `pnpm check` for runtime changes. Independent non-author authorization/lifecycle review where affected; real local database/storage proof where affected; device acceptance is separate.

### COMM-22 — Add explicit routine sharing with provenance and independent copies

**Stage:** Expansion. **Dependencies:** [COMM-16](https://github.com/AdamHikl/mizyun/issues/155), [COMM-09](https://github.com/AdamHikl/mizyun/issues/148), [COMM-12](https://github.com/AdamHikl/mizyun/issues/151).

Let friends exchange useful workout plans while preserving ownership and safety.

**Implementation steps**

1. Define an allowlisted routine snapshot with authorship/version, safe exercise targets and no injury/limitation/Coach/private note fields; require deliberate preview/publication.
2. Allow authorized recipient to import a new independent editable private routine, with attribution and confirmation; never share mutable source IDs or permit writes back to the author.
3. Define stale source edits/removal, custom exercise references, unavailable/deleted author, moderation/report and export/deletion semantics. Explain copied material already retained by a recipient cannot be remotely erased.
4. Validate units and reference exercises deterministically; no paid marketplace or unqualified medical coaching claims.

**Files and ownership**

- [NEW] routine-share domain/contracts/API/mobile flows and tests
- [MODIFY] workout routines via public import/export ports, safety and lifecycle

**Acceptance and verification**

- [ ] Copying cannot change the author’s routine or include hidden health fields.
- [ ] Source change/deletion leaves an explicitly independent recipient copy with honest provenance.
- [ ] Unsafe-content report, bad references, retry duplicate import and both-platform UX pass.
- [ ] Record source/commands/outcomes/skips; run applicable focused tests and `pnpm check` for runtime changes. Independent non-author authorization/lifecycle review where affected; real local database/storage proof where affected; device acceptance is separate.

### COMM-23 — Evaluate broader discovery, public visibility and contact matching

**Stage:** Expansion, decision gated. **Dependencies:** [COMM-16](https://github.com/AdamHikl/mizyun/issues/155), [COMM-09](https://github.com/AdamHikl/mizyun/issues/148), [COMM-14](https://github.com/AdamHikl/mizyun/issues/153), [COMM-15](https://github.com/AdamHikl/mizyun/issues/154).

Assess wider network growth only after a safe friends community retains users.

**Implementation steps**

1. Validate user need for wider discoverability and compare explicit handle search, creator/profile search and optional public cards; default existing profiles/cards stay private with no retroactive widening.
2. Threat-model scraping/impersonation/harassment, search indexing, public-link persistence, viewer controls, suspension and moderation demand; public profiles/Explore require separately approved audience rules and launch gates.
3. Treat contact matching as a separate go/no-go within this package: no address-book access/upload until purpose/consent, third-party contact rights, minimization, retention and platform-policy review are accepted.
4. Add migration, export/deletion, anti-enumeration, opt-out and metrics if a specific discovery experiment is selected. No ad targeting, graph sale, engagement ranking or involuntary promotion.

**Files and ownership**

- [NEW] discovery experiment/privacy contract/threat model
- [NEW, only after decision] bounded discovery schemas/routes/UI/tests
- [MODIFY] standards/disclosures and lifecycle for selected scope

**Acceptance and verification**

- [ ] No current participant or historical card becomes public by default.
- [ ] Explicit denial/revocation works and does not break known-friend following.
- [ ] A measured benefit, capacity budget and independent privacy/authorization review precede enablement.
- [ ] Record source/commands/outcomes/skips; run applicable focused tests and `pnpm check` for runtime changes. Independent non-author authorization/lifecycle review where affected; real local database/storage proof where affected; device acceptance is separate.

## D. Verification and launch gates

Before each runtime segment refresh dated primary sources, implement meaningful failure-boundary regressions, format only owned changes, then run focused suites and `pnpm check` before commit. Commands proposed (not run in this planning session):

```bash
pnpm --filter @mizyun/contracts test
pnpm --filter @mizyun/core test
pnpm --filter @mizyun/adapter-supabase-server test
pnpm --filter @mizyun/api test src/modules/community src/modules/account
pnpm --filter @mizyun/mobile test src/features/community src/features/settings
pnpm db:verify # only the disposable local Mac database, never Hetzner/Pi
pnpm check
git diff --check
```

COMM-02 adds real PostgREST/storage/RPC checks where applicable; mocks alone are insufficient. Community security fixtures use synthetic data and at least owner, approved follower, unrelated/pending and blocked principals, plus separate staff and anonymous access. New exported schema/transport versions need old-client rollout compatibility. The full gate is required after helper writes settle; no skipped provider/device suite can be described as passing.

Minimum adversarial acceptance matrix:

- All select/insert/update/delete/RPC paths across all viewer states and source/private tables; forged approvals/roles/ownership and direct database access.
- Approve racing cancel/block/delete; duplicate/crossed requests, reject cooldowns, handle collisions/reuse, stolen/revoked/foreign-environment invitations.
- Lost response after publish/follow/reaction/report commit, worker restart, bounded backlog and retry dedupe; no queued write replay after principal/consent change.
- Unpublish/block/source deletion while another client fetches or resumes; revoked details/counts/search/cursors/inbox/delivery excluded. No absolute guarantee for content already fetched; stale client display is cleared upon controlled lifecycle revalidation.
- Equal-time keyset pages, high-degree accounts, malformed cursor and no unbounded scans/fanout; set measured latency, payload, quota and cost thresholds before admission.
- Notification denial, token replacement, multiple devices, logout, cold/warm tap and post-removal taps; no lock-screen health payload. Push-provider acceptance is separate from visible delivery.
- Report after block/removal, queue role denial, reporter confidentiality, audit, escalation, appeal, operator unavailability and malicious reports.
- Large export, declared consistency, tombstoned account deletion interrupted between batches/storage stages and restricted evidence expiry; restore must replay privacy revocations before social reads/delivery reopen.
- Physical iOS and Android builds without Metro; VoiceOver/TalkBack, large text/iPad/small phone, dark/light, units/timezones, poor network and two-account switching. Unenrolled users can still log food/workouts.

Pilot gates: approved product/privacy/age contract; accepted RLS/lifecycle review; existing relevant release gates; staffed moderation/contact/escalation; matched disclosures; real local DB tests; exact Dev candidate with device journeys; queue/kill-switch/restore drills; founder go/no-go and bounded eligible cohort. Proposed cohort 10–30 opt-in adults, not public access; individual admissions need approved policy, environment and release evidence. Existing Dev testing authorization is founder/testing-partner only with a shared-Gemini exception: this plan does not expand it. Select an accepted isolated pilot environment/provider-admission policy before cohort invitations; do not silently put a larger cohort on current Dev. Proposed success review uses approved friend pairs, first deliberate share, voluntary return and interviews, core-product retention, support burden, safety response and cost. COMM-01 fixes numeric success/go/no-go thresholds before recruitment. Follower count, downloads and founder-assisted walkthroughs do not prove retained value.

Each issue tracks implemented, automatically verified, Dev deployed and device accepted separately. Initial #137 completion needs COMM-01–16 exit evidence; later children remain independently gated. If GitHub requires completed sub-issues for parent closure, reparent deferred expansions to an explicitly created expansion epic at that milestone, preserving all links and scope history; never close them as completed just to close #137. Production promotion, artifact/upload and store approval stay separate explicit milestones.

## Primary sources and design consequences

Official sources accessed 2026-09-29; these support policy/technology facts, while architecture/defaults above are planning proposals:

- [Apple App Review §1.2 and §5.1](https://developer.apple.com/app-store/review/guidelines/): filtering, report response, blocking and a reachable published contact belong in the UGC launch gate; preserve sensitive-data controls.
- [Google Play UGC policy](https://support.google.com/googleplay/android-developer/answer/9876937?hl=en): content visible to a subset is UGC; terms acceptance and ongoing moderation apply to the friends pilot too.
- [Google Child Safety Standards applicability](https://support.google.com/googleplay/android-developer/answer/14747720?hl=en): evaluate actual app category/functionality and applicable declarations/contact/escalation before broader social surfaces; an adult audience is not assumed to settle applicability.
- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) and [Storage authorization](https://supabase.com/docs/guides/storage/security/access-control): inspect policies, grants, views/RPC and privileged clients; future community media must be separate private storage with scoped access.
- [Expo SDK 57 notifications](https://docs.expo.dev/versions/v57.0.0/sdk/notifications/) and [linking](https://docs.expo.dev/linking/overview/): platform permission, delivery and deep-link lifecycle need explicit device acceptance and account revalidation.
- [React Native accessibility](https://reactnative.dev/docs/accessibility): screen-reader role/state/focus behavior informs UI acceptance.
- [GDPR official text](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32016R0679): assess purposes/lawful basis and sensitive-data treatment, withdrawal, access/erasure/portability, minimization and DPIA need. This plan does not certify compliance.

## E. Next-session prompt

> Work on COMMUNITY-001 / COMM-01 under `docs/COMMUNITY_IMPLEMENTATION_PLAN_2026-09-29.md` and parent #137. First inspect `git -c core.fsmonitor=false status --short`, root AGENTS, newest status and START_HERE; read goals/business alignment and `pnpm context account-lifecycle` plus focused auth/workout context. Re-fetch the issue and dates/sources. Produce the product/permission/privacy contract and wireframes before writing runtime code. Keep community after existing private-product acceptance unless Adam explicitly changes sequencing. Delegate a bounded independent threat-model/UX review; coordinator owns status/GitHub/ADR integration and shared files. Ratify age/audiences, history visibility, limits/retention, staffing and pilot thresholds; precisely preserve private-record cross-user denial. No local Qwen, remote reset, Production deploy or provider enablement. Mark completed design evidence accurately; leave implementation and release gates open. After this contract is accepted, COMM-02 is the next runtime work package.

## Dev sequencing amendment — 2026-10-01

Adam explicitly authorized implementing all later expansions #156–162 on Dev, superseding their deferred source-start sequence. ADR-0032 specifies separate default-off controls, explicit group/follower/recipient audiences and no address-book collection. This amendment does not supply original pilot, operator, legal, physical or Production exits. Each issue remains independently tracked until its stated acceptance is met.
