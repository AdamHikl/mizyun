# Product analytics backend: review, implementation plan, and operator guide

> **Status: proposed; documentation only.** Requested by the founder on 2026-09-12, narrowed to a future-session implementation plan on 2026-09-13. Work package **OBS-002**, supporting OBS-01, PRIV-01, and product outcomes O1–O5. Nothing in this document is deployed or implemented by this session.
>
> Review baseline: source HEAD `16a1e86`, plus the existing dirty working tree inspected on 2026-09-12/13. Deployment state was not inspected. A helper performed a read-only analytics audit; implementation helpers subsequently stopped at the account usage limit. The coordinator verified the source findings. No independent review of a completed implementation exists.

## 1. Intended result and scope

Give the founder and authorized coding agents a practical way to answer:

- Which features attract the most people, and which receive repeated use?
- Which screens do people visit, and which navigation paths are common?
- Where do meal, workout, and measurement logging fail, take effort, or get left unfinished?
- Do consenting users return, complete setup, and create useful records?
- Does a new app build improve completion, latency buckets, and recoverable failure rates?

Collection must occur **only after the current optional product-analytics consent is enabled**, through onboarding or Account. Turning it off must stop local capture immediately and revoke backend ingestion when the server receives the change. Normal app use must not depend on analytics availability.

Build on the existing first-party API and Supabase/PostgreSQL infrastructure. A bounded event store, small batch uploader, aggregate CLI, and documented JSON output are sufficient. No dashboard, third-party analytics SDK, session replay, screen recording, touch-coordinate heatmap, keystroke logger, or raw request/body collector is needed.

“Testing capture” means synthetic event fixtures and scripted acceptance journeys using the same ingestion boundary. It does not authorize collecting production user content for tests, model training, or replay.

## 2. Review of the current implementation

The following are source observations, not device reproductions or deployed findings.

| Finding                                                   | Evidence                                                                                                                             | Consequence and required action                                                                                                                 |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing collection is local-only                         | `apps/mobile/src/composition/analytics-client.ts`; ADR-0014                                                                          | There is no central dataset today. Introduce a new consent version and a superseding ADR before automatic upload.                               |
| Existing copy promises local storage and voluntary export | Onboarding `AnalyticsConsentPrompt`; Settings `AnalyticsCard`; `docs/OBSERVABILITY.md`                                               | A legacy local `granted` value cannot authorize backend transfer. Never backfill old local events.                                              |
| Useful primitives already exist                           | `packages/observability/src/index.ts`                                                                                                | Reuse the closed union, failure classifications, duration/tap/retry buckets, and non-throwing interface; extend them deliberately.              |
| Workout-history events fail parsing                       | `FeatureName` and workouts hub include `workout_history`; `isAnalyticsEvent` feature branch omits it                                 | Events are discarded when read from storage. Add a regression covering every declared feature through persistence and parsing.                  |
| Retention is incomplete on reads                          | `local-analytics-storage.ts`: pruning in `append`, not age filtering in `list`                                                       | An idle installation can export events older than 30 days. Enforce retention on read, upload, and export, not only append.                      |
| Account lifecycle is not a sufficient network boundary    | Settings sign-out invokes denial; `auth-context.tsx` has central sign-out/subscription; the analytics bridge is above `AuthProvider` | Network analytics needs central identity binding covering sign-out, expiration, account deletion, preview mode, and switching accounts.         |
| Foreground does not equal a meaningful session            | `_layout.tsx` emits session start on every non-active → active change                                                                | Permission dialogs and short interruptions can inflate sessions. Adopt an explicit inactivity boundary.                                         |
| Navigation and feature coverage are incomplete            | Six feature names; no general route observer                                                                                         | Add an allowlisted screen vocabulary including coach, feedback, logging, energy setup, and edit flows. Never send paths or route parameters.    |
| Logging counts cannot identify complete attempts          | `LoggingFlowMeasurement` has no attempt identifier or explicit unfinished exit                                                       | Completed/started is only a proxy today. Add random flow IDs and terminal outcome semantics before calling this a funnel or abandonment rate.   |
| Activation summary ignores ordering                       | `summarizeAlphaAnalytics` checks existence of onboarding and a core record independently                                             | A record created before onboarding completion can count as activation. Require ordered events and a stated observation window.                  |
| Return-day summary is not cohort retention                | `summarizeAlphaAnalytics` counts days with session events inside each export                                                         | It cannot distinguish a new, incomplete cohort from churn. Define eligible D1/D7 denominators and report missing observation.                   |
| Timestamp validation is permissive                        | `isAnalyticsEvent` uses `Date.parse`, without an exact UTC format or bounded clock skew                                              | Add strict schema-versioned transport validation; reject arbitrary timestamp strings, future events, expired queue data, and unbounded strings. |
| Current analysis requires participant exports             | `scripts/analyze-alpha-exports.ts`, `pnpm alpha:analyze`                                                                             | Keep this legacy tool available; add a separate backend report command. Do not reinterpret its outputs as central user metrics.                 |

