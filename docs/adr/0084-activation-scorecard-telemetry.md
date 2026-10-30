# ADR-0084 — First-run choice and activation scorecard telemetry

- Status: accepted for Dev implementation, 2026-10-26 (#335, GTM-04 of the adopted go-to-market plan). Production release not authorized by this ADR.
- Builds on: ADR-0014 (local consent-first analytics), ADR-0026 (first-party analytics backend), ADR-0039 (private aggregate dashboard), ADR-0057 (consent reminders).

## Context

The go-to-market plan needs a weekly scorecard with denominators: installs by acquisition source, activation (onboarding plus a first confirmed core record within seven days), day-7 return, week-4 return (a core action on days 22–28 after activation) and MAU (a core logging/review action in the last 30 days), as defined in `docs/INVENTURE_PROGRAM_PLAN_2026-09-23.md`. New accounts land on Home with no guidance; the top Home item opened a 6-screen, 14-tap setup wizard. Bouldering, the beachhead activity, emitted no analytics event. Retained analytics events are deleted after 30 days (`cleanup_expired_product_analytics`), so a cohort's activation events are gone before its week-4 window can be read.

## Decision

1. **First run.** While an account has no display name and this device has no first-run record for it, Home shows "What do you want to log first?" (a climbing session where bouldering is enabled, a workout, a meal, my weight, or "Just look around"). One tap opens the existing fastest capture: an auto-started bouldering session, a blank one-time workout, Log meal or Log weight. Profile, goal and energy inputs stay in the deferred "Set up Mizyun" wizard. The card offers a units choice (saved as `unitSystem` only); timezone handling, AI consent and its adult (18+) confirmation at the first Coach send are unchanged.
2. **Acquisition source.** "How did you hear about Mizyun?" is a fixed single-choice list (`acquisitionSourceSchema`, including "Somewhere else" and "Prefer not to say", no free text). It appears only after optional analytics consent is granted and is sent once, as an analytics event, when the first-run choice is made. It is not stored on the profile.
3. **Events.** Strict, payload-free events added to `analyticsEventV2Schema`: `first_run_completed` {choice incl. explore, duration bucket}; `acquisition_source_selected` {source}; `first_confirmed_record` {recordKind}; `return_milestone_reached` {milestone: day_7 | day_28, cohortWeek: ISO week of the first record}. `core_record_created` gains `bouldering_session`, emitted when a session finish is confirmed. Events leave the device only through `NetworkAnalyticsClient.track`, which drops them unless consent is currently granted; no earlier event is replayed after a later consent. A later `return_milestone_reached` does carry the ISO week of a first record that may predate consent (coarse, no record content).
4. **Device anchor.** A per-account SecureStore entry holds only the first-run time, choice, local date of the first confirmed record and two milestone flags. It is written even without consent, so a later consent cannot relabel a later record as the first one. Day windows use local calendar days (1–7 and 22–28 after the first record). Local account-data erasure deletes it; sign-out keeps it.
5. **Catalogs.** `dashboard-v1` is frozen at the 16-event set parsed by builds 9 and 10 (original record kinds). The current catalog is `activation-v1`; new builds request it for the analytics list and account export. Old catalogs omit new events and mark filtered exports partial, as before.
6. **Scorecard.** `scripts/analytics-dashboard/scorecard.sql` is a read-only, consent- and epoch-scoped aggregate query. The cohort week label lets the week-4 numerator be counted after retention removes the activation event; the denominator is the `first_record_cohort` count recorded four weeks earlier in the scorecard ledger.

No migration, API route or retention change. No new platform API: SecureStore and the analytics client are already in use, so no new primary-source research was required.

## Consequences

- Counts cover consenting accounts only and are reported with consent coverage. Users who consent after their first run are not in an install cohort; this undercounts rather than guesses.
- The anchor is device-local: a reinstall loses later milestones (undercount); a second device sends its own milestones relative to its own first record. An older account without a display name sees the card once per device (or after Clear local data); the scorecard therefore counts only accounts whose Auth signup is within 7 days before their first run, and week-4 returns only from accounts that signed up within 14 days before their cohort week.
- Release order: the API must be deployed before a mobile build with these events ships. An older API rejects `catalog=activation-v1` (Account analytics list/export) and whole ingest batches containing the new event names.
- Week-4 rates require the weekly ledger; a missed Monday leaves that cohort's denominator unavailable rather than zero.
- Cohort weeks are device-local while event timestamps are UTC, so boundary-day records can fall in adjacent weeks.
- Bouldering is enabled by default only on Dev; Production shows the climbing option only when its switch is on.
- Device acceptance (real first-run timing, Coach answer inside two minutes) remains open.

## Amendment, 2026-10-30 (climber first-run audit, gaps 4 and 3)

- **Prompt placement.** The first-run card shows the optional analytics prompt, and after consent the source question, above the log options. The wording and consent behaviour are unchanged; a first tap still ends the card.
- **Anchor without a first run.** A confirmed core record on a device with no stored anchor for the account now creates one with no first-run choice (stored as `"none"`) and sends `first_confirmed_record` (under current consent only). It sends no `first_run_completed` and no `return_milestone_reached`: the scorecard's activation and return denominators require a first-run choice, so return events from such anchors (already set-up accounts, second devices, reinstalls) would inflate day-7 and week-4 numerators. The anchor still hides the card and pins the first record. An existing but unreadable anchor is left untouched, and a record arriving after a local erasure in the same app process does not re-create the anchor. Older builds accept the `"none"` string and keep the card hidden, but after a downgrade they may send return milestones for such an anchor.
- **Coach.** Each Coach text send reports `feature_action_result` {`coach_message_request`, success or failure, a coarse failure reason, a duration bucket}. The action was already in every catalog.
- **Share card.** `share_card_result` {card: `bouldering` | `workout`, outcome: `share_sheet_shown` | `unavailable` | `failed`} records the "Share image" result. `share_sheet_shown` means the system sheet opened and closed; neither OS reports whether a target was chosen, so it is not counted as a share.
- **Catalogs.** `activation-v1` is frozen at its 20 events. The current catalog is `activation-v2`, which adds `share_card_result`; new builds request it. The same release order applies: deploy the API before shipping a build that sends `share_card_result` or requests `activation-v2`.
