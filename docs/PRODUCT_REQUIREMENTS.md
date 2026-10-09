# Product requirements

> Detailed behavioral scope for the Mizyun MVP. Product intent lives in `goals.md`; implementation order lives in `plan.md`. Requirement IDs are stable and should be referenced by tests, backlog items, and pull requests.

## Actors and terms

- **User:** the authenticated owner of a private Mizyun workspace.
- **Confirmed record:** authoritative data explicitly entered or accepted by the user.
- **Draft estimate:** editable, non-authoritative output from text/photo interpretation.
- **Coach:** the conversational interface backed by normalized tools and an optional model provider.
- **Memory:** durable coach context that has provenance, confidence, status, and user controls.
- **Canonical unit:** the storage/calculation representation, normally metric and UTC-aware; display units follow user preference.

## Functional requirements

### Identity and account

- **AUTH-01:** A user can create an account, complete required confirmation, sign in, restore a valid session, and sign out.
- **AUTH-02:** Authentication failures are actionable without exposing whether unrelated accounts exist.
- **AUTH-03:** A user can recover access through a provider-supported password-reset flow.
- **AUTH-04:** A user can export their data and initiate complete account/data deletion.
- **AUTH-05:** Every protected API operation derives `userId` from a verified access token, never from a client-supplied owner field.
- **AUTH-06:** Native session material is stored in platform-secure storage and removed on sign-out.

### Profile, preferences, and goals

- **PROF-01:** A user can set display name, unit system, timezone, height, and optional birth year.
- **PROF-02:** A user can record relevant experience, preferences, and exercise/dietary limitations without these becoming medical diagnoses.
- **GOAL-01:** A user can create and update a primary goal with kind, start date, optional target/date, and pace preference.
- **GOAL-02:** Goal changes preserve history and the inputs used by prior calculations/recommendations.
- **GOAL-03:** Unsafe or implausible targets are rejected or require a conservative correction with an explanation.

### Nutrition

- **NUT-01:** A user can create, edit, copy, and delete a food entry with time, name, calories, macros, serving context, and notes. Each existing Meals day heading offers an accessible add action that opens a meal for that local day, displays the selected date, preserves it through manual/AI/recent-meal entry and recovery, and refreshes that historical day on return. Historical saves do not suppress today’s reminders; a recovered draft for another day must be explicitly cleared before starting on the selected day.
- **NUT-02:** Daily and weekly totals use only confirmed entries and respect the user's local day boundaries.
- **NUT-03:** A user can submit text or a private food photo to produce an editable estimate after AI is enabled.
- **NUT-04:** Estimated calories/macros include range, confidence/provenance, and assumptions when available.
- **NUT-05:** An estimated entry cannot become authoritative until the user confirms or edits it.
- **NUT-06:** The app can retain reusable foods/meals without silently changing historical entries.
- **NUT-07:** Pro users can optionally record and review fibre, saturated fat, total sugars, sodium, and dietary cholesterol on confirmed meals. Missing values remain unknown, partial totals disclose coverage, and free or downgraded users retain access, correction, export, and deletion of previously recorded values.
- **NUT-08:** With existing AI consent/adult eligibility and a server-authoritative Pro grant, photo/text meal drafts and deliberate refinements can suggest those five additional nutrients. Estimates remain editable and uncertain until explicit confirmation; unknown values remain blank and client settings or quota overrides cannot grant access. Refinement must use current edits and must not overwrite changes made during a request. No historical backfill is automatic.
- **NUT-09:** Manual meal creation offers portion totals (default) or label values per 100 g with a required positive food weight in grams. Preview and confirmed Save use `label value × weight ÷ 100`, rounded once to two decimals in kcal/g/mg; blank remains unknown. Draft recovery preserves the chosen basis and raw values. Clear, recent-meal copies and replacement AI estimates restore portion-total mode; existing Pro and retry safeguards apply.
- **NUT-10:** Saved meals automatically display a decorative illustration when no retained photo is available, with no extra action or save delay. Common dishes use a bundled consistent catalog, including offline and without AI access. Unfamiliar dishes retain a neutral fallback while enabled background generation uses only the owned saved meal name under current authentication, adult eligibility, consent and dedicated durable limits. Repeated dishes reuse private account-scoped artwork. Real photos take priority; artwork never changes meal facts or nutrition. Failure, revocation, cancellation and stale account/token/name results preserve the fallback. Generated media participates in export/deletion; live provider, native and release acceptance remain separate.

