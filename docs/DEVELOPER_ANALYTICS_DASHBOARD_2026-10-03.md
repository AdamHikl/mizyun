# Phiskel developer analytics dashboard

> [#186](https://github.com/AdamHikl/mizyun/issues/186), [ADR-0039](adr/0039-private-aggregate-developer-dashboard.md). Local implementation; hosted/store/device acceptance remains separate.

## What is included

The dashboard uses pinned Metabase Open Source `v0.63.18.2` and a separate PostgreSQL17.6 warehouse. Its 19 cards cover current account/consent coverage and freshness, daily registrations, observed activity and sessions, observed meals/workouts/body-record creations, screens, dashboard controls, explicit settings-search result buckets and selected destinations, logging observations/failures/duration, matched scoped journeys and onboarding friction, navigation transitions, matured observed return, app releases, feature outcomes and official store imports. Filters select synthetic/Dev/Production and 1–30 UTC days.

| Question                         | Source and definition                                                                     | Coverage limitation                                                                                                                        |
| -------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| How many registrations?          | Creation dates of existing Auth accounts                                                  | Includes unconfirmed; deleted accounts disappear; not an immutable signup ledger                                                           |
| How many active users?           | Distinct consenting accounts with retained events                                         | Nonconsenting/uninstrumented activity is unknown; all-platform accounts are globally distinct                                              |
| How many meals per day?          | `core_record_created` meal events                                                         | Consenting successful manual saves; retries/visits may recount records; excludes automatic recurring meals and is not consumption evidence |
| Which widgets are clicked most?  | Static `dashboard_control_clicked.control`                                                | Requires newly instrumented mobile candidate; repeated presses count                                                                       |
| Which settings are searched for? | Static destination selected from local results                                            | No query text; selection popularity is distinct from explicit search-submit counts                                                         |
| Where do users get lost?         | Matched journeys, setup steps, screen transitions, failures, durations and empty searches | Matched scoped starts/completions/exits; unknown outcomes never imply abandonment                                                          |
| How many downloads?              | Separately imported Apple/Google aggregate reports                                        | Not yet automatic; store definitions/timezones/freshness differ; clicks are not completed downloads                                        |
| How many return?                 | D1/D7 after first retained observed event with matured denominators                       | Rolling 30-day observation, not signup retention or causal UX evidence                                                                     |

The supported mobile additions never collect typed queries, names, email, route parameters, food/health values, photos or Coach content. Existing optional analytics consent remains the collection boundary. No telemetry failure may delay a save, navigation or auth change. Version/build come from the embedded Expo config; native artifact verification is a separate evidence tier.

## Selected topology: on-demand Mac dashboard — 2026-10-04

Adam selected this arrangement after considering the Pi: **Hetzner collects, Mac displays; Pi is not part of analytics.** This supersedes the Pi candidate below. The existing dashboard stack is local; real-source refresh/device/store acceptance is still pending, so this is not evidence that the demo now contains real activity.

| Component                                 | Storage and role                                                          | Required availability                                                |
| ----------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Hetzner app API and existing app database | Consented raw app events; source of truth for rolling 30-day reports      | Continuously available to receive events, independently of Mac/Pi    |
| Mac Metabase and dedicated PostgreSQL     | Aggregate reporting snapshot, dashboard definitions and local credentials | Running while refreshing/viewing; may be stopped while Mac is unused |
| Pi                                        | Existing frozen recovery data and encrypted backups                       | Existing recovery policy only; no analytics dependency               |

When viewing real data, start only the dedicated Mac stack, refresh Dev/Production separately using the fixed collector, then open the local dashboard. Mac power-off loses no events already received by Hetzner. On return, refresh catches up within the retained 30-day source window; it cannot recover expired events or measurements that were never instrumented. App report views expire after two hours without refresh. No server-side reporting stack, public hostname, Cloudflare Access setup, Pi installation or Hetzner upgrade is required for this topology.

## Real-data Mac use

Docker Desktop and private SSH/Tailscale access to Hetzner must be available while refreshing. From this repository run:

```bash
pnpm analytics:dashboard
pnpm analytics:dashboard --status
pnpm analytics:dashboard --stop
```

The first command starts the **separate real-data** project `mizyun-analytics-live`, creates or preserves mode0600 ignored local credentials, provisions all 19 cards, and refreshes Dev and Production independently. Open `http://127.0.0.1:3034`; the command prints the direct dashboard link and login-file path `ops/analytics/.env.live-login`, never passwords or API keys. The generated operator address is a local login identifier, not a guessed personal email. There is no email delivery. Status reads local freshness without SSH; stop preserves containers, volumes and credentials and stops only this dashboard. Run the start command again when viewing later or after two hours to refresh the full retained window. No automatic background collection is installed on the Mac.

The real project has separate fixed storage/network/credentials from the synthetic demo on3033. Context/endpoint overrides, changed Compose/runtime settings, public ports, foreign mounts, replaced secrets and synthetic rows cause refusal. The source query runs fixed read-only SQL on the marked Hetzner host; Production uses its existing private PostgreSQL plus loopback pooler and Dev its separate loopback database. No remote services/configuration are changed. The app reporting connection receives aggregates only. Metabase may also contain its vendor-bundled read-only SQLite Sample Database (`/plugins/sample-database.sqlite`); it is not app activity, is excluded from every dashboard card, and acceptance rejects any other connection.

Failed per-source collection during the start command clears that environment's reporting snapshot so it cannot appear freshly connected; a failure to clear is explicitly reported and must be resolved before trusting that source. Generic `analytics:dashboard:refresh` failures leave the prior snapshot untouched, bounded by two-hour reader expiry. Neither path fabricates zero counts for missing sources. Freshness/consent coverage is always shown; no consenting Production events means unobserved usage, not zero total activity. New widget/settings/journey measurement still requires the instrumented app/API candidate to be delivered and accepted; the dashboard cannot reconstruct events that were never captured. Downloads remain unavailable until official reports are imported.

Credentials: preserve `.env.live` (database passwords and encryption secret), `.env.live-admin` (operator/password/API key) and `.env.live-login` (viewing login). They are ignored by Git and must not be posted in chat. Losing a secret while named live resources remain causes refusal rather than regeneration/reset. A lost setup response can recover from the persisted password; a lost API-key creation response requires explicit controlled recovery because the unmasked secret cannot be recovered by listing keys. Do not delete volumes or reinstall to bypass these checks.

`pnpm analytics:dashboard:verify-live` validates the pinned real local API, repeat provisioning, all card queries, positive administrator control, anonymous/ordinary-principal denial and temporary-account deactivation. It does not modify source data or substitute for installed-device telemetry acceptance.

## Local synthetic setup

The current Mac preview is initialized. Run:

```bash
pnpm analytics:dashboard:local
```

This starts the dedicated local containers, refreshes 30 days of labelled simulated aggregates, and provisions the private dashboard. It prints the dashboard URL and the ignored mode0600 login-file path `ops/analytics/.env.local-login`; no credentials enter terminal output. `pnpm analytics:dashboard:local --status` is read-only. It refuses remote Docker contexts, real Dev/Production snapshots, store reports, foreign storage and unknown synthetic source witnesses. Existing local Supabase is untouched. The data is simulated, not measured app activity. Refresh again with the same command after two hours or when you want fresh dated demo data. Containers persist on this Mac until explicitly stopped; no background source collector is installed.

Store examples from `pnpm analytics:dashboard:demo --store-examples` are labelled simulated format examples and are **never** imported or shown as official downloads. Store cards remain unavailable. Use the initialization steps below only for a new local installation, preserving existing credentials/volumes when rerunning:

1. Copy [the environment example](../ops/analytics/.env.example) to `ops/analytics/.env` (ignored, mode0600). Generate distinct random database/reader/writer/encryption secrets. Preserve the encryption secret across restarts and recovery. Use no actual store or Supabase credentials.
2. Start only the dedicated stack:

   ```bash
   docker compose --env-file ops/analytics/.env -f ops/analytics/compose.yaml up -d
   ```

3. Verify source/warehouse behavior with a newly created synthetic scratch database:

   ```bash
   pnpm analytics:dashboard:verify-init
   pnpm analytics:dashboard:verify-db
   ```

   The initialization check creates/removes only a unique new analytics Compose project and verifies the SQL bootstrap and restricted reader. The source/warehouse check refuses a warehouse containing Dev/Production snapshots, creates/drops only its unique scratch database in `mizyun-analytics-postgres-1`, verifies grouping/consent/epoch/retention/reader permissions/retry/expiry, and leaves aggregate synthetic preview data. It never reads or resets the existing local Supabase database.

4. Complete Metabase startup at `http://127.0.0.1:3033`, using a local test administrator. Create an Administrators API key in Admin → Settings → Authentication → API keys. Keep the key out of chat, shell history and Git. The API is unversioned; do not upgrade the image without rechecking the tagged APIs and real integration.
5. Run the provisioner with environment variables supplied through a private secret file or process environment:

   ```bash
   pnpm analytics:dashboard:provision
   ```

   Required: `METABASE_URL=http://127.0.0.1:3033`, `METABASE_API_KEY`, `REPORTING_DB_HOST=postgres`, `REPORTING_DB_PORT=5432`, `REPORTING_DB_NAME=mizyun_reporting`, `REPORTING_DB_USER=reporting_reader`, `REPORTING_DB_PASSWORD` (the reader secret). Provisioning is repeat-safe for its marked collection/cards/dashboard and refuses unrelated content collisions. It restricts both managed database and collection permissions before accepting a dashboard. No public UUID or embedding is permitted.

6. Run `pnpm analytics:dashboard:verify-metabase` only on this synthetic local stack. It bootstraps or reuses a fixture administrator from an ignored local test secret file; checks real provisioning, repeat provisioning, every SQL card, and anonymous/nonadministrator query denial. It never accesses store/source accounts or production hosts.

## Budget-first Raspberry Pi split assessment — 2026-10-04

> Historical candidate, superseded by the selected Mac topology above. Do not execute its Pi next action.

Adam ruled out the 8GB Hetzner upgrade until there is real revenue and asked about putting the dashboard backend on the existing Pi. This is a feasible candidate architecture, **not deployment authorization**. The Mac preview and all deployed services remain unchanged.

- **Hetzner:** retain authoritative Dev/Production APIs, Auth/Storage/databases and consented raw analytics. Compute bounded fixed-query aggregate snapshots locally; this adds collection/query work, not another Metabase/PostgreSQL dashboard stack.
- **Pi:** separate Metabase metadata database, aggregate warehouse, dashboard service and periodic import. Use new directories/volumes/credentials; preserve frozen app services/data and encrypted backup-pull workflow. Do not restart the old app stacks. The dashboard can serve the browser directly over private Tailscale/SSH access; public `developer.phiskel.com` and Access setup are optional later delivery work, not required for a private pilot.
- **Transfer:** only validated current-consent/current-epoch aggregates; no raw events/identifiers/health values or source keys in the Pi warehouse. Prefer a separate narrowly gated read-only snapshot retrieval identity, with source computation on Hetzner and outbound private Pi retrieval. Do not copy the Mac operator/root SSH key or reuse the backup decryption identity on the Pi. The current Mac collector assumes the ops SSH alias and local Docker Compose and needs a dedicated least-privilege host deployment path before this topology is accepted.
- **Capacity evidence:** repository migration inventory identifies a Pi5 with 4 GB RAM; September 2026 backup notes report approximately 7.5 GiB root microSD free. Those values are historical. A single read-only SSH attempt to `rpserver` timed out on 2026-10-04; current available RAM/CPU/disk, 64-bit OS, running workloads and backup freshness are unverified. Do not treat connection timeout as proof the Pi is powered off. No remote changes or repeated probes were made.
- **Architecture evidence:** read-only official registry manifests on 2026-10-04 confirm `metabase/metabase:v0.63.18.2` native linux/arm64 digest `sha256:21a98ee8705f22d0141b1719f1062670b932f3375ffc49f7018de6920a19a0df` and `postgres:17.6` linux/arm64/v8 digest `sha256:ac74e8c63c516b1f81fbaaede0663981399f80e42369431136b2455557f8547b`. No emulation/JAR workaround is needed on a verified 64-bit Pi OS. Existing configured 1,920 MiB caps are an initial budget, not measured Pi usage or acceptance evidence.
- **Storage and recovery:** a USB SSD is preferred for PostgreSQL/image writes; first inspect existing media and free space rather than assuming a purchase is necessary. Shared-root usage must leave backup retention/safety floors intact. Restrict memory/CPU/log/disk growth; prove a dashboard query/restart cannot disrupt backup pulling. If the Pi or home connection fails, dashboard freshness expires while app collection continues independently on Hetzner; current 30-day raw retention bounds catch-up. Source export timing must avoid the Production backup freeze and reconcile erasure on recovery.

**Next exact action:** when the Pi is reachable, inspect actual memory/CPU/storage/OS and backup health, then prepare and verify a separate bounded private analytics deployment candidate. No VM resize, Pi deployment/service change, credential transfer or ingress configuration is included in this assessment.

## Optional future hosted deployment prerequisites

These apply only if Adam later selects a hosted dashboard. The current destination is this Mac; no public hostname is required. An optional future destination is a private `developer.phiskel.com` service, independent of the marketing website and app backend. There is no public-site SDK or dashboard route exposing service credentials.

- Obtain the founder's explicit administrator/Access email. Do not guess from Git metadata or install a public setup wizard.
- The selected topology keeps Metabase/reporting PostgreSQL on the Mac. Adam deferred the 8 GB Hetzner upgrade until revenue and excluded the Pi from analytics. Reconsider capacity only if a future hosting change is requested; no resize or optional-service change is included.
- Keep the port bound to loopback. Configure a separate Cloudflare Tunnel hostname to port3033 **only after** a founder-only Access policy with MFA has been verified. Keep Metabase login as a second layer. Verify anonymous access, a different account, direct origin, Metabase queries and public-sharing/embedding denial.
- Create fresh hosted credentials independently of the synthetic local test. Preserve PostgreSQL data and Metabase encryption secret in the existing encrypted recovery process. Check backup/service dependencies before adding a job; do not stop or modify existing app services, storage, networks or cloudflared during dashboard installation.
- Provision only the aggregate warehouse connection and founder dashboard. No raw Supabase connection, client service-role key, public embed, query caching, scheduled email or provider AI connection.
- Add a protected host-local 15-minute refresh timer, executing the fixed collector separately for Dev/Production. Capture only sanitized success/failure metadata, monitor failed refreshes, and verify effective source isolation. The collector uses the fixed `mizyun-hetzner-ops` alias, unique host marker and exact loopback database port/container checks. It has no arbitrary SSH/SQL selector.
- Apply the hourly analytics retention worker to a verified Dev API candidate and accept native telemetry on both platforms before extending its release. Production app promotion remains a separate explicit accepted-SHA milestone.

The implementation does not create DNS/Access policies, remote credentials, a refresh timer, store credentials or a Production release. These are explicitly open acceptance actions under #186.

## Capture and imports

After the real-data Mac target, source targets and operator access have been verified, the collector rebuilds the full 30-day aggregate snapshot:

```bash
pnpm analytics:dashboard:refresh --env dev
pnpm analytics:dashboard:refresh --env prod
```

`--json` returns only validated aggregates; the default imports them into the dedicated warehouse using its writer. The generic collector now accepts only live Dev/Production or normalized official store imports; synthetic snapshots use the dedicated demo launcher, which refuses real data. Failed reads/imports leave the previous generation untouched and eventually hide its metrics after two hours. Console errors never echo source payloads, SSH/SQL diagnostics or credentials.

Store imports intentionally start with a normalized aggregate-only JSON boundary. A normalized row is:

```json
{
  "platform": "ios",
  "day": "2026-10-01",
  "metric": "first_time_downloads",
  "value": 12,
  "source": "apple_app_store_connect"
}
```

This is an example format, not a measured count. Import an array with `pnpm analytics:dashboard:refresh --store <normalized-report.json>`. Reimporting the same platform/day/metric replaces it rather than double-counting. Unexpected fields, source/platform mismatches, negatives, invalid/future dates, ambiguous `downloads` and duplicate normalized rows fail before any import.

Apple metrics: `first_time_downloads`, `redownloads`. Google: `user_acquisitions`, `device_installs`, `listing_visitors`, `install_clicks`. Preserve the official report calendar date, documented timezone and reporting period during normalization; app UTC dates and store calendar dates must not be presented as a linked conversion funnel. Reports may be delayed or privacy-suppressed. Missing imported rows are unavailable, never automatically zero. Automatic API/bucket retrieval and real report-format adapters remain a separate store credential/report acceptance step.

## Scoped journeys and export compatibility

Random flow IDs are owned by a consent epoch and account lifecycle. A denied start stays unobserved; regranting does not attach an old attempt to new consent. Async callbacks capture the initiating attempt. UI cleanup is not an exit; only an unprevented route-removal action or explicit acknowledged discard contributes an exit. Meal AI drafts do not create completion/record events until Save. Workout journeys describe logging-screen visits, with minimize recording navigation exit while the durable workout remains resumable.

Matched counts are grouped by retained start day and require the same source account/flow ID/kind. The earliest terminal event wins; repeated starts/completions are deduplicated. Failures may recover. Completed + explicit exits + unknown outcomes equals scoped starts; unknown includes unfinished, terminated or lost events. Unscoped legacy events and starts outside retention are excluded. Onboarding begins only after current consent is granted, records actual static steps, and completes after all authoritative writes succeed.

`GET /v1/analytics/events` and `/v1/account/export` default to the frozen legacy event/step catalog. Current native clients explicitly request `?catalog=dashboard-v1`. Strict queries reject unknown/duplicate flags. Full owner export now includes repository analytics that the previous wire adapter omitted; legacy filtering marks the manifest partial, adjusts emitted counts and reports omitted events. Current exports retain the complete supported catalog. This changes no health record shapes or source identity authority.

## Privacy lifecycle and recovery

Only granted current-consent-version/current-epoch events inside the retained window enter the source query. Unknown dimensions are filtered in SQL and rejected again at the warehouse boundary. Whole-window replacement removes withdrawn/cleared/deleted contributions after refresh. The reader connection cannot access raw staging tables, change any reporting table or connect to Metabase's metadata database; Metabase has no source database credentials.

The two-hour expiry bounds stale **reader-view** visibility when collection fails; it is not synchronous deletion of already downloaded/exported results or old aggregate backups. Disable query caching and emailed subscriptions. Treat operator exports as controlled company records with a retention owner; an export cannot be silently recalled. Do not re-identify aggregate reports by combining them with private app/support datasets.

On restore: keep dashboard ingress and refresh jobs closed; restore encrypted metadata and credentials; reapply/verify database and collection permission graphs and disabled public links/caching/AI; discard old app snapshot rows; rebuild from current source consent/epoch/erasure state; verify freshness/access before opening ingress. Backups do not prove revocation reconciliation. Never restore raw source events into this warehouse.

## Verification and remaining work

Fresh detailed outcomes will be recorded in [status](../status.md) and #186. Required checks: snapshot/provisioner unit tests, contract/API/mobile suites, isolated PostgreSQL and real Metabase API integration, independent non-author lifecycle/authorization review, fresh `pnpm check`, and exact installed Dev telemetry acceptance. Keep pre-existing dirty work separate.

Remaining breadth: instrument missing feature outcomes and measured Community paths; define automatic recurring-meal activity separately; build least-privilege store report adapters and immutable business/paid metrics where authorized. Historical clicks/searches cannot be reconstructed from records that never captured them. Broader event categories require closed schemas, catalog review and applicable disclosure/consent lifecycle checks.
