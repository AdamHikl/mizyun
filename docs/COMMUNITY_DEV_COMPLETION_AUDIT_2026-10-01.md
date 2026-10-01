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

#156–162 are separate later expansions (comments, groups, challenges, messaging, media, routine copies and broader discovery/contact matching). Their source is absent and they retain their own decisions and original post-pilot/operator prerequisites. A scope question was sent while completing the existing friends feature; no answer received at this audit stage. They are not reported implemented or closed. Source and automated coverage alone cannot supply human/operator/legal/pilot evidence.

## Dev deployment and iPhone

Pending the final repository check and exact committed candidate. Read-only preflight verified Dev checkout `28e2a71d59cccafe90a891e65159c64dad9bb0d9` pristine, service active/PID1304992, privacy-maintenance timer active and last service Result=success/ExecMainStatus=0. Device detection succeeds for exact Adam iPhone `00008140-001114501A86801C`. Restricted sandbox detection previously failed; trust/device access preflight detected the phone. No other device selected.