Current strengths worth preserving: explicit opt-in, a closed event vocabulary, bounded local storage, coarse measurements, no raw exception capture, and fire-and-forget instrumentation at core call sites.

### Files to inspect at implementation startup

Read root/nested AGENTS, current `status.md`, `docs/START_HERE.md`, `docs/SESSION_GUIDE.md`, and `pnpm context analytics-observability`. Preserve all existing changes. Read the newest status only as the active handoff.

Then inspect:

- `packages/observability/src/index.ts` and tests; `docs/OBSERVABILITY.md`; ADR-0014.
- `apps/mobile/src/features/analytics/`, `composition/analytics-client.ts`, `composition/api-client.ts`, and the API client transport's token acquisition behavior.
- `apps/mobile/src/features/auth/auth-context.tsx`, `app/_layout.tsx`, onboarding, Settings, and instrumented logging screens.
- `apps/api/src/app.ts`, authentication plugin, error envelopes, logging serializers, and account routes.
- Supabase repository client interfaces, account export/deletion adapters, current migration conventions, and pgTAP tests.
- `scripts/check-beta-pro-requests.mjs` for established SSH/container targeting and stdin-based SQL transport; reuse only read-only reporting patterns, not its mutation or user-identifying output.
- Privacy policy, served legal content, store disclosures, quality gates, and current environment topology.

## 3. Proposed architecture and ownership

```text
Authenticated mobile app
  → current analytics consent + identity-bound bounded queue
  → authenticated /v1/analytics batch endpoint
  → closed contract validation and verified-principal ownership
  → transactional repository operation
  → isolated Dev or Production PostgreSQL tables

Founder/authorized agent CLI
  → Tailscale SSH to the selected environment
  → fixed, read-only aggregate SQL
  → human tables or versioned aggregate JSON
```

Recommended first version: internally account-linked events, because unique users, cross-session return use, export, and deletion require an ownership link. The account ID comes exclusively from verified authentication and is never accepted in event properties. Reports expose aggregates, not account identifiers. This is **not anonymous collection**; explain the link in consent copy and disclosures.

A separate analytics subject mapping would still be re-identifiable and would add lifecycle complexity. Defer it unless the privacy review finds a concrete need. Do not hash emails or introduce device fingerprints.

