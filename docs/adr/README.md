# Architecture Decision Records (ADR) Index

- [ADR-0052 — Community revocation capture and quarantined replay](0052-community-revocation-capture-and-quarantined-replay.md): local implementation 2026-10-08; content-free outbox, encrypted sink and idempotent offline replay. Independent durability, coverage and recovery acceptance remain pending.

- [ADR-0044 — Native-bound mobile environment](0044-native-bound-mobile-environment.md): accepted for local implementation 2026-10-06; effective Expo Debug configuration, installed application identity, and pre-client routing validation.

- [ADR-0043 — Build 6 compatibility during build 7 promotion](0043-build6-forward-backend-compatibility.md): pinned legacy contracts, nullable invalidated nutrient estimates, qualified Coach controls and coherent backup/migration failure handling.

- [ADR-0042 — Compact agent continuity and serialized stable checks](0042-compact-agent-continuity-and-serialized-checks.md): accepted for local implementation 2026-10-04; bounded live status, preserved handoffs, unchanged full gates with local coordination/input stability, and portable device-discovery cleanup.

- [ADR-0030 — Explicit community publication boundary and isolated social authorization](0030-explicit-community-publication.md): accepted 2026-09-29; isolated social tables, field-limited snapshot publication, and bilateral blocking.
- [ADR-0029 — Pro advanced food nutrients](0029-pro-advanced-food-nutrients.md): accepted 2026-09-29; typed nutrient storage and server-side Pro authorization.
- [ADR-0028 — Optional device-only step reading](0028-optional-device-only-steps.md): accepted 2026-09-28; opt-in HealthKit/Health Connect steps on device.

- [ADR-0027 — Dev Android workout Live Update](0027-dev-android-workout-live-update.md): accepted 2026-09-27; native Android 16 ongoing notification, countdown and fallback.

- [ADR-0025 — Root Stack over Native Tabs for cross-tab modal navigation](0025-root-stack-over-native-tabs.md): accepted 2026-09-11; restores previous tab when dismissing modals, superseding ADR-0006.
- [ADR-0024 — Self-service AI consent access](0024-self-service-ai-consent-access.md): accepted 2026-09-10; removes manual email admission while retaining authentication, consent and usage protections.

> Complete register of architectural decisions for Mizyun. Completed decisions are authoritative until explicitly superseded by a later accepted ADR.

