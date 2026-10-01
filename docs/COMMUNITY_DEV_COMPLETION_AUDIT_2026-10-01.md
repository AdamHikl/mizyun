# Remaining Community work — Dev completion audit

Adam authorized remaining Community implementation, issue reconciliation, final testing, backend Dev deployment and iPhone Dev installation on2026-10-01. This supersedes older documents requiring another deployment/install confirmation. Production, website publishing, Store submission and broader participant admission remain outside this request. Startup HEAD `b588ca11137f17b73a93d4b7beb46da603aa198b`, branch `codex/community-140-145`. Pre-existing detailed-sharing installation evidence edits were inspected and preserved.

## Implemented and independently reviewed

Core friends packages #142–153 already contain enrollment, separate identity, approved directional following, invitations, preview/publication, feed/detail, reactions, reporting, inbox, export/withdrawal/deletion, privacy epochs and operations controls. #166 follow-back and #167 detailed sharing are source-complete. Remaining concrete source improvements in this audit:

- Feed profile, per-card block/relationship and reaction reads overlap in bounded batches of five; all existing JWT/current-authority checks, projection, ordering and fail-closed errors remain. No authorization cache. A page rejected by a card/reaction read is not returned partially.
- Refreshed real Auth/PostgREST acceptance uses actual current PATCH approval/UPSERT reaction boundaries, explicit terms/generation, only synthetic cohort admissions, operation replay and nontrivial revocation/withdrawal. Strict empty-stack/loopback/scratch/redirect/proxy/pre-enabled-controls checks and cleanup guard tests.
- Reusable schema-only local database verifier applies missing current migrations and runs every SQL file plus six explicit capacity/concurrency scripts in a unique scratch. Ordinary completion/failure drops the scratch; `--keep-scratch` transfers cleanup for isolated transport testing.
- Disclosure preparation now includes explicitly selected exercise/set/repetition/weight/duration snapshots and actual inbox90-day retention. No legal approval is inferred.

Helper owned the transport runner/guard tests; coordinator owned feed/adapter scheduling, scratch verification, documents, issues and remote actions. Independent non-author reviewer approved all settled runtime/harness source after resolving wrong fixture-spy placement and an overly broad Python script glob. No source migration, provider enablement or automatic enrollment/sharing was added.

## Fresh automated evidence

Corrected regression against committed baseline: API feed1fail/7pass; adapter1fail/39pass, demonstrating serial outstanding I/O. Earlier API regression intercepted in-memory preselection; that failed experiment is not the accepted reproduction. Final focused API129tests/11files, adapter40tests, mobileCommunity284tests/29files and Python guard7tests pass.

`python3 scripts/verify-community-local-db.py --logs /private/tmp/community-remaining-db --keep-scratch`: **547pgTAP assertions across24SQLfiles PASS**, every plan present and no `not ok`. Source schema/application ACLs and migration numbers only, no user data; forward130000–230000 and20261001130000/140000 applied in empty `mizyun_community_verify_78e643673b51`. Six capacity/concurrency scripts pass: equivalent handles; seven directional/approval/cap races; three publication/replay/source-delete races; two detailed exercise-edit/source-delete races; concurrent reports/staff claims; concurrent push claims.

Synthetic capacity:30readers/100targets/3000edges,100current+2000historicalcards; live cap30 unchanged. Indexed101author probes, SQL28.266ms; MacDocker/psql median93.03ms/p95101.91ms. These are local SQL/transport measurements, not Hetzner HTTP or native latency acceptance.

Real transport: isolated loopback GoTrue `v2.192.0` and PostgREST `v14.14` containers used explicit effective database URIs pointing at the same scratch with matching local JWT configuration. Only Auth migration-version records were copied after schema ownership setup; no users/sessions. Private configuration files were0600, credentials stayed out of output and were removed. `python3 scripts/test-community-postgrest.py --disposable-local-stack --config <private-local-config>`: **78assertions PASS**, synthetic3accounts/cohorts/profile/withdrawal remnants cleaned. Both services and scratch database removed. Initial scratch ownership attempts with restricted postgres failed before fixtures; retry used the local administrator only on scratch Auth objects.