| Layer                                  | Responsibility / likely files                                                                                                                                                                               |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/observability`               | Provider-neutral event types, measurement helpers, consent/queue/repository ports, and pure aggregation helpers. No database or native imports.                                                             |
| `packages/contracts`                   | Strict versioned ingestion, consent, acknowledgment, and export schemas, with exact extra-property rejection. Decide one source of truth for event validation; avoid parallel TS/SQL vocabularies drifting. |
| Supabase server adapter                | Transactions/RPC calls, retention and ownership persistence; public exports from adapter index.                                                                                                             |
| `apps/api`                             | Authenticated routes, request/body/rate bounds, stable safe errors, composition, cleanup integration.                                                                                                       |
| Mobile analytics feature + composition | Native queue/consent adapter, uploader lifecycle, account binding, route normalization, platform/build context.                                                                                             |
| `scripts/product-analytics.mjs`        | Aggregate reports with `--help`, explicit environment selection, JSON schema version, safe timeouts, fixture tests.                                                                                         |
| Documentation                          | Superseding ADR, event catalog, CLI runbook, research log, disclosures, feature map, status/backlog.                                                                                                        |

A new dependency edge must pass repository architecture checks. Prefer contracts as the public network schema source rather than importing mobile/internal module files. Update lockfile and workspace dependencies normally; do not manually patch installed package links.

## 4. Consent and account lifecycle design

### 4.1 Consent version and state

Use a new purpose/version, for example `product-analytics-v2`. Leave the historical ADR and local v1 export format identifiable. No automatic conversion of the local v1 preference and no migration of v1 event files into the network queue.

Server state should contain account ownership, consent version, granted flag, monotonic revision, random collection epoch, and timestamps. Queue entries bind to the exact account, environment, consent version, and epoch under which collection happened. Auth tokens are transport credentials, not persisted queue fields.

A consent mutation uses an idempotency key and expected revision. Grant is **only** an explicit user action. An uploader must never silently PUT `granted=true` in response to a conflict, expired epoch, restart, or GET failure. Revocation and ingestion serialize on the same database row/lock; revocation rotates the epoch and deletes retained behavioral events in the same transaction.

Use revision conflict handling to prevent a delayed grant from restoring access after a newer opt-out. On a conflict, stop collecting, discard stale queued events, fetch current consent, and show the current state. A fresh explicit grant may then be submitted against the latest revision.

### 4.2 Required behavior by situation

| Situation                                                 | Required behavior                                                                                                                                                                                                 |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unknown, denied, legacy local consent, or preview account | No new analytics event collection or upload. No pre-consent queue.                                                                                                                                                |
| Enable during authenticated onboarding or Account         | Explain server transfer first; persist the current server choice, then activate capture. Emit an optional current screen/session observation only after success, without replaying earlier activity.              |
| Enable while offline                                      | Keep collection off and show that enabling could not be completed. Normal onboarding continues.                                                                                                                   |
| Disable while online                                      | Synchronously stop new local capture; durably mark pending denial and clear queue; send revocation; mark server completion only after acknowledgment.                                                             |
| Disable while offline / response lost                     | Keep capture off across restart; retry the account-bound denial on reconnection. Show “Off on this device; server removal pending.” Do not claim global completion before the server receives it.                 |
| Another device remains online                             | Server rejects old epochs after revocation commits. The offline device cannot instantly inform the server; this limitation must be explicit.                                                                      |
| Sign-out, expiry, switching account, deletion             | Cancel upload work, clear queued events and session/flow identifiers at the central identity boundary. Never attach old events to a new token/account. Sign-out must not wait indefinitely for network analytics. |
| Pending denial followed by sign-out                       | Preserve only the minimum account-bound revocation intent; retry only with authentication for that same account. Never reuse stored credentials or send that revocation as another user.                          |
| Sign-in on another installation                           | Read current versioned account consent before collecting. Valid server consent can represent the account-level choice; a legacy local grant alone cannot.                                                         |
| Consent read fails                                        | Suspend capture/upload; do not infer granted from stale cached state after a new identity/session boundary.                                                                                                       |
| Clear events while retaining consent                      | Stop/clear queue, transactionally delete server events and rotate collection epoch; adopt the acknowledged new epoch. This prevents an in-flight old batch from restoring cleared data.                           |
| Export                                                    | Include retained events and current consent metadata in account export, with truthful manifest counts and pagination. Optional analytics export uses the same source.                                             |
| Account deletion                                          | Delete events and consent with account removal; verify the existing asynchronous deletion worker actually reaches the FK cascade. Block new capture once deletion is pending.                                     |

Consent is independent from AI consent and Auth email verification. Do not change either of those systems as part of OBS-002.

### 4.3 Proposed user-facing text

> Help improve Mizyun by sharing which features and screens you use, whether actions succeed, and coarse time and effort ranges. These optional events are sent to Mizyun’s servers and linked to your account for usage analysis, export, and deletion. They do not include food text, health measurements, photos, messages, or typed content. Retained events cover up to 30 days. You can turn this off and request removal in Account. Core features work the same either way.

Finalize retention wording after the cleanup SLA is implemented: immediate exclusion after expiry and deletion on the next hourly cleanup is different from an exact physical deletion deadline. Offline denial must have its own pending state text. Avoid “anonymous,” “local-only,” and blanket “no identifiers” claims for the new design.

## 5. Event design and instrumentation

### 5.1 Envelope

Propose a network event schema version 2. All fields are bounded and validated independently on the server:

| Field                  | Purpose / restriction                                                                                                                           |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                   | Random UUID generated once at capture; unchanged across retries; account-scoped uniqueness.                                                     |
| `schemaVersion`        | Literal supported version.                                                                                                                      |
| `recordedAt`           | Strict canonical UTC timestamp, accepted only within queue retention and bounded clock skew.                                                    |
| `sessionId`            | Random, analytics-only UUID after consent; rotates on cold start, account/epoch change, and 30 minutes of inactivity. Never an Auth session ID. |
| `sequence`             | Bounded integer increasing within a session; deterministically orders same-timestamp events and exposes gaps.                                   |
| `flowId`               | Optional random UUID for a supported attempt, required only for flow events; never a meal/workout/database ID.                                  |
| `name` / `properties`  | Closed discriminated union, exact keys, enums and coarse buckets.                                                                               |
| `platform`             | `ios` or `android`; synthetic fixtures identified separately.                                                                                   |
| `appVersion` / `build` | Bounded validated release metadata; no hardware model, locale, timezone, IP, or device identifier in the initial scope.                         |

Batch-level consent version/epoch is mandatory. Server derives account/environment and adds `receivedAt`; client-supplied environment cannot authorize or redirect collection. Client clocks and offline delivery are untrusted; reports expose delay/coverage limitations.

### 5.2 Initial catalog

| Event                       | Allowed properties                                                                      | Capture boundary                                                                                                                 |
| --------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `app_session_started`       | `entryPoint`: cold start / foreground                                                   | Auth and consent resolved, then genuine session boundary; not every permission dialog return.                                    |
| `screen_viewed`             | `screen`: closed enum                                                                   | Resolved visible screen gains focus; duplicate rerenders do not count.                                                           |
| `onboarding_started`        | No arbitrary properties                                                                 | Current onboarding begins after consent. Mid-onboarding opt-in means earlier steps are unobserved.                               |
| `onboarding_step_completed` | Fixed step enum                                                                         | Step successfully completes, without values entered.                                                                             |
| `onboarding_completed`      | Duration/tap buckets                                                                    | All authoritative setup writes succeed.                                                                                          |
| `logging_flow_started`      | `flow`: meal / workout / body measurement; `mode`: supported enum                       | New attempt begins; bind flow ID.                                                                                                |
| `logging_flow_completed`    | Flow, duration/tap/retry buckets                                                        | Authoritative save succeeds once.                                                                                                |
| `logging_flow_failed`       | Flow, stage, reason, retryability, retry bucket                                         | Actual failed boundary; error classifier receives raw error locally but emits only the enum.                                     |
| `logging_flow_exited`       | Flow, duration bucket; exit: cancel / navigate away                                     | Observed exit without completion; do not infer this from app process disappearance.                                              |
| `core_record_created`       | Record kind                                                                             | Confirmed creation associated with its flow; deduplicate analytics retry.                                                        |
| `feature_action_result`     | Fixed action enum, outcome success / failure, optional fixed reason and duration bucket | Coach request, feedback submission, draft generation, or photo operation finishes. Add each action only with a tested call site. |

Existing `feature_viewed` can remain readable for v1 exports. Use `screen_viewed` as the canonical v2 view count so central tracking and legacy focus instrumentation do not double count views.

Initial screen vocabulary: dashboard, nutrition history, workout history, body history, progress photos, settings, coach, feedback, onboarding, log meal, log workout, log body measurement, energy setup, meal detail/edit. Map static route names, not query values. Unknown/auth callback routes produce no event. Account cards that do not navigate require an explicit fixed action if their usage needs measurement.

For feature actions, start with coach message request, meal text draft, meal photo draft, draft confirm, draft discard, feedback submit, progress-photo upload/delete, and energy setup save. Never record prompt length/content, macro changes, exercise names, typed text, media IDs, or URLs. Draft correction can later be a boolean user-edited marker; nutrition deltas are outside this scope.

### 5.3 Timing and partial observations

Preserve existing coarse bucket definitions. Audit whether “logging time” includes background time, workout execution/rest time, or only data-entry effort. Do not compare a workout-session duration with meal entry effort as if they measure the same task. Document the chosen clock for each flow; prefer active-screen time where practical.

A process killed during a flow yields an **unknown outcome**, not proven abandonment. Multiple failures can occur within one flow that later succeeds. Deduplicate terminal completion; do not suppress legitimate distinct failed attempts. Navigating temporarily away from a resumable workout is not necessarily cancelling it.

## 6. Backend persistence, limits, and delivery

### Tables and access

Proposed tables: `product_analytics_consents` and `product_analytics_events`.

- Consent: `user_id` PK/FK to Auth user, version, granted flag, revision, epoch, grant/revoke/update timestamps, and bounded consent-mutation idempotency metadata.
- Events: `user_id`, event ID, consent epoch/version, validated payload or equivalent typed columns, server receipt timestamp. Unique `(user_id, id)` and indexes led by ownership plus receipt/session ordering as required by actual queries.
- Enable RLS on every user-owned table. Authenticated users may read their own retained records; no direct client table writes or cross-owner access. Account foreign keys cascade deletion.
- Use a service-only transactional RPC invoked by the verified API composition, or an equally reviewed authenticated RPC with all validation inside it. Recommended first version: service-only RPC, with schema validation in API and no PUBLIC/anon/authenticated execute grants. Service credentials remain server-only.
- Fix SECURITY DEFINER search paths, schema-qualify referenced objects, and explicitly revoke default execute permissions. Never accept an arbitrary user ID through a public request body.
- Include both ingestion and revocation in the same lock discipline. Check current consent and epoch inside the transaction, not in a prior network read.
- Same event ID and identical body is an idempotent retry; same ID with different body is a conflict. Do not silently overwrite or count twice. Validate the full batch before insertion, with all-or-nothing acceptance.

### Proposed API contract

| Endpoint                         | Behavior                                                                                                         |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `GET /v1/analytics/consent`      | Authenticated own current version, granted flag, revision, epoch; missing consent means off.                     |
| `PUT /v1/analytics/consent`      | Explicit versioned choice with expected revision and operation ID; returns authoritative state.                  |
| `POST /v1/analytics/events`      | Bounded epoch-bound batch; accepted IDs or deterministic all-or-nothing acknowledgment.                          |
| `DELETE /v1/analytics/events`    | Authenticated clear with expected revision/idempotency; atomically rotate epoch, clear events, return new state. |
| `GET /v1/analytics/events`       | Bounded own-data export with stable cursor if pagination is needed.                                              |
| Existing account export/deletion | Include analytics records/consent/counts; erase through verified lifecycle.                                      |

Use existing stable error envelopes and request IDs. Distinguish invalid schema (422), auth failure (401), stale consent/epoch (409), quota (429 with retry guidance), and unavailable persistence (503). Respect route body limits; oversized/malformed JSON errors must also use the standard envelope. Never echo invalid property values or database error text.

### Conservative initial bounds

These are implementation defaults to confirm under synthetic load, not measured production requirements:

- 50 events and 32 KiB per batch; bounded individual fields and event size.
- 500 queued events per account/environment, up to 72 hours; never queue before consent. Evict oldest on capacity and describe missing coverage, rather than blocking app use.
- Flush after a small threshold or approximately 30 seconds while active, plus foreground/reconnect. No native background job is required initially; background flush is opportunistic only.
- Exponential retry with jitter, a capped interval, and one in-flight uploader per account. Honor 429/Retry-After. Do not retry invalid payloads forever.
- Persist event IDs before transmission. Remove only acknowledged IDs; a lost response must not duplicate counts. Serialize queue mutation and acknowledgment against account/consent changes.
- Proposed server ceiling: 10,000 retained events per account, with a separate short-window request/event limiter. Return an explicit quota result; never silently claim completeness. Tune after synthetic load and pilot evidence.
- Exclude events older than 30 days from every report/export/read immediately. An hourly server-side cleanup deletes expired rows even for inactive accounts; prove reboot recovery and capture last-success evidence. Do not rely exclusively on new event ingestion for cleanup.

For the pilot, implement retention with a tested Pi systemd timer or an established always-on backend job with startup catch-up. Verify the actual scheduler available; do not assume managed Supabase scheduling exists on this self-hosted stack. Cleanup failure should be operationally visible without logging user data.

Backups can retain deleted rows until backup expiry. Document existing backup retention and make restore procedures reapply deletion/consent controls before analytics becomes available. Do not promise historical backup erasure from a live-table DELETE.

## 7. Metric definitions and interpretation

All user denominators refer to **observed consenting accounts**, not all Mizyun users. An account is not guaranteed to represent one person. Reports must display time range, environment, schema/build filters, observed sample sizes, and collection limits.

| Report                     | Definition                                                                                                          | Limitation                                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Feature popularity         | Views, distinct accounts, sessions, and views per viewing account by screen/action                                  | Show unique users beside counts so one heavy tester cannot dominate unnoticed.                                                            |
| Navigation                 | Adjacent `screen_viewed` events ordered by sequence within account + epoch + session                                | Never join across sessions/devices/epochs or across known sequence gaps. A transition shows observed navigation, not intent.              |
| Active users               | Distinct accounts with supported activity within each UTC day / trailing 7 days / trailing 30 days                  | Counts are consenting-account activity; session starts alone can be reported separately from meaningful actions.                          |
| Flow outcomes              | Distinct flow IDs started, completed, explicitly exited, with failures, and unresolved                              | Completion/started is not a failure or abandonment rate. Failure events are not unique failed users.                                      |
| Friction                   | Duration/tap/retry bucket distributions by flow/mode and outcome; failure stage/reason counts and affected accounts | Report a median bucket, never invent exact seconds from buckets.                                                                          |
| Activation                 | Observed onboarding completion followed by a core record within 24 hours                                            | Only accounts with observed onboarding and a fully matured window enter the rate denominator. Late opt-in is unobserved, not unactivated. |
| D1 / D7 return             | Activity on UTC day 1 / day 7 after first observed activity in an epoch                                             | Use only matured cohorts. Label as first-observed retention, not signup retention; raw 30-day retention limits reconstruction.            |
| Return frequency           | Distribution of distinct active days within the requested interval                                                  | Useful even before mature cohort sizes; not equivalent to retention.                                                                      |
| Feature action reliability | Success/failure outcomes and affected users for each instrumented action                                            | No crash-free-session claim; JS process death/native crashes are not fully observed.                                                      |
| Build comparison           | Same definitions by app version/build/platform, with sample sizes and windows                                       | Observational comparisons are not causal A/B results; changing instrumentation must be disclosed.                                         |

Zero denominators produce `null`/“insufficient data,” not 0% or 100%. Filter by event time in UTC, with server receipt metadata for delivery lag and retention enforcement. Exact duplicate events do not affect totals. Late deliveries can revise historical reports; include `generatedAt` and the window boundaries.

Do not use profile goals, health values, billing, emails, AI logs, or feedback text to enrich these reports. Four-/twelve-week business retention cannot be measured from a 30-day raw store; defer longer retention or privacy-reviewed aggregate cohorts to a later decision.

Small groups can still be recognizable to the founder even without IDs. Restrict reports to trusted operators, avoid raw per-user drill-down, and do not publish pilot aggregates as anonymous public datasets. Apply a minimum group size if sharing beyond that boundary.

## 8. Proposed command-line guide

**The following commands are specifications for the later implementation. They do not exist yet.** The existing local-export command `pnpm alpha:analyze` remains separate.

```bash
# Start with explicit Dev scope; --help must never connect to a server.
pnpm analytics --help
pnpm analytics summary --env dev --days 7
pnpm analytics features --env dev --days 7
pnpm analytics navigation --env dev --days 7
pnpm analytics flows --env dev --days 7
pnpm analytics retention --env dev --days 30