| ID                                                                           | Title                                                            | Status     | Date       | Replaced by / Related                                                                                                                        | Applicability                                                                      |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------- | ---------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| [ADR-0001](0001-modular-monolith.md)                                         | Modular monolith with ports and adapters                         | Accepted   | 2026-07-14 | —                                                                                                                                            | Repository structure, packages, clean dependency direction                         |
| [ADR-0002](0002-provider-neutral-identity.md)                                | Provider-neutral identity boundary                               | Accepted   | 2026-07-14 | —                                                                                                                                            | Identity contracts and auth abstraction                                            |
| [ADR-0003](0003-local-first-supabase-development.md)                         | Local-first Supabase development                                 | Accepted   | 2026-07-15 | —                                                                                                                                            | Local CLI Supabase workflow on Mac                                                 |
| [ADR-0004](0004-validated-environment-composition.md)                        | Validated environment composition                                | Accepted   | 2026-07-15 | —                                                                                                                                            | Strict environment validation schemas                                              |
| [ADR-0005](0005-provider-neutral-authenticated-transport.md)                 | Provider-neutral authenticated transport                         | Accepted   | 2026-07-15 | —                                                                                                                                            | HTTP API client and bearer token injection                                         |
| [ADR-0006](0006-home-stack-inside-native-tabs.md)                            | Home workflow stack inside native tabs                           | Superseded | 2026-07-19 | Superseded by [ADR-0025](0025-root-stack-over-native-tabs.md)                                                                                | Mobile UI navigation structure                                                     |
| [ADR-0007](0007-local-day-offset-boundaries.md)                              | Explicit UTC offsets for local-day food queries                  | Accepted   | 2026-07-19 | —                                                                                                                                            | Nutrition date boundaries and timezones                                            |
| [ADR-0008](0008-retry-safe-onboarding-commit.md)                             | Retry-safe onboarding commit protocol                            | Accepted   | 2026-07-19 | —                                                                                                                                            | Onboarding idempotency and state machine                                           |
| [ADR-0009](0009-active-workout-authority-and-recovery.md)                    | Active workout authority and recovery                            | Accepted   | 2026-07-19 | —                                                                                                                                            | Local workout persistence and crash recovery                                       |
| [ADR-0010](0010-weight-trend-semantics.md)                                   | Weight trend semantics                                           | Accepted   | 2026-07-19 | —                                                                                                                                            | Exponential moving average trend calculations                                      |
| [ADR-0011](0011-dashboard-review-and-local-energy-day.md)                    | Dashboard review and local energy day                            | Accepted   | 2026-07-21 | —                                                                                                                                            | Energy balance calculations and dashboard rollups                                  |
| [ADR-0012](0012-user-scoped-private-media-persistence.md)                    | User-scoped private media persistence                            | Accepted   | 2026-07-21 | —                                                                                                                                            | Supabase Storage bucket structure and RLS                                          |
| [ADR-0013](0013-private-progress-photo-mobile-boundary.md)                   | Private progress-photo mobile boundary                           | Accepted   | 2026-07-21 | —                                                                                                                                            | Mobile camera/picker consent and EXIF stripping                                    |
| [ADR-0014](0014-local-consent-first-product-analytics.md)                    | Local, consent-first product analytics boundary                  | Accepted   | 2026-07-22 | —                                                                                                                                            | Privacy-first local analytics event logging                                        |
| [ADR-0015](0015-stateless-mistral-coach.md)                                  | Stateless Mistral coach with Mizyun-owned grounding              | Superseded | 2026-07-23 | Provider removed 2026-09-03; historical grounding rationale remains                                                                          | Historical Mistral choice; provider-neutral grounding invariants                   |
| [ADR-0016](0016-managed-first-portable-to-mizyun-operated-infrastructure.md) | Managed first, portable to Mizyun-operated infrastructure        | Accepted   | 2026-07-23 | Related: [ADR-0018](0018-isolated-mac-development-and-windows-production.md), [ADR-0020](0020-dual-pi-environments-and-explicit-releases.md) | Infrastructure portability and managed hosting principles                          |
| [ADR-0017](0017-ai-governance.md)                                            | AI governance — workspaces, ZDR, EU residency, free-vs-paid caps | Superseded | 2026-07-25 | Provider/admission/budget specifics replaced by current Gemini config, ADR-0024, and durable limit code/tests                                | Historical safety, data-minimization and budget rationale                          |
| [ADR-0018](0018-isolated-mac-development-and-windows-production.md)          | Isolated Mac development and Windows founder production          | Superseded | 2026-07-31 | Superseded by [ADR-0020](0020-dual-pi-environments-and-explicit-releases.md)                                                                 | Windows PC retained as hot backup; Pi is primary host                              |
| [ADR-0019](0019-gemini-provider-and-dynamic-switching.md)                    | Gemini provider support and app-wide dynamic provider switching  | Superseded | 2026-08-24 | Dynamic switching removed 2026-09-03; current server composition is Gemini-or-disabled                                                       | Historical switching/model pins; current config and code are authoritative         |
| [ADR-0020](0020-dual-pi-environments-and-explicit-releases.md)               | Dual Pi environments and explicit releases                       | Superseded | 2026-09-07 | Active topology replaced by accepted Hetzner cutover on 2026-09-19                                                                           | Historical Pi topology; isolation and explicit-release rationale remains           |
| [ADR-0021](0021-durable-account-deletion-lifecycle.md)                       | Durable account deletion lifecycle and tombstones                | Accepted   | 2026-09-08 | —                                                                                                                                            | Multi-stage deletion pipeline, tombstones, and token-based status recovery         |
| [ADR-0022](0022-git-backed-navigation-and-advisory-impact.md)                | Git-backed engineering knowledge and advisory impact analysis    | Accepted   | 2026-09-09 | —                                                                                                                                            | Developer tooling, context manifest, and advisory impact graph                     |
| [ADR-0023](0023-local-native-release-builds-no-eas.md)                       | Local native release builds and direct store signing (no EAS)    | Accepted   | 2026-09-09 | —                                                                                                                                            | Pure local Xcode/Gradle release pipelines without Expo EAS cloud dependency        |
| [ADR-0024](0024-self-service-ai-consent-access.md)                           | Self-service AI access after consent                             | Accepted   | 2026-09-10 | —                                                                                                                                            | Immediate AI access upon consent without email allowlist                           |
| [ADR-0025](0025-root-stack-over-native-tabs.md)                              | Root Stack over Native Tabs for cross-tab modal navigation       | Accepted   | 2026-09-11 | Supersedes [ADR-0006](0006-home-stack-inside-native-tabs.md)                                                                                 | Mobile UI navigation and cross-tab modal architecture                              |
| [ADR-0026](0026-first-party-product-analytics-backend.md)                    | First-party product analytics backend                            | Accepted   | 2026-09-13 | —                                                                                                                                            | Consent-respecting analytics storage and reporting                                 |
| [ADR-0027](0027-dev-android-workout-live-update.md)                          | Dev Android workout Live Update                                  | Accepted   | 2026-09-28 | —                                                                                                                                            | Android active workout status                                                      |
| [ADR-0028](0028-optional-device-only-steps.md)                               | Optional device-only steps                                       | Accepted   | 2026-09-28 | —                                                                                                                                            | Health steps device integration                                                    |
| [ADR-0029](0029-pro-advanced-food-nutrients.md)                              | Pro advanced food nutrients                                      | Accepted   | 2026-09-29 | —                                                                                                                                            | Typed nutrient storage and server-side Pro authorization                           |
| [ADR-0030](0030-explicit-community-publication.md)                           | Explicit community publication boundary and isolated social auth | Accepted   | 2026-09-29 | —                                                                                                                                            | Isolated social tables, field-limited snapshot publication, and bilateral blocking |

