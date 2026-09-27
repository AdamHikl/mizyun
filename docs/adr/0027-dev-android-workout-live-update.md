# ADR-0027 — Dev Android workout Live Update

Status: accepted 2026-09-27 for Dev implementation. Device acceptance and Production promotion remain separate.

## Decision

Use one local Expo Android module to post and update the active workout notification on Android 16 and later in Mizyun Dev. Request Android's promoted ongoing presentation and use its native chronometer for the rest countdown. Reuse the existing workout summary and exact workout deep link. Keep one stable notification ID and cancel it when the workout finishes, is discarded, is authoritatively absent, or its owner opts out or signs out.

The existing Expo notification remains the fallback when the native update cannot post, on older Android, and in Production. Keep the separately scheduled `Rest Over!` alert. Do not introduce a foreground service for notification display.

## Rationale and limits

Expo SDK 57 Notifications does not expose Live Update promotion or a countdown chronometer. Android's Live Update is still a regular notification whose promotion depends on eligibility, user settings and the device. Local automated checks can prove adapter wiring and native compilation; only device observation can establish the visible chip, countdown, tap routing and lifecycle behavior. The local module may autolink into other variants even while only Dev invokes it and declares the promotion permission.

Primary documentation, accessed 2026-09-27: [Android Live Updates](https://developer.android.com/develop/ui/views/notifications/live-update), [Android foreground service types](https://developer.android.com/develop/background-work/services/fgs/service-types), [Expo SDK 57 Notifications](https://docs.expo.dev/versions/v57.0.0/sdk/notifications/), [Expo config plugins](https://docs.expo.dev/config-plugins/plugins/).
