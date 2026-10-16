# ADR-0065: Selected Health run imports saved to the account

Date: 2026-10-16. Status: accepted for Dev under [#216](https://github.com/AdamHikl/mizyun/issues/216) (RUN-06), by Adam's explicit choice on 2026-10-16 ("Save to account, Dev only"). Partially supersedes [ADR-0045](0045-ephemeral-health-previews.md) for completed runs only; weight and workout previews stay ephemeral. Native/device, privacy-disclosure and Production gates remain open.

## Context

Runners mostly record runs with a watch or another app. Manual Log run already exists, but re-typing a recorded run is the main friction. ADR-0045 kept every Health read in memory and deferred account copies to INT-03 account synchronization, which has not been built. INT-03 covers continuous sync, cursors, source deletion reconciliation and restore; a one-time, user-selected copy of a few completed runs needs much less.

## Decision

- **Explicit one-time copy, not sync.** Workouts → Import runs reads running workouts from the last 30 days (Apple Health `.running`; Health Connect running and treadmill sessions) in a foreground, in-memory session. The user selects runs and taps Add. Only selected runs are sent. There are no cursors, observers, background reads or source-deletion tracking. Leaving the screen, Clear, account change and backgrounding (except during a permission sheet or an in-flight save) discard the read list.
- **Permissions.** New native read kind `run`: HealthKit workouts + `distanceWalkingRunning`; Health Connect `READ_EXERCISE` + `READ_DISTANCE`. No routes, heart rate, calories, history or background permissions. Missing distance permission or data yields no distance, never zero or an estimate.
- **Distance.** HealthKit: `HKWorkout.statistics(for: distanceWalkingRunning)` (iOS 16.4 floor; deprecated `totalDistance` is not used). Health Connect: aggregate `DistanceRecord.DISTANCE_TOTAL` over the session interval filtered to the session's own data origin, so other apps' or unrelated walking samples are not summed.
- **Stored shape.** Imported runs reuse the running workout row with `runSummary.origin = { kind: "health_import", provider, sourceAppId, sourceAppName, externalId }` and `durationBasis` `active` (HealthKit workout duration) or `elapsed` (Health Connect session). Manual runs remain `elapsed`. No raw provider metadata is stored.
- **Identity and duplicates.** Account + provider + source app + external ID is unique among existing runs (partial unique index); re-importing returns the existing run (`created: false`). Each save carries a stable client operation ID for lost-response retries. Overlap with a logged run, or any date-only run on the same day, is shown as **Possible duplicate** and starts unselected; nothing is merged or deleted automatically. If existing runs cannot be read, the picker refuses to list rather than skipping duplicate checks. Deleting an imported run allows a later explicit re-import.
- **Read-only provider facts.** Date, start, duration, basis, distance and origin cannot change after import (enforced in SQL and the API; the edit form locks them). Name, notes, environment and effort stay editable. Manual runs cannot claim an import origin.
- **Use.** Imported runs count in Mizyun run history and weekly running totals. They are excluded from Coach/AI grounding, Community/sharing and outbound Health exports in this package; changing Coach eligibility is a separate decision.
- **Compatibility.** `GET /v1/runs` returns imported runs only with `include=imports`, because older clients strictly parse manual origin. Account export includes imported runs with their origin; account deletion removes them with other workouts. Disconnecting Health does not delete them.
- **Availability.** Mobile entry is Dev-variant only; `POST /v1/runs/imports` is enabled only when `MIZYUN_ENVIRONMENT=dev`. Existing imported runs remain readable, editable and deletable.

## Consequences

- Corrections or deletions made later in the source app are not reflected; the user deletes and re-imports. This is stated in the run detail.
- iOS usage text and the Android rationale now say selected runs are saved to the account. The public privacy policy and Store health disclosures must name this before any Production enablement.
- Apple guideline 5.1.3 forbids third-party disclosure for advertising/data mining and storing personal health information in iCloud; account storage for the user's own history is not prohibited but must be disclosed. Excluding imported runs from Coach avoids sending HealthKit-derived data to the AI provider until that is separately decided.
- Native compilation was checked only against stand-ins; real device permission, partial-permission, third-party source distance, paging and revocation behaviour are required acceptance items.

## Sources

Reviewed 2026-10-16: [App Review Guidelines 5.1.3](https://developer.apple.com/app-store/review/guidelines/#health-and-health-research), [Health Connect aggregate data](https://developer.android.com/health-and-fitness/health-connect/aggregate-data), [HKWorkout statistics(for:)](<https://developer.apple.com/documentation/healthkit/hkworkout/statistics(for:)>) (page body did not render; iOS 16 availability and `totalDistance` deprecation rely on the plan's 2026-10-06 review and require device confirmation), and the sources in ADR-0045.
