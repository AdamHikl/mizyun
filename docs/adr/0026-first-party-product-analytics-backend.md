# ADR 0026: First-party product analytics backend (OBS-002)

- Status: accepted
- Date: 2026-09-13
- Supersedes: ADR 0014 (in part: extends local-only collection with first-party server ingestion and account-linked lifecycle)

## Context

ADR 0014 established a closed, strictly validated analytics vocabulary and local-only storage for the initial alpha. However, manual export of JSON via system share sheets does not scale to ongoing beta usage, cannot measure retention across device uninstalls, and limits visibility into onboarding drops, logging failures, and friction.

Mizyun requires a first-party, server-side analytics subsystem (OBS-002) that:

1. Collects coarse product telemetry without relying on third-party tracking vendors (e.g. Mixpanel, PostHog, Segment, Google Analytics).
2. Links events to authenticated accounts to support GDPR/privacy account export and account deletion.
3. Strictly preserves user privacy: no health measurements, food names/nutrition details, photos, chat messages, or tokens may ever enter the analytics pipeline.
4. Operates under explicit, versioned, opt-in consent with immediate local and server-side cessation upon revocation.

## Decision

1. **Architecture & Storage**:
   - Store events in a dedicated `product_analytics_events` table in PostgreSQL with strict Row Level Security (RLS) enforcing that users can only view their own events. Direct client inserts/updates/deletes are revoked; all ingestion and mutation happen via security-definer RPCs or authenticated API endpoints.
   - User consent is versioned (`product-analytics-v2`) and tracked in `product_analytics_consents` with revision counters and rotation epochs.
   - Retention is bounded to 30 days via automated database cleanup (`cleanup_expired_product_analytics`).

2. **Ingestion & Transport**:
   - `POST /v1/analytics/events`: Authenticated batch ingestion endpoint accepting up to 50 validated `AnalyticsEventV2` events per request with a 32 KiB body limit.
   - Ingestion enforces active consent and epoch match (HTTP 409 conflict triggers client queue purge and resync).
   - Ingestion sanitizes skew: timestamps > 5 minutes in the future or > 72 hours in the past are rejected.

3. **Privacy & Disclosure**:
   - Disclosures in both Onboarding and Settings explicitly state that coarse usage data is sent to Mizyun's servers to improve the app UI and experience, and is linked to the user's account for export and deletion.
   - All legacy copy claiming "data stays on this device" is removed.
   - Events strictly conform to `analyticsEventV2Schema` in `@mizyun/contracts`. Arbitrary keys and values are rejected at validation boundaries.

4. **Client-Side Durability & Offline Support**:
   - `NetworkAnalyticsClient` manages an account-bound offline queue (bounded to 500 events).
   - Denying consent immediately purges the local queue and records an optimistic denial, syncing with the server.

5. **Lifecycle Integration**:
   - Account export (`GET /v1/account/export`) includes all retained product analytics events and consent status.
   - Account deletion (`DELETE /v1/account`) cascades to completely remove all analytics events and consent records.
   - User-initiated clearing (`DELETE /v1/analytics/events`) deletes all server-side events for that user and advances the consent epoch.

6. **Operator Tooling**:
   - A CLI (`pnpm analytics <command>`) executes read-only, non-identifying aggregate queries over SSH into the Raspberry Pi host.
   - Raw individual event rows, emails, and user IDs are never returned to the CLI operator.

## Consequences

- Product telemetry is reliably gathered for consenting users without any third-party SDK dependencies.
- Privacy compliance is maintained through end-to-end user data rights (export, clear, delete).
- Zero telemetry is collected or retained for non-consenting users.
