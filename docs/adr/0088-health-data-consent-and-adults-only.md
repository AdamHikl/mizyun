# ADR-0088 — Health-data consent and adults-only accounts

- Status: proposed for Dev implementation, 2026-10-27 (review findings PRIV-01 and PRIV-02). The legal texts are drafts for Adam/legal review; Production release is not authorized by this ADR.
- Builds on: ADR-0024 (AI admission after consent), ADR-0084 (first-run card on Home).
- Drafts: [policy changes](../legal-drafts/PRIVACY_POLICY_HEALTH_CONSENT_DRAFT_2026-10-27.md), [DPIA](../legal-drafts/DPIA_DRAFT_2026-10-27.md).

## Context

Weight, body measurements, height, sex at birth, birth year and diet logs are health data (GDPR Art. 9). The published policy relied on contract for them and named no Art. 9 condition; no consent was asked outside AI and analytics. Onboarding accepted birth years up to the current year − 13, the server accepted any birth year, and AI/Community (18+) compared birth years only.

## Decision

1. **Explicit consent.** After sign-in, before content, onboarding or the ADR-0084 first-run card, the session gate shows "Your health data": what is stored and why, a separate unticked checkbox (not bundled with the Terms), and Privacy Policy/Terms links. Existing users see it on their next launch. `public.user_health_data_consents` keeps the current answer (version `2026-10-27`, `consented_at`/`revoked_at`), and a trigger appends every grant/withdrawal to `user_health_data_consent_events` (owner read-only) so a decision can be demonstrated. Both are owner-scoped by RLS, included in the account export and removed with the account.
2. **Withdrawal.** Settings → Privacy & data → Withdraw health data consent records the withdrawal; the gate then asks again before the app can be used. The consent screen always offers export and account deletion, also to users who never agree. A database trigger sets the consent times (clients cannot backdate them) and keeps the original time of a repeated grant. Stored data is not deleted automatically by the withdrawal (open decision for Adam in the DPIA).
3. **Server enforcement.** `PUT /v1/profile`, and a birth year sent with `PUT /v1/account/ai-consent`, refuse a new (changed, non-null; height within 0.05 cm counts as unchanged) birth year, height, sex at birth or activity level with `HEALTH_DATA_CONSENT_REQUIRED` (a) for every client once a withdrawal is recorded, and (b) without a current grant for clients at compat level `2026-10-27` or later. Installed builds that never show the step (1.0.9 without the header, 1.0.10 at `2026-10-21`) are not refused for a missing answer, so they keep working until users update; meals, weights and workouts are gated by the app, not the server (follow-up). The header is self-declared: this protects honest clients, not against a user bypassing their own app.
4. **Adults only.** All profile writes reject a birth year after `currentUTCYear − 18` (`adultBirthYearSchema`), whatever the client; `PUT /v1/account/ai-consent` refuses such a year before saving it. The app refuses it in onboarding, profile settings and energy setup with a kind message and saves nothing. For the one boundary year the app asks "Have you turned 18 yet?" and stores no answer. A stored under-18 birth year closes the app to an explanation with export, deletion and sign-out.
5. **Launch.** `HealthDataConsentController` (plain class, unit-tested) drives this: a cached grant opens the app at once and the server answer replaces it; the app asks again whenever it returns to the foreground, so a withdrawal on another device closes it too. Results and cache writes from a superseded load, save or user are dropped. With neither a server answer nor a cached one, the app shows "Can't reach Mizyun" with a retry instead of a consent step it cannot save.

## Consequences

- Only the birth year is kept (minimisation). The boundary answer is self-declared and device-only, so the server and the AI/Community checks still compare years; a 17-year-old who answers "Yes" passes.
- Release gate: apply the migration and deploy the API to an environment before any build at compat `2026-10-27` uses it; otherwise users without a cached answer see "Can't reach Mizyun".
- Installed 1.0.9/1.0.10 builds now get a generic error for a 13–17 birth year (transitional; they also write goal and weight first).
- Logging reminders (first meal, weigh-in, evening stretch) run outside the gate and can still fire after a withdrawal (follow-up).
- Store listings must change (App Store 16+, Play target audience 18+ with the content rating from the questionnaire, health data declarations; Adam 2026-10-28, following MyFitnessPal); see the DPIA draft.
