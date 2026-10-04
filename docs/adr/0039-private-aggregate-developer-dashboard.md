# ADR 0039: Private aggregate developer dashboard

- Status: accepted for Mac dashboard with Hetzner collection; real Mac viewing verified; new capture/device/store acceptance remains open
- Deployment topology updated: 2026-10-04 (explicit user selection)
- Date: 2026-10-03
- Work item: [#186](https://github.com/AdamHikl/mizyun/issues/186)
- Extends: [ADR-0026](0026-first-party-product-analytics-backend.md)

## Decision

Adam requested app downloads, registrations, meal activity, popular controls, navigation friction and settings use on phiskel, and selected self-hosting. Reuse the first-party consent-gated event pipeline and use Metabase Open Source for charts, filters and private operator access. Do not add a third-party tracking SDK or build a second analytics engine.

Metabase connects only to a separate PostgreSQL aggregate warehouse. A fixed read-only query on the marked Hetzner host computes current 30-day aggregates from granted current-version/current-epoch events. Only validated non-identifying aggregates cross this boundary. The source credentials never enter Metabase or mobile/web bundles. Dev, Production and synthetic snapshots are separately identified. No arbitrary SQL, SSH target, account selector or source database URL is accepted by the collector.

Each refresh atomically replaces one environment's full snapshot; lost-response retries are idempotent and older snapshots cannot replace newer ones. Reader views suppress snapshots older than two hours and dates beyond the retained window. Revocation, clear and deletion remove contributions on the next successful refresh; if refresh fails, the reader window bounds visibility. This is eventual aggregate refresh, not synchronous withdrawal of already downloaded reports. Do not retain historical identifiable event exports or claim irreversible aggregate exports can be recalled.

Add only static dashboard-control identifiers, explicit settings-search submit result buckets and selected static destinations under the existing coarse usage disclosure. Never capture keystrokes, search text, health values, food text, photos, routes/record identifiers or session replay. Account changes reset local analytics before replacement consent synchronization; old upload responses cannot mutate a newer lifecycle/epoch queue.

Auth account creation aggregates are operational counts of existing accounts, including unconfirmed accounts and excluding deleted accounts. Meal counters describe observed consenting manual creations; automatic recurring materialization is not included. Unscoped event counts do not establish matched funnels. New consent-owned random attempt scopes produce matched start-cohort counts using the earliest terminal, with unknown outcomes distinguished from explicit exits and no abandonment inference. IDs stay at the source. Setup captures actual static steps only after grant; authoritative saves, not AI drafts, produce completion. D1/D7 are matured first-observed return cohorts inside a rolling retained window, not signup retention. Instrumentation gaps are explicit; missing sources produce unavailable/unobserved results.

Store data uses separately attributed normalized official aggregate reports. Apple first-time downloads/redownloads and Google user acquisitions/device installs/listing visitors/install clicks keep their source definitions. Never equate install clicks, installations, app opens and account registrations, or infer a person-level store-to-account funnel. Automated report retrieval requires separate least-privilege store credentials and verified report formats.

Adam selected an on-demand Mac dashboard with continuous first-party collection on Hetzner on 2026-10-04. Hetzner retains authoritative consented raw events in its existing app database; only the app collection/retention path needs continuous availability. Metabase, its metadata database and the aggregate warehouse stay on this Mac, bound to loopback. Starting a real-data viewing session must refresh the complete retained window through the fixed read-only collector; there is no requirement for a Mac collector while the Mac is asleep/off. The Pi is excluded from analytics and keeps its existing recovery role. No additional Metabase/reporting PostgreSQL services belong on Hetzner; an 8 GB upgrade is deferred until real revenue. No new server deployment/service/configuration change is authorized by this topology selection.

Keep synthetic preview data clearly labelled and separately guarded. The current synthetic launcher must not be repurposed to accept real data silently. A separate real-data Mac project on loopback3034 now starts, refreshes fixed live Dev/Production sources, reports local freshness, and stops without removing credentials or volumes. Real pinned-API and restart acceptance is recorded in the runbook/status; exact new capture/device release and store integration remain open. The synthetic launcher stays on3033 and refuses real data. A refresh catches up only inside the existing rolling 30-day raw retention window; after two hours without successful refresh, app reader views hide stale metrics. No claim of indefinite historical catch-up is made. Mac local warehouse/Metabase metadata use persistent PostgreSQL volumes with protected credentials and a preserved encryption secret; old app snapshots must be discarded and rebuilt against current consent after recovery.

Disable public sharing, embedding, provider AI, anonymous Metabase usage tracking and query caching. Restrict both collection and database query permissions to administrators. Warehouse credentials are a dedicated read-only role; Metabase has no connection to user-owned source tables. Future public `developer.phiskel.com` access would be a separate approved package with founder-only Access/MFA and Metabase login; DNS, Tunnel, public ingress and hosted refresh timers are not prerequisites for the selected local Mac workflow.

## Alternatives and consequences

Apple App Store Connect and Play Console supply acquisition/store metrics, but do not expose Mizyun's custom UI events or authoritative registrations. They complement this dashboard. Hosted product analytics would introduce a processor and new data egress, contrary to the selected first-party approach. Metabase provides the existing dashboard tool without that tracking SDK dependency.

This adds service/backup/refresh operations and consumes roughly a capped 1.9 GiB across the configured local containers; this dashboard budget is borne by the Mac when running. Hetzner still bears existing event storage and bounded aggregate queries. Local synthetic acceptance does not prove real-source refresh, source deployment, store integration or installed-device telemetry. See [the runbook](../DEVELOPER_ANALYTICS_DASHBOARD_2026-10-03.md).

## Primary sources

Accessed 2026-10-03: [Metabase Docker](https://www.metabase.com/docs/latest/installation-and-operation/running-metabase-on-docker), [database roles](https://www.metabase.com/docs/latest/databases/users-roles-privileges), [data permissions](https://www.metabase.com/docs/latest/permissions/data), [pinned release](https://github.com/metabase/metabase/releases/tag/v0.63.18.2), [Cloudflare private self-hosted applications](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/), [Apple Analytics](https://developer.apple.com/help/app-store-connect-analytics/), [Google acquisition reporting](https://support.google.com/googleplay/android-developer/answer/9859173).

## Local continuation and catalog negotiation

The separate synthetic command uses only owned synthetic aggregates, fixed loopback containers and preserved private credentials; real source/store data causes refusal. Simulated store examples stay outside the reporting table. No Mac background source collector is installed.

Expanded version2events require response-catalog negotiation: unflagged owner list/account export uses a frozen legacy subset, while current clients request the full `dashboard-v1` catalog. Legacy omissions are explicit in full-export completeness/counts; current full export includes previously omitted repository analytics. Strict query validation protects the fixed catalog boundary. React effect cleanup is never interpreted as user exit; navigation measurement checks prevented actions.
