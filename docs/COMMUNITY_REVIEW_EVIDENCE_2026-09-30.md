# Community quality review — 2026-09-30

Review scope: GitHub #140–145 under #137. Source HEAD: `877d1898e9205c4be19c6344e1cf1d533f4ff312`, plus the preserved uncommitted community implementation and review fixes. No commit, push, Hetzner deployment, native install, Production migration/data mutation or Store submission. All database work used the local `supabase_db_mizyun` container and a separately created/removed scratch database.

## Reproduced failures and remedies

The original direct-database regression baseline failed **22 of 29 assertions**. API/memory regressions initially failed nine checks; three mobile-controller regressions failed before their fixes. An availability regression later demonstrated a taken hidden handle incorrectly reported available. These were actual failures, not inferred completion evidence.

| Boundary              | Original defect                                                                                                      | Reviewed remedy                                                                                                                                             |
| --------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Enrollment/sanctions  | Raw owner-all writes bypassed age/terms, suspension and generation                                                   | RPC-only enrollment, durable current-terms receipt, eligibility/deletion cleanup, immutable reserved handle and suspended identity                          |
| Discovery/invitations | Global token enumeration, hidden incoming blocks, bio exposure and broken hidden invites                             | Owner-only raw tables, caller-relative bilateral block checks, exact minimal lookups, token-specific capability, boolean-only handle availability           |
| Follow lifecycle      | Mutable edge endpoints, requester approval, duplicate retries and eraseable cooldowns                                | Recipient transition guards, transactional request creation, immutable identity, approved-only raw removal and preserved canceled/declined cooldown rows    |
| Publication           | Foreign/incomplete/routine source, duplicate cards, stale generation/replay resurrection                             | Owned completed-session validation, author/source uniqueness, generation + UUID + payload/version ledger, persistent deletion tombstones                    |
| Revocation/reactions  | Multipart ignored cleanup, retained invites/reactions, direct source correction bypass                               | Atomic database triggers/RPCs for source correction, withdrawal, suspension, eligibility loss, deletion, card version/revocation and follower/block cleanup |
| Mobile intent         | Stale identity after withdrawal, wrong preview/POST edit, account-switch token race, repeated share token generation | Principal-scoped state and transport, effect-safe setup, stable sharing intent UUID, preview generation/existing-card PATCH, token revalidation/reuse       |
| Link/log boundaries   | Substring link acceptance, Dev wrong scheme, bearer token/query in logs                                              | Exact installed-variant custom schemes, login continuation, native share uses installed scheme, community URL redaction                                     |

Independent non-author review covered the migration, Supabase adapter, API/memory, mobile principal scopes and shared HTTP guard. Reported actionable authorization findings were resolved in current source. Helpers did not deploy or execute database changes; coordinator verified actual files and runs.

## Verification and limits

- `pnpm check`: first complete run passed; final complete run recorded below after all writes settle. Includes Metro bundle smoke, repository types/tests/tooling and offline AI fixture checks. Credential-gated live provider suites remain skipped under `docs/BEFORE_TESTING.md`.
- Focused final helper evidence: core 26, contracts 43, Supabase adapter 36, API/memory 51 and mobile community 70 passing assertions/tests. Shared HTTP suite passed 31 tests including deferred-session guards and a failing-first regression proving a stale scoped 401 cannot sign out the next account. The full final repository run is the coordinator's acceptance authority.
- Three community pgTAP files: **70 assertions pass** (16 isolation + 30 raw-boundary + 24 retry/lifecycle). SQL tests use synthetic principals and transaction rollback; a harness checks both process errors and `not ok` assertions, since psql alone does not fail on pgTAP assertions.
- Fresh-schema forward migration test: `20260930100000_community_foundation.sql` followed by `20260930110000_community_review_hardening.sql` applied and all 70 assertions passed in an isolated scratch database. The scratch base schema omitted unrelated extension ACLs, then restored fixture privileges on private workouts/profiles; community grants were created by their migrations. Scratch database was removed and the original local database preserved.
- `python3 scripts/test-community-postgrest.py`: **37 checks passed** against real local GoTrue/Auth sessions and PostgREST. Covers hidden identities/tokens, recipient approval, private-source isolation, direct source correction/reaction cleanup, incoming blocks, concurrent equivalent publication and approval racing block. Three synthetic accounts were removed in `finally`. Only localhost/127.0.0.1 is accepted; local CLI credentials remain in memory and are not printed. Service authority is used solely for synthetic account setup/cleanup and inspecting reaction cleanup.
- Full local `pnpm exec supabase test db`: PASS, 11 files / 217 tests. No `db:reset`/`db:verify`/remote database operation was run.
- Local hardening was applied incrementally while debugging, then tested fresh independently; the local-only migration ledger records `20260930110000` applied. Neither remote environment has this migration.