# Machine-readable output for an authorized agent.
pnpm analytics summary --env dev --days 7 --json

# Query both environments separately; never blend their users or totals.
pnpm analytics summary --env both --days 7 --json

# Explicit production analysis once the feature is released there.
pnpm analytics features --env prod --days 14 --platform ios --json

# Synthetic local report verification, without network access.
pnpm analytics summary --fixture ./synthetic-analytics.json --days 7 --json
```

Define `--days` as an integer 1–30; default 7. Define default environment as Dev; require explicit `prod` or `both`. Support only documented report/platform/build filters, bounded result rows, and `--limit` with a small maximum if needed. Reject unknown/missing arguments before SSH. No arbitrary SQL, hostname, table, user selector, email search, or shell expression flag in the initial CLI.

### Access mechanism

Use the established `rpserver` Tailscale SSH identity and an explicit allowlisted mapping to Dev/Production database targets. Reverify actual service/container names before implementation; the current scripts are reference patterns, not proof of effective target isolation.

Prefer a dedicated reporting database role limited to vetted aggregate functions/views. If initial founder operation temporarily uses the existing privileged local psql transport, document that SSH grants broader power than the CLI and keep SQL fixed, aggregated, and enclosed in `BEGIN READ ONLY`. A read-only transaction is defense in depth, not a replacement for database privileges.

Pass SQL through process stdin, use a fixed executable and argument array, set connection and statement timeouts, disable shell interpolation, and bound output bytes. Do not print child stderr verbatim if it may contain credentials or SQL values. Never load service-role keys into CLI output, report JSON, task prompts, or mobile code.

For `both`, collect independent results and structured sanitized errors. One failed environment must not masquerade as a zero-event dataset. Exit codes: 0 complete success (including genuine empty data), 1 execution/partial failure, 2 invalid arguments. stdout is valid JSON only in JSON mode; human diagnostics go to stderr.

### JSON shape and operator workflow

Proposed top-level keys: `schemaVersion`, `generatedAt`, `window` (`from`, `to`, `timezone: UTC`), `filters`, `environments`, and `warnings`. Each environment result carries its own name, status, observed account/event/session counts, report rows, and coverage warnings. IDs, emails, raw rows, paths, tokens, and event timestamps per user must be absent.

Start each review with summary/sample size, then feature reach, then high-frequency failure stages and high-effort flows. Inspect navigation only with its session/gap warnings. Convert patterns into hypotheses: “photo upload failure affects multiple consenting users” is actionable; “users dislike photos” is not established by that fact. Validate a suspected issue with a synthetic/device reproduction and voluntary feedback through existing channels.

An authorized agent should use the documented command and aggregate JSON, cite the environment/window/build/sample in its findings, and keep any saved report in an ignored operator output directory. Never automatically send reports or feedback messages to other people. Never join aggregates to user identity lists to infer individuals.

## 9. Implementation stages and acceptance

Each stage is a coherent future work package. The coordinating agent owns continuity files and any commit/deployment. Delegate a disjoint test investigation or independent review while doing useful local work. Do not create separate user-visible tasks unless requested.

### Stage A — decisions, regression baseline, and contracts

1. Reinspect dirty tree, package versions, relevant current docs and feature context.
2. Write a proposed/superseding ADR for server collection, account linkage, versioned consent, session/flow identifiers, limits, retention and operator access. Update the event catalog and planned disclosure wording together.
3. Demonstrate parser/retention/order defects with synthetic regressions, then fix them with the new contract work.
4. Define strict schemas and ports, shared event vocabulary, stable error/acknowledgment semantics, and metric fixtures. Keep old local exports parseable.

**Exit:** every event/property has a documented purpose and privacy boundary; legacy opt-in cannot become backend consent; schema tests reject unknown/sensitive fields and invalid time/size inputs; pure-package boundaries pass.

### Stage B — database and backend capture

1. Add forward migrations with ownership FKs/indexes/RLS, explicit RPC ACLs, consent revision/epoch changes, deduplication, and limits.
2. Implement repository and authenticated routes using verified ownership. Disabled/unavailable persistence must be honest and must not fall back to a fake successful production in-memory store.
3. Integrate account export/deletion and an actual retention job. Keep manifest counts and pagination truthful.
4. Add real disposable-database isolation, concurrency, retry, and lifecycle tests; independent non-author review is mandatory.

**Exit:** no collection without current consent, no stale writes after revoke/clear, no cross-user or direct-client write bypass, no duplicate count after lost response, and proven cleanup/export/deletion behavior locally. Tests using an in-memory adapter alone do not meet this exit.

### Stage C — mobile consent, queue, navigation, and event coverage

1. Implement new consent UI/persistence, pending offline denial, account-bound queue, cancellation, acknowledgment, and bounded retry behavior with injected test ports.
2. Bind uploader to the central Auth lifecycle and settled consent; handle preview, expired session, sign-out, account deletion, and account switching.
3. Add one normalized route observer, real session/flow identifiers, and the event catalog's scoped feature outcomes. Avoid duplicate view instrumentation.
4. Update Settings export/clear status and all local-only copy; keep core saves/navigation independent from analytics success.

**Exit:** tested unknown/legacy/denied/offline/account-switch behavior; queued events never change owner; no raw route/error payloads; clear and revoke survive lost responses/restarts; iOS/Android bundles pass. Device acceptance remains separate.

### Stage D — CLI and report validation

1. Implement aggregate SQL and the documented command grammar with strict allowlists and JSON output.
2. Use synthetic two-/multi-user sessions with known sequences, retries, missing events, late events, time boundaries, and immature cohorts.
3. Verify SQL output against hand-computed expected totals, including database execution on the local disposable target. Exercise environment outage, invalid args, output limits, and shell-injection strings.
4. Add command/help/runbook links to the feature map and an agent-usable reference. A custom skill is optional; a precise runbook is sufficient.

**Exit:** trusted human/agent can retrieve correct non-identifying aggregates using one command; no raw row fallback; insufficient data and partial failure are explicit; report tests actually exercise SQL semantics.

### Stage E — integration, evidence, and Dev acceptance

1. Format only the changed files, inspect the full integrated diff, run required checks after helper writes settle, and resolve independent security-review findings.
2. Record local evidence, exact source SHA, migration IDs, skipped/gated suites and reasons. Keep pre-existing work distinct in the handoff.
3. In the implementation session, deploy only a verified candidate through the current authorized Dev workflow after `pnpm check`; inspect Tailscale, target isolation and clean Pi checkout first.
4. Test installed Dev app on iOS and Android: denial, grant in both entry points, navigation, successful/failed logging, offline queue, lost response, revoke, clear, restart, account switch, export, deletion.
5. Run the Dev CLI and compare aggregates with the scripted consenting test journeys. Prove non-consenting test accounts contribute zero event rows.

**Exit:** separately recorded implemented, automatically verified, Dev deployed, and device accepted evidence. Production promotion is a separate explicit milestone. This plan does not authorize builds, remote configuration changes, deployment, or release in the documentation session.

## 10. Required failure-oriented test matrix

| Boundary        | Cases and expected evidence                                                                                                                                                                         |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Consent         | Unknown/denied/legacy never captures; offline grant stays off; pending denial persists; consent-version mismatch rejected.                                                                          |
| Races           | Ingest concurrent with revoke/clear; delayed grant after newer revoke; two devices; duplicate consent mutation after lost response. Assert final rows and state, not just HTTP status.              |
| Auth            | Missing/expired token; user B reading/writing A; forged body user ID; preview; switching while batch request is awaiting a response.                                                                |
| SQL access      | RLS SELECT/INSERT/UPDATE/DELETE, table grants, RPC execute ACLs, service-only paths, ownership FKs, indexed queries.                                                                                |
| Delivery        | Lost response after commit; restart before acknowledgment; duplicate ID with altered body; partial invalid batch; queue overflow; timeout; 429 backoff; invalid event is not retried forever.       |
| Payload privacy | Extra keys, raw exception text, free strings, URL parameters, signed URL, token, health value, media ID, arbitrary timestamp string, malformed version and oversized body all rejected/suppressed.  |
| Instrumentation | Every enum survives roundtrip; focus vs rerender; modal return; permission sheet; multiple failures then success; true exit vs resumable workout; unknown flow after process death.                 |
| Lifecycle       | Export includes all retained analytics and consent/counts; clear cannot be undone by stale batch; revoke purges; account deletion cascades; inactive-account retention; cleanup reboot and failure. |
| Reporting       | Same-timestamp ordering, cross-device sessions, sequence gaps, denominator zero, incomplete cohorts, UTC rollover, late arrival, out-of-window data, repeated export, quota-skew warnings.          |
| Operations      | Dev/Production are never mixed; one unavailable environment yields partial failure; CLI stderr is sanitized; no accidental mutation; no ID leakage.                                                 |

Future verification commands should be adjusted to the actual implementation files:

```bash
pnpm --filter @mizyun/observability test
pnpm --filter @mizyun/contracts test
pnpm --filter @mizyun/adapter-supabase-server test
pnpm --filter @mizyun/api test src/modules/analytics
pnpm --filter @mizyun/mobile test src/features/analytics
node --test scripts/product-analytics.test.mjs
# Only against the verified local disposable Mac database:
pnpm db:verify
pnpm check
git diff --check
```

These are planned commands, not passed results. Never run destructive database verification on the Pi. Provider integration tests remain gated by `docs/BEFORE_TESTING.md`; synthetic analytics testing should not require real model requests or real health data.

## 11. Later improvements and explicit non-goals

Defer until pilot evidence shows a need: web dashboard, warehouse/stream processor, paid analytics vendor, long-lived user drill-down, marketing attribution, A/B experiment assignment, exact timing telemetry, native crash SDK, alert automation, and 12-week retention storage. Avoid “rage taps” inferred from undifferentiated tap counts; that needs a distinct privacy-reviewed instrument and does not establish user frustration on its own.

The pilot can reveal repeated errors, long flows, and navigation detours. It cannot explain every motivation or guarantee full capture. Use voluntary feedback and synthetic reproduction to turn those observations into product changes.

## 12. Primary sources and implementation consequences

Checked 2026-09-12/13; refresh materially affected versions at implementation startup. These inform the proposed design, not a legal/store compliance conclusion.

- [Expo SDK 57 reference](https://docs.expo.dev/versions/v57.0.0/): use the repository's exact SDK and supported native APIs; no native analytics dependency is necessary for the proposed first version.
- [Expo Router screen tracking](https://docs.expo.dev/router/reference/screen-tracking/): route observation is available. Mizyun should transform routes to approved enums; the documentation's raw pathname/params example does not satisfy this project's payload boundary.
- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security): use ownership policies, explicit grants, and indexed ownership filters. Privileged clients bypass RLS, so service-only ingestion must retain verified-principal checks.
- [PostgreSQL row locking](https://www.postgresql.org/docs/current/explicit-locking.html): transaction-held locks support serializing consent changes and ingestion. The actual lock protocol still needs concurrency tests.
- [PostgreSQL window functions](https://www.postgresql.org/docs/current/tutorial-window.html): partitioned ordered sequences can produce navigation transitions and cohort calculations without returning raw rows to the CLI.
- [Node child processes](https://nodejs.org/api/child_process.html): use fixed executables, argument arrays, stdin, timeouts, and bounded output. Never construct a shell command from untrusted filters.
- [Apple App Privacy details](https://developer.apple.com/app-store/app-privacy-details/) and [Google Play Data safety guidance](https://support.google.com/googleplay/android-developer/answer/10787469): review the new transmitted usage/diagnostic data and account linkage against the actual released behavior. Optional opt-in is not a reason to leave disclosures unchanged.

The exact Expo SDK 57 filesystem subpage did not return usable content during this review. Reopen its current versioned FileSystem documentation before implementing queue persistence. PostgreSQL and Node “current” documentation may describe versions newer than the deployment; verify installed versions and the subset of APIs used.

## 13. Copy-ready instruction for the implementation session

> Implement OBS-002 using `docs/PRODUCT_ANALYTICS_IMPLEMENTATION_PLAN_2026-09-13.md`. Begin with working-tree/session context and Stage A. Preserve pre-existing changes. Use at least one disjoint helper and independent non-author review for consent/auth, RLS/migrations, account lifecycle and deployment work. Implement first-party consent-versioned analytics, bounded account-bound delivery, safe navigation/flow events, and aggregate human/JSON CLI reports. Do not upload legacy local analytics or collect non-consenting/preview activity. Validate real local database races and lifecycle behavior; update disclosures and continuity with actual evidence. Keep local verification, Dev deployment, device acceptance, and Production release distinct. Do not promote to Production without a separate explicit release instruction.
