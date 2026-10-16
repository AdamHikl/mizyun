# Local health preview module

`MizyunHealthConnections` exports `availabilityAsync()`,
`requestReadPermissionAsync(kind)`, `readPageAsync(kind, fromISO, toISO, pageToken)`
and `invalidateAsync()`. The JS wrapper remains usable on web and native binaries
without this module. A native rebuild is required to enable HealthKit/Health Connect.

Only `weight`, `workout` and `run` are accepted. Each permission request selects one
read kind: `weight` and `workout` request one read type; `run` requests completed
workouts plus walking/running distance only (HealthKit `workoutType()` and
`distanceWalkingRunning`; Android `READ_EXERCISE` and `READ_DISTANCE`). There are no
health writes, routes, heart rate, calories, history/background permissions, observers,
network calls, storage, or steps/nutrition reads. The app must call `invalidateAsync`
when clearing the preview, leaving its screen, or switching accounts. Native
background/destruction also retire all read paging state. Pending/queued old
generation reads cannot return records or recreate a continuation after invalidation.

Windows must have a start before an end, at most 30 elapsed days. Weight timestamps
are within `[from,to)`; workouts must start in that range and finish no later than
`to`. Pages contain at most 100 records, newest first. Records originating from
`com.mizyun.app`, `com.mizyun.development`, and `com.mizyun.dev` are excluded.
Only the declared source/time/weight or workout summary fields cross the bridge.
Source timezone is the stored HealthKit timezone or Health Connect record offset;
no current-device timezone is substituted. Android app labels are unknown (`null`).
Recognized provider activity enums become readable names; other enums become
`Other workout`. HealthKit uses workout duration; Health Connect uses session
elapsed duration. No sets, calories, photos, routes, or full metadata are returned.

`run` returns only running workouts: HealthKit `.running` (filtered in the query, so
the source limit applies to runs) and Health Connect `EXERCISE_TYPE_RUNNING` /
`EXERCISE_TYPE_RUNNING_TREADMILL` (filtered after each native page, so a page may hold
fewer than 100 records, or none, while a continuation remains). Each run has
`startedAt`, `endedAt`, `durationSeconds`, `durationBasis` (`active` for HealthKit
workout duration, `elapsed` for Health Connect session end minus start),
`distanceMeters` and `indoor`. HealthKit distance is the workout's
`statistics(for: distanceWalkingRunning)` sum (iOS 16+; the deprecated `totalDistance`
is not read). Health Connect distance aggregates `DistanceRecord.DISTANCE_TOTAL` over
the session's `[start,end)` restricted to the session's own data origin, so other apps'
or unrelated samples are not summed. Distance is `null` when unavailable, not positive,
not permitted or revoked during the read; it is never zero-filled or estimated. Other
distance aggregation failures fail the page (`read_failed`) instead of returning a
transient `null`. `indoor` is HealthKit `HKMetadataKeyIndoorWorkout` (the only metadata
key read besides the timezone), `true` for Health Connect treadmill runs and otherwise
`null`.

All results include `status`, `records`, `nextPageToken`, and `readAccess`, optionally
a fixed `errorCode`. HealthKit read access stays `unknown` even after a successful
permission callback or empty read. Android returns `granted` only when every permission of the
selected kind is verified. A `run` with exercise but not distance access is `ready`
with `readAccess: "unknown"`, returning sessions with `distanceMeters: null` and no
error code. Empty HealthKit reads never prove denial or a
confirmed absence of source data. Native exceptions are reduced to fixed codes.

HealthKit queries at most 1,001 samples and rejects source coverage above 1,000
with `source_limit_exceeded` and no records. A snapshot can retain at most 1,000
filtered records, four snapshots total, for five minutes. Continuation tokens are
opaque, single-use and bound to type/date window. Health Connect requests native
100-record pages and retains at most eight opaque token bindings for five minutes;
its raw provider tokens remain native. Expired/mismatched/replayed tokens require
a new preview. Empty provider tokens mean completion. Permission waits time out
after 120 seconds; read waits after 30 seconds. A still-open timed-out system sheet
keeps the permission launch gate closed until its callback or module destruction so a late
result cannot be mistaken for a new request.
Activity destruction cancels the pending wait and retains that gate; if Expo cannot
restore the old callback, a denied request may need an app restart before prompting
again. Already granted access can still be checked without another sheet.

Android calls are guarded at API 28 and provider availability, retaining the app's
API 24 unsupported fallback. The existing health-steps module supplies the shared
permission rationale activity and Android 14 alias; its copy must cover these new
optional previews. The app owns HealthKit entitlements/usage text. Native app
compilation, permission denial/revocation, real source pagination, lifecycle,
API 24 launch, and physical-device acceptance are separate required checks.
