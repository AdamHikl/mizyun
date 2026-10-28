# ADR-0085 — Crash and error reporting

- Status: Proposed (draft) 2026-10-27 — no vendor SDK added; implementation tracked in #342. Review finding OPS-01 (#32).
- Builds on: ADR-0014 (local consent-first analytics), ADR-0026 (first-party analytics backend), ADR-0084 (payload-free telemetry).

## Context

OPS-01 (#32): neither the mobile app nor the API has crash or error reporting. The only signal is journald on the Hetzner VM, so a crash on a user's phone, or a non-5xx failure that never reaches a log, is invisible until someone reports it. Mizyun handles health, nutrition and body data (special category, GDPR Art. 9) and photos, so a stack trace, breadcrumb, request body or screenshot can itself contain health data. Dev and Production share one 4 GB-RAM-class VM with the API, two Supabase stacks and Postgres instances, so any new service competes for memory. `docs/PRIVACY_POLICY.md` today lists no diagnostics processor; analytics events are deleted after 30 days (ADR-0084 context). `docs/STORE_PRIVACY_CHECKLIST_2026-10-21.md` says to "keep the current answer" for Diagnostics, which would no longer hold.

## Options

**(a) Sentry SaaS, EU region.** Data at rest (events, release health, releases, source maps, replays) is stored in Frankfurt (`de.sentry.io`); the region cannot be changed later. Sentry documents that user accounts, DSN keys, tokens, audit logs, project metadata and support-ticket data stay in the US regardless, that region choice covers only storage at rest, and that Sentry still accesses and processes data under its terms. Sentry is a processor under its DPA; EU-to-US transfers rely on the Data Privacy Framework with SCCs as fallback, with a sub-processor list and 30 days' notice of changes. Native Hermes/Expo source map and native symbol support. Free Developer tier and paid Team tier figures come only from third-party summaries (about 5,000 errors/month free; Team about $26/month) and are unverified against sentry.io/pricing. No RAM or ops cost on the VM, and it keeps working when the VM is down. Cost: a new third-party processor and a US-touching control plane to disclose and keep in the DPA/sub-processor register.

**(b) Self-hosted GlitchTip (Sentry-SDK-compatible).** GlitchTip lists React-Native and Node among supported SDKs; it is used by changing the DSN. Docs: PostgreSQL 14+ required; Valkey/Redis 7+ optional (without it Postgres carries queue, cache and sessions); all-in-one mode (`GLITCHTIP_EMBED_WORKER=True`); recommended 512 MB RAM, minimum 256 MB, about 30 GB disk per million events/month; Docker Compose recommended; upgrades are pull and restart with automatic migrations, major releases about yearly; set Postgres `max_locks_per_transaction` to 512. Data stays on Mizyun's own infrastructure, so no new processor, no transfer, and retention is ours. Costs: roughly 0.3–0.5 GB of the shared VM, a separate Postgres (or a database in an existing one, which would couple it to Dev/Prod), another public hostname via the Cloudflare tunnel, our own backups and upgrades, and a reporter that is down exactly when the VM is. Unverified: source map upload against GlitchTip with the current `sentry-cli`/`@sentry/react-native` Expo plugin. A 2024 GlitchTip issue reported `sentry-cli releases finalize` failing on a missing endpoint (current status not checked), and a third-party template notes that uploaded source maps are lost on redeploy unless a volume is kept. Release health and sessions support is not confirmed from primary docs. Needs a spike.

**(c) Structured API logging only (baseline).** Redacted JSON logs, request ids and an alert on 5xx rate and unhandled rejections. No new processor or RAM, but it gives no mobile crash visibility, which is the larger gap. Worth doing regardless; not sufficient alone.

## Privacy-policy and store implications (apply to a or b)

- Disclose a new data category (crash/error diagnostics: stack trace, app and OS version, device model, coarse timestamp, optional pseudonymous install id), purpose (fixing defects), recipient (the processor for (a); "our own server" for (b)), storage region, and retention.
- Legal basis: legitimate interest is defensible only for payload-free diagnostics; because the app handles special-category data, the safer posture is to send reports only when the existing optional analytics consent is granted, or a separate "Send crash reports" switch, default off, and to document that choice. A legal decision for Adam; this ADR does not settle it.
- Apple App Privacy: collecting Crash Data and Performance Data off the device by us or a third-party SDK must be declared under Diagnostics. The "optional disclosure" exemption does not apply to ongoing collection, so declare. Keep it unlinked only if no user id, IP or other identifier is kept. If IP addresses are stored, declare them.
- Google Play Data safety: declare Crash logs and Diagnostics collected via the SDK. Sending to a processor acting only on our instructions is generally not "sharing". Automatic deletion within 90 days qualifies for the deletion answer.
- Never send health values, meal or boulder photos, free text, notes, Coach text, names, emails or account ids. At most a random per-install id, or none.

## Decision (proposed)

Adopt **(b) self-hosted GlitchTip** for Production and Dev crash reporting, plus **(c)** for the API. Rationale: the privacy claim stays simplest and truest ("diagnostics stay on Mizyun's server, no new processor, no US control plane"), there is no licence cost (the RAM, operations and backup costs below remain), and the Sentry SDKs give an exit to (a) by changing a DSN. The RAM objection is real, so adoption is conditional on a spike: (1) measure free memory on the shared VM with Dev and Production under load and confirm GlitchTip in all-in-one mode with Postgres-only queueing fits a hard memory limit (target 512 MB total) without risking the Supabase or API services; (2) prove a symbolicated Hermes/Expo release error reaches GlitchTip using the pinned `@sentry/react-native` and `sentry-cli`, with source maps on a persistent volume. **If either fails, fall back to (a) Sentry EU** with a signed DPA and sub-processor review, rather than shrinking guardrails.

Mandatory guardrails for either option:

1. SDK: `sendDefaultPii: false`; no screenshots, view hierarchy, session replay or profiling; no performance tracing initially; request bodies and headers never attached.
2. `beforeSend`/`beforeBreadcrumb` allowlist scrubbing: drop console, fetch/XHR bodies and navigation-parameter breadcrumbs; strip URL query strings, user, IP and device name; truncate messages; unit-tested against fixtures containing health values, emails and tokens. Server-side scrubbing and (Sentry) "prevent storing IP addresses" on as a second layer. Sentry notes geo data is still derived from the IP unless a rule removes it.
3. Production crash reporting is gated by user consent, off by default until the legal basis is settled; a user turning it off stops sending.
4. Retention at most 30 days (90 hard ceiling); no per-event delete exists in Sentry, so rely on project-level retention.
5. Separate Dev and Production projects and DSNs; a source-map and release name per build; Dev data never read into Production dashboards.
6. DSNs are not secrets; a remote kill switch via build/env flag and API-served config disables reporting without a release. No auth tokens or upload tokens in the app.
7. GlitchTip on its own hostname behind the tunnel with admin sign-up closed, Postgres backed up with the existing recovery archive, memory-limited container, upgrade owner named. The public ingest endpoint needs per-DSN rate limits (GlitchTip project throttling and/or a Cloudflare rate-limit rule) so abuse cannot exhaust the shared VM, and the new hostname on the shared `cloudflared` tunnel must keep the tunnel-isolation guarantees (`deploy/hetzner/verify-shared-tunnel-dependencies.mjs`).
8. Privacy policy, Store listing disclosures, App Privacy and Play Data safety answers updated, and the analytics/diagnostics settings copy changed, before any Production build includes the SDK.

## Consequences

- One more service on the VM to patch, back up and monitor; a VM outage also silences crash reports (journald and an external uptime check remain).
- Mobile and API code add a thin `observability` port so a vendor SDK stays out of `packages/core`; the SDK lives in `apps/mobile` and `apps/api` composition only.
- A native SDK addition needs a new mobile build; builds already in the field report nothing.
- Open: legal-basis decision, spike results, Sentry pricing verification, release health support in GlitchTip.

## Sources (checked 2026-10-27)

- Sentry data storage location: https://docs.sentry.io/organization/data-storage-location/ (fetched)
- Sentry data scrubbing index: https://docs.sentry.io/security-legal-pii/scrubbing/ (fetched; SDK-level details not on this page)
- Sentry server-side scrubbing: https://docs.sentry.io/security-legal-pii/scrubbing/server-side-scrubbing/ (fetched; IP setting label not given)
- Sentry React Native data collected: https://docs.sentry.io/platforms/react-native/data-management/data-collected/ (fetched)
- Sentry DPA: https://sentry.io/legal/dpa/ (fetched; sub-processor page https://sentry.io/legal/subprocessors/ not opened)
- GlitchTip install requirements: https://glitchtip.com/documentation/install (fetched)
- GlitchTip SDK list: https://glitchtip.com/sdkdocs (fetched; no source map or sessions detail)
- GlitchTip sentry-cli issue: https://gitlab.com/glitchtip/glitchtip-backend/-/issues/342 (search result only, not opened)
- Sentry pricing: third-party summaries via search only; https://sentry.io/pricing not fetched, figures unverified
- Apple App Privacy details: https://developer.apple.com/app-store/app-privacy-details/ (fetched)
- Google Play Data safety: https://support.google.com/googleplay/android-developer/answer/10787469 (fetched)
