# DRAFT for Adam / legal review — not published, not in effect

**Approved by Adam on 2026-10-29.** Still not published or in effect: apply it to `docs/PRIVACY_POLICY.md` and the public policy page with the Production release that ships the consent step.

**Privacy Policy changes: health-data consent and 18+ only (2026-10-27)**

Status: proposed text only. `docs/PRIVACY_POLICY.md` (effective 2026-10-21) is unchanged and remains the only policy in effect. Nothing here is legal advice or a legal guarantee. Have a qualified privacy lawyer review it before publishing. Publish it with the app release that ships the consent step, not before.

Why: internal review PRIV-01 (health data relied on a contract basis with no GDPR Art. 9 condition named, and no DPIA) and PRIV-02 (the app allowed 13+, while AI and Community need 18+). The DPIA draft is in `docs/legal-drafts/DPIA_DRAFT_2026-10-27.md`.

Dates, consent version and provider names below must match the code (`consent_version` "2026-10-27" is the example used by the coordinating session).

---

## A. Replacement for Section 3 — Purposes and Legal Bases

> ## 3. Purposes and Legal Bases
>
> **Account and service.** Mizyun uses your email, authentication details and session information to create and run your account. This is necessary to provide the service you asked for (Art. 6(1)(b) GDPR).
>
> **Health data.** Some of the information you enter is health data under data protection law: your weight and body measurements, height, sex at birth, birth year, activity level, goals, meals and diet logs, workouts, runs and bouldering sessions, and the Coach conversations and photos that relate to them. Mizyun processes this data only with your **explicit consent** (Art. 9(2)(a) GDPR, together with Art. 6(1)(a)). We ask for it in a separate step, after sign-up and before you enter any health information. The box is not ticked by default and is not part of accepting the Terms. If you already had an account, we ask on your next launch, before you log further health information. We record when you consented and which version of the explanation you saw.
>
> You can withdraw this consent at any time in Account & Settings. Withdrawal is recorded immediately; the app then stops collecting new health data and asks again before it can be used, and Mizyun's servers refuse further body and age details for your account. (Older app versions on another device may keep sending other logs until updated.) Withdrawal does not affect processing done before it. Without this consent Mizyun cannot provide its tracking features, because they depend on this data. You can still sign in, export your data and delete your account. **[OPEN: whether data already stored is deleted automatically on withdrawal — see Section D. Until Adam decides, say only what the app actually does. Suggested wording if nothing is auto-deleted: "Withdrawing does not by itself delete data you have already saved. Use Delete my account, or delete individual records, to remove it."]**
>
> **Optional AI.** AI data is processed only with your separate AI consent (Art. 6(1)(a), and Art. 9(2)(a) where the data is health data), which you can review or withdraw in the app. AI features are available only to adults (18 or older). Section 4 lists what is sent to which provider.
>
> **Optional product analytics.** Processed only if you opt in (Art. 6(1)(a)); you can turn it off at any time, which deletes your events.
>
> **Community.** Community profiles and the items you choose to share are processed on your choice to join and to share each item. You can withdraw by leaving Community or removing the item. Shared items (for example a meal or workout) can reveal health information, so share only what you are comfortable with.
>
> **Health permissions on your phone.** Data read from Apple Health or Android Health Connect is read only after you grant permission and start the relevant action.
>
> **Security, abuse prevention, reliability and support** are handled for legitimate interests (Art. 6(1)(f)). Information may also be processed where necessary to comply with law or respond to valid legal requests, or to establish or defend legal claims.

Notes for review:

- Wording "explicit consent" must match the on-screen text of the consent step exactly in substance. Update this text if the screen text changes.
- Whether Art. 6(1)(b) can sit next to Art. 9(2)(a) for the same data is a point for legal review. The draft keeps 6(1)(a) for the health data to be safe.

---

## B. Section 7 — new bullet and amended text

Add as the first sentence of Section 7:

> In Account & Settings, users can withdraw their consent to processing of health data. Withdrawal is recorded immediately, the app stops collecting new health data, and the consent screen offers **Export or delete my data** (also available to users who never agree). **[OPEN: add "and your existing health records are deleted" only if Adam chooses automatic deletion.]**