### Energy model

- **ENG-01:** BMR/TDEE and goal targets are calculated by versioned deterministic functions from confirmed inputs.
- **ENG-02:** The user can inspect formula version, assumptions, activity input, and goal adjustment.
- **ENG-03:** Intake balance distinguishes consumed calories, estimated baseline expenditure, activity adjustment, and uncertainty.
- **ENG-04:** Exercise and step expenditure are not double-counted when sources overlap.
- **ENG-05:** Trend-based recalibration requires enough observations and presents a range, not false precision.
- **ENG-06:** Missing or stale inputs produce an honest incomplete state rather than a fabricated target.

### Exercise and workouts

- **EX-01:** A user can create, edit, archive, and list custom exercises.
- **EX-02:** Exercises support instructions and metadata required for later filtering/suggestions without hard-coding a vendor taxonomy.
- **WO-01:** A user can create and reorder workout templates or exercise lists.
- **WO-02:** A user can start, pause/recover, complete, edit, and delete a workout session.
- **WO-03:** Sets support repetitions/load, duration, distance, and perceived exertion as applicable.
- **WO-04:** The app displays relevant previous performance while logging an exercise.
- **WO-05:** Progress summaries can show personal records, volume, frequency, and consistency without comparing incompatible measurement types.
- **WO-06:** Suggestions reflect stated goals, experience, equipment, limitations, and recent volume; unsafe volume/intensity is avoided.
- **WO-07:** A user can start an empty one-time workout directly from Workouts, add exercises and log actual sets while exercising using the existing workout controls. Exercise selections are saved before their first set and recover with the active session. One-time workouts have no prescribed set/repetition targets, never modify a reusable routine, and finish into private workout history. Start retries reuse the same operation identity.

### Body progress and media

- **BODY-01:** A user can log weight and optional measurements with time and source.
- **BODY-02:** The app shows raw measurements and a clearly labeled trend without hiding source data.
- **BODY-03:** A user can upload private progress photos with purpose/date metadata and delete them permanently.
- **BODY-04:** Media access is short-lived and authorized; raw storage paths are not treated as public URLs.
- **BODY-05:** Photo comparison occurs only between images the user selects.
- **BODY-06:** The app does not diagnose conditions or claim precise body-fat/body-composition measurements from photos.

### Activity and health platforms

- **ACT-01:** The app requests only required HealthKit/Health Connect permissions with an explanation and works when access is denied.
- **ACT-02:** Synced step/activity records retain source, device/platform identifiers where allowed, and sync provenance.
- **ACT-03:** Synchronization is idempotent across retries, app restarts, and timezone changes.
- **ACT-04:** The user can disconnect a source and understand whether imported historical records remain.

### Coach and conversations

