# Issue acceptance batch — 2026-10-08

Baseline: `8b9d82447628e0cbfe3a5a6b3038e172adaf71c9`. This batch implements bounded portions of #23, #25/#26 and #31. Whole issue exit criteria remain open. No backend deployment, native installation, Production release or Store upload occurred.

## Implemented and independently reviewed

- **#31 / Q2 weight:** persist a fixed UUID, measurement instant and normalized payload before dispatch; restore ambiguous attempts across screen remount/restart; reject corrupt/unreadable recovery rather than send a fresh operation; block double taps and edits to pending payload. API validates operation identity and returns the original owner-scoped record for equal retries, or409 for changed payload/races. Forward migration `20261008100000_body_measurement_retry_identity.sql` adds the nullable UUID and partial owner/operation unique index. Keyless older clients remain compatible. Workouts, sets, routine copies and proposal saves still need durable caller identities.
- **#25/#26 local deletion:** required recovery-receipt persistence precedes DELETE; `{deleted:false}` cannot count as completed. Failed local cleanup, false draft/consent results and export inventory failures surface as incomplete. Offline cache validates owner index entries and retains the index after failed removals. SecureStore chunk deletion retains the manifest for retries, and mutations serialize by storage instance/key across wrappers. Portable media export, post-Auth transport recovery, complete data barriers and restart-safe purge completion remain open.
- **#23 / Q9:** `/v1/readiness` reports the process-start source SHA, instance/start identity and bounded DB/Auth/Storage checks. Promotion requires requested/checkout/running SHA equality, a fresh instance and ready dependencies. Unknown or dirty startup source cannot attest readiness. Stop-before-checkout applies to promotion and rollback; failed rollback stop cannot mutate the checkout. Legacy rollback is explicitly qualified and cannot substitute for modern release readiness. This is process/checkout evidence, not cryptographic attestation against an attacker who can rewrite Dev source.

Independent High reviews: weight/deletion reviewed by `provider_acceptance_inventory`; promotion/readiness by non-author `review_apple_issue_closure`. Two promotion stop/order findings and one chunk-storage concurrency finding were fixed and rereviewed clear. Coordinator inspected changes and actual verification output.

## Fresh verification

The first package test invocation accidentally ran full packages: API937passed/15credential-gated skips; contracts277; Supabase-server187; Supabase-mobile32. Mobile1772passed with one analytics-fixture suite failing because its real import loaded an absent mocked Platform export. The fixture now isolates the transport while retaining the real weight preparation helper; focused analytics rerun3/3passed. Weight screen5, account management26 and offline-cache18 passed in that batch. Deployment fault harness74/74passed; shell syntax and diff checks passed.

Real SQL: local Docker socket `/Users/adam/.docker/run/docker.sock`, guarded container `supabase_db_mizyun`, local port54322. Migration plus15 pgTap checks executed in one transaction and rolled back: owner RLS/index, retry uniqueness, changed payload, numeric precision, keyless compatibility and two-user isolation passed. No remote migration/reset performed.

Final serialized `pnpm check` **PASS**, input SHA-256 `9b11c11a0868b62e97eeae9559e820c4bd3dda3b05ce414907a66e48529f2021`. Fresh mobile1775passed, API937passed/15skipped, config81passed/3skipped, deployment74/74 and all remaining pipeline gates passed. Credential/BEFORE_TESTING-gated provider suites remain unaccepted. This clean isolated candidate excludes all pre-existing dirty root work. Completion evidence is a documentation-only amendment after the gate; source inputs are unchanged.

## Fresh server observations

Read-only inspection found pristine Dev `7d5c9d0ecfd52629995af25d896dd6cdfef1abaf` (PID638748) and Production `9b0c41acbb7e4ee70592cab40b6148fc76a393ed` (PID3086051), with matching process working directories. Dev namespace/effective-user probes denied read/write/traverse to Production env/repo/storage/migration paths and Docker socket. This proves those tested paths only.

A disposable confirmed Dev Auth account was created, but public Dev password sign-in returned403 before cross-environment token checks could run. It was deleted successfully and lookup404 verified absence. No Production account was created. Token rejection in both directions remains unverified;403 is not evidence of a cross-environment isolation failure. Fresh read-only probes of the new readiness dependency paths returned database200/Auth200/Storage200 in each environment; this does not accept running release identity or authenticated smoke.

#7 Apple revocation encryption key is absent from the inspected Dev/Production env files; the revocation migration is absent from current deployed source. Source implementation is not delivered or native/provider accepted.

## Exact closure checklist

