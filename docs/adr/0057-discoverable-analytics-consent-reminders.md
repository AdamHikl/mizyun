# ADR0057: Discoverable analytics consent and local reminders

- Status: Accepted for implementation; native and release acceptance open
- Date: 2026-10-12
- Scope: OBS-01–04 / PRIV-01 / #239; extends [ADR0026](0026-first-party-product-analytics-backend.md)

## Context

Adam could find AI consent but could not find optional analytics consent. Current source provides a separate onboarding choice and Account → Privacy & data → Product Analytics & Export; searching data collection or usage data did not find it. This does not establish which controls appear in an installed binary.

## Decision

Add a compact direct Account shortcut named Help improve Mizyun, preserve the Privacy & data destination, and support analytics consent/data collection/usage data searches. Label the existing affirmative action Allow usage analytics and explain that it is separate from AI consent.

Show an in-app dialog only on Home after eight seconds, with a settled authenticated profile, foreground app, no onboarding and no active workout. Prompt only when local and current server consent establish an undecided account. Existing grants and explicit refusals/revocations suppress it. Failed reads never become assumed unknown consent.

The dialog offers Review analytics, Remind me in2 weeks, and Don't ask again. Review navigates to the existing disclosed consent controls and never grants permission itself. Reserve a14-day cooldown before presentation, so dismissal, Back or a restart cannot provoke repeated asks. Do not record prompt impressions/choices as telemetry before consent.

Store version1 `{nextPromptAt, neverAsk}` under `mizyun.analytics-reminder.v1.<ownerId>` in SecureStore. It is a local presentation preference, not consent authority. Keep account state separate and discard late asynchronous responses after session changes. Corrupt/unreadable preferences suppress prompts; failed permanent-suppression saves show a retry message. Account-local erasure deletes the key and reports failures through the existing cleanup result.

## Consequences

The reminder runs at the next eligible Home/foreground visit once due; it does not use push notifications or schedule work while the app is closed. Cadence/suppression are per account on each device, not synchronized across devices. Reinstall may clear Android local preferences; iOS Keychain retention is not relied on. Consent/denial remain server-backed and authoritative through the unchanged pipeline. No new analytics event/property, backend endpoint, migration, SDK or OS permission is introduced. Users who already declined can still opt in manually through the direct Account control.

The two-week cadence is Mizyun's product decision. Official privacy/platform sources and implementation consequences are recorded in [research](../RESEARCH_LOG.md#discoverable-analytics-consent-and-fortnightly-in-app-reminders-239--2026-10-12). Native small-screen/dynamic-text/VoiceOver/TalkBack and installed-build acceptance remain separate from automated source/bundle checks.
