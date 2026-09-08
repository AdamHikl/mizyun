# Dev/Production and release-remediation implementation review

Reviewed 2026-09-08. Source: clean `main` at `dc8d6a5`, including remediation commit `372a8a4` and Dev deployment fix `9b0f4a4`. Compared against [the environment guide](tutorials/DEV_PRODUCTION_PI_GUIDE.md), [R1–R9 closure criteria](RELEASE_READINESS_2026-09-07.md), requirements, ADR-0020, and quality gates.

Implementation follow-up: [detailed plan for Q1–Q9](REMEDIATION_IMPLEMENTATION_PLAN_2026-09-08.md), with [per-finding evidence and independent-review checklist](REMEDIATION_EVIDENCE_CHECKLIST.md). These are execution aids, not proof that findings are fixed.

## Verdict

**Both workstreams are partially implemented, not complete. Do not promote this candidate or invite external testers yet.** Separate persistent backends exist and the changes address real gaps, but important implementation defects remain. The former “all remediations” and INFRA-DUAL-001–005 `done` claims exceed their evidence.

This was a review, not a repair/deployment session. Remote inspection was read-only; no user records, credentials, service configuration, or deployed code were changed. No live model calls were made.

## Findings requiring fixes

### Q1 — P1: Dev API can access production secrets and Docker

`deploy/raspberry-pi/mizyun-api-dev.service:9` runs Dev as `mizyun`, the same user/group as Production. Live systemd inspection confirms this. Both environment files are `640 root:mizyun`; `mizyun` belongs to `docker`, and the Docker socket is `660 root:docker`. No inaccessible-path isolation is configured. A Dev bug or dependency running under this account can read production secrets and administer production containers. `NoNewPrivileges` does not remove existing file/group permissions.

