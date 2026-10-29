# DRAFT — Data Protection Impact Assessment (DPIA), Mizyun

**DRAFT for Adam / legal review. Not published, not legal advice.** Approved by Adam on 2026-10-29.
Date: 2026-10-27. Basis: GDPR Art. 35. Related: `docs/legal-drafts/PRIVACY_POLICY_HEALTH_CONSENT_DRAFT_2026-10-27.md`, internal findings PRIV-01 and PRIV-02. Facts come from `docs/PRIVACY_POLICY.md` (effective 2026-10-21) and `AGENTS.md`; verify them before sign-off.

## 1. Description of the processing

**Controller:** Adam Hikl (sole operator). Contact: support@mizyun.phiskel.com.

**What Mizyun is:** a privacy-conscious health and fitness tracking app (iOS and Android) for adults 18+, with optional AI features and optional Community.

**Data subjects:** adult users (18+). Under-18 users are out of scope and refused (self-declared birth year).

**Data processed:**

- Special category (Art. 9) health data: weight, body measurements, height, sex at birth, birth year, activity level, goals, meals and diet logs, workouts, runs, bouldering sessions, Coach conversations and saved memories, meal and progress photos.
- Other: email, authentication identifiers, consent records, Community profile and shared items, optional product analytics, support messages, security logs.
- Not uploaded: steps read from Apple Health / Health Connect (shown on device only). Imported runs are saved only if the user selects them.

**Systems and recipients:**

- Backend hosted at Hetzner (Helsinki) with separate Dev and Production environments (per AGENTS.md; the public policy does not name the host yet).
- Daily encrypted Production backups to a Raspberry Pi, kept 90 days; the age recovery key is kept off the servers.
- Optional AI providers: Anthropic (Claude: Coach, typed meal estimates, draft changes, Log activity) and Google (Gemini: photo estimates, ingredient photos, cooking assistant, illustrations, evening stretch). Anthropic normally deletes data within 30 days (may keep longer for policy enforcement or law). Google may retain up to 55 days for abuse monitoring.
- Cloudflare (DNS, support-email routing), Amazon SES (email delivery).
- Mizyun does not sell data, run advertising or track across apps.

**Legal basis (proposed):** explicit consent (Art. 9(2)(a) with Art. 6(1)(a)) for health data, collected in a separate unticked step before any health data is entered, stored server-side with version and timestamps, withdrawable in Account & Settings. Separate consent for AI, analytics and Community.

## 2. Necessity and proportionality

- **Purpose:** personal tracking of nutrition, body metrics and training; the features cannot work without this data.
- **Minimisation:** only birth year (not full birth date); steps not uploaded; imported runs only if selected; no routes, heart rate or calories read from Health; meal photos stay on device unless backup is turned on; AI is optional and only the data listed per feature is sent; analytics are opt-in, coarse, with no health values, and deleted after 30 days.
- **Accuracy:** AI output is advisory; photo-derived values need user confirmation before becoming authoritative; calculations are deterministic in code.
- **Storage limits:** retention in policy Section 6 (backups 90 days, analytics 30 days, Community limits). Open: retention for consent records and for health data after withdrawal.
- **Rights:** in-app JSON export (including the new consent record), account deletion, consent withdrawal, analytics and AI controls; rights to access, correct, erase, restrict, transfer and object by contacting support.
- **Processors and transfers:** Anthropic, Google, Cloudflare, Amazon may process outside the EU/EEA. The mechanism per provider (contract terms, SCCs, EU-US Data Privacy Framework) is not recorded in the repository and must be confirmed. **[OPEN]**
- **Age:** 18+ from a self-declared birth year: the API refuses new under-18 birth years from every app version; the app refuses them, asks "Have you turned 18 yet?" for the boundary year (answer not stored), and closes accounts that already hold an under-18 year. Limitations in Section 3 risk R5.

## 3. Risks to data subjects

| #   | Risk                                                                                                                                                                                                                                                         | Likelihood                | Severity    | Notes                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------- |
| R1  | Health data processed without a valid Art. 9 condition (PRIV-01)                                                                                                                                                                                             | Medium before fix         | High        | Addressed by the consent step and server check                                                                       |
| R2  | Unauthorised access or breach (cross-user access, credential or server compromise)                                                                                                                                                                           | Low-Medium                | High        | Health data is sensitive; a leak could cause distress, discrimination or embarrassment                               |
| R3  | Disclosure to AI providers beyond what users expect                                                                                                                                                                                                          | Medium                    | Medium-High | Coach receives profile and log context; provider retention of 30 to 55 days                                          |
| R4  | Unintended exposure through Community sharing (copies, screenshots)                                                                                                                                                                                          | Medium                    | Medium      | Shared meals and workouts can reveal health information                                                              |
| R5  | A minor uses the app (self-declared birth year; someone born in the year 18 years ago may be 17)                                                                                                                                                             | Low-Medium                | High        | Age not verified                                                                                                     |
| R6  | Consent not freely given, informed or withdrawable in practice                                                                                                                                                                                               | Low                       | High        | Mitigated by separate unticked checkbox, plain explanation, in-app withdrawal; withdrawal consequences must be clear |
| R7  | Data kept after withdrawal or longer than needed (backups 90 days; no auto-delete on withdrawal)                                                                                                                                                             | Medium                    | Medium      | Open decision                                                                                                        |
| R8  | Cross-border transfers to AI and email providers                                                                                                                                                                                                             | Medium                    | Medium      | Mechanisms unconfirmed                                                                                               |
| R9  | Inaccurate AI advice relied on for health decisions                                                                                                                                                                                                          | Medium                    | Medium      | Output is advisory; user confirmation required for values                                                            |
| R11 | Installed builds released before the consent step (1.0.9, 1.0.10) keep logging health data without a recorded consent; the server enforces consent on profile health fields only for builds that show the step, and other health writes are gated in the app | Medium until users update | High        | Transitional; see open decision on forcing an update                                                                 |
| R10 | Dev environment holds real user data under a lighter policy (shared Gemini project, auto-confirmed emails)                                                                                                                                                   | Low-Medium                | Medium      | Limited to founder and testing partner; keep separate from Production                                                |

