# Product analytics event catalog

> OBS-001 privacy and measurement contract. This is the reviewable source of truth for every product analytics event and property in schema version 1.

## Boundary

- Analytics is optional and off until the user explicitly enables it during onboarding or in Account.
- Version 1 writes only to a bounded file on the device. There is no analytics SDK, network processor, account identifier, device identifier, advertising identifier, fingerprint, or automatic upload.
- The local log retains at most 500 valid events for at most 30 days. Invalid, unknown, future-version, or extra-property records are discarded before export.
- Disable clears the local event file. Clear removes events without changing consent. Analytics storage/read/share failures never block core tracking.
- Sign-out also requests denial and local clearing so a later account on the same device cannot inherit the prior user's events or choice; sign-out itself never waits for analytics success.
- Export is an explicit user action through the native system share sheet. The user controls the destination; Mizyun does not silently transmit the export.
- Timestamps are needed to evaluate return use. Durations, tap counts, and retries use coarse buckets rather than exact values.

This is an engineering boundary, not a legal-compliance conclusion. Store disclosures and the privacy policy must be reviewed against the shipped binary before any beta release, and this catalog must be updated before adding an event, property, processor, or SDK.

## Prohibited data

No event or property may contain:

- user/account IDs, email, names, device IDs, advertising IDs, IP addresses, or stable fingerprints;
- food names, notes, serving text, calories, macros, body/health values, exercises, loads, repetitions, goals, or limitations;
- photo bytes, metadata, asset IDs, storage paths, signed URLs, or picker paths;
- conversation/message content, memory content, model prompts/output, tokens, session material, or request/response bodies;
- arbitrary strings, URLs, exception messages, stack traces, or vendor-defined automatic context.

The TypeScript event union is closed and the persisted-data parser rejects extra properties. A new property requires a catalog update, tests, and privacy review before code is merged.

## Event catalog

| Event                    | When                                                             | Allowed properties                                                                       | Classification and purpose                                     |
| ------------------------ | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `app_session_started`    | Cold start or return from background after consent               | `entryPoint`: `cold_start` or `foreground`                                               | Usage data; return-use/retention proxy                         |
| `onboarding_completed`   | All authoritative onboarding writes succeed                      | `duration`, `taps` (coarse buckets)                                                      | Usage data; activation and setup friction                      |
| `core_record_created`    | A meal, workout, or body-measurement logging flow succeeds       | `recordKind`: `meal`, `workout`, or `body_measurement`                                   | Usage data; first-core-record activation and coarse adoption   |
| `logging_flow_started`   | A supported logging screen mounts                                | `flow`: `meal`, `workout`, or `body_measurement`                                         | Usage data; completion denominator                             |
| `logging_flow_completed` | The corresponding authoritative save/complete operation succeeds | `flow`, `duration`, `taps`, `retries` (coarse buckets)                                   | Usage data; logging efficiency and completion                  |
| `logging_flow_failed`    | Load, validation, submit, or upload step fails                   | `flow`, enumerated `stage`, enumerated `reason`, boolean `retryable`, bucketed `retries` | Usage/diagnostic data; recoverable friction without error text |
| `feature_viewed`         | A measured surface gains focus                                   | `feature`: dashboard, nutrition history, body history, progress photos, or settings      | Usage data; coarse feature adoption                            |

## Buckets

- Duration: under 30 seconds; 30–59 seconds; 1–2 minutes; 3–5 minutes; over 5 minutes.
- Taps: 0–4; 5–9; 10–19; 20 or more.
- Retries: 0; 1; 2; 3 or more.
- Failure stage: validation, load, submit, upload.
- Failure reason: invalid input, network, session, server, disabled, unexpected. Raw error messages are never stored.

## Alpha analysis workflow

For the 10–30-person design-partner alpha, a consenting participant opens Account → Optional product analytics → Export and deliberately shares the JSON export with the founder. Analysis should derive:

- activation from `onboarding_completed` followed by the first `core_record_created`;
- logging completion from completed/started flow counts;
- median friction from ordered duration/tap buckets, reported as buckets rather than fabricated exact values;
- return use from distinct calendar days containing `app_session_started`;
- feature adoption from the enumerated `feature_viewed` values;
- failure/retry patterns from only the enumerated stage/reason fields.

Do not combine an export with account, health, interview, or support datasets to re-identify it. If linked longitudinal analysis becomes necessary, it requires a new documented identifier design, lawful-basis review, consent copy, retention/deletion behavior, and ADR before implementation.
