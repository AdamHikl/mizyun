# ADR-0055: Persistent personal reads at app startup

Date: 2026-10-09. Status: Accepted for implementation. Extends [ADR-0037](0037-personal-screen-startup-reads.md), issue #182 / MOBILE-LOAD-001. Device acceptance remains separate.

## Decision

Restore bounded personal display reads through the existing encrypted, chunked SecureStore adapter after authenticated startup. Snapshots contain exact request path/query, schema-validated response data and original successful-read time; they never contain session tokens. The owner envelope, canonical personal-path allowlist, 48-hour maximum age, 512-record limit and one-million-byte serialized limit bound disk retention. Memory retains its existing size limits and short fresh-read periods. An expired display read may appear immediately while its shared background transport refreshes; focused Home, Workouts, Meals and Coach consume refresh notifications. Date/offset queries remain distinct. Unvisited history pages and arbitrary search results are fetched on demand.

Only an authenticated current owner may consume a saved response. Restored values must pass the requesting schema. Caller, account/token, read generation and storage-cleanup generation are checked across asynchronous boundaries. Each background request remains bounded by the existing 20-second transport timeout. A stable screen version no longer clears unrelated expired queries: each requested read owns its freshness check. Failed background transports retain the original snapshot age. Home never re-dates its separate dashboard snapshot or reconciles reminders from a restored response.

Personal writes retire saved reads before dispatch and clear memory before and after the attempt, including a lost response. If encrypted retirement fails, the write returns an error before dispatch. Current account/token and caller lifetime are rechecked after asynchronous retirement; concurrent same-account writes remain independent. Storage serializes per-owner operations; account cleanup fences queued saves, delayed persistence timers and older in-flight reads. Cache authorization failures retire exposed snapshots and block disk restoration for that owner for the remaining process lifetime. A new successful login after process restart can recreate snapshots from live reads.

Existing owned Coach conversation history can load independently of live AI provider readiness. Status, consent and usage/admission controls remain live; history never grants permission to send, retry generation, upload a photo, create a conversation or request adaptation. Startup reads existing conversations and their latest thread without generation or creation.

Community retains its separate foreground, memory-only authorization cache and original ten-second lease. Adult eligibility and active membership are checked before startup feed warming. Offline personal snapshots do not include social feeds, audience data, membership, authority endpoints, capabilities or signed media. A visit after Community permission expiry requires online revalidation; startup loading cannot establish continuing access to another person's content.

## Evidence and consequences

See [implementation evidence](../STARTUP_OFFLINE_CACHE_EVIDENCE_2026-10-09.md). The app shell stays interactive while independent startup reads load. With no prior snapshot, a first online download remains necessary. Native cold-start/airplane-mode/reconnect/account-switch and Community revocation journeys must be accepted on a rebuilt standalone Dev app before claiming installed behavior.

Primary sources checked 2026-10-09: [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/), [SecureStore API](https://docs.expo.dev/versions/v55.0.0/sdk/securestore/) (version 57 page unavailable during this session; reuse existing version-57 adapter), [React Native AppState](https://reactnative.dev/docs/appstate), [React effect lifecycle](https://react.dev/reference/react/useEffect).