Also add to the list of rights in the last paragraph of Section 7: the right to withdraw consent at any time without affecting earlier processing (Art. 7(3) GDPR). Keep the existing mention of access, correction, erasure, restriction, transfer, objection and complaint to a data protection authority.

Section 2: add "Consent records for health data (whether it was granted, which version, and when it was granted or withdrawn)" to the bullet "Support messages and feedback, consent records…" or list it separately. These records are included in the account export.

---

## C. Replacement for Section 8 — Children (rename "Age requirement")

> ## 8. Age Requirement (18+)
>
> Mizyun is for adults aged **18 or older**. It is not directed to children and is not intended for anyone under 18.
>
> Mizyun asks for your **birth year** (not your full date of birth) during setup and in your profile. The app refuses a birth year that would make you under 18, and nothing is saved for a refused age. Because we only collect the year, a person born in the year exactly 18 years before the current year may still be 17, so the app also asks them whether they have turned 18; that answer is used only for this check and is not stored. We collect only the year to avoid holding more personal data than needed (data minimisation). Age is self-declared by the user and Mizyun does not verify identity or age. By using Mizyun you confirm you are 18 or older.
>
> If we learn that someone under 18 has an account, we will close it and delete its data from active systems as described in Section 7, and we will not use the data further. If you believe a child is using Mizyun, contact support@mizyun.phiskel.com.

Notes for review:

- The "close and delete" promise must be backed by an operational process (who checks, how fast). Set a realistic commitment before publishing. **[OPEN]**
- Whether the self-declared birth-year check is enough (versus full date of birth or another method) is a legal and risk decision. See Section D.

---

## D. Other places that must change in step

- **Terms of Service** (`docs/TERMS_OF_SERVICE.md`): add an eligibility clause for the whole app (18+). Section on AI (line 23) and Community eligibility (line 33) currently set 18+ / birth year at least 19 years before the current UTC year for Community. Keep that stricter Community check or align it deliberately, and describe the whole-app check (birth year at most current year minus 18). Add the health-data consent and withdrawal consequence, and the termination/account-closure right for under-18 accounts.
- **Website copy** (separate repo `/Users/adam/Documents/mizyun-website`): the privacy page, terms page, any "who is it for" text, and the delete-account page. Publish the new policy and terms at the same time as the app release.
- **Sign-up screen**: Privacy Policy and Terms links (being added in code).
- **In-app disclosures**: the AI disclosure and Community rules mention adults only; check they stay consistent. Any onboarding text mentioning age or "13".
- **App Store / Google Play**: age rating, target audience, privacy labels, data safety, listing text. See the "Store console changes" section of the DPIA draft and `docs/STORE_LISTING_DISCLOSURES.md`.
- **Store reviewer notes** and `docs/STORE_PRIVACY_CHECKLIST_2026-10-21.md` lines 41 and 77 (stale once 18+ ships).
- **`docs/COMMUNITY_LEGAL_STORE_CHECKLIST.md`**: its "Privacy / lawful basis / DPIA" open item should point to the DPIA once signed off.
- **Existing under-18 users**: decide what happens to accounts created under the old 13+ rule. **[OPEN]**

## E. Open questions for Adam / legal

1. Delete health data automatically when consent is withdrawn, after a grace period, or only on user request?
2. Is a self-declared birth year acceptable, or is full date of birth (or another check) needed? Trade-off: stronger age assurance versus more personal data.
3. Can Art. 6(1)(b) and 9(2)(a) coexist for the core tracking features, or should the policy say consent only?
4. What is the retention period for consent records after account deletion (proof of consent versus minimisation)?
5. What to do with existing accounts whose birth year implies under 18 or is missing.
6. Does Section 5 need named transfer mechanisms (for example Standard Contractual Clauses or the EU-US Data Privacy Framework) for Anthropic, Google, Cloudflare and Amazon SES? The current text says only "the applicable contractual or legal mechanism".
7. Should the policy state where the servers are (Hetzner, Helsinki) and that backups go to a Raspberry Pi with 90-day retention? The current policy mentions the 90-day backup retention but not the hosting provider or location. I did not add it here without your decision.
8. Is the operator an individual (Adam Hikl) with no postal address acceptable for the controller identity requirement?
