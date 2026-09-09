# Implementation review — round 3, September 9, 2026

## Verdict and reviewed candidate

**Several round-2 defects are fixed, but the claim that all Q1–Q9 findings are implemented and verified is still incorrect.** There are remaining implementation defects, a new duplicate-meal regression, and incomplete operational acceptance. Do not treat commit/deploy/physical testing as the only work left.

Reviewed the existing uncommitted changes on top of `e41e2406929ec89a5328e7869466fd109e5b9b9b`. Implementation diff fingerprint (`git diff --binary HEAD -- apps packages scripts deploy package.json`, SHA-256): `ff775cf84ae50961899579ac7a36282d44705e79765a021222e6ee49fdfd1f68`. This identifies the reviewed working changes; HEAD alone does not contain them. No application code was edited by this review.

Three independent helpers reviewed Q2/Q3/Q6, Q4/Q5, and Q7/Q8 while the coordinator reviewed Q1/Q9, live permissions, probes and test results. Compare with [round 2](IMPLEMENTATION_REVIEW_2026-09-08_ROUND_2.md) and preserve the original [implementation plan](REMEDIATION_IMPLEMENTATION_PLAN_2026-09-08.md) exit criteria. The approved shared Gemini project and founder/testing-partner Dev exception remain unchanged.

## Every issue: fixed versus still open

| Issue               | Verified improvement                                                                                      | Remaining verdict                                                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Q1 isolation        | Unit template masks backups and removes writable repo; backup script restricts modes                      | Source improved; live isolation remains unfixed and unaccepted                                        |
| Q2 retries          | Server compares timestamps/details; restoration gated; storage writes serialized                          | **Regressed:** edited ambiguous retry can create a duplicate meal                                     |
| Q3 build separation | Original missing Production URL/foreign host/unknown profile cases reject; empty native identity rejects  | Partial: missing key, insecure endpoints, callback and preview omissions still accepted               |
| Q4 deletion         | First-transition CAS, stage resume, absent Auth handling, receipt storage and status endpoint added       | Partial: concurrent resume, receipt expiry, unused mobile recovery and write barriers remain          |
| Q5 export           | Correct table, paged goals, secondary sort, signing-failure partial marker, local JSON cleanup            | Original 500 regression fixed; full export still incomplete                                           |
| Q6 tiers            | Expanded PostgREST script; original source protection retained                                            | No new bypass found; deployed/upgrade acceptance still incomplete                                     |
| Q7 consent          | Coach retry key, version check and account-generation invalidation fixed                                  | Partial: failed revocation reports success; hidden error details and mutable action context remain    |
| Q8-A admission      | Configurable server email allowlist wired to AI entry points                                              | Partial: empty/missing allowlist permits all eligible accounts; deployment/configuration proof absent |
| Q8-B budgets        | Successful Gemini usage propagated on some paths; RPC errors checked                                      | Partial: no atomic token reservation, no lease/aggregate cap, incomplete attempt accounting           |
| Q8-C evaluation     | Simulated metrics removed; summary correctly labels fixture checks; actual model gate remains open        | Documentation improved; measured provider evaluation still blocked                                    |
| Q9 deployment       | Explicit wrong-port and Production service alias probes now reject; unhealthy recovery gets failure state | Partial: omitted-port bypass and failed-checkout recovery falsely reported successful                 |
| R3/R8               | Still explicitly open                                                                                     | Signed artifacts, physical journeys and off-device restore not accepted                               |

## P1 — Q2 edited retry creates a second meal

`apps/mobile/src/features/log-meal/log-meal-screen.tsx:245–264` allocates a new operation ID whenever form values differ from `submittedOperationRef`. After the server commits but the response is lost, a user editing and retrying therefore creates a new authoritative entry instead of reconciling the first one.

Fresh network-free probe extracted the actual screen ID-selection block and submitted through actual Fastify routes with an in-memory repository:

