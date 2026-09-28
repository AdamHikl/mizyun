# ADR-0028 — Optional device-only step reading

Status: accepted 2026-09-28 for source implementation; native device acceptance and store release remain separate.

## Decision

Add local Expo modules for HealthKit on iOS and Health Connect on Android. Request only step-count read access after an explicit Account & Settings action. Read today's aggregate using local calendar-day boundaries when the dashboard opens or refreshes. Keep the preference per signed-in user in device secure storage. Disabling it stops reads and removes the dashboard value. Do not copy imported steps into Mizyun's backend, Coach context, offline dashboard cache, energy formula, analytics, or exported account data in this segment.

## Rationale and limits

This gives a useful activity signal with a small permission scope while preserving manual tracking when access is denied or unavailable. HealthKit does not reveal read denial, so an absent sum is shown as no readable data, never as a claimed zero. Health Connect's aggregate avoids double-counting overlapping step sources. A later synchronized activity model would need source provenance, deletion handling, timezone-safe idempotency, and an energy de-overlap decision under ACT-02–04.

The iOS app needs the HealthKit entitlement and a read-purpose string. Android needs `READ_STEPS`, Health Connect availability checks, and the Play permission rationale. Local Expo modules require new native builds. The public privacy policy and Play Health declarations must describe the enabled behavior before distribution.

Mizyun's Android minimum remains API 24. The Health Connect library declares API 26, while its provider runs on Android 9 (API 28) or later. The manifest merge explicitly overrides the library minimum, and the adapter returns unavailable before touching Health Connect below API 28. This keeps the existing app usable on older devices; an API 24 launch remains a device acceptance check.

Primary documentation, accessed 2026-09-28: [Apple HealthKit setup](https://developer.apple.com/documentation/HealthKit/setting-up-healthkit), [Apple authorization](https://developer.apple.com/documentation/HealthKit/authorizing-access-to-health-data), [Android Health Connect setup](https://developer.android.com/health-and-fitness/health-connect/get-started), [Android read and aggregation](https://developer.android.com/health-and-fitness/health-connect/read-data), [Expo local modules](https://docs.expo.dev/modules/get-started/).