- **COACH-01:** A user can create, continue, rename/archive, and delete private conversations. The Coach tab opens the full page with suggested check-ins and composer when no conversation exists, without a separate start screen. The first consent-approved message/photo creates a conversation; opening the tab alone does not.
- **COACH-02:** The coach can access only normalized tools returning the current user's authorized, confirmed data.
- **COACH-03:** Responses distinguish stored facts, deterministic calculations, interpretations, and suggestions.
- **COACH-04:** When inputs are insufficient or uncertain, the coach asks for confirmation or states the limitation.
- **COACH-05:** The coach refuses diagnosis, dangerous targets, and advice outside the defined safety boundary.
- **COACH-06:** Provider failure, timeout, rate limit, or disabled state preserves the user's message and offers a recoverable result.
- **COACH-07:** An explicit meal-logging statement or food-photo attachment can produce a persistent, editable nutrition action proposal; the proposal remains non-authoritative until the user reviews it and saves through the confirmed food-entry boundary.
- **COACH-08:** An explicit workout-planning request can produce a persistent, editable action proposal derived from the deterministic training prescription; the user can change or remove proposed content, and no workout becomes authoritative until the user explicitly starts it.
- **COACH-09:** An explicit daily-plan request produces a persistent, versioned summary of confirmed calorie/protein progress, training state, missing inputs, and one deterministic next action; missing meal logs are not treated as zero intake, and generating the plan never mutates authoritative records.
- **COACH-10:** An explicit weekly-review request produces a persistent, versioned adaptation proposal from complete nutrition days, deterministic weight trend, active goal, and recent training load. Insufficient or poorly adherent data forces a hold; an applicable goal-pace change requires explicit authenticated acceptance and stale proposals cannot overwrite a changed goal.
- **COACH-11:** Proactive Coach reminders are off by default, device-local, permission-aware, individually configurable for daily and weekly check-ins, and fully removable. Opening one automatically submits the corresponding Coach request upon entering the chat; no provider call, health analysis, logging, or authoritative mutation happens in the background.
- **COACH-12:** Coach app guidance uses a release-owned capability catalog, distinguishes implemented features from account/build access and available Coach actions, and states uncertainty for unknown capabilities. Feature/route additions require catalog coverage; semantic behavior changes update guidance and regression queries. Recurring-meal setup help never becomes a one-off draft or creates a schedule implicitly.

### Durable memory

- **MEM-01:** The system may create memory candidates from explicit user statements or confirmed records with source and confidence.
- **MEM-02:** A user can list, inspect provenance, correct, deactivate, and delete durable memories.
- **MEM-03:** Sensitive or uncertain inference is not promoted silently to durable truth.
- **MEM-04:** Superseded, expired, or deleted memories are excluded from retrieval.
- **MEM-05:** Retrieval is scoped by verified user identity and constrained by relevance, kind, status, recency, and budget.
- **MEM-06:** Changing embedding/vector providers does not require changes to feature modules or stored canonical memory content.

### Community and following friends (post-MVP / planned pilot)

The selected design is [COMM-01 revision 2026-09-30](COMMUNITY_PRODUCT_CONTRACT.md), including its audience matrix, failure states, issue ownership, limits and retention. It supersedes prior proposed defaults. Implementation evidence is separate in [the quality review](COMMUNITY_REVIEW_EVIDENCE_2026-09-30.md); [adult target-user validation](COMMUNITY_UX_VALIDATION_2026-09-30.md) remains pending. No first-beta sequencing or pilot admission is approved here.