```text
First request: 200-calorie meal committed, HTTP 200 response treated as lost
Edit/retry: 250 calories, screen allocates another operation ID, HTTP 200
GET: two meals, total 450 calories
```

The new test around `meal-retry-durability.test.ts:294` manually assigns another UUID and treats that behavior as desirable. It does not prove lost-response safety. `submittedOperationRef` also disappears on restart: the immutable submitted payload/outcome is not persisted. Edited retries after restart behave differently, retaining the original ID and conflicting. The client comparison omits details even though the server now compares them.

**Required:** persist the immutable submitted operation and unknown-outcome state; reconcile the original result before allowing an explicit edit/new-entry operation. Test committed-but-lost responses with edits both before and after restart. Preserve the good server canonical comparison, Save restoration guard and storage queue changes. Other mutation families remain subject to the original audit.

## P1 — Q9 port denylist still permits the Production default

`scripts/promote-dev.sh:74` only rejects the literal `:5432` pattern. A fresh mocked invocation of the actual script accepted this valid URL and reported success:

```text
MIZYUN_DEV_DB_URL=postgresql://synthetic:synthetic@127.0.0.1/postgres
mock call: supabase db push --db-url postgresql://synthetic:synthetic@127.0.0.1/postgres?sslmode=disable
exit: 0; journal status: success
```

