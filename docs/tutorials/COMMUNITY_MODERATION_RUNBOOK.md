# Community moderation — COMM-09 / #148

Implementation runbook, 2026-09-30. **Pilot admission remains closed.** This document prepares the operator workflow; it is not evidence of staffing, tested contact, deployment, legal acceptance or notification delivery.

## Staff and access acceptance

Adam Hikl owns primary coverage and acceptance. A trained named backup and independent appeal reviewer are **not yet supplied**. Record their name, training date, coverage calendar and handover acknowledgement before admission. Ordinary first review target is 24 elapsed hours; urgent child-safety/threat reports target four elapsed hours, both measured from server receipt. Coverage must meet these clocks whenever Community is enabled.

Staff use dedicated Supabase Auth accounts with MFA (`aal2`). The coordinator provisions named UUIDs in the service-managed `community_moderation_staff` registry and the API's `COMMUNITY_MODERATOR_USER_IDS` allowlist. Staff cannot self-enroll in either registry. The API forwards the verified caller JWT; database RPCs independently check the active registry and MFA. Do not give operators a service-role key or private-health database access. Account MFA must actually be enrolled and exercised; unit JWT fixtures do not prove that configuration.

Set `COMMUNITY_SAFETY_EMAIL`, `COMMUNITY_STANDARDS_URL`, and `COMMUNITY_SAFETY_CONTACT_VERIFIED=true` only after inbound/reply and the published URL are tested. No mailbox or public rules deployment is supplied by this implementation. The app displays contact unavailable until verified configuration exists. Verification configuration attests operational evidence; it cannot test deliverability itself. Keep enrollment closed until #153/#154/#155 accept contact, staffing, disclosures and freeze behavior.

## Getting a moderator session

Staff operations need an `aal2` token. Run the helper yourself in a terminal; it prompts for email, password (hidden) and the 6-digit authenticator code, and never accepts them as arguments or environment variables. The target and public Supabase configuration come from `apps/mobile/.env.<environment>`; the Supabase origin must be exactly the pinned host for that environment and requests never follow redirects.

```bash
# Sign in, complete MFA, then run the moderation CLI (default: --queue)
node scripts/community-staff-session.mjs --env production -- --queue
node scripts/community-staff-session.mjs --env production -- --inspect <report-uuid>

# Or export the session into the current shell (the only mode that prints the token)
eval "$(node scripts/community-staff-session.mjs --env production --print-export)"
node scripts/community-moderation.mjs --env production --queue
unset COMMUNITY_STAFF_ACCESS_TOKEN API_URL
```

First use with no verified TOTP factor enrolls one ("Mizyun moderator") and prints the `otpauth://` URI and secret once; add them to an authenticator app, then enter the current code. The screen is cleared after enrollment; do not copy the secret anywhere. An abandoned unverified factor is removed only after you confirm. A wrong code allows three attempts. Tokens expire (about one hour); rerun the helper for a new one. `--print-export` refuses to run when stdout is a terminal, so it must be wrapped in `eval`; always `unset` both variables when finished. The helper proves only that this account can obtain `aal2`; the account must still be in `community_moderation_staff` and `COMMUNITY_MODERATOR_USER_IDS`.

## Queue and decisions

The CLI uses `COMMUNITY_STAFF_ACCESS_TOKEN` for the current named MFA session and an explicitly reviewed HTTPS `API_URL`. Never paste credentials into an issue, command argument, screenshot or durable log.

```bash
node scripts/community-moderation.mjs --queue
node scripts/community-moderation.mjs --inspect <report-uuid>
node scripts/community-moderation.mjs --action warn --report <report-uuid> --reason "Policy category and explanation"
node scripts/community-moderation.mjs --action suspend --report <report-uuid> --reason "Policy category and explanation" --suspension-days 7
node scripts/community-moderation.mjs --review-appeal <appeal-uuid> --decision approved --notes "Independent review explanation"
```

Review only case-scoped social snapshots and bounded confidential report notes. Never import private workouts, food, photos or Coach data. A reported account cannot read reporter identity, staff notes or staff provenance. Report submission alone imposes no sanction. Prepublication filtering is deterministic and incomplete: human reports and false-positive correction remain necessary. No content is sent to an AI provider.

Decision RPCs serialize queue mutations, enforcement and audit in one transaction. Closed cases cannot be re-decided. Reporter and subject cannot decide their own case. `remove` hides a selected card or clears profile display/bio; `suspend` has 7/14/30-day limits; `ban` blocks further social enrollment while the account exists. Private tracking is unaffected. Sanctions withdraw social authority and revoke content. Expiry or successful appeal removes only the matching sanction; it never republishes a card, recreates relationships or reenrolls an account. Fresh user consent is required. A remaining independent sanction continues to deny enrollment.

The subject obtains a redacted notice in Community safety and can file one appeal per decision. The original decision maker, reporter and appellant cannot review it. Record reasons in the case audit. Reporter follow-up is limited to their own case status; #149 delivery remains separate.

## Required acceptance drill

Using synthetic accounts on an explicitly accepted Dev SHA, a named primary must resolve ordinary and urgent cases within their clocks; the named backup must independently adjudicate an appeal. Exercise a wrong-role token, missing MFA, forged operator header, original-reviewer denial, reporter/subject privacy, removed-card reporting using a caller-owned receipt, offline report retry, duplicate submission, restricted-account safety controls and enrollment after expiry/reversal. Confirm audit entries against actual database transactions and verify inbound contact/reply. Record redacted timestamps, source SHA, migrations, operator identity and actual outcomes. Offline CLI `--drill --mock` is a **simulation only**, never staffing or live acceptance.

## Emergency and coverage failure

For imminent harm, direct users to local emergency services. Do not promise emergency response. Child sexual exploitation, threats, harassment, body shaming, dangerous fitness advice, impersonation, scams, spam and illegal content require prompt triage under the published standards.

Before admission, #154 must establish applicable jurisdictional reporting duties and verified official escalation destinations; no statutory or agency contact acceptance is implied here. Do not download, duplicate or distribute suspected illegal media. This pilot accepts no report attachments. Restrict access to necessary case evidence and obtain qualified escalation guidance. Log the incident and access decisions without copying private health data.

If coverage/contact fails or review clocks cannot be met, halt admission/publication and social visibility as appropriate under #153, while preserving authenticated reporting, contact/emergency guidance, block management, appeals, withdrawal/export/deletion and private tracking. There is no invented freeze endpoint in this runbook. Verify actual switch tooling and outage/notification behavior in #153 before admission.

## Retention and deletion dependencies

The contract requires at most 30 days for interaction receipts, necessary closed-case evidence 180 days, overdue open-case review weekly, and individualized hold review every 90 days. RPCs deny expired receipts immediately. Automated physical purge, justified hold administration, full export/deletion coverage and restore barriers are **#151/#154 acceptance dependencies**; this source package does not claim them complete. Do not extend case retention or silently discard necessary evidence merely because an account is deleted. Staff registry revocation must immediately deny future RPCs; audit access and erasure policy need their own acceptance record.