- **COMMUNITY-01:** Default unenrolled and undiscoverable. Explicit adult declaration, current versioned rules receipt and separate social identity are required. Server eligibility conservatively requires valid private self-reported `birthYear <= currentUtcYear - 19`; this is not identity verification. Age-assurance/legal acceptance belongs to #154 before admission. Social, AI, analytics, health and push choices are independent; private profile/email/year/measurements/Coach data are not copied socially.
- **COMMUNITY-02:** Normalized case-insensitive unique handles contain 3–24 lowercase ASCII letters/digits/underscore with reserved-name/filter checks. Pilot handles are immutable and reserved through withdrawal. Full deletion uses 90-day minimal quarantine. Any later rename requires an explicit #142 extension, 30-day cooldown and old-invite invalidation, not an advertised pilot capability.
- **COMMUNITY-03:** Following is directional, role-controlled and explicitly approved. Reciprocal following is separate. Terminal declined/canceled cooldown state persists 48 hours. Removal requires a fresh request; own graph only; request/edge limits follow the contract.
- **COMMUNITY-04:** Either-direction block immediately ends both edges/requests, denies social visibility and interactions, suppresses notifications and invalidates affected reactions. Unblock restores nothing. Blocks/sanctions survive community re-enrollment; restricted owner block management and safety/account controls remain available.
- **COMMUNITY-05:** Owner mute suppresses that person's feed and non-safety push without changing the edge/audience or notifying them. Mute is separate from blocking and reporting.
- **COMMUNITY-06:** Exact handle lookup only for explicitly searchable active profiles; no prefix/contact/phone/email/recommendation discovery. Reusable owner-revocable invites last at most seven days, bind generation/environment and expose only minimal identity to eligible signed-in members. Possession never bypasses follow approval or cohort eligibility. Native/QR/HTTPS fallback require their own acceptance.
- **COMMUNITY-07:** Save privately and share separately. Explicit completed-session projection contains generic category, selected valid non-future calendar day and optional duration defaulting off. A separately selected detailed snapshot may include exercise names and completed set types, reps, weights and set durations after exact preview. Preview explains current/future approved audience and inability to recall copies already seen. No private titles/notes/location/biometrics/nutrition/photos/Coach content or health integrations. Detailed sharing defaults off; existing minimal cards are never backfilled. Private edits do not silently update snapshots; deleting/unconfirming revokes them; deliberate version changes clear reactions.
- **COMMUNITY-08:** Owner and currently approved active followers alone access still-published cards, subject to eligibility/generation/block/suspension/deletion/expiry/feature/cohort checks at the database boundary. Approval includes earlier still-published history. Raw private source IDs, social eligibility and other users' graph never become follower projections.
- **COMMUNITY-09:** Following feed is reverse chronological by publication timestamp and stable ID cursor; chosen workout day is separate. No algorithmic ranking, engagement pressure or public exploration. Expired/revoked cards are hidden even if purge is delayed.
- **COMMUNITY-10:** One reversible predefined encouragement per actor/card. Author and actor alone see permitted identities; other followers see authorized aggregates. Unfollow/removal invalidates only the removed follower's reactions on that author's cards; revocation/version changes clear all card reactions. Comments/free-text replies remain off.
- **COMMUNITY-11:** Report handle/profile/card and recent authorized abuse without restoring browsing. Confidential case receipt, restricted safety contact, server filtering including bio, trained scoped moderation, backup, sanctions/appeal and response coverage are mandatory. A prohibited-word list alone is insufficient. No moderator access to private health/Coach records or subject access to reporter identity.
- **COMMUNITY-12:** Own inbox and separately optional push respect mute/block/withdrawal and current authority at delivery/open. Push is generic and contains no names, health details, private IDs or bearer tokens. Expired queued events cannot deliver after their deadline.
- **COMMUNITY-13:** Withdrawal immediately removes social authority, graph/cards/invites/delivery while preserving private use. New enrollment generation restores nothing; blocks/sanctions remain. Limited physical retention is disclosed separately from immediate visibility loss.
- **COMMUNITY-14:** Own export includes minimized/redacted social records without exposing third-party reporters or staff evidence. Account deletion denies social authority immediately and uses the contract's bounded purge/hold/90-day backup restore barrier. No indefinite unspecified sanctions archive or automatic new-account fingerprinting.
- **COMMUNITY-15:** Actor/generation/payload-bound idempotency, bounded pagination and concurrency-safe quotas prevent retry resurrection. Pilot social cache is memory-only with foreground freshness/account-switch clearing; offline failure does not authorize stale social browsing or falsely confirm server mutations.
- **COMMUNITY-16:** Server-owned staged admission starts with accepted 10-person cohort, absolute maximum 30; distinct from AI access. Exact-candidate legal/moderation/contact/age/device/isolation/lifecycle gates and voluntary four-week pilot thresholds apply. Community kill switches preserve private use and restricted safety/account controls; Production release is separate.

## Cross-cutting requirements

### Privacy and security