| Issue | Coordinator verification still needed                                                                                                                      | Founder/device or external evidence still needed                                                                                                     |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| #7    | Deliver revocation migration/key custody on an accepted candidate; prove failure/retry/worker recovery                                                     | Disposable real Apple sign-in grant, delete account, verify Apple revocation and interrupted/restarted deletion recovery                             |
| #21   | Diagnose synthetic Dev sign-in403; prove own environment login and opposite-token rejection both directions; complete effective runtime/resource isolation | Install Dev and Production together; cold/warm callbacks remain in correct app/account; standalone operation with Mac off                            |
| #23   | Exact Dev promotion/readiness and authenticated smoke; migration checksum/history/drift, backup references and schema-compatible rollback/fault rehearsal  | Candidate compatibility journeys if API/schema behavior changes                                                                                      |
| #25   | Complete export inventory and offline media delivery; snapshot/resource/cleanup proof; deletion write/upload/restore barriers and orphan retention         | Disposable-account export/download/open offline, then interrupted deletion and recovery; B remains intact                                            |
| #26   | Finish source gaps inherited from#25 and verify real Auth/Storage isolation                                                                                | Combined two-account iPhone/Android privacy round: deny/revoke consent, switch accounts, export/delete/restart, no retained private data from A in B |
| #27   | Exact delivered candidate identity/signatures/standalone build and callback evidence; existing signed build9 evidence remains historical                   | Both native apps standalone, sign-in callbacks/cold starts, permissions, version/backend recorded; Store acceptance separately                       |
| #29   | Project governance and consent-bound live synthetic quality/latency/cost evaluation after BEFORE_TESTING gates                                             | Gemini console fields below; paid billing and grounding decision already confirmed                                                                   |
| #31   | Weight migration/real API replay delivery; implement remaining workout/set/copy/proposal durable identities and reconcile mutation inventory               | After delivery: weight double tap, lost response and app restart produce one record; changed pending payload blocked; deliberate new entry works     |

Prior#11/#13/#138 approvals are retained;#102/#139 and other source/device exits from [batch3](OLDEST_ISSUES_BATCH_3_2026-10-07.md) remain open.

#22/#24/#28/#30 are already closed with qualified supersession/completion evidence. #8 was closed on founder acceptance of its existing TestFlight milestone. These closures do not accept new candidate delivery or the open privacy/provider/release gates above.

## One combined phone round after delivery

Record app version/build, OS/device, installation channel and backend for each app. Use disposable accounts for deletion.

1. Dev/Production installed together: cold/warm sign-in callbacks and account switching select the right app; each works while Mac is off.
2. Weight: double tap; lose response after save; quit/reopen/retry; verify one row and unchanged date/value. Pending payload cannot be edited into a different retry; a deliberate new save creates a separate record.
3. AI: accept current consent once, exercise enabled features; decline/revoke means no new dispatch; switch accounts without inherited consent/data. Device observations do not replace server/provider quota evidence.
4. After export/media gaps are implemented: export and reopen offline, compare all expected categories/counts/photos. Then interrupt/restart deletion; Auth and local private content gone, recovery remains truthful, second account intact.
5. After Apple key/migration delivery: use a disposable real Apple grant and verify revoke/delete/restart failure recovery.

Already approved Play, Beta Pro, Branding and exercise-order checks are credited; no repeated acceptance is requested for unchanged milestones.

## Gemini console fields still needed

Founder attestation2026-10-08: paid billing active; Google Search grounding should remain enabled for accuracy. Preserve that decision. Server uses the Gemini Developer API; inspected Dev fallback is `gemini-3.7-flash`, Production fallback `gemini-3.6-flash`; model `gemini-3.8-flash`. Key presence does not identify a project.

Open [Google AI Studio](https://aistudio.google.com/), API keys/Projects, and copy the **project ID associated with Mizyun's key**, without the key itself. Provide whether GenerateContent logging is enabled, whether datasets exist/share with Google, the monthly project spend cap and alert recipient. Historical project/cap notes are not fresh console proof. An OAuth-authorized API Keys lookup could also identify the project; no such login/tool is available here.

## Primary sources refreshed2026-10-08

- [Expo57 SecureStore](https://docs.expo.dev/versions/v57.0.0/sdk/securestore/), [Crypto](https://docs.expo.dev/versions/v57.0.0/sdk/crypto/), [Postgres unique indexes](https://www.postgresql.org/docs/current/indexes-unique.html), [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security): durable pre-dispatch identity plus owner uniqueness; source/SQL proof remains distinct from native recovery.
- [Node child_process](https://nodejs.org/api/child_process.html), [AbortSignal timeout](https://nodejs.org/api/globals.html#static-method-abortsignaltimeoutdelay), [Fastify routes](https://fastify.dev/docs/latest/Reference/Routes/), [Supabase self-hosting](https://supabase.com/docs/guides/self-hosting/docker): capture actual startup checkout with bounded argument-only commands and bounded dependency probes. [ADR-0051](adr/0051-running-release-readiness.md) records the design limits.
- [Gemini usage policies](https://ai.google.dev/gemini-api/docs/usage-policies), [logs/datasets](https://ai.google.dev/gemini-api/docs/logs-datasets), [terms](https://ai.google.dev/gemini-api/terms): abuse monitoring can retain prompts/context/output55days; GenerateContent logging has separate project settings, datasets separate retention/sharing, Search grounding additional30day debugging retention. Paid billing does not establish EU-only processing or zero retention. Existing blanket30day abuse-retention text must be corrected.
- [Gemini billing](https://ai.google.dev/gemini-api/docs/billing), [rate limits](https://ai.google.dev/gemini-api/docs/rate-limits), [Cloud budgets](https://docs.cloud.google.com/billing/docs/how-to/budgets): project caps and alerts require console evidence; delayed cap enforcement can overrun. [API Keys lookup](https://docs.cloud.google.com/api-keys/docs/reference/rest/v2/keys/lookupKey) requires OAuth and lookup permission; do not expose keys to discover project identity.
