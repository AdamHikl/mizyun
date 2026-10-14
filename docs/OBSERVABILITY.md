# Product analytics event catalog

> OBS-001/OBS-002 privacy and measurement contract. Current transport schema is version2 and consent is `product-analytics-v2`. [ADR-0026](adr/0026-first-party-product-analytics-backend.md) supersedes the local-only v1 boundary; [ADR-0039](adr/0039-private-aggregate-developer-dashboard.md) adds aggregate reporting.

## Boundary

Analytics is optional and off until explicitly enabled in onboarding or Account. Authenticated ingestion stores user-owned events in the first-party backend under current consent revision/epoch. The backend internally associates events with the account for ownership, export and erasure; the event payload never includes an account identifier. The bounded device queue retains at most500 events. Server events expire after30 days, with immediate/hourly cleanup on a running API. New mobile capture requires the corresponding native candidate; schemas alone do not prove instrumentation.

Disable/clear rotates the server epoch and erases server events. Local denial clears the queue; account changes discard local state and stale upload responses cannot mutate the next account's queue. Analytics failures never block tracking, navigation, authentication or saves. Export/list is an explicit owner action and is distinct from an operator's aggregate report export.

The developer dashboard connects only to a separate aggregate warehouse. Fixed source queries include granted current-version/current-epoch events in the retained window and output counts, enumerated dimensions, dates and freshness/source-SHA metadata. They never export raw events or account/session/flow IDs. Full-window refresh removes revoked/cleared/deleted contributions on its next successful run; stale reader-view metrics become unavailable after two hours. Old exports/backups cannot be synchronously recalled. Private operator reports must not be combined with support/health datasets to re-identify participants. No public sharing, embedding, external analytics SDK, heatmap, session replay or AI service is added.

This engineering boundary is not a legal-compliance conclusion. Review privacy policy, onboarding/Account disclosure and store declarations against the shipped candidate before release. New events/processors/properties require catalog and privacy review. Historical clicks and searches cannot be reconstructed.

## Prohibited data

No event property may contain names, email, user/account/device/ad identifiers, IP addresses, fingerprints, arbitrary strings/URLs/errors, route parameters, raw search queries, food names/amounts/nutrients, health/body/exercise values, notes, photos/metadata/paths, Coach messages/prompts/outputs, credentials or response bodies. Random event/session/optional flow IDs exist only in the authenticated event envelope and are excluded from the warehouse. App version/build are embedded release metadata; reporting accepts numeric release/build formats or `unknown`, never arbitrary strings.

The strict closed schemas in [analytics.ts](../packages/contracts/src/analytics.ts) define every allowed value. Unknown events, properties and dimensions fail validation. Settings search runs locally; only an explicit keyboard submit and a chosen static destination are measurable, never keystrokes or query text.

## Event catalog

| Event                       | Trigger                                    | Allowed properties                                                                                      | Purpose/coverage                                                      |
| --------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `app_session_started`       | Cold start/foreground after consent        | `entryPoint`: cold_start/foreground                                                                     | Observed sessions/return use                                          |
| `screen_viewed`             | Measured screen gains focus                | `screen`: closed screen enum                                                                            | Adoption and within-session transitions                               |
| `onboarding_started`        | Consent-granted scoped setup starts        | None                                                                                                    | Observed consenting setup starts                                      |
| `onboarding_step_completed` | Authoritative step succeeds                | `step`: welcome/display_name/units/baseline_weight/energy_profile/primary_goal (legacy values retained) | Actual wizard steps; no form values                                   |
| `onboarding_completed`      | Authoritative setup writes succeed         | Bucketed `duration`, `taps`                                                                             | Observed completions, not registration count                          |
| `onboarding_failed`         | Final setup persistence fails              | Static `step`, enumerated `reason`                                                                      | Recoverable outcome; no raw errors                                    |
| `onboarding_exited`         | Explicit exit (close or "Explore first")   | Static `step`, bucketed `duration`, `exit`: cancel                                                      | Terminal explicit exit; cleanup emits nothing                         |
| `logging_flow_started`      | Supported logging screen mounts            | `flow`: meal/workout/body_measurement; optional `mode`: manual/quick/voice/photo/barcode                | Observed starts; unmatched counts are not abandonment                 |
| `logging_flow_completed`    | Authoritative save succeeds                | `flow`, bucketed `duration`, `taps`, `retries`                                                          | Logging friction observations                                         |
| `logging_flow_failed`       | Load/validation/submit/upload fails        | `flow`, enumerated `stage`, `reason`, boolean `retryable`, bucketed `retries`                           | Failure classification, no raw error                                  |
| `logging_flow_exited`       | Explicit supported exit                    | `flow`, bucketed `duration`, `exit`: cancel/navigate_away                                               | Scoped cancel/unprevented navigation; cleanup is unknown              |
| `core_record_created`       | Supported authoritative record creation    | `recordKind`: meal/workout/body_measurement                                                             | Consenting manual creation counts; recurring automatic meals excluded |
| `feature_action_result`     | Supported action finishes                  | Closed `action`, success/failure `outcome`, optional enumerated `reason`/bucketed `duration`            | Reserved schema; missing capture remains open                         |
| `dashboard_control_clicked` | Measured Home control pressed              | `control`: closed dashboard-control enum                                                                | Widget popularity; repeated presses count                             |
| `settings_search_used`      | Nonempty local search explicitly submitted | `resultCount`: none/1_to_5/6_plus                                                                       | Coarse search-result friction                                         |
| `settings_search_selected`  | Local search result selected               | `destination`: closed settings-destination enum                                                         | Requested setting popularity; no search phrase                        |

