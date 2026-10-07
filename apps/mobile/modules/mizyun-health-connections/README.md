# Local health preview module

`MizyunHealthConnections` exports `availabilityAsync()`,
`requestReadPermissionAsync(kind)`, `readPageAsync(kind, fromISO, toISO, pageToken)`
and `invalidateAsync()`. The JS wrapper remains usable on web and native binaries
without this module. A native rebuild is required to enable HealthKit/Health Connect.

Only `weight` and `workout` are accepted. Each permission request selects one read
type. There are no health writes, history/background permissions, observers,
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

All results include `status`, `records`, `nextPageToken`, and `readAccess`, optionally
a fixed `errorCode`. HealthKit read access stays `unknown` even after a successful
permission callback or empty read. Android returns `granted` only for the selected
type when the grant is verified. Empty HealthKit reads never prove denial or a
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