Reproducible primary tests are the repository test files and local-only script; redacted run logs live at `/private/tmp/community-review-2026-09-30`. Temporary local CLI credential material is removed after verification. Source-check/mock evidence is distinct from real local transport/database evidence, Dev deployment, device acceptance and Production release.

## Remaining work and corrected issue exits

- **#140 / COMM-01:** reconcile intended quotas/retention/handle policy against implementation; confirm age-assurance/calendar-year boundary, safety/operational launch decisions and approved UX. Self-reported birth year is not verified identity/exact age. Design copy now explicitly separates these proposals from functioning behavior.
- **#141 / COMM-02:** locally remediated and automatically verified foundation; no Dev/native/release claim. Reserved future modules retain their own package gates. Production-source tables remain owner-only.
- **#142 / COMM-03:** complete enrollment/profile settings and planned rename/quarantine journeys and acceptance. Existing handle reservation/immutable policy is safe but not the intended rename feature.
- **#143 / COMM-04:** implement mute/preferences and complete follow/follower/block management UI, bounded list pagination and intended quota policies. The repaired APIs are not a complete community experience.
- **#144 / COMM-05:** QR and reachable enrollment/navigation; physical iOS/Android cold/warm, signed-out continuation, deliberate current-principal follow and environment/link acceptance. HTTPS app/universal links and web fallback are not implemented/claimed; current links use variant-specific installed custom schemes.
- **#145 / COMM-06:** integrate sharing with actual workout completion/history and accept preview/publish/retry/edit/unpublish/source deletion/account-switch on physical Dev builds. Delivery/notification suppressions require their own later outbox package; no worker or Store behavior is inferred.
- **#146–155:** feed, staffed moderation/filtering, inbox/push, navigation/accessibility, export/deletion inventory, offline/cache lifecycle, feature kill switches, policy and pilot readiness remain the original planned packages. Source declarations do not approve broader external testing under the existing Dev exception.

The single pilot transaction lock includes social changes and relevant private workout/profile/deletion writes; it favors correctness at bounded scale and may contend. Scalability/load and full lifecycle/native acceptance remain open. In-memory mocks do not model all private age/source state; real SQL/transport tests prove those boundaries locally.

## Final coordinator outcomes

- `pnpm check`: PASS on the final current-source candidate, including scoped-401 regression, Metro bundle, types, repository tests, build/deployment/signing safeguards and offline fixture evaluation.
- `pnpm exec supabase test db`: PASS, 11 files / 217 tests, including all 70 community assertions.
- Local `pnpm exec supabase db lint --local --level error`: PASS, no schema/function errors.
- Real local Auth/PostgREST: PASS, 37 checks / three synthetic accounts removed.
- Fresh forward migrations: PASS / 70 assertions / scratch database removed.
- Candidate runtime/test hashes are recorded in `docs/COMMUNITY_REVIEW_SOURCE_2026-09-30.json`. Source state remains the uncommitted candidate on the recorded HEAD; no deployment or native acceptance.