Omitting a port uses the connection default (normally 5432), not the required Dev port 5433. PostgreSQL supports omitted/default ports and query parameters in connection URIs: [official connection documentation](https://www.postgresql.org/docs/current/libpq-connect.html). Checking a forbidden substring does not establish the effective database identity. The original explicit 5432 and `mizyun-api.service` cases now correctly return exit 2 before mocked mutations.

**Required:** parse and validate effective connection parameters against the intended host/port/database mapping, require unambiguous approved values, and reject overriding query/alternate connection forms unless explicitly supported. Bind the service, repository and readiness endpoint to the same environment. Apply equivalent safeguards to Production.

## P1 — Q9 failed code restoration can still be reported as successful

Both promotion scripts ignore checkout/install/restart errors using `|| true` and infer rollback success from generic HTTP 200. A fresh mocked Dev failure made migration fail and then made the rollback checkout fail, while health returned 200. The script exited 1 for the original deployment failure but journaled **`rolled_back` / `rollback succeeded`**, despite never restoring the previous checkout.

The new `rollback_failed` branch fixes an unhealthy rollback only. It does not prove code/dependency/service restoration. Readiness still does not identify the running SHA or required database state. Migration checksum drift, schema-compatible rollback, partial migration failure and the full Production stage-failure matrix remain open from round 2.

**Required:** track every recovery step, fail recovery if one fails, verify the actual running release and dependencies, and keep forward migration compatibility explicit. Both deployers need fault tests for these conditions. All deployment probes in this review used fake binaries in disposable temporary directories; no real migration or restart occurred.

## P1 — Q1 template changes are not installed isolation

Fresh read-only SSH inspection found:

```text
Dev SHA: 425b3e01b088cf8efff3820143dde319d50281f0
Production SHA: c02a67ab31a101c06c9a3ebdf275f9d0cee4a992
Dev PID: 1978605; User/Group: mizyun-dev-api
ReadWritePaths: /var/lib/mizyun/dev/repo /tmp
InaccessiblePaths: Production env/repo/Supabase/Docker only; backups not masked
/srv/mizyun/backups: 777
/var/lib/mizyun/dev/repo: 775, mizyun:mizyun-dev-api
Dev identity: CAN READ Production database.dump
```

The checked-in unit template changes and future backup chmod are useful, but are not applied by editing those files or merely updating app code. The API promotion script does not install/reload the unit. Existing backup access must be repaired explicitly and verified; the runtime identity must not retain a writable executable checkout through the effective service namespace. Install/permission acceptance and restricted-runtime functional checks remain necessary after locally verifying safe deployment tooling.

## P1 — Q4 deletion recovery remains incomplete

- CAS at `account-repository.ts:716–761` only serializes callers that initially read `challenge_issued`. A caller that initially reads `in_progress` skips the claim and starts cleanup again. A fresh actual-repository probe using an `in_progress/auth` job and concurrent confirmations called `auth.deleteUser` twice and both returned deleted. A persisted state is not an exclusive worker lease.
- `loadDeletionChallenge` in mobile `account-data-management.ts:69` deletes the receipt when the original challenge expires. That also removes recovery for an already accepted job, exactly when expiry-independent recovery is needed.
- `checkAccountDeletionStatus` exists but is referenced only by tests, not the account UI. The new unauthenticated status route does not by itself deliver post-Auth recovery to the user or resume unfinished server cleanup.
- Full deleting-state barriers, complete object enumeration beyond the existing caps/soft-delete filtering, actual JWT-path acceptance, restart/partial-failure tests and restore reconciliation remain open.

**Required:** exclusive resumable lifecycle ownership, durable accepted-job receipts distinct from challenge expiry, a reachable post-Auth status/recovery UI, and the original write/storage/token/restore barriers. Test concurrent resumes, failures after Auth deletion, long interruptions and local cleanup against real boundaries.

## P1 — Q5 export still omits lifetime data

The `user_feedback` table fix resolves the prior concrete persistent-export failure. Adding a secondary ID sort and marking signing failures partial are also improvements.

However, the new paged `memory_items` query only counts rows; it does not return their contents. The API still supplies memories from capped `MemoryStore.list` and overwrites the manifest count with that list length. The export path now pages goals, which is a real improvement. `fetchAllPaged` still terminates on fewer than 500 returned rows, so a lower effective cap truncates results; offset sorting is not a consistent snapshot under concurrent writes. The new 1,000-page ceiling silently terminates without setting partial/error, and missing signing capability can yield null links without marking the export partial.

Private photos remain expiring URLs rather than portable offline media. Arrays/parallel signing remain unbounded. The native Android Share path remains a file URI message without proven attachment delivery. Consent query errors and omitted durable fields remain concerns from round 2. Local JSON cleanup is improved, but does not establish a complete portable export or all lifecycle cleanup.

**Required:** use the complete paged data in the delivered payload, stable snapshot/count verification above actual server limits, truthful completeness for every category/failure, bounded construction, portable media delivery and real iOS/Android attachment acceptance. Do not close Q5 after fixing just the table name.

## Q7/Q8 — consent and AI boundaries

**Q7 — P1 failed revocation reports success:** `account-data-card.tsx:90–92` unconditionally displays “AI consent has been revoked” after awaiting the controller. `ai-consent-controller.ts:400–434` catches server/storage failure, stores an error and resolves normally. Settings ignores that error. A failed revoke therefore tells the user sharing stopped while server consent remains granted. Return an explicit outcome and show failure unless persistence actually succeeds.

The retry key and obsolete-version checks are fixed; a fresh A→B→A probe no longer dispatches the stale save's action. Error/loading details remain absent from rendered consent consumers, and pending actions still lack immutable conversation/draft context. A lower-priority class-level probe starting revocation then requesting an action dispatched while revocation was pending and left `saving`/granted state afterward. That exact same-controller sequence was not reproduced on a device; screen instances limit its exposure.

**Required:** prevent new execution while revocation is pending, reconcile invalidated async states, bind actions to their original context, and exercise error/retry/loading behavior in rendered consumers rather than only a synthetic hook dispatcher.

**Q8-A:** `authorizeAiAccess` only applies the email allowlist when nonempty (`ai-eligibility.ts:75`); server config defaults to an empty list. Thus omission still allows every otherwise eligible account. The configured policy has not been installed or live-tested. Preserve the shared-project/autoconfirm exception, but enforce intended admission with explicit configuration/identity ownership rather than treating an optional list as completed containment.

**Q8-B:** SQL `ai_reserve_tokens` remains unchanged in `20260724120000_ai_ops_001_limits.sql:115–133`: it checks usage but adds no reserved amount. Concurrent requests can pass against the same remaining budget. No environment-wide monetary ceiling or expiring in-flight ownership was added. Successful usage metadata on some paths is useful, but Coach text meal drafting still commits literal 500 (`coach/routes.ts:723`); failed attempts/fallbacks and crashes remain incompletely accounted for. New mocked RPC tests do not prove database concurrency safety.

**Required:** implement atomic owned reservations with settlement/recovery, total attempt accounting and bounded aggregate cost, then prove concurrency/restart behavior with a real disposable database.

**Q8-C:** The final offline summary is now truthful and fake latency/token metrics are removed. This fixes the reporting defect; it does not perform measured candidate/fallback evaluation. Keep that gate blocked. Some individual runner headings still use accuracy/neutralization language for fixture checks; these must not be cited as live quality measurements.

## Q3/Q6 and remaining acceptance

Fresh clean-process probes show actual Expo config still accepts: Production endpoints with no publishable key; HTTP API/Supabase URLs; `mizyun://wrong/callback`; and standalone preview with endpoints/callback all missing. See `apps/mobile/app.config.js:81–104`. Validate required key/provenance, secure full endpoints and callback, plus preview's standalone requirements at the actual entry point. Native blank-ID checks now fail closed; script-string assertions still do not prove both variant switches. Dev-client dependency, EAS settings and signed two-app acceptance remain open.

Q6 has no newly found source bypass. The expanded PostgREST script contains 11 test blocks, not the claimed 10. The missing-claims case supplies an invalid JWT, proving malformed-token rejection rather than valid signed claims handling; cross-user rejection needs successful second-user authentication as a prerequisite. Existing-row UPSERT is covered, insertion-branch/upgrade/exact-Dev acceptance remains incomplete. Root `pnpm check` does not invoke this script. Preserve the source protection and complete that evidence.

## Fresh verification and next action

The initial literal `pnpm check` exited 1 on formatting in `docs/REMEDIATION_EVIDENCE_CHECKLIST.md`. The remaining sequence was run separately and exited 0: typechecks, both JS bundle exports, workspace tests, 22 deployment safeguard cases, build matrix runner and 56 offline invariant checks. Credential-gated API integration suites remained skipped; no new destructive database, native, live-provider or restore acceptance occurred. Documentation formatting is checked after this review's corrections. Passing mocks did not prevent the fresh failures above.

**Next:** fix the Q2 ambiguous-retry regression and Q9 effective-target/recovery defects locally, with independent regression review. Then explicitly apply and verify Q1 host isolation using reviewed tooling. Complete Q4/Q5 lifecycle/export, Q7 revocation/context and Q8 admission/reservations; finish Q3/Q6 and measured evaluation acceptance. Only then move to R3/R8 final device/recovery acceptance and an explicitly accepted Production milestone. The defects are implementation work, not merely a queue of device checks.

## Coordinator implementation pass — September 9

The coordinator subsequently implemented locally: edited ambiguous meal retries now stop with a recovery message; promotion scripts require canonical explicit database URLs and track failed checkout/install/restart recovery; production/preview Expo profiles require publishable configuration, HTTPS and the exact production callback; failed AI-consent revocation returns an explicit failure; external AI configuration rejects enabled access without an email allowlist; the text Coach path uses provider-reported token usage when available; and migration `20260909130000_ai_token_reservations.sql` adds atomic daily token reservations. Focused typechecks, API/mobile/config tests, build-matrix tests and 23 deployment safeguard tests pass. The migration has not been applied to a database, Q1 unit changes have not been installed on the Pi, and Q4/Q5 lifecycle/export plus Q7 UI/context and Q8 lease/aggregate accounting remain open.