- [ADR-0031 — Community tab and Account header entry](0031-community-tab-account-header.md): accepted 2026-09-30; five tabs, stable Account URL and deliberate participation.

- [ADR-0032 — Community Dev expansion boundaries](0032-community-dev-expansion-boundaries.md): accepted2026-10-01; separate switches/consent/audiences and Dev-only source sequence.

- [ADR-0034 — Derived local navigation for coding agents](0034-derived-agent-navigation.md): accepted 2026-10-02; on-demand source/config facts, disposable parse cache, bounded packets and shared client workflow.

- [ADR-0035 — AI estimates for additional meal nutrients](0035-ai-advanced-nutrient-drafts.md): accepted for local implementation 2026-10-02; server-authorized editable estimates, unknown-value preservation and explicit confirmation; provider/device acceptance remains separate.

- [ADR-0036 — Focused retrieval and validated graph reuse](0036-focused-agent-retrieval-and-graph-cache.md): accepted 2026-10-02; task-only impact, complete source/doc excerpts, safe resolution caching and repeatable proxy measurements.

- [ADR-0037 — Personal screen reads at authenticated startup](0037-personal-screen-startup-reads.md): accepted for local implementation 2026-10-03; bounded memory reads, startup prefetch, write/lifecycle invalidation and retained screen content (#182).

- [ADR-0038 — Durable recurring meal logging](0038-recurring-meal-logging.md): accepted 2026-10-03; server-side snapshots, timezone schedules and occurrence ledger.

- [ADR-0039 — Private aggregate developer dashboard](0039-private-aggregate-developer-dashboard.md): accepted for local implementation 2026-10-03; first-party analytics, Metabase over aggregate-only storage, closed widget/settings telemetry and private operator access.

- [ADR-0040 — Free exercise catalog and legacy identity](0040-free-exercise-catalog-and-legacy-identity.md): accepted for local implementation 2026-10-04; adapted RepDB Free content, preserved historical IDs, in-app attribution and pending variant-specific media; professional content/device acceptance remains open.

- [ADR-0041 — Release-owned Coach app capability knowledge](0041-coach-app-capability-knowledge.md): accepted for local implementation 2026-10-04; trusted product catalog, deterministic recurring setup help and required feature/route coverage.

- [ADR-0045 — Ephemeral health previews](0045-ephemeral-health-previews.md): accepted for the first integration source package 2026-10-06; per-category read-only foreground weight/workout previews, memory-only session, no backend/Coach/sharing, and Production disabled pending native/device/privacy acceptance.

- [ADR-0046: Pro multi-photo drafts and Coach context](0046-pro-multi-photo-drafts.md) — accepted implementation; native/provider acceptance pending.

- [ADR-0047 — Selected device health exports](0047-selected-device-health-exports.md): Dev-only selected first-party nutrition/standalone workout writes; encrypted local retry/mapping lifecycle, separate session permissions and qualified platform retention; native/device/privacy gates open.

- [ADR-0048 — Connected Community UI reads](0048-community-connected-ui-reads.md): local implementation 2026-10-07; persistent destinations, bounded authorized profiles/conversations, stable artifact authors and original foreground authority. Dev/native acceptance pending.

- [ADR-0046 — Manual running authority and retry-safe mutations](0046-manual-running-authority.md): accepted for Dev implementation 2026-10-06; authoritative local dates, dedicated run UI, atomic owner receipts and separate resistance context.

- [ADR-0049 — Private meal thumbnails on Dev](0049-private-meal-thumbnails.md): accepted2026-10-06; optional reduced owner-only meal photos, recovery/deletion and explicit Dev activation.

- [ADR-0053 — Automatic decorative meal illustrations](0053-automatic-meal-illustrations.md): accepted for implementation2026-10-09; instant bundled food artwork, private asynchronous reuse, separate durable image limits, and default-off live provider acceptance.

- [ADR-0054 — Dev phone-owned manual workout companions](0054-dev-workout-companions.md): accepted2026-10-09; explicit foreground binding, memory-only snapshots, bounded receipts and uncertain-outcome barriers; paired-device and Production acceptance remain open.

- [ADR-0055 — Persistent personal startup reads](0055-persistent-personal-startup-reads.md): accepted for implementation2026-10-09; encrypted owner-scoped offline display reads, shared background refresh, cleanup fences and live AI/Community authority.

- [ADR-0056 — Explicit Community meal publication](0056-explicit-community-meal-publication.md): accepted for implementation 2026-10-12; confirmed meal snapshots, optional nutrition and existing social authorization/lifecycle controls. Simulator testing deferred; release gates open.

- [ADR-0057 — Discoverable analytics consent and reminders](0057-discoverable-analytics-consent-reminders.md): accepted for implementation2026-10-12; direct Account consent controls, account-scoped14-day Home reminders, explicit suppression and unchanged consent authority. Native/release gates open.

- [ADR 0058: Pinned ingredient nutrition for meal recipes](0058-pinned-recipe-nutrition-catalog.md)

- [ADR 0059: Durable recipe request budgets](0059-durable-recipe-request-budgets.md)

- [ADR 0060: Transient recipe ingredient review](0060-transient-recipe-ingredient-review.md)
- [0061 — Recipe sessions and consumed-meal handoff](0061-recipe-session-and-consumed-meal-handoff.md)

- [0062 — Private recurring meal suggestions](0062-private-recurring-meal-suggestions.md): explicit opt-in after deterministic three-day detection; transactional receipts, owner-scoped recovery and account lifecycle. Dev/native/pilot acceptance remains open.

- [0063 — Frozen offline recipe evaluation](0063-frozen-offline-recipe-evaluation.md) — REC-06 synthetic references, immutable thresholds and qualified provider/native acceptance.

- [0064 — Rate-based goal modes and weekly calorie review](0064-rate-based-goal-modes-and-weekly-calorie-review.md) — ENG-07/08 %BW modes, trend weight, adaptive maintenance and user-accepted weekly calorie proposals.
- [0065 — Selected Health run imports](0065-selected-health-run-imports.md) — RUN-06 Dev-only user-selected Apple Health/Health Connect run copies with read-only provider metrics, dedup and Coach exclusion.