The guide explicitly requires a separate unprivileged Dev runtime identity without production-secret or Docker access. Move the runtime to that identity, restrict production paths, and keep deployment privileges outside the API process. Verify denials as the actual runtime user before marking INFRA-DUAL-002 complete. Docker documents the administrative power of its group in [Linux post-installation](https://docs.docker.com/engine/install/linux-postinstall/).

### Q2 — P1: Normal mobile meal retries still get different IDs

`apps/mobile/src/features/log-meal/log-meal-screen.tsx:182` saves the recoverable draft without `clientOperationId`; restore also omits it. The form submitted at line 233 does not carry it. `log-meal-data.ts:78` consequently generates a new UUID on every attempt. A successful insert followed by a lost response and another Save produces another authoritative meal.

The backend uniqueness implementation helps callers that reuse a key; it does not fix the actual screen. A network-free probe submitted the same keyless form twice after simulated transport failures and confirmed different IDs. Persist one ID and submission timestamp before the first request, restore them, pass them on every retry, and rotate only for a new logical entry. Test lost responses, restarts, concurrent saves, and the remaining weight/workout/set/proposal paths required by REL-AUD-007.

### Q3 — P1: R3 build isolation remains incomplete

`apps/mobile/eas.json` still has no explicit variant/environment selections. `app.config.js:20` defaults to Dev. Evaluating each checked-in EAS profile with no external variant override produced `com.mizyun.dev` and `mizyun-dev` for **all three profiles, including production**. The production profile supplies production backend URLs, so it can build the Dev identity against Production. Remote EAS configuration was not inspected and might override this, but the checked-in configuration remains unsafe and unreproducible.

`expo-dev-client` is still absent. The local Dev wrapper correctly validates public hosts/callbacks, but its `run` action does not regenerate or verify existing native project identity. Switching wrappers after a different variant's prebuild can compile the previous identity with the newly supplied backend values. The guide's separate Metro/standalone modes, paid-team signing, and final signed artifacts remain unaccepted.

Set explicit profiles, verify remote public values/project/signing, add the compatible Dev client, and guard native project reuse. Verify both generated identities and endpoint/key/callback combinations before installation. [Expo variants](https://docs.expo.dev/build-reference/variants/) documents profile environment selection and regeneration when switching existing native directories.

### Q4 — P1: Account deletion suppresses failures and cannot reliably resume

`packages/adapters/supabase-server/src/account-repository.ts:258` consumes the challenge before cleanup. Lines 280–302 swallow all Storage/list/memory errors, including outages and authorization errors. A subsequent Auth failure leaves partial cleanup and requires a new challenge; process restart loses challenges entirely. The route also logs a memory cleanup warning and still reports success. The adapter's no-admin fallback can return success without deleting the Auth identity/profile.

A fake-boundary probe forced Storage removal to fail, allowed Auth deletion, and observed `{deleted:true}`; repeating the same challenge failed. This is evidence of the error-handling defect, not a claim that real Supabase always allows Auth deletion with objects remaining. Supabase explicitly says owned objects can block Auth deletion. See [user deletion](https://supabase.com/docs/guides/auth/managing-user-data).

Require the administrative dependency, distinguish missing objects from failures, enumerate all objects, and implement resumable cleanup with honest success/failure semantics. Test Storage outage, partial removal, API restart, lost response, Auth failure, token/session behavior after deletion, and user-B preservation. A direct SQL cascade test is not an end-to-end account deletion test.

### Q5 — P1: “Export all data” is still incomplete

`account-repository.ts:124–196` uses single queries capped at 10,000; there is no pagination, and the server may impose a smaller row cap. Conversations/messages and media have the same limitation. Media exports contain only ID and creation time, without photo content or usable retrieval information. The API mapper selects only parts of stored records. `account-data-card.tsx:47` shares JSON as a message rather than producing a downloadable archive file.

Implement paginated complete-category export and an explicit private-media export design, generate a native JSON/archive file, and verify it can be saved/reopened on both platforms. Align completeness and deletion wording with actual backup/processor retention. The present promise of an immediately complete permanent erasure is not established by the implementation or backup lifecycle.

### Q6 — P1: Profile tier protection can be bypassed through INSERT

`supabase/migrations/20260908120000_security_and_retry_integrity.sql:30` protects UPDATE only. The original own-profile INSERT and DELETE policies remain. Live read-only Dev SQL confirmed authenticated INSERT privilege on `plan_tier` and DELETE privilege on `profiles`, with policies checking only ownership. An authenticated user can delete their own profile and insert it again with a paid tier, bypassing the UPDATE trigger. This conclusion follows from the live privileges/policies and trigger; no live user's tier was changed.

Protect every write path, including initial INSERT and delete/reinsert; retain a trusted entitlement authority. Add database tests using actual authenticated JWT claims for INSERT, UPDATE, UPSERT, delete/reinsert, and permitted service-role changes. A column revoke does not counteract a remaining table-wide grant; see [PostgreSQL privileges](https://www.postgresql.org/docs/current/sql-grant.html).

### Q7 — P1: AI consent continuation reopens its own modal

In both `coach-setup-screen.tsx:160` and `log-meal-screen.tsx:122`, Accept sets consent state and immediately invokes a saved callback. That callback closes over the earlier `aiConsentGranted === false` render and calls the old guarded action, which queues itself and opens the modal again. Repeated acceptance repeats the stale callback; cancelling and starting a new action is a workaround.

This is a source-level control-flow finding; no fresh native UI journey was performed. Separate the consent gate from the authorized action or execute pending action data after the new consent state is established. Test first-use Accept/Decline, storage failure, and account switching with component/native interaction tests. The existing consent tests cover storage helpers, not this flow. See [React state snapshots](https://react.dev/learn/state-as-a-snapshot).

### Q8 — P0 external-AI gate: eligibility, access and cost isolation remain open

`apps/api/src/ai-eligibility.ts:16` treats an unknown birth year as eligible. `food-entries/draft-route.ts:112` also permits processing when profile lookup fails. Mobile consent is stored locally, with no server authorization record/check preventing older or direct clients from bypassing it. No tester allowlist was found.

Live Dev Auth allows signup with automatic email confirmation; both APIs report external Gemini access enabled. Dev and Production have different Supabase public/service keys, but **the same Gemini key**. The new daily meal-draft quota is an in-memory request counter, not a persistent spend ledger; a local probe confirmed a fresh limiter allows calls after the previous instance exhausted its daily quota. Separate signup identities also receive separate counters. No independent provider-side Dev budget evidence was established.

Fail closed on unknown eligibility/errors, enforce founder/tester and AI consent policy at the server, isolate provider budgets, and persist reservations across restarts. Until the external gate passes, enforce founder-only or disabled external AI server-side. Keep manual tracking usable. Current-model evaluations, project billing/settings, and privacy/retention evidence remain outstanding; `BEFORE_TESTING.md` still has open evaluations and incorrectly mixes 2.5 Flash, old Mistral evidence, and the live 3.8 Flash model. Current [Gemini terms](https://ai.google.dev/gemini-api/terms) distinguish paid-service data handling and require adult eligibility and Paid Services for EEA client availability. This review did not inspect the Google billing account.

### Q9 — P1: Deployment scripts do not meet exact-candidate/target/rollback gates

`scripts/deploy-remote.mjs:104` checks the current checkout, even if the requested SHA differs. It then pushes `<targetSha>:main` at line 109; an accepted older SHA is rejected when origin/main has advanced. Dev similarly validates current HEAD rather than the selected candidate. Production still accepts an omitted SHA and defaults to HEAD, contrary to the explicit-release contract.

The remote scripts have no concurrency lock or fixed environment manifest guard: working directory, database URL and service name are not cross-checked. Migration execution depends on a Git diff instead of reconciling pending ledger entries every time. Both health-timeout branches use `exit 1`; an explicit exit does not invoke the ERR trap, so that failure bypasses the advertised rollback routine. No deployment fault-injection tests were found.

Validate the selected SHA in an isolated checkout, require an explicit Production SHA already reachable from main without rewinding it, guard all target resources, serialize deployments, reconcile the migration ledger, and explicitly invoke compatibility-safe rollback on readiness failure. Prove this with disposable harnesses, not production fault injection. Removing the old remote-reset CI file is a real improvement; R9's original unsafe workflow is gone.

## Verified progress and remaining acceptance

| Area                        | Review result                                                                                                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Pi SSH                      | Working; restored since the original audit                                                                                                                                                 |
| Dev checkout                | `9b0f4a40de445702475cb1e64327ca806cc3dafd`                                                                                                                                                 |
| Production checkout         | `c02a67ab31a101c06c9a3ebdf275f9d0cee4a992`; release patches not promoted                                                                                                                   |
| API reachability            | Both public `/v1/health` endpoints returned HTTP 200 from the Mac                                                                                                                          |
| Database/Storage separation | Distinct live mount paths and containers; Dev DB 5433, gateway 8100                                                                                                                        |
| Latest Dev migration        | `20260908120000` present in migration ledger                                                                                                                                               |
| Dev resources               | API 400 MiB/50% CPU limits; container memory limits configured. Pi has ~3.9 GiB RAM, ~1.5 GiB available, ~891 MiB swap used, 8.1 GiB disk free at inspection. No stress acceptance claimed |
| Credentials                 | Supabase public/service keys differ; Gemini key is shared. No secrets printed                                                                                                              |
| R1/R2 implementation        | Persistent adapter/token forwarding, Settings controls, and external deletion page added; Q4/Q5 prevent closure                                                                            |
| R4 implementation           | iOS Google button hidden, leaving own-account email login; signed-candidate login/recovery acceptance still required                                                                       |
| R7 implementation           | Database unique index and backend key lookup present; Q2 prevents mobile acceptance                                                                                                        |
| R9                          | Original persistent-host reset workflow removed                                                                                                                                            |
| Standard check              | Fresh `pnpm check` passed: formatting, types, both bundle exports, **1,198 tests passed / 13 integration tests skipped**                                                                   |
| Focused probes              | Four network-free reproductions passed, demonstrating Q2/Q4/Q8 and restart-reset quota behavior; temporary test removed from source                                                        |
| Backups                     | Pi backup directories include `20260908T075712Z`; presence does not prove restore or off-device recovery                                                                                   |

No fresh physical-device/simulator UI acceptance, signed TestFlight/Play artifact inspection, clean local database reset/upgrade test, two-user account deletion/export integration, cross-environment token rejection, backup restore, outage alert, rollback rehearsal, Mac-off journey, or resource stress test was performed. These remain acceptance gaps, not automatically implementation failures. Python outbound public probes from the Pi returned HTTP errors; local Pi checks and separate public Mac curl probes succeeded.

The proposed ADR still describes adoption as pending; the guide's acceptance checklist remains unchecked; plan/status/backlog contradicted one another. Completion labels have been reopened where the review found failed closure criteria. Historical evidence is retained and clearly superseded by this review.

## Next work sequence

1. Repair Dev runtime privilege isolation and founder-only access/provider budget boundaries (Q1/Q8). Preserve both persistent datasets and the deployed Production SHA.
2. Repair deletion/export, mobile retry IDs, tier authority and consent continuation (Q2/Q4–Q7). Add regression tests around the failures, not only happy-path mocks.
3. Complete guarded build profiles and deployment validation/rollback (Q3/Q9). Verify exact final candidate on Dev with synthetic accounts.
4. Complete R3/R8 signed-device, two-user, restore, monitoring, migration/old-client compatibility and Mac-off acceptance. Reconcile adopted ADR/runbooks with observed configuration.
5. Promote only the newly accepted SHA. External AI remains separately gated; a manual-only pilot is an option after its own privacy/reliability gates pass.