- **SEC-01:** Every user-owned table has RLS enabled, an ownership policy, and a `user_id`-leading access index where appropriate.
- **SEC-02:** Every relationship involving user-owned records preserves ownership in the foreign-key or repository boundary.
- **SEC-03:** Cross-user row and media tests must fail for read, write, update, delete, and signing operations on private health, nutrition, workout, profile, and coaching records. Opt-in social artifacts (e.g. published workout cards, social profiles, encouragement reactions) are governed by the dedicated relationship-based audience authorization policies defined under COMMUNITY-01–16 and ADR-0030; they never relax or expose private source tables.
- **SEC-04:** Model/service secrets exist only server-side; public mobile keys are explicitly classified as publishable.
- **SEC-05:** Tokens, message bodies, health values, and image contents are excluded from routine logs.
- **SEC-06:** Export, retention, deletion, and provider-sharing behavior is visible to the user.

### Reliability and data integrity

- **REL-01:** Mutating operations are idempotent or carry enough identity/version information to prevent duplicate records on retry.
- **REL-02:** Time-based data stores an absolute instant plus enough timezone context to render the user's intended day.
- **REL-03:** Canonical calculations do not depend on display-unit rounding.
- **REL-04:** Offline/network failure preserves recoverable user input for critical logging flows.
- **REL-05:** Schema and contract changes are backward-compatible or include an explicit migration/version transition.

### Accessibility and platform behavior

- **UX-01:** Core workflows support screen readers, dynamic text, adequate contrast, and non-color status cues.
- **UX-02:** Tap targets, keyboards, loading, empty, error, and retry states are explicitly handled.
- **UX-03:** Metric and imperial display choices produce equivalent stored meaning.
- **UX-04:** iOS and Android are tested independently; success on one platform is not treated as proof for the other.
- **UX-05:** Common meal, workout, weight, and photo actions are designed and measured for low time/tap cost rather than feature-count alone.

### Product validation and monetization

- **OBS-01:** Product analytics require an explicit classification of each event/property and must exclude food text, health values, photo contents/paths, message bodies, tokens, and other sensitive payloads.
- **OBS-02:** The product can measure onboarding activation, first core record, logging completion/failure, logging time/taps, return use, and coarse feature adoption with consent-respecting identifiers.
- **OBS-03:** Analytics failure or refusal of non-essential analytics does not block core tracking, export, privacy, or deletion workflows.
- **BILL-01:** Free and premium entitlements are explicit, server-verifiable where required, and never inferred only from a client-controlled flag.
- **BILL-02:** Purchase, pending, failed, cancelled, expired, grace-period, and restore states are recoverable and explained on both iOS and Android.
- **BILL-03:** Losing a premium entitlement never prevents a user from accessing, exporting, or deleting their existing authoritative records.

## Core user journeys

### New-user activation

1. Create and confirm an account.
2. Complete minimum profile and set a primary goal.
3. Add baseline weight.
4. Log either a first meal or first workout.
5. Reach a dashboard that explains what is known, estimated, and still missing.

### Daily nutrition

1. Add food manually or request a draft from text/photo.
2. Review/edit serving and estimate.
3. Confirm the entry.
4. Review daily intake and target range with assumptions.

### Workout progression

1. Select or create a workout.
2. Review relevant prior performance.
3. Record sets and complete the session.
4. Review a progression/consistency summary.

### Coach recommendation

1. Ask a question about the active goal.
2. Coach retrieves only authorized, relevant confirmed data/memories.
3. Response explains evidence, uncertainty, and a practical next step.
4. User can correct the data or memory that shaped the answer.

## MVP acceptance

The MVP is ready for external beta only when all MVP-scoped requirements have linked tests or explicit manual acceptance evidence, every P0/P1 gate in `docs/QUALITY_GATES.md` passes, and no item in the AI release gate remains incomplete for any enabled AI capability.

## NUTR-REC-001 — Recurring saved meals

Users may explicitly authorize automatic logging from an owned confirmed saved meal at a chosen local time on selected weekdays. Schedules display their timezone and support time/day edits, pause/resume, skip today and stop. Backend generation works with the phone app closed, labels generated entries, preserves editable history and nullable nutrients, and never duplicates or recreates a deleted occurrence. User export/erasure covers snapshots and occurrence ledger. See [implementation plan and acceptance](RECURRING_MEALS_PLAN_2026-10-03.md).