## 4. Measures

- Row Level Security on every user-owned table; owner-only access to the consent table; separate Dev and Production databases and credentials; no service-role or model keys in the app.
- Encrypted transport; private media storage with time-limited links; encrypted backups with the recovery key off the servers.
- Server-side consent check: profile health-field writes (birth year, sex at birth, height) are refused without current consent; consent included in export.
- Age gate: onboarding, profile and energy setup refuse a birth year implying under 18, nothing is saved; API schema rejects it too.
- AI: separate consent and 18+ gate, provider kill switches, usage limits, vendor terms reviewed.
- Community: sharing previews, reports, blocks, retention limits.
- Process to add: a procedure for handling a suspected under-18 account (close and delete); breach response plan (72-hour authority notification where required); review of this DPIA when features or providers change. **[OPEN]**

Consent records: the current answer (version, granted/withdrawn time) and an append-only history of every grant and withdrawal are kept per user, readable only by that user, included in the export and deleted with the account.

## 5. Residual risk

After the measures above, the draft assessment is that residual risk is **medium** (not signed off), mainly from: sensitivity of the data, AI provider retention, self-declared age, and the unresolved withdrawal and transfer decisions. If residual risk stays high after Adam's decisions, Art. 36 prior consultation with the supervisory authority must be considered. **[Legal review needed.]**

## 6. Open decisions

1. **Withdrawal:** keep stored data until the user deletes it (current plan), or delete automatically (immediately or after a grace period)?
2. **Birth-year precision:** keep birth year only (minimisation; for the one boundary year the app asks "Have you turned 18 yet?" on the device and stores nothing, but the answer is self-declared and the server can only check the year) or collect full birth date?
3. **DPO:** is a Data Protection Officer required (large-scale processing of special categories)? A single-person operator may still need an assessment. **[Legal.]**
4. **Processor DPAs and transfer mechanisms** for Anthropic, Google, Cloudflare, Amazon SES, and Hetzner (hosting); confirm signed terms and SCC/DPF coverage.
5. **Retention periods:** consent records, backups (90 days), Community items, support messages, security logs, AI provider retention.
6. **Existing users** with under-18 or missing birth year.
7. **EU representative / supervisory authority:** which authority applies depending on where Adam is established. **[Legal.]**
8. **Article 6(1)(b) and 9(2)(a) together** in the policy text.
9. **Dev environment** use of real data and the shared Gemini project.

- **Older builds:** require an app update (minimum supported version) before Production promotion, or accept R11 until 1.0.9/1.0.10 users update?

## 7. Store console changes Adam must make (not done)

Do these when the 18+ / consent build is submitted. Cited lines are in `docs/STORE_PRIVACY_CHECKLIST_2026-10-21.md`.

**Decision (Adam, 2026-10-28):** follow MyFitnessPal's model, which is App Store **16+**, Google Play content rating **Everyone**, and **18+** in the Terms. The 18+ minimum is enforced by the Terms, the in-app birth-year check and the API; the Store labels describe content and do not set the minimum age. The 2026-10-28 comparison is in `docs/RESEARCH_LOG.md`.

**App Store Connect**

- **Line 41** (Age Rating, "current rating is 12+ … the rest of the app has no age gate"): the rating and the sentence become outdated. Re-run the Age Rating questionnaire, answering honestly (health and wellness topics; medical or treatment information; user-generated content and messaging for Community; AI features). If it calculates lower than **16+**, use the option to set a higher age rating and choose **16+** (Apple's tiers are 4+, 9+, 13+, 16+, 18+; confirm the actual options in the console). If honest answers calculate 18+, keep 18+. Update the checklist wording.
- **Lines 19 to 25** (Health & Fitness: Health, Fitness): keep, and make sure the health-data purposes and the in-app consent are reflected in review notes. Add to App Review Notes (STORE_LISTING_DISCLOSURES.md section 4) that the app is 18+ and requires explicit health-data consent after sign-up.
- Check the Privacy Policy URL shows the new version (line 36).

**Google Play Console**

- **Line 77** (Target audience: "keep the current age groups … choosing 18+ is simplest"): choose **18 and over** only, and remove any under-18 groups. Target audience is separate from the content rating and should match the Terms.
- **Line 76** (Content rating questionnaire): re-answer honestly after the change and keep user interaction / user-generated content "Yes". The IARC rating (expected **Everyone** / PEGI 3, as for MyFitnessPal) comes from the answers and can't be chosen directly. Accept whatever the answers produce.
- **Lines 57 and 70** (Health info, Fitness info collected, required): keep; check the Data safety answers match the policy, including that health data is collected with the user's explicit in-app consent and can be deleted.
- **Lines 73 to 75** (Health apps declaration, Health Connect permissions): re-check that the declaration matches the final behaviour.
- Update the privacy policy URL in Play Console after publishing the new policy.

Also update `docs/STORE_LISTING_DISCLOSURES.md` (Section 5) accordingly.

## 8. Sign-off

| Role                   | Name      | Decision | Date | Signature |
| ---------------------- | --------- | -------- | ---- | --------- |
| Controller             | Adam Hikl |          |      |           |
| DPO / adviser (if any) |           |          |      |           |
| Legal reviewer         |           |          |      |           |

Next review: on any new health feature, new provider, new data type, or by [date to be set].
