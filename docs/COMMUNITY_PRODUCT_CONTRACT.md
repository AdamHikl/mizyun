# Community product contract, privacy rules and UX

**Design revision:** COMM-01 / [#140](https://github.com/AdamHikl/mizyun/issues/140), 2026-09-30. This revision supersedes the September 29 contract and its conflicting defaults. Product rules below are implementation requirements, not claims about working screens, staff coverage or release acceptance. Target-user validation remains unrun; see [the validation pack](COMMUNITY_UX_VALIDATION_2026-09-30.md).

**Parent:** [#137](https://github.com/AdamHikl/mizyun/issues/137). **Architecture:** [ADR-0030](adr/0030-explicit-community-publication.md). **Inventory and per-issue plans:** [master implementation plan](COMMUNITY_IMPLEMENTATION_PLAN_2026-09-29.md). **Current code evidence:** [September 30 review](COMMUNITY_REVIEW_EVIDENCE_2026-09-30.md).

## 1. Scope and permissions

Community lets consenting adult friends encourage each other through deliberately published workout completion cards. Private tracking remains the primary product. Community stays outside the first-beta follower exclusion until its own pilot gates are accepted; this document changes neither roadmap sequencing nor Production availability.

- Joining, exact-handle discovery, each follow approval, each publication and push permission are separate choices. Discovery and duration sharing default off. Enrollment copies no private profile fields into social identity.
- Refusing Community, declining a request or withdrawing preserves private tracking, paid entitlement and Coach access. AI consent/admission, analytics consent, HealthKit/Health Connect permission and notification permission remain independent. Community has no access to private health integrations or Coach context.
- Pilot scope: separate social profile; approved directional following; exact lookup or invitation; chronological feed; five predefined encouragement reactions; owner controls; block/mute/report; staffed moderation; inbox; lifecycle/export and operational safety.
- No public profiles/feed, follower-count ranking, recommendations, contact uploads, email/phone lookup, custom workout titles, captions, comments, mentions, photos, groups, challenges, direct messages or routine imports in this pilot. Issues #156–162 retain separate post-pilot decisions and gates.
- No premium community admission/paywall or reward for enrolling. No automatic follow, sharing, invitation sending or notification permission request.

### Selected design decisions

These are the selected bounded-pilot rules. Their implementation and legal assessment have named owners; selection alone does not authorize pilot admission.

| Decision               | Rule                                                                                                                                                                                                                                                                                                       | Implementation / acceptance owner |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Adult eligibility      | Separate adult declaration plus conservative server evaluation of private self-reported birth year: integer 1900 through current UTC year, `birthYear <= currentUtcYear - 19`. Missing/invalid year denies enrollment.                                                                                     | #142, #154                        |
| Age boundary           | In 2026, years through 2007 pass; 2008 does not establish that the birthday has occurred. A person born in 2008 must wait until 2027 under this mechanism. Never describe self-report as identity verification. No new DOB, ID or selfie collection.                                                       | #142, #154                        |
| Age assurance review   | #154 must assess whether this mechanism is adequate for the actual jurisdictions, distribution and cohort before admission. If stronger assurance is required, stop admission and record a revised minimal-data design; no silent collection or default bypass. Private profile corrections stay possible. | #154, #155                        |
| Audience               | Owner plus currently approved, active followers, including still-published historical cards. Approval is directional; reciprocal following needs its own approval.                                                                                                                                         | #143, #145, #146                  |
| Discoverability        | Default off; exact normalized handle only when enabled. Known valid invitation provides minimal identity despite search being off.                                                                                                                                                                         | #142, #144                        |
| Handles                | Immutable for this pilot; reserved to the account through withdrawal. Deleted-account handle has a 90-day minimal quarantine. Future rename requires #142 extension, 30-day cooldown, no silent redirect and invalidation of old invitations. Rename is not advertised in pilot UX.                        | #142, #151                        |
| Invitations            | Reusable, owner-revocable bearer capability, maximum seven days, bound to inviter identity, enrollment generation and environment. At least 128 random bits; never an approval or admission bypass.                                                                                                        | #144                              |
| Publication            | Separate from saving a workout. Generic category and selected calendar day; duration off until deliberately selected. Preview discloses present and future approved audience.                                                                                                                              | #145                              |
| Safety ownership       | Founder Adam Hikl is accountable product/operator owner. A named trained backup, staffed schedule, verified contact route, appeal route and escalation playbook are prerequisites, not existing capabilities.                                                                                              | #148, #153, #154, #155            |
| Retention              | Fixed category-specific deadlines in section 5; immediate authorization loss precedes asynchronous purge. Legal assessment must approve disclosed purposes/holds before admission.                                                                                                                         | #151, #153, #154                  |
| Capacity and expansion | Initially founder/testing partner in Dev only; later an admitted 10-person cohort, then at most 30 after recorded gates. A server-owned Community cohort policy is separate from deprecated `AI_ALLOWED_EMAILS`; private/AI admission does not imply Community admission.                                  | #153, #155                        |

UTC rollover, future/missing/fractional birth years, a correction into ineligibility and enroll/re-enroll must use the same server policy. Losing eligibility revokes social authority; restricted owner safety, export, withdrawal and private tracking stay available. Stored year and declaration are never exposed to other members or included in invitation/notification payloads.

## 2. Identity and audience matrix

Social identity is entered deliberately: normalized handle 3–24 ASCII lowercase letters, digits or underscore; display name 1–32 characters; initials badge 1–4 characters; optional bio up to 160 characters. Handles, display names and bio receive server moderation/filtering and reserved-name checks. Pilot bio does not accept URLs, email addresses or phone contact fields; moderation still handles indirect contact/disclosure and false positives. Initials/color have accessible text; no image upload. Do not imply a pseudonym guarantees anonymity: a handle, day and optional duration may identify someone or reveal a fitness habit.

| Viewer / context                                                 | Minimal identity: handle, display name, initials                                                                                                           | Bio                          | Published card                                             | Relationship information                                       |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------- |
| Owner, active                                                    | Own profile and settings                                                                                                                                   | Own                          | Own management, including revoked status                   | Own incoming/outgoing requests and following/followers         |
| Approved active follower A → B                                   | B, even with discovery off                                                                                                                                 | B                            | B's current authorized cards, including prior publications | A's relationship to B only                                     |
| Pending / unrelated active member                                | Exact lookup if B opted into search, or minimal identity of the other participant through their own pending edge for consent/status/safety; otherwise none | No                           | No                                                         | Own request status only                                        |
| Active member with valid invitation                              | Inviter, even with search off; no bio                                                                                                                      | No                           | No until independently approved                            | Own request status only                                        |
| Signed out / unenrolled / ineligible                             | No social identity, including invitation preview                                                                                                           | No                           | No                                                         | No; sign-in/enrollment offers preserve token safely            |
| Either-direction block                                           | Neither party's identity through social reads                                                                                                              | No                           | No                                                         | Neutral unavailable response; owner may manage own block entry |
| Withdrawn / suspended / deleted author                           | No discoverable identity                                                                                                                                   | No                           | No                                                         | No live graph                                                  |
| Withdrawn / suspended / ineligible viewer, or community disabled | Restricted own safety/account controls only                                                                                                                | No social browsing           | No social browsing                                         | Own block management and appeal/export/withdrawal only         |
| Authorized moderator                                             | Report-scoped social evidence under logged staff role                                                                                                      | Necessary reported text only | Necessary reported snapshot only                           | No unrestricted graph or private-source access                 |

A pending edge grants each active participant minimal identity of the other participant solely for their own request consent/status/safety, independent of discovery. It grants no bio, activity or third-party graph. Follower/following lists are owner-only. No follower counts, last-seen/read receipts or other members' graph. Author sees permitted reactor identities on their own card; reactor sees their own reaction. Other followers see only authorized aggregate counts, not identities. Bilateral blocks suppress related identities and interactions in every surface, including aggregate contribution for the affected viewer. Staff/report routes must never expose reporters to the subject.

Every social read and mutation checks authenticated principal, current enrollment generation, cohort/feature policy, active eligibility, audience, block, suspension/deletion and card state at the database boundary, including direct PostgREST/RPC access. API DTO stripping alone is insufficient. Safety/account control exceptions use separate caller-owned scopes, never directory/feed access. Do not disclose whether an unavailable result means nonexistent, blocked, withdrawn, suspended or excluded.

### Lifecycle rules

- Enrollment requires fresh unchecked declaration/rules consent and a durable current-version receipt (`2026-09-30` for these revised rules; the old receipt does not imply acceptance of them). Rule changes require explicit reacceptance before creating content; withdrawal remains available. Joining never publishes saved workouts or requests notification/analytics/AI consent.
- Requests: none → pending → approved / declined / canceled. Recipient alone approves/declines; requester alone cancels. Preserve minimal declined/canceled cooldown records for 48 hours, rather than deleting them and allowing immediate retries. Duplicate attempts resolve the existing state. Removal requires a fresh request; approval grants current and future still-published cards.
- Block atomically severs edges and requests in both directions, revokes affected interaction authority and suppresses delivery. Unblock restores nothing. Blocks and suspensions bind stable account identity through withdrawal/re-enrollment. Unfollow/removal invalidates the removed follower's reactions on that author's cards; it does not erase other followers' reactions.
- Mute suppresses that person's feed cards and non-safety push without altering audience/edge or notifying them. It is not a block or a moderation sanction; their own accessible card/profile detail remains available.
- Invitation revoke/expiry/generation change denies all uses. A bilateral block denies resolution for that viewer; do not revoke the inviter's reusable link for everybody. Existing requests still need normal consent; invitation expiry does not erase a separately approved relationship.
- One live snapshot per author/source workout. Only confirmed completed sessions qualify. Generic categories: strength, running, cycling, HIIT, mobility, walking, other. Selected day must be a valid non-future calendar day in the author's selected local context, not silently converted through UTC. Duration is explicit, bounded and previewed. Free text and all health details beyond this projection are rejected.
- Private edits leave the published copy unchanged. Explicit update requires a fresh preview/confirmation and version; existing reactions clear on card version change. Revocation, source deletion/unconfirmation, withdrawal, suspension or eligibility loss immediately denies reads and invalidates applicable reactions. Re-publishing is deliberate and never restores old reactions.
- Operation UUID is bound to actor, generation, normalized payload and version. Same-operation lost-response retries resolve the recorded result; conflicting payload fails. Retries of revoked/deleted/old-generation operations cannot create authority. A fresh operation requires another explicit publish decision.
- Withdrawal immediately hides profile/cards, ends relationships/requests, revokes invites and disables deliveries; private workouts remain. Re-enrollment creates a new generation, discovery off and no restored graph/cards/tokens/reactions. Existing blocks/sanctions remain. Full account deletion also removes social authority and follows the bounded retention/restore rules below.

## 3. Small-screen wireframes and copy

These are reviewable text prototypes, not implemented mobile screens. Use a narrow 320-point layout, scrollable content, large text, keyboard-safe forms, labeled controls, visible focus and VoiceOver/TalkBack reading order. Important disclosures must remain next to the action, not hidden in a link. Native acceptance under #150 includes both platforms, dynamic text, long names, dark mode and reduced motion. Reactions have spoken names, not emoji-only buttons.

### A. Enrollment, refusal and settings — #142 / #150

```text
Community                       [Back]
Encourage friends with workouts
that you choose to share.
Your private tracking works without this.

Only approved followers see your cards.
They can see earlier cards still shared.
Birth year eligibility: [Explanation]
[ ] I am 18 or older
[ ] I accept Community rules [Read rules]
Handle          [_____________]
Display name    [_____________]
Initials        [__]
Bio (optional)  [_____________]
[ ] Allow friends to find my exact handle
    An invite can work with this off.
[Join Community]                 [Not now]
```

No prechecked controls. Show privacy/disclosed retention and contact links before submission. Invalid/ineligible year: “We cannot confirm eligibility from your birth year. Community is available when this check passes. Your private tracking stays available.” Boundary explanation gives the year cutoff and waiting rule without asking for ID. Duplicate/reserved/filtered handle shows an inline actionable error; blocked/disallowed enrollment gives neutral unavailability and safety/contact access. Network failure retains form in memory but records no successful enrollment.

Settings: own profile edit excluding pilot handle rename; exact lookup switch; follower/following/request lists; mute list; block list; inbox/push choices; rules/privacy/contact; export; withdraw. Saving profile/discovery is confirmed separately; turning search off does not revoke existing follows or invites. Push remains off until requested in its own context.

### B. Discovery and invitation — #144 / #150

```text
Find a friend                   [Back]
Exact handle [____________] [Find]
No contact upload or suggested people.
Result: [AH] Adam  @adam
        [Request to follow]

Your invites [Create invitation]
Invite: expires Oct 7 [Share] [Revoke]
Anyone receiving it can ask to follow you.
You still decide whether to approve them.
```

A known invitation shows “Invitation from @adam” only after authorized sign-in/enrollment; then a deliberate request action. Invalid/expired/blocked/wrong-environment link: “Invitation unavailable. Ask your friend for a new one.” Pending/approved status replaces duplicate request buttons. Cancel login never sends a request. Changing accounts clears the principal-bound preview and re-resolves. Native share cancellation creates no follow.

Use the actual app variant's scheme (`mizyun-dev` for Dev, `mizyun` for Production) with safe token parsing and explicit environment checks. HTTPS universal/app links and not-installed fallback require owned-host association and physical-device acceptance in #144; do not show an unverified public invitation URL. QR contains exactly the same bearer link and expiry disclosure; no private identity payload. Never send invitations to others automatically.

### C. Request approval and graph management — #143 / #150

```text
Follow request
[AH] Adam  @adam
Approval lets Adam see your earlier cards
still shared and cards you share later.
[Approve] [Decline] [Block / Report]

My followers [Remove follower]
My following [Unfollow] [Mute] [Block / Report]
```

Follow-back remains a separate action. Removing a follower: “They lose access to your shared cards. Following them, if any, is unchanged.” Block: “You will lose both follow connections. They cannot view or interact with you through Community. Unblocking will not reconnect you.” No “they were notified” claims. Approval racing block/withdrawal resolves to unavailable and clears stale data. Cooldown/capacity errors give a retry time or capacity explanation without exposing another person's state.

### D. Save, preview and card update — #145 / #150

```text
Workout saved privately
[Done] [Share with approved followers]

Share workout                    [Cancel]
[AH] @adam
Strength workout
Day [2026-09-30]
[ ] Include duration  [45 minutes]
Only approved followers, now and in future.
New followers can see this while it is shared.
Exercise details, notes and health records
are not included. People can save what they see.
[Share workout]
```

Saving must finish independently; failed/canceled sharing cannot roll back the workout. Preview uses a generic category, never the private title, and the selected day, never a misleading “Today.” No scheduled/automatic/background share. With zero followers still permit deliberate publication after “You have no followers yet. Future approved followers can see this.” Edit/unshare controls are author-only; unshare: “Hide this card from Community? Your workout stays private and saved. Copies already seen cannot be recalled.” Source eligibility loss, stale version and lost response show clear recoverable states and require fresh preview if the submitted content changed.

### E. Feed, detail and encouragement — #146 / #147 / #150

```text
Community         [Requests] [Inbox] [Settings]
[AH] @adam           Shared Sep 30
Strength workout    Day Sep 29
[Clap] [High five] [Fire] [Fist bump] [Thumbs up]
[Open] [Report / Mute / Block]
```

Reverse chronological publication order with stable timestamp/ID cursor; selected workout day may differ. No unread pressure, streak rankings or engagement recommendation. Empty: “No shared workouts yet. Find a friend or keep tracking privately.” A reaction toggles once per actor/card with allowed enum only; other followers see no actor list. Report/moderation-hidden/revoked/inaccessible detail: neutral “This activity is unavailable,” remove cached card and reaction state. Owner can see its own moderation notice and appeal without exposing the reporter.

### F. Report, safety and moderation notices — #148 / #150

```text
Report Community content        [Cancel]
Reason [Harassment / Impersonation / Spam /
        Unsafe or sexual content / Other]
Details (optional) [_______________]
Please leave out private health information.
[ ] Also block this person
[Submit report]

Report received: [case reference]
We will review it. [Contact support]
If someone is in immediate danger,
contact local emergency services.
```

Report is confidential, not anonymous to authorized staff; filing alone does not imply a sanction. Limit details to 1,000 characters, no attachments/health-log imports. No automatic block from an unchecked choice. Report button also appears on handle/profile/invite surfaces. A caller-owned recent-interaction receipt supports reports for up to 30 days after content disappears or enrollment ends, without restoring browsing or trusting arbitrary target IDs. Restricted users have block management, appeal, safety contact and account controls. Rate limits never remove the verified safety contact route. Offline submission says “Not sent” with retry; no false receipt. Sanction notice gives reason category, duration, effect and appeal path without reporter/evidence identity; independent second review by trained backup, no retaliatory publishing.

### G. Withdraw, return and account lifecycle — #151 / #150

```text
Leave Community?
Your profile and shared cards disappear.
Connections and invitations end.
Your private tracking remains available.
Returning starts again with no connections
or shared cards. Blocks still apply.
Some records have limited retention [Details].
[Leave Community]                [Keep Community]
```

On confirmation clear social memory locally immediately; show “Confirming withdrawal” until server result is reconciled. Other members lose access when the server accepts withdrawal; an offline tap alone cannot revoke remote access. Do not claim remote deletion when offline. On return, show fresh terms/declaration and generation, without resurrected cards. Export includes own social records with third-party identities minimized and reporter identity/internals withheld; asynchronous export may fail/retry independently of private use. Account deletion denies social authority immediately when accepted, confirms the account-level state, and uses durable purge/restore evidence; withdrawal is not account deletion.

### H. Offline, stale auth, links and policy changes — #152 / #149 / #150

```text
Community needs a connection to check access.
[Retry] [Continue private tracking]
```

No persistent social feed/profile/token cache in this pilot. Background/lock/sign-out/account switch clears memory. Foreground entry and every protected read revalidate permission; failed freshness hides content rather than displaying cached authority. A response must belong to the current account, request and generation. Navigation/deep links retain no private source ID, raw token telemetry or stale profile. Local hiding cannot recall pixels/screenshots already seen. Pending mutations are scoped to principal/generation, never replayed for another account or automatically turned into new publication operations. Inbox and push delivery recheck authority at send/open; generic push text has no names, category, duration, source IDs or bearer invite tokens. Withdraw/block/mute/suspension/feature disable cancels invalid delivery.

## 4. Complete journey ownership and failure boundaries

Every journey has a primary issue; cross-cutting owners implement their part in their existing plan. A row is not acceptance evidence.

| Journey                                           | Permission / deliberate action                                     | Failure and recovery                                                                    | Primary owner |
| ------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------- | ------------- |
| Refuse / browse private app                       | No enrollment required                                             | No repeated blocking prompt or lost private functionality                               | #142          |
| Join / reaccept terms / become ineligible         | Eligible server principal, declaration and current receipt         | Invalid year/terms/version/cohort denies social authority; safety/private use available | #142          |
| Profile edit / search preference                  | Owner only; explicit social input                                  | Conflicting/filtered edit retains prior valid version; no silent private-profile copy   | #142          |
| Handle reservation / future rename                | Owner, immutable pilot rule                                        | Reserved handle unavailable; deletion quarantine; rename separately gated               | #142          |
| Search exact handle                               | Active member + target searchable                                  | No prefix/enumeration; rate limit; neutral unavailable                                  | #144          |
| Create / share / QR / revoke invitation           | Owner active, generation/environment bound                         | Expiry/revoke/wrong app/no app/cancel; no automatic relationship                        | #144          |
| Resolve invite through sign-in / switch accounts  | Re-resolve current eligible principal                              | No unauthenticated identity, stale user response or cohort bypass                       | #144          |
| Request / cancel / decline / approve              | Caller role, target generation, both active                        | Cooldown/caps/concurrent block; preserve terminal state                                 | #143          |
| View own requests / followers / following         | Owner graph only                                                   | Bounded pages; no other graph/last seen/counts                                          | #143          |
| Remove / unfollow / block / unblock               | Caller-owned role, separate block management                       | Authority/reactions/delivery revoked atomically; unblock restores nothing               | #143          |
| Mute / unmute / safety lists                      | Owner-only preference                                              | Acknowledged state, no notification to target, no audience change                       | #143          |
| Save completed private workout                    | Private tracking authorization alone                               | Share failure/cancel cannot affect saved workout                                        | #145          |
| Preview / publish / update / unshare              | Completed owner source + explicit minimal snapshot                 | Reject extra fields/future day; version or retry conflict; fresh preview                | #145          |
| Browse following feed / detail                    | Fresh current audience and all overrides                           | Empty, partial paging, deleted/hidden/stale card; no persistent cache                   | #146          |
| Add / toggle / remove encouragement               | Authorized card and predefined reaction                            | Revoked audience/version; no stale counts/third-party identity list                     | #147          |
| Report profile / handle / card / recent abuse     | Authorized subject or caller-owned recent receipt                  | Confidential case receipt; offline/duplicate/rate-limit contact fallback                | #148          |
| Filter / review / sanction / appeal               | Scoped staff role with audit, not private-health access            | Backlog/outage, false positive, backup/appeal, escalation                               | #148          |
| Inbox / push preference / notification tap        | Owner preferences + current recipient authority                    | Denial, duplicate/expired delivery, block/mute races and stale tap                      | #149          |
| Navigation / large text / assistive controls      | Accessible equivalent actions                                      | Keyboard, loading/error focus, dark mode, labels, both devices                          | #150          |
| Withdrawal / re-enrollment                        | Own account even when restricted                                   | Lost result reconciled, new generation, no restored graph                               | #151          |
| Export / full account deletion / purge / restore  | Own account; scoped staff evidence only                            | Partial job failure, retained-case limits, 90-day recovery barrier                      | #151          |
| Offline / retry / foreground / switch account     | Fresh principal/generation, caller-bound operations                | Lost response/restart/out-of-order response never grants new authority                  | #152          |
| Cohort / caps / kill switch / metrics / incident  | Server policy + privileged audited operations                      | Fail closed social browsing; private/safety routes continue                             | #153          |
| Legal / privacy / store / child safety assessment | Accepted disclosures/age mechanism/contact for actual distribution | Missing assessment or route blocks admission                                            | #154          |
| Exact-candidate friends pilot / go or stop        | All preceding exits and adult voluntary participation              | Missing staff/device/isolation/lifecycle acceptance pauses pilot                        | #155          |

## 5. Limits, retention and operating requirements

### Bounded pilot limits

Limits apply in the authoritative transaction/RPC boundary and API; neither route may bypass them. Use server UTC fixed daily windows and rolling minute windows, documented retry times, and actor-scoped counting. Concurrent requests cannot exceed caps; idempotent retries do not consume a second successful-operation allowance. Additional infrastructure limits may prevent abuse but must preserve authorized safety/account actions.

| Operation                                  | Pilot limit                                                                                                   | Owner      |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | ---------- |
| Cohort                                     | 10 initially; absolute 30 admitted accounts                                                                   | #153, #155 |
| Approved following / followers             | 30 each, no public count                                                                                      | #143       |
| Follow requests                            | 50 created/day, 10/minute; 20 pending outgoing; 50 pending incoming; declined/canceled pair cooldown 48 hours | #143       |
| Exact lookups + invitation resolutions     | Combined 30 attempts/minute and 120/day per actor; do not permit unauthenticated identity probes              | #144, #153 |
| Invitations                                | 20 live, 20 created/day; seven-day maximum; expired links do not count live                                   | #144       |
| New publication / explicit snapshot update | Combined 20/day per actor; all attempts remain duplicate/concurrency guarded                                  | #145       |
| Reactions                                  | One active predefined choice per actor/card, reversible; 30 mutations/minute                                  | #147       |
| Reports                                    | 10 new cases/day; duplicate evidence attaches to existing case; verified safety contact remains available     | #148       |
| Read lists                                 | Default 20, maximum 50 per page with stable cursor, no unbounded graph/feed enumeration                       | #143–149   |
| Handles                                    | No rename in pilot; deleted-account quarantine 90 days                                                        | #142, #151 |

Limits above do not approve a larger public launch. Changing them requires capacity/security review and exact-candidate acceptance in #153/#155.

### Retention and erasure schedule

Periods below are selected product maxima, not claims that law mandates these numbers. #154 assesses lawful purposes, notice and exceptions; #151/#153 implement/read-deny deadlines and monitored cleanup. Revocation is immediate access denial. Routine purge completes within 24 hours of its deadline unless a separately authorized restricted case hold applies. Missing cleanup evidence blocks admission. No indefinite “archive or purge” option.

| Record                                                         | Selected deadline / remaining access                                                                                                                                                                                                                                                                                                    | Owner            |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| Active social identity                                         | While enrolled; withdrawn display/bio/initials purge within 30 days, unavailable to members immediately                                                                                                                                                                                                                                 | #142, #151       |
| Handle reservation / preferences / current generation / blocks | Minimal account-owned safety/reservation state persists through withdrawal for account lifetime; no browsing entitlement                                                                                                                                                                                                                | #142, #143, #151 |
| Deleted-account handle                                         | Minimal normalized claim quarantine for 90 days, then purge; cannot resolve to deleted identity                                                                                                                                                                                                                                         | #151             |
| Published card                                                 | At most 365 days from explicit publication/update; reads deny at expiry even if cleanup fails; source existence never extends it automatically                                                                                                                                                                                          | #145, #146, #151 |
| Revoked card payload                                           | Purge within 30 days; no follower access during that interval; narrowly necessary report snapshot handled separately                                                                                                                                                                                                                    | #151             |
| Invalidated reaction                                           | Immediately omitted from authorized counts/identity views; physical cleanup within 24 hours                                                                                                                                                                                                                                             | #147, #151       |
| Declined / canceled request                                    | Minimal pair/cooldown state 48 hours; purge within 24 hours thereafter; active edges end on removal/withdrawal                                                                                                                                                                                                                          | #143, #151       |
| Expired / revoked invite                                       | Resolution denies immediately; bearer token purged within 24 hours; minimal audit metadata at most 30 days                                                                                                                                                                                                                              | #144, #151       |
| Inbox / outbox / delivery metadata                             | Inbox 90 days; outbox expires after 24 hours and cannot send late; content-free delivery diagnostics 30 days                                                                                                                                                                                                                            | #149, #151       |
| Publication retry ledger                                       | Minimal operation digest/result/revocation tombstone through account lifetime so an old UUID never republishes; obsolete generation identifiers unavailable for reads. After card/source purge, retain only digest, generation/version, terminal state and opaque effect ID; no full result JSON, private source ID or workout payload. | #145, #152, #151 |
| Terms receipts                                                 | Current/account history while needed for enrollment accountability; withdrawal max 30 days unless disclosed case hold; current return requires a new receipt                                                                                                                                                                            | #142, #151, #154 |
| Recent interaction receipt for reporting                       | Opaque caller-owned subject reference, maximum 30 days; no old content browsing or public identity directory                                                                                                                                                                                                                            | #148, #151       |
| Report / moderation case                                       | Until resolved; necessary closed-case evidence 180 days; overdue open cases reviewed weekly, never indefinite unattended queue                                                                                                                                                                                                          | #148, #151       |
| Exceptional legal/safety hold                                  | Necessary scoped case only, reason/access/expiry documented; review every 90 days; explicit renewal justified. No automatic indefinite identifiable sanctions after account deletion.                                                                                                                                                   | #148, #154       |
| Full account deletion                                          | Deny authority when deletion accepted; purge live social identity/content within 30 days except justified disclosed case hold; no automatic future-account fingerprinting                                                                                                                                                               | #151, #154       |
| Encrypted recovery archives                                    | Existing infrastructure maximum 90 days, inaccessible to members. Before any restore serves traffic, replay newer deletion/revocation/sanction state; independently retained restore barrier covers at least this window.                                                                                                               | #151, #153       |

An export gives the requester their own data, relevant relationship state and their own report submissions/status; third-party data and internal moderation evidence are minimized/redacted. It must not expose another reporter, private source IDs through followers, invitation bearer secrets to recipients, or staff-only evidence. Export and deletion must cover every new table, storage object, outbox and operational mirror. Backups are not represented as immediate physical deletion. Account-owned lifetime ledgers are purged on account deletion, while minimal erasure/restore barriers survive only as needed to stop archive resurrection.

### Moderation, rules and contact

Community rules prohibit harassment, hate, sexual exploitation (including CSAE), threats, impersonation, spam, unsolicited solicitation, invasive disclosure of another person's information and posting sensitive health information in social text. Pilot text filtering covers handles, display names and bios before exposure; a banned-word list alone is not a complete moderation system. Maintain false-positive correction and abuse escalation, without private health or Coach data in review tooling.

Adam Hikl owns staffing/contact acceptance. #148 must name a trained backup and document daily coverage, role grants, training, incident runbook and report/appeal handling; #153 monitors backlog and coverage. First review target: ordinary reports within 24 hours; urgent threats/child-safety concerns prioritized for review within four elapsed hours of server receipt. Coverage must support this clock whenever Community is enabled; no silent deferral to the next staffed day. These are internal admission prerequisites, not an assertion that 24/7 emergency response exists. Automatic containment may hide flagged text pending human review; do not silently delete based on a report alone. The app clearly directs imminent danger to local emergency services.

Publish an actual tested support/safety contact and Community rules/privacy route before enrollment is enabled. No invented mailbox or broken placeholder. #154 verifies child-safety scope against actual Play categories/features, applicable jurisdictions, disclosures and lawful escalation; adult gating alone does not exempt an in-scope app from Google's Child Safety Standards. Appeals receive a second reviewer independent of the original decision. If coverage or contact fails, freeze admission/publication and social visibility as needed while keeping reporting/contact, withdrawal/export/deletion and private tracking available.

### Pilot success and stop rules

A four-week voluntary cohort begins only after #155 accepts an exact source SHA, migrations, deployed Dev target, both-platform device journeys, two-way Dev/Production isolation, cleanup/restore tests, staff/contact/age/disclosure gates and this design's user validation. Dev founder/testing-partner policy is not broader admission approval. Production requires its separate explicit release milestone.

Success thresholds are product decisions for this small cohort, not industry benchmarks or statistical proof: at least five independently consenting friend pairs; at least half of study-consenting participants return to Community in two separate weeks including week four; all study-consenting assessed participants correctly explain audience, history and refusal/withdrawal after any copy revision; explicitly record unassessed members and do not infer their understanding; all reports receive first review within targets; zero confirmed private-source leaks, unauthorized social access or unremediated deletion/restore failures. Record denominator, dates, founder assistance and refusals separately. Optional aggregate analytics require their own consent; nonconsent cannot exclude use. Manual study feedback can supply metrics without hidden tracking.

Stop admission/publication on authorization leak, lost erasure barrier, unsafe stale delivery, uncovered moderation, failed safety contact or missing legal acceptance. Preserve private tracking and restricted safety/account controls. #153 owns operational switches and incident records; #155 owns documented go/pause/rollback decisions. Broader discovery and expansion remain gated after this pilot.

## 6. Threat model and acceptance evidence

| Threat / failure boundary                            | Required control and proof                                                                                                                    | Owner                        |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Private-source disclosure / overposting              | Strict projection, no private-table social read policy, caller-bound RPC and hostile extra-field tests across transports                      | #141, #145                   |
| Enumeration / bearer link theft                      | Exact opt-in lookup, minimal invite preview, random short-lived revocable tokens, caps, no token/source/profile telemetry                     | #144, #152, #153             |
| Forged follower approval / graph inference           | Role-specific transitions; owner graph; neutral unavailable responses; concurrent approve/block tests                                         | #143                         |
| Withdrawal / suspension / age / delete race          | Atomic authority cleanup and generation-bound operations at DB boundary; no old-operation resurrection                                        | #142, #143, #145, #151, #152 |
| Stale cache / account confusion / queued delivery    | No persistent social cache; foreground/principal checks; send-time and tap-time authorization; lost response and out-of-order native journeys | #149, #152                   |
| Retry / concurrency / denial of service              | Payload-bound UUIDs; bounded lists/limits enforced under concurrency; lock contention and cleanup monitoring, emergency switches              | #145, #152, #153             |
| Harassment / impersonation / sanctions evasion       | Server filter, stable-account block/sanctions, confidential report, trained scoped staff, appeal and staffing outage test                     | #148                         |
| Excess retention / restored erasure                  | Deadline-based read denial, monitored purge, scoped case holds, export redaction and 90-day restore barrier exercise                          | #151, #153, #154             |
| Inadequate age assurance / misleading claims         | Conservative year policy without identity-verification claims; independent legal/distribution assessment before admission                     | #142, #154                   |
| Pressure / consent conflation / inaccessible refusal | Unchecked separate controls, equally usable refusal/private paths, accessible prototype comprehension and device tests                        | #140, #142, #150, #155       |

All implementation packages run appropriate focused regressions and `pnpm check`, with independent non-author review for authorization/RLS and deletion/export. Direct database/Auth/Storage tests, native interaction, deployment and user validation are separate evidence tiers. Historical passing tests in the September 30 review do not accept these new requirements.

### Current implementation gaps — design does not close them

The reviewed local foundation includes durable enrollment receipt, discovery off, immutable/reserved handles, actor-bound RPCs, stable blocks/sanctions, current-generation publication retry ledger and bounded outgoing requests/invitations. #141 remains accepted only for its recorded local foundation exit.

Subsequent source sessions implemented #142’s conservative `year - 19` rule, fresh declaration/current receipt and enrollment/settings UI; #143’s caps, graph/request/mute/block UI and durable operations; #144’s exact discovery/invitation/QR controls; and #145’s duration-off preview, completion/history entry, atomic version confirmation and limits. Their [combined commit verification](COMMUNITY_COMMIT_EVIDENCE_2026-09-30.md) records source and automated checks. Enrollment stays closed; physical journeys, not-installed fallback, staffed safety/contact, legal/admission and lifecycle acceptance remain open. Feed #146 and reactions #147 need the specified audience/identity behavior. Recent-report receipts/restricted safety, filtering, staffed appeals and contact remain #148. Inbox #149, device accessibility #150, retention/restore/export #151, retry/cache #152, cohort/limits/operations #153, legal/store #154 and exact pilot #155 each retain their own exits. Do not reopen the accepted local foundation merely to claim these later exits passed.

## 7. Design completion and next action

Design review can accept the rules, matrix, wireframes, copy, threat model and ownership inventory. #140's original plan also requires adult target-user feedback including someone who declines Community. That work has not been performed by an agent; [the validation pack](COMMUNITY_UX_VALIDATION_2026-09-30.md) supplies a consent-respecting protocol and unfilled evidence template. Keep #140 open until genuine feedback is reviewed, material confusion is corrected and retested, or the user explicitly changes the acceptance scope without losing the gate.

The design-segment next action was #142; subsequent sessions implemented #142–145 source. Current acceptance and next actions are in the combined evidence and latest status. Do not treat starting #142 as pilot launch permission. No runtime, migration, deployment or native acceptance is provided by this documentation revision.