## Buckets and static controls

- Duration: under30s, 30–59s, 1–2min, 3–5min, over5min. Taps:0–4,5–9,10–19,20+. Retries:0,1,2,3+.
- Failure stage: validation/load/submit/upload. Reason: invalid_input/network/session/server/disabled/unexpected.
- Dashboard controls: nutrition_card, weight_card, training_card, steps_card, quick_log_meal, quick_log_workout, quick_log_weight, quick_log_photo, first_meal_log, first_meal_copy, first_meal_reminder, energy_setup, review_week, review_month, refresh_retry, complete_setup.
- Settings destinations: profile, goal, energy-setup, food-standards, body, progress-photos, workout, reminders, appearance, health-steps, coach-preferences, ai-usage, memory, account-data, community-settings, analytics, legal, security, identity, setup-wizard, feedback, sign-out.
- Feature actions: coach_message_request, meal_text_draft, meal_photo_draft, draft_confirm, draft_discard, feedback_submit, progress_photo_upload, progress_photo_delete, energy_setup_save.
- Screens: dashboard, nutrition_history, workout_history, body_history, progress_photos, settings, coach, feedback, onboarding, log_meal, log_workout, log_body_measurement, energy_setup, meal_detail. Community is not an instrumented analytics screen.

## Reporting interpretation

Registrations come from creation dates of current Auth accounts, including unconfirmed and excluding deleted accounts; they are independent of optional event collection. Daily activity is distinct consenting observed accounts, globally deduplicated across platforms. D1/D7 return uses a matured cohort after first retained observation, not signup retention. Daily logging counts are observed successful manual outcomes, not unique authoritative records; retries or later visits may recount persisted records. They do not measure total meals consumed or scheduled automatic creations. New scoped logging/onboarding attempts match by account/flow/kind inside the source; only counts leave it. Cohorts use the start date and earliest observed terminal, deduplicate starts/completions and classify nonterminal failures separately. Legacy unscoped events remain observations. Unknown outcome is not abandonment. A final screen is not proof that a user got lost.

Store metrics preserve Apple's first-time downloads/redownloads and Google's acquisitions/device installs/listing visitors/install clicks as distinct measurements. Missing/suppressed/unimported rows are unavailable. Store calendar dates/timezones cannot be silently joined to app UTC data as a conversion funnel. See [dashboard runbook and acceptance](DEVELOPER_ANALYTICS_DASHBOARD_2026-10-03.md).

## Catalog compatibility

Owner list and full-account export accept only optional `catalog=dashboard-v1`. Unflagged clients receive the frozen original11event/original6onboarding-step subset so older parsers remain valid. Current clients request the full catalog. Filtered full exports mark the manifest partial with accurate emitted/omitted analytics counts; no health data is filtered. Consent version remains `product-analytics-v2` under the existing coarse usage disclosure. Scope generation/epoch guards prevent delayed callbacks from measuring another account or a later consent epoch.