**Fresh `pnpm check` PASS (exit0):** mobile1061/API737,15existing gatedAPI skips; all workspace typechecks, dual Hermes exports, navigation/formatting, deployment/build/signing/backup safeguards,29CommunityCLI tests and56offlineAI invariants. Only continuity/feature-map documentation followed this runtime gate; subsequent navigation/changed-document formatting checks pass. Deployment driver will independently rerun the full check against the exact committed candidate. Deployment/device evidence is recorded below after completion. Existing credential/provider-gated API suites remain skipped under BEFORE_TESTING, not passing. Full log `/private/tmp/community-remaining-check.log`; focused/database/transport logs use `/private/tmp/community-remaining-*`. No physical UI journey is inferred from SQL, transport or installation.

## GitHub closure audit

Live GitHub inventory already has #141, #163, #165 and #168 CLOSED/status:done; no reopening. The following original exits remain substantive, so source completion does not justify closing them:

| Issues             | Remaining exact acceptance                                                                                                                                                             |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #140               | Genuine adult target-user sessions including voluntary decliner                                                                                                                        |
| #142–147, #166–167 | Installed two-account enrollment/invite/follow-back/detailed preview/feed/reaction/unpublish/source-delete/block/mute/withdraw journeys, cold/warm/QR/account-switch and failure cases |
| #148               | Named trained independent backup, verified safety contact, real MFA staff provisioning, timed report/escalation/appeal drills                                                          |
| #149               | Actual scheduled safe push, tickets/receipts/device delivery, denial/rotation/multiple-device/logout/tap acceptance; delivery remainsfalse                                             |
| #150, #152         | Both-platform complete journeys, VoiceOver/TalkBack/large text/layout and two-device revocation/offline/account switching                                                              |
| #151, #153         | Separately durable revocation ledger and restore replay implementation/acceptance, high-degree lifecycle/restart, actual Hetzner HTTP load/cost/alerts/outage/backlog/recovery         |
| #154               | Named qualified legal/disclosure/applicability approval, verified public contact/disclosures and exact Store declarations                                                              |
| #155, #137         | Exact-candidate physical/operator/recovery/pilot acceptance and separately authorized cohort go/no-go                                                                                  |

Adam subsequently answered the scope question: **also implement #156–162 on Dev**, then explicitly resumed. Their implementation is now active under ADR-0032; default-off controls and independent consent/audiences remain. The original post-pilot/human/operator/legal exits are not supplied by source development.

## Dev deployment and iPhone

Core candidate `5e7e2afd494897d129e8383f3b41a91600da9f09` was committed/pushed and deployed by `pnpm deploy:dev <exactSHA>`. The driver reran the full exact-candidate gate successfully; migrations were already current. Remote journal2026-10-01T18:42:08Z success, previous28e2a71, current5e7e2a. Public health200 at18:42:09.124Z; activePID2054798 and pristineDev checkout. Maintenance serviceResultsuccess/ExecMainStatus0 and timeractive; deliveryfalse/cohort2 preserved.

Reviewed synthetic public Dev API/Auth test completed105 assertions including cleanup. Only fresh temporary synthetic principals/cohorts/workout artifacts were created; all removed and exact baseline cohort/controls restored. It covers join/approval/self-approval denial/follow-back/search-disabled/detailed publish+replay/private source and outsider denial/reactions/inbox/feed/unpublish/stale access/block/withdraw/private tracking. Single-card10reads median227.19ms/p95383.26ms is transport evidence, not30-user/pilot acceptance. Earlier defaultPython-UA requests returned non-JSON403 and cleaned up; explicit acceptance client User-Agent/Accept succeeded. No external configuration changed.

`pnpm mobile:install:ios:dev --device 00008140-001114501A86801C` built/signed/installed standaloneDev1.0.6(6), bundle `com.mizyun.development`, at2026-10-01T18:44:04Z. Actual codesign strict/deep and exact Dev API/Auth/callback byte checks passed. JSsha256 `0d14b741511a49d4fc9dea711eb758161e71379d4ec3a198d82ee412fd4acf73`. Main launch was denied because the iPhone was locked (CoreDevice10002/FBS7); installation does not prove native feature acceptance. Logs `/private/tmp/community-remaining-deploy.log`, `community-remaining-dev-http-identified-client.log`, `community-remaining-ios-install.log`. Expansion source requires a new final candidate, gate, deployment and installation.
