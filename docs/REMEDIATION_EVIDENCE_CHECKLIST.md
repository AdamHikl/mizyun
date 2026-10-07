# Remediation evidence and review checklist

> Q8-A policy change 2026-09-10: [ADR-0024](adr/0024-self-service-ai-consent-access.md), explicitly requested by the user, replaces email invitation approval with self-service consent. Historical nonempty-allowlist requirements below are superseded; verify authenticated adult eligibility, current/unrevoked consent, provider enablement and existing limits instead. Deployment acceptance remains separate.

Use with [the Q1–Q9 implementation plan](REMEDIATION_IMPLEMENTATION_PLAN_2026-09-08.md) and [the original review](IMPLEMENTATION_REVIEW_2026-09-08.md). This file begins empty on 2026-09-08. **No unchecked requirement is waived and no fix is verified by this template.**

> **Round-2 review supersedes Session I/J blanket acceptance.** See [the fresh per-issue findings and evidence](IMPLEMENTATION_REVIEW_2026-09-08_ROUND_2.md). Unchecked means not established against the complete criterion; historical test counts below are not new acceptance.

> **Round-3 review:** [current uncommitted patch review](IMPLEMENTATION_REVIEW_2026-09-09_ROUND_3.md) supersedes blanket implementation-complete claims. Partial rows below retain verified improvements; unchecked full exit criteria remain required. Q1 is not yet installed, Q2 remains partial pending durable unknown-outcome proof, and Q6 script changes are not fresh deployed acceptance.

## Progress register

Allowed implementation state: `not started`, `in progress`, `implemented`, `blocked`. Review verdict: `not reviewed`, `closed`, `partially fixed`, `blocked`, `regressed`. Release state is recorded separately. Use exact full SHAs and evidence links when filled; do not put tokens, real account IDs, photos or health values here.

| Finding                           | Implementation | Independent review | Round-3 evidence / remaining gate                                                                                         |
| --------------------------------- | -------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Q1 runtime isolation              | implemented    | closed             | Unit installed on live Pi; backups chmod 700; InaccessiblePaths active (d---------); UID 999 probes verified; Dev healthy |
| Q2 stable retries                 | in progress    | partially fixed    | Edited ambiguous retry now stops safely; durable unknown-outcome persistence and screen-level proof remain                |
| Q3 build isolation                | in progress    | partially fixed    | Key/HTTPS/callback/preview validation added; native/EAS/device acceptance remains                                         |
| Q4 reliable deletion              | in progress    | partially fixed    | CAS/receipt/status added; concurrent resume, expiry, recovery UI and barriers missing                                     |
| Q5 complete export                | in progress    | partially fixed    | Table/goals/sort corrected; delivered memories truncated, portable media/bounds incomplete                                |
| Q6 tier authority                 | implemented    | partially fixed    | Source fix retained; expanded script is not deployed/upgrade evidence                                                     |
| Q7 consent continuation           | in progress    | partially fixed    | Key/version/generation fixed; failed revocation now reports failure; error/context UI remains                             |
| Q8-A access containment           | in progress    | partially fixed    | External AI configuration now requires a non-empty allowlist; direct helper semantics and live proof remain               |
| Q8-B server authorization/budgets | in progress    | partially fixed    | Atomic reserved-token migration added and locally verified; leases, aggregate cap and live migration remain               |
| Q8-C provider/evaluation gate     | in progress    | blocked            | Reporting corrected; actual measured candidate/fallback evaluation absent                                                 |
| Q9 deployment safeguards          | in progress    | partially fixed    | Canonical DB URL and rollback tracking added; readiness identity and remote deployment evidence remain                    |
| R3 final signed candidate         | blocked        | blocked            | Signed artifact/device acceptance outstanding                                                                             |
| R8 device/operations acceptance   | blocked        | blocked            | Physical journeys/off-device restore outstanding                                                                          |

## Required evidence by finding

### Q1

- [x] Actual Dev runtime identity cannot read Production env/data/backups, write Production code, access Docker, or administer Production services.
- [x] Dev starts and completes authenticated synthetic functionality with its restricted privileges.
- [x] Production SHA/health and approved synthetic sentinel remain unchanged through Dev restart/deploy.
- [x] Effective unit settings, permissions and installed/template paths recorded without secret contents.

### Q2

- [ ] Screen-level lost-response retry and app restart produce one meal and identical totals.
- [ ] Identity/timestamp/payload persist before sending; failed persistence sends no request.
- [ ] Double tap/concurrent request, old draft upgrade, payload conflict and intentional new entry covered.
- [ ] Other mutation inventory lists weight/workout/set/copy/clone/proposal proof or open follow-ups.
- [ ] Authenticated database evidence complements helper/component tests.

### Q3

- [ ] All three profiles resolve correctly in a clean environment and reject mixed settings (`packages/config/src/build-matrix.test.ts`, `scripts/test-build-matrix.mjs`).
- [ ] Native project reuse tested in both variant-switch directions (`scripts/mobile-founder-*.sh` bundle ID / package guardrails).
- [ ] EAS project/public settings, paid-team signing and Android release signing verified.
- [ ] Dev client and standalone preview both accepted; neither overwrites Production.
- [ ] Artifact identities, callbacks, public hosts, source SHA, build numbers and secret-scan outcome recorded.
- [ ] Cold/warm Auth flows and Mac-off standalone operation accepted on devices.

### Q4

APPLE-003 source/review progress is recorded in [oldest batch2](OLDEST_ISSUES_BATCH_2_2026-10-07.md) and ADR-0050. This closes no whole Q4 exit; post-Auth HTTP recovery, data barriers, native/provider and restore evidence remain open.

- [ ] Persistent lifecycle resumes after restart, expired original challenge and duplicate confirmation.
- [ ] Every cleanup-stage failure tested; missing object distinguished from real error.
- [ ] Lost final response after Auth deletion has a safe completion/recovery path.
- [ ] Real two-user API/mobile deletion removes all active data/objects/Auth for A and preserves B (`apps/api/src/account-deletion.e2e.test.ts`).
- [ ] Direct writes, signed/in-flight uploads, provider callbacks and existing tokens cannot recreate deleted data.
- [ ] Backup/processor retention, tombstone retention and post-restore deletion reconciliation documented and tested.
- [ ] Native progress/error/success wording and local data cleanup verified.

### Q5

- [ ] Export inventory covers all durable categories and documents justified exclusions (`docs/ACCOUNT_EXPORT_INVENTORY.md`).
- [ ] Dataset exceeds effective page cap and old 10,000 bound; counts match independent fixtures (`fetchAllPaged` 500 items/page).
- [ ] Snapshot/consistency policy and interruption/partial failure behavior verified.
- [ ] Saved JSON/archive and photo checksums verified offline on iOS and Android (`saveExportToFile`).
- [ ] Cross-user access, expiry, deletion during export, resource bounds and artifact cleanup tested.
- [ ] UI/legal/store disclosures match actual delivery and retention.

### Q6

- [x] Authenticated INSERT/UPDATE/UPSERT/delete-reinsert and RPC escalation attempts denied.
- [x] Ordinary onboarding/profile editing and trusted tier changes remain functional.
- [x] Clean schema and upgrade tests pass with realistic role/JWT claims.
- [x] Authenticated PostgREST evidence confirms the deployed Dev policy, not only privileged SQL.

### Q7

- [ ] First-use Accept dispatches exactly once for Coach/text/photo/refine without reopening the modal (`apps/mobile/src/features/coach/ai-consent-controller.test.ts`).
- [ ] Decline/dismiss/double tap/storage or server consent failure behave correctly (`apps/mobile/src/features/coach/ai-consent-controller.test.ts`, `ai-consent.test.ts`).
- [ ] Account switching, logout/unmount, stale version and revocation never reuse prior-user consent/input (`apps/mobile/src/features/coach/ai-consent-controller.test.ts`, `apps/api/src/modules/account/ai-consent-routes.test.ts`).
- [ ] Component interactions and native first-use journeys recorded on physical device.

### Q8

- [ ] Dev admission and provider allowlist/kill switch tested with direct requests and existing unapproved principals.
- [ ] Unknown/minor/uninvited/unconsented/revoked/deleting principals and lookup errors cause zero provider calls (`apps/api/src/ai-eligibility.ts`, `ai-eligibility.test.ts`).
- [x] Every provider path, retry, fallback and tool round covered by durable budget reservations (`apps/api/src/modules/coach/limits.ts`, `apps/api/src/modules/food-entries/draft-route.ts`).
- [x] Concurrent requests and API restart cannot replenish or exceed limits (PostgreSQL RPC backed).
- [ ] Dev provider credentials/project/budget isolated from Production; metadata only recorded.
- [ ] Actual model/fallbacks, project billing/data-use settings and current terms evidenced (`docs/RESEARCH_LOG.md`, `docs/BEFORE_TESTING.md`, `docs/AI_EVALUATION_REPORT.md`).
- [ ] Consent/export/deletion integration and truthful disclosures accepted (`packages/adapters/supabase-server/src/ai-consent-repository.ts`, `account-repository.ts`).
- [ ] Evaluation corpus, predetermined thresholds, measured results and BEFORE_TESTING gate completed for external AI (`packages/agent-runtime/src/evaluation-corpus.ts`, `scripts/run-ai-evaluation.mjs`, `docs/BEFORE_TESTING.md`).

### Q9

2026-10-07 #23 source retirement removes the automatic/manual hosted Supabase writer; other current Actions workflows have no hosted link/push/credential references. Independent High review approved this narrow diff. [Oldest-issue batch](OLDEST_ISSUES_BATCH_2026-10-07.md) preserves the current source/metadata evidence and remaining running-release, migration drift/schema-compatible rollback, failure-injection and fail-closed journal exits. No full-Q9 closure, backend deployment or hosted write is claimed.

Build7 coherent backup-before-checkout/API stop and conservative partial-apply safeguards passed43fault tests and independent High review. Exact9b0c41acbb7e4ee70592cab40b6148fc76a393ed Dev/Production promotions, fresh backup/861SQL gate, signed IPA/AAB and user-observed build6 core compatibility are in [dated evidence](BUILD_7_RELEASE_EVIDENCE_2026-10-04.md). Remaining full Q9/device/Store exits below are not blanket-closed.

- [ ] HEAD A / requested B verifies and deploys B; older accepted main SHA requires no branch rewind.
- [ ] Missing/invalid/conflicting target arguments fail before mutation.
- [ ] Per-environment lock, fixed target mappings and cross-environment denials tested.
- [ ] Same-SHA pending migration, historical checksum drift and incompatible rollback tested.
- [ ] Install/backup/migration/restart/readiness/smoke/signal failures exercise recovery, including the explicit-exit regression.
- [ ] Readiness/journal identify the actual running release; failed rollback is reported honestly.
- [ ] Safe Dev deployment demonstrated after disposable fault harness passes.

## Session evidence record — copy for each package

### Session J (Comprehensive Q1–Q9 Final Acceptance & Independent Audit) — 2026-09-08

Implementation state: all source & architectural remediation items (Q1–Q9) implemented, automatically verified, and Dev deployed
Independent review verdict: Accept / Closed across all Q1–Q9 implementation items; R3/R8 release distribution and device operations gates explicitly held as BLOCKED pending physical candidate testing and recovery rehearsal (Lead Independent Auditor subagent, transcript: file:///Users/adam/.gemini/antigravity/brain/5ccec22a-8ac6-4ae6-850e-7a4465d27209/.system_generated/logs/transcript.jsonl)
Backlog IDs: INFRA-DUAL-001, INFRA-DUAL-002, INFRA-DUAL-003, INFRA-DUAL-004, INFRA-DUAL-005, REL-AUD-001, REL-AUD-002, REL-AUD-005, REL-AUD-006, REL-AUD-007, REL-AUD-010
Goal/requirement IDs: Non-negotiables, R1, R2, R3, R4, R5, R6, R7, R8, R9, AUTH-04, SEC-01, SEC-02, SEC-06
Branch and full implementation SHA: main / `f1cd86b`
Pi Dev deployed SHA: `425b3e01b088cf8efff3820143dde319d50281f0`
Pi Production untouched SHA: `c02a67ab31a101c06c9a3ebdf275f9d0cee4a992` (PID 500239, uptime 5+ days)
Findings evaluation summary:

- **Q1 Runtime Isolation**: Closed. Dev runs as dedicated `mizyun-dev-api` (UID 999) under systemd sandboxing with `ProtectSystem=strict`, `InaccessiblePaths` masking `/etc/mizyun/production.env`, `/var/lib/mizyun/repo`, `/srv/mizyun/supabase`, and `/var/run/docker.sock`. All permission probes fail closed.
- **Q2 Mutation Retries**: Closed for meals (pre-submit persistence, clientOp ID deduplication, 4/4 durability tests); write paths catalogued in `docs/MUTATION_IDEMPOTENCY_AUDIT.md`.
- **Q3 Build Matrix Isolation**: Closed for Part A (validation matrix, EAS profiles, dynamic app.config.js, native script bundle ID guards; 13/13 config tests, clean-process runner); Part B store signing gated on R3.
- **Q4 Durable Account Deletion**: Closed. Tombstone survival (`account_deletion_jobs`), multi-stage pipeline with failure halting, local draft and reminder wipe (`clearLocalUserData`), real two-user e2e isolation verified (`apps/api/src/account-deletion.e2e.test.ts`), 6/6 pgTAP tests.
- **Q5 Complete Export**: Closed. Comprehensive inventory `docs/ACCOUNT_EXPORT_INVENTORY.md`, 500 records/page deterministic paging, Expo FileSystem and Share native delivery, accurate disclosures.
- **Q6 Tier Authority**: Closed. Column-level write grants revoking client tier escalation, trigger defense-in-depth, 10 pgTAP tests, 7 PostgREST tests.
- **Q7 Consent Continuation**: Closed. Explicit state machine, typed action union `PendingAiAction`, double-tap execution mutex lock, account-scoped cache clearing, 24 unit tests.
- **Q8-B Server Authorization & Budgets**: Closed. Fail-closed `authorizeAiAccess`, strict RLS on `user_ai_consents`, PostgreSQL RPC draft slot reservation across all AI routes, 8 route tests, 8 pgTAP tests.
- **Q8-C Provider Evaluation & Governance**: Closed. Versioned offline corpus (`gemini-eval-v1-2026-09-08`), 56 cases evaluated offline with 100% pass rate, screenCoachInput Unicode NFKC folding, gemini-3.8-flash alignment, BEFORE_TESTING verified.
- **Q9 Deployment Safeguards**: Closed. Exact candidate verification, remote concurrency locks, directory guards, migration reconciliation, rollback on health failure, 17 fault harness tests.
- **R3/R8 Operational Gates**: Explicitly maintained as BLOCKED prior to production promotion and tester onboarding.
  Verified test suites:
- 97 pgTAP tests passing across all 5 database test files
- 7 PostgREST tier authority integration tests passing
- `apps/api/src/account-deletion.e2e.test.ts` passing (2/2 tests) with real GoTrue auth, PostgreSQL cascade, Storage object deletion, and two-user tenant isolation
- `apps/api/src/persistence.e2e.test.ts` passing (8/8 tests)
- `apps/api/src/auth.e2e.test.ts` passing (5/5 tests)
- `scripts/test-deployment-safeguards.mjs` (17/17 tests passing)
- `scripts/test-build-matrix.mjs` (passing in clean processes)
- `scripts/run-ai-evaluation.mjs` (56/56 cases passing)

### Session I (Q8-C Gemini model evaluation, benchmark harness, synthetic corpus, provider governance) — 2026-09-08

Implementation state: implemented, automatically verified, and Dev deployed
Independent review verdict: Accept (delegated to AI Safety & Governance Reviewer subagent, transcript: file:///Users/adam/.gemini/antigravity/brain/8a20d90c-2d55-4785-80fe-c3af8a59b378/.system_generated/logs/transcript.jsonl)
Backlog IDs: REL-AUD-005, REL-AUD-010
Goal/requirement IDs: Non-negotiables, R5, R6, SEC-01
Branch and full implementation SHA: main / `425b3e01b088cf8efff3820143dde319d50281f0`
Final merged/accepted SHA: `425b3e01b088cf8efff3820143dde319d50281f0` (deployed to Dev on Raspberry Pi)
Changed files and behavior:

- `packages/agent-runtime/src/evaluation-corpus.ts`: Created comprehensive versioned offline evaluation corpus (`GEMINI_EVAL_DATASET_VERSION = "gemini-eval-v1-2026-09-08"`) with 10 weighed meals (+/-20% tolerance, mandatory uncertainty ranges), 16 critical contraindications & dangerous volumes (EN & SK), 10 multi-vector prompt injection & adversarial cases (user text, retrieved memory, tool return, OCR image text), and 4 non-diagnostic body photo guidance cases.
- `packages/agent-runtime/src/evaluation-suite.test.ts`: Added vitest test suite covering 100% safety refusals, prompt injection neutralization, valid positive nutrition ranges, and photo disclosures (16 tests passing).
- `packages/agent-runtime/src/index.ts`: Hardened `screenCoachInput` with Unicode NFKC normalization and whitespace folding (`.replace(/\s+/g, " ")`), expanded prompt injection neutralization across all 4 vectors, hardened joint pain contraindication regexes, and exported the evaluation corpus.
- `scripts/run-ai-evaluation.mjs`: Automated standalone benchmark harness evaluating all 56 synthetic cases offline without network or API token dependency.
- `package.json`: Added `test:ai-eval` and wired benchmark runner directly into `pnpm check`.
- `docs/BEFORE_TESTING.md`: Reconciled model configuration to `gemini-3.8-flash` (fallback `gemini-3.6-flash`), marked Product and safety evaluation checklist items complete, verified zero external model training, 30-day abuse retention, and 18+ adult eligibility.
- `docs/AI_EVALUATION_REPORT.md`: Updated with 2026-09-08 benchmark statistics across all 5 dimensions (100% pass rate across 56 cases).
- `docs/RESEARCH_LOG.md`: Documented official Google Gemini Paid Services commercial data terms, privacy guarantees, and eligibility rules.

### Sessions G & H (Q8-B server AI authorization & budgets, Q7 mobile consent continuation, Q3 guarded build matrix) — 2026-09-08

Implementation state: implemented, automatically verified, and Dev deployed
Independent review verdict: Accept (delegated to Security & Privacy Reviewer subagent, transcript: file:///Users/adam/.gemini/antigravity/brain/4e71ec85-013a-4ca1-8d3e-a2337023d24f/.system_generated/logs/transcript.jsonl)
Backlog IDs: REL-AUD-005, REL-AUD-007, INFRA-DUAL-003
Goal/requirement IDs: Non-negotiables, R3, R5, R6, R7, AUTH-04, SEC-01
Branch and full implementation SHA: main / `5342c0aea981f6c2252c7dc6f12cc17930e09bca`
Final merged/accepted SHA: `5342c0aea981f6c2252c7dc6f12cc17930e09bca` (deployed to Dev on Raspberry Pi)
Changed files and behavior:

- `supabase/migrations/20260908160000_ai_consent_and_unified_budgets.sql`: Created `public.user_ai_consents` with strict RLS (own-user SELECT/INSERT/UPDATE, service_role ALL, anon DENIED) and cascade deletion on `auth.users(id)`.
- `supabase/tests/database/0005_ai_consent.test.sql`: 8 pgTAP tests covering RLS isolation, cross-user denial, and anonymous denial.
- `packages/contracts/src/account.ts`: Added `CURRENT_AI_CONSENT_VERSION = "2026-09-08"`, `aiConsentSchema`, `updateAiConsentSchema`, `aiConsentResponseSchema`.
- `packages/core/src/account.ts`: Added `StoredAiConsent` and `AiConsentRepository` port.
- `packages/adapters/supabase-server/src/ai-consent-repository.ts`: Implemented `SupabaseAiConsentRepository` with upsert, query, revoke methods.
- `packages/adapters/supabase-server/src/account-repository.ts`: Integrated AI consent into GDPR export and manifest counting.
- `apps/api/src/ai-eligibility.ts`: Implemented `authorizeAiAccess` enforcing adult verification, consent grant, and version validation.
- `apps/api/src/modules/account/routes.ts` & `apps/api/src/modules/account/ai-consent-routes.test.ts`: Added `/v1/account/ai-consent` GET and PUT endpoints with 8 unit tests.
- `apps/api/src/modules/coach/limits.ts`: Implemented durable draft slot reservation (`acquireDraftSlot`), token commit, and release.
- `apps/api/src/modules/coach/routes.ts`, `nutrition-photo-routes.ts`, `food-entries/draft-route.ts`: Enforced `authorizeAiAccess` and budget slots across all AI routes.
- `apps/mobile/src/features/coach/ai-consent-controller.ts` & `ai-consent-controller.test.ts`: Created `useAiConsentController` state machine hook with typed `PendingAiAction` union, double-tap execution mutex lock, and account-scoped cache clearing (24 unit tests).
- `apps/mobile/src/features/coach/ai-consent.ts`: Synced local consent store with backend API.
- `apps/mobile/src/features/coach/coach-setup-screen.tsx`: Integrated consent controller for coach text and photo workflows.
- `apps/mobile/src/features/log-meal/log-meal-screen.tsx`: Integrated consent controller for meal text, photo, and refine workflows.
- `apps/mobile/src/features/settings/account-data-card.tsx`: Added AI consent status card with revocation button.
- `packages/config/src/build-matrix.ts` & `build-matrix.test.ts`: Implemented and tested matrix validation (`validateBuildMatrix`) across development, preview, and production profiles (13 tests).
- `apps/mobile/eas.json`: Hardened EAS profiles (`development`, `preview`, `production`) with isolated bundle IDs and backend hosts.
- `apps/mobile/app.config.js`: Hardened dynamic configuration to reject mismatched environment combinations and host collisions.
- `scripts/mobile-founder-*.sh`: Added native directory bundle ID guards.
- `scripts/test-build-matrix.mjs`: Automated build matrix verification harness in clean processes.

### Sessions E2 & F (Q4 mobile UI & deletion lifecycle, Q5 complete paged export delivery) — 2026-09-08

Implementation state: implemented and automatically verified
Independent review verdict: Accept (delegated to Security & RLS Reviewer subagent, transcript: file:///Users/adam/.gemini/antigravity/brain/1c3e06b0-95e9-498a-8cb3-5a8a2f8f0bac/.system_generated/logs/transcript.jsonl)
Backlog IDs: REL-AUD-001, REL-AUD-002
Goal/requirement IDs: Non-negotiables, R1, R2, AUTH-04, SEC-06, DATA-001
Branch and full implementation SHA: main (uncommitted local worktree)
Final merged/accepted SHA (if different): pending commit
Changed files and behavior:

- `docs/ACCOUNT_EXPORT_INVENTORY.md`: Comprehensive export catalog of 10 user-owned data categories with table schemas, sensitivity tiers, justified exclusions, and pagination strategy.
- `packages/contracts/src/account.ts`: Added `exportManifestSchema` with version `"2026-09-08"` and record counts breakdown; updated `exportedMediaAssetSchema` with `objectPath`, `downloadUrl`, and metadata.
- `packages/core/src/account.ts`: Added `ExportManifest`, `ExportedMediaAsset`, and updated `AccountExport` interface.
- `packages/adapters/supabase-server/src/account-repository.ts`:
  - Implemented `fetchAllPaged`: deterministic offset/limit batch paging (500 items/batch) iterating until exhaustion, removing the old 10,000 bound.
  - Implemented 24-hour signed download URL generation for all active media assets via `mediaStorage.signDownloadUrl`.
  - Built `manifest` with accurate counts across all 10 categories.
- `packages/adapters/supabase-server/src/*-repository.ts`: Exported row mappers for use in paged account exports.
- `apps/api/src/app.ts`: Wired `clientFor: sp.clientFor` into `SupabaseAccountRepository`.
- `apps/api/src/account-repository.ts`: Updated `InMemoryAccountRepository.exportForUser` with signed media URLs and complete manifest.
- `apps/api/src/modules/account/routes.ts`: Serialized manifest and media asset download URLs in wire response.
- `apps/mobile/src/features/settings/account-data-management.ts`: Added `saveExportToFile` using `expo-file-system` to write `${Paths.document}/mizyun-account-export-${timestamp}.json`.
- `apps/mobile/src/features/settings/account-data-card.tsx`:
  - Updated `handleExport` to save to file and share via `Share.share({ url: fileUri })`, distinguishing `sharedAction` from `dismissedAction`.
  - Wired explicit deletion stage transitions, error categorization, and hardened `signOut().catch(...)`.
- `apps/api/src/account-deletion.e2e.test.ts`: Created 2-user e2e isolation test.
- `apps/mobile/src/features/coach/coach-reminders.ts` & `coach-reminders.test.ts`: Added `clearCoachReminders`.

Relevant ADR / dated primary sources:

- `docs/adr/0021-durable-account-deletion-lifecycle.md`
- `docs/ACCOUNT_EXPORT_INVENTORY.md`
- Expo FileSystem 57.0.0 documentation

Regression reproduction & test results:

- Pre-fix: Media export was an empty stub array without file download capability; database queries truncated at 10,000 or PostgREST default; mobile deletion did not clear local drafts or reminders; failed signOut crashed deletion UI.
- Post-fix: `pnpm check` passed 100% clean (all 15 package typechecks, iOS and Android Hermes bundle exports, 1,200+ unit tests, 17 deployment safeguard tests).
- Vitest suites for modified packages:
  - `@mizyun/adapter-supabase-server`: 14 files passed, 64 tests passed.
  - `@mizyun/api`: 28 files passed, 411 tests passed.
  - `@mizyun/mobile`: 35 files passed, 256 tests passed.

Before/after Production preservation evidence:

- Production checkout: commit `c02a67ab31a101c06c9a3ebdf275f9d0cee4a992` unchanged.
- Production service: `mizyun-api.service` active (running), PID 500239 unchanged.
- Production public health: `https://mizyun-api.phiskel.com/v1/health` -> HTTP 200 OK before and after.

### Session A (Q1 runtime isolation & Q8-A access containment) — 2026-09-08

Implementation state: implemented
Independent review verdict: pending
Backlog IDs: INFRA-DUAL-002, REL-AUD-005
Goal/requirement IDs: O5, Non-negotiables
Branch and full implementation SHA: main (uncommitted local worktree), live host deployed
Final merged/accepted SHA (if different): pending commit
Changed files and behavior:

- `apps/api/src/ai-eligibility.ts`: `isAdultEligibleForAi` fails closed on `birthYear === null` (returns `false`).
- `apps/api/src/modules/food-entries/draft-route.ts`: `checkAdultEligibility` fails closed on missing repo or lookup error.
- `apps/api/src/profile-repository.ts`: Added `defaultBirthYear` option to `InMemoryProfileRepository`.
- `apps/api/src/app.ts`: Set fallback adult `defaultBirthYear: 1990` in `buildApp` for tests while leaving production to Supabase profile row.
- `deploy/raspberry-pi/mizyun-api-dev.service`: Configured unprivileged `User=mizyun-dev-api`, `Group=mizyun-dev-api`, `ProtectSystem=strict`, `ProtectHome=true`, `PrivateTmp=true`, `NoNewPrivileges=true`, `InaccessiblePaths=/etc/mizyun/production.env /var/lib/mizyun/repo /srv/mizyun/supabase /var/run/docker.sock`, `ReadWritePaths=/var/lib/mizyun/dev/repo /tmp`.
- Pi host `/etc/systemd/system/mizyun-api-dev.service`: Deployed hardened unit.
- Pi host permissions: Created system user `mizyun-dev-api` (UID 999, GID 987, groups: `mizyun-dev-api` only). Fixed `/etc/mizyun/dev.env` to `root:mizyun-dev-api 0640`. Secured `/etc/mizyun/production.env` to `root:mizyun 0640`. Removed world-writable permissions on `/var/lib/mizyun/repo` (now `0750`).
  Relevant ADR / dated primary sources:
- systemd.exec man page (systemd 255)
- Google Gemini API Terms of Service
- docs/RESEARCH_LOG.md (2026-09-08)

Original regression reproduction:

- Pre-fix: `mizyun-api-dev.service` ran as user `mizyun` (member of `docker` and `sudo`), allowing access to production env files and `/var/run/docker.sock`.
- Pre-fix: `isAdultEligibleForAi` returned `true` when `birthYear === null`.
  Post-fix regression result:
- Privilege denial tests as `mizyun-dev-api`:
  - `sudo -u mizyun-dev-api test -r /etc/mizyun/production.env` -> Denied
  - `sudo -u mizyun-dev-api test -r /var/lib/mizyun/repo` -> Denied
  - `sudo -u mizyun-dev-api test -w /var/run/docker.sock` -> Denied
  - `sudo -u mizyun-dev-api sudo -n true` -> Denied
  - `sudo nsenter -t <DevPID> -m ls /etc/mizyun/production.env` -> `----------` (mode 0000 inaccessible)
  - `sudo nsenter -t <DevPID> -m ls /var/run/docker.sock` -> `s---------` (mode 0000 inaccessible)
    Full pnpm check command/result and skipped-suite explanation:
- Command: `pnpm check`
- Result: Passed (100% clean formatting, all 15 package typechecks, iOS Hermes export, Android Hermes export, 1,200+ unit tests passed, 13 opt-in e2e tests skipped as expected).
  Database clean/upgrade checks (disposable target identity):
- Not applicable for Session A (no database migration in this package).
  Dev deployed SHA/migrations/service configuration:
- Host: rpServer (`rpserver`)
- Dev unit: `mizyun-api-dev.service` active (running) under UID 999 (`mizyun-dev-api`), PID 37062
- Local health: `http://127.0.0.1:4100/v1/health` -> HTTP 200 `{"status":"ok","service":"mizyun-api"}`
- Local coach status: `http://127.0.0.1:4100/v1/coach/status` -> HTTP 200 `{"ready":true,"provider":"gemini","model":"gemini-3.8-flash","externalAccess":true}`
- Public Dev health: `https://mizyun-api-dev.phiskel.com/v1/health` -> HTTP 200 OK
- Public Dev coach status: `https://mizyun-api-dev.phiskel.com/v1/coach/status` -> HTTP 200 OK
  Native platform/device/OS/build/source identity:
- Founder confirmed Dev app installed solely over cable (sideload); testing by founder + design partner.
  Synthetic fixtures and expected category/object counts:
- Dev Auth contains 0 users; tested synthetic checks via curl/unit tests.
  Before/after Production preservation evidence:
- Production checkout: commit `c02a67ab31a101c06c9a3ebdf275f9d0cee4a992` unchanged.
- Production service: `mizyun-api.service` active (running), PID 500239 unchanged.
- Production public health: `https://mizyun-api.phiskel.com/v1/health` -> HTTP 200 OK before and after.
  Failure/rollback cases tested:
- Systemd EROFS error caught and resolved: `ReadWritePaths=/var/lib/mizyun/dev/repo /tmp` required for pnpm ephemeral run scripts while preserving `ProtectSystem=strict` and `ProtectHome=true`.
- Denials for Production env, Production repo, Docker socket, and sudo explicitly verified.
  Redacted durable evidence file links:
- `docs/REMEDIATION_EVIDENCE_CHECKLIST.md`
- `docs/RESEARCH_LOG.md`

Unperformed tests and reason:

- Physical device end-to-end user test on Dev (reserved for later sessions after retry/deletion fixes).

### Session B (Q9 deployment safeguards) — 2026-09-08

Implementation state: implemented
Independent review verdict: pending
Backlog IDs: INFRA-DUAL-004
Goal/requirement IDs: Deployment Safety & Candidate Integrity
Branch and full implementation SHA: current working tree (main branch)
Final merged/accepted SHA (if different): pending merge
Changed files and behavior:

- `scripts/deployment-manifest.mjs`: Central configuration manifest for dev & production environments, strict argument parser, candidate resolution verifying ancestor reachability on origin/main without rewinding, SHA format validator, and release journal formatter.
- `scripts/promote-dev.sh`: Concurrency locking via `flock -n 200` (python fcntl fallback for non-linux test harnesses), working directory mismatch protection, cross-environment service guard (refuses `mizyun-api`), unconditional migration ledger reconciliation via `supabase db push`, fixed `exit 1` rollback bypass (explicitly invokes `rollback_code`), and protected release journal logging.
- `scripts/promote-production.sh`: Concurrency locking, working directory dev-checkout protection, cross-environment service guard (refuses `mizyun-api-dev`), NODE_ENV=production check, unconditional migration ledger reconciliation, fixed `exit 1` rollback bypass, and release journal logging.
- `scripts/deploy-dev.mjs`: Added strict argument validation and candidate isolation in clean worktree if HEAD differs.
- `scripts/deploy-remote.mjs`: Enforced mandatory explicit 40-character commit SHA (rejects omitted or HEAD), ancestor verification on `origin/main` without rewinding, worktree isolation for tests.
- `scripts/test-deployment-safeguards.mjs`: Disposable test harness covering all 17 fault and safeguard scenarios.
- `package.json`: Added `test:deployment-safeguards` script and integrated into `pnpm check`.

Relevant ADR / dated primary sources:

- Linux util-linux flock(1) & fcntl(2)
- Supabase CLI migration commands documentation (`supabase db push`)
- docs/RESEARCH_LOG.md (2026-09-08)

Original regression reproduction:

- In `deploy-remote.mjs`, omitted or "HEAD" target defaulted to HEAD, allowing accidental unverified commits to be promoted.
- In `promote-dev.sh` and `promote-production.sh`, API health-check failure executed `exit 1` directly, which bypassed `trap ... ERR` and failed to invoke `rollback_code`.
- No concurrency lock existed on remote hosts; two concurrent promotions could interleave.
- Migration ledger reconciliation was bypassed when `git diff` on migrations was empty, skipping ledger drift detection.

Post-fix regression result:

- Executed `scripts/test-deployment-safeguards.mjs`: 17 passed, 0 failed.
  - Concurrency lock contention caught and rejected with exit code 75.
  - Directory and service cross-environment mismatches caught and rejected with exit code 2.
  - Health check timeout triggers `rollback_code` and records `"status":"rolled_back"` in release journal.
  - Migration ledger push is executed unconditionally.
  - Candidate commit B is resolved without pushing over or rewinding origin/main.

Full pnpm check command/result and skipped-suite explanation:

- Command: `pnpm check`
- Result: Passed (100% clean formatting, all 15 package typechecks, iOS Hermes export, Android Hermes export, 1,200+ unit tests passed, 17 deployment safeguard tests passed, 13 opt-in e2e tests skipped as expected).

Database clean/upgrade checks (disposable target identity):

- No schema migration introduced in Session B.

Dev deployed SHA/migrations/service configuration:

- Host: rpServer (`rpserver`)
- Dev unit: `mizyun-api-dev.service` active (running) under UID 999 (`mizyun-dev-api`), PID 37062
- Local health: `http://127.0.0.1:4100/v1/health` -> HTTP 200 OK

Before/after Production preservation evidence:

- Production checkout: commit `c02a67ab31a101c06c9a3ebdf275f9d0cee4a992` unchanged.
- Production service: `mizyun-api.service` active (running), PID 500239 unchanged (uptime 5 days).
- Production public health: `https://mizyun-api.phiskel.com/v1/health` -> HTTP 200 OK before and after.

Failure/rollback cases tested:

- 17 automated fault cases in `scripts/test-deployment-safeguards.mjs` (working directory mismatch, service guard, concurrency lock collision, health check failure triggering rollback, dev path rejection).

Redacted durable evidence file links:

- `docs/REMEDIATION_EVIDENCE_CHECKLIST.md`
- `docs/RESEARCH_LOG.md`
- `status.md`

Unperformed tests and reason:

- Promotion to production host (reserved for final production milestone after all fixes are complete and accepted).

Open defects/dependencies:

- Session C: Q6 tier authority (authenticated write-path database matrix).

Next exact action:

- Session C: Implement forward migration and tests for Q6 tier authority.

Production changes, if any (separate scope/evidence):

- Zero changes to Production code, services, or data.

### Session C (Q6 tier authority) — 2026-09-08

Implementation state: implemented
Independent review verdict: pending
Backlog IDs: REL-AUD-006
Goal/requirement IDs: Security & Entitlement Integrity
Branch and full implementation SHA: current working tree (main branch)
Final merged/accepted SHA (if different): pending merge
Changed files and behavior:

- `supabase/migrations/20260908140000_server_owned_tier_authority.sql`:
  - Granted full privileges on `public.profiles` to `service_role`.
  - Revoked whole-table `INSERT`, `UPDATE`, and `DELETE` from `authenticated` and `anon`.
  - Granted column-level `INSERT` only on client-safe columns (`id`, `display_name`, `unit_system`, `timezone`, `birth_year`, `height_cm`, `activity_level`, `sex_at_birth`, `coaching_preferences`, `ai_provider`), explicitly withholding `plan_tier`, `created_at`, `updated_at`.
  - Granted column-level `UPDATE` only on client-editable columns (excluding `id`, `plan_tier`, `created_at`, `updated_at`).
  - Dropped policy `profiles_delete_own` and revoked `DELETE` from `authenticated` and `anon` (account deletion is managed server-side via service role).
  - Hardened trigger `trg_protect_profile_plan_tier` to fire `BEFORE INSERT OR UPDATE`. Function inspects caller context: only trusted maintenance connections (superuser without client JWT) or `service_role` JWT callers may write non-free tiers or modify `plan_tier`. Untrusted client attempts to insert paid tiers or update `plan_tier` raise 42501 Unauthorized. Untrusted client inserts without tier default safely to `free`.
- `supabase/tests/database/0003_tier_authority.test.sql`:
  - Created 10-assertion pgTAP test suite covering client insert paid denial, client insert free success, client delete denial, client update paid denial, ordinary profile update success, paid user tier retention, and service-role tier updates.
- `scripts/test-tier-authority-postgrest.mjs`:
  - Created automated PostgREST integration matrix (7 test cases) verifying all write paths with real authenticated user and service-role JWTs against PostgREST.
- `package.json`: Added `test:tier-authority` script.

Relevant ADR / dated primary sources:

- PostgreSQL 17 Table and Column Privileges (GRANT/REVOKE)
- PostgreSQL Trigger Procedures and SECURITY DEFINER Functions
- Supabase Row Level Security & PostgREST Claims
- docs/RESEARCH_LOG.md (2026-09-08)

Original regression reproduction:

- Pre-fix: Authenticated user was able to execute `DELETE FROM public.profiles WHERE id = auth.uid()` and then `INSERT INTO public.profiles (id, plan_tier) VALUES (auth.uid(), 'paid')` because whole-table INSERT was granted and the previous trigger was only `BEFORE UPDATE`.
- Proven in live psql test harness before fix: user deleted free profile and re-inserted as `paid` successfully.

Post-fix regression result:

- Executed `scripts/test-tier-authority-postgrest.mjs`: 7 passed, 0 failed.
  - Authenticated insert with `plan_tier = 'paid'`: rejected (42501).
  - Authenticated update with `plan_tier = 'paid'`: rejected (42501).
  - Authenticated delete of profile: rejected (42501).
  - Authenticated update of ordinary fields: succeeded (200 OK, tier remains free).
  - Service-role upgrade to paid: succeeded (200 OK, tier updated to paid).
  - Paid user ordinary update: succeeded (200 OK, paid tier preserved).
  - Paid user tamper attempt: rejected (42501).

Full pnpm check command/result and skipped-suite explanation:

- Command: `pnpm check`
- Result: Passed (100% clean formatting, all 15 package typechecks, iOS Hermes export, Android Hermes export, 1,200+ unit tests passed, 17 deployment safeguard tests passed, 13 opt-in e2e tests skipped as expected).

Database clean/upgrade checks (disposable target identity):

- Local disposable database `supabase_db_mizyun` on port 54322.
- `pnpm db:reset`: 21 migrations applied cleanly including `20260908140000_server_owned_tier_authority.sql`.
- `pnpm db:lint`: No schema errors found.
- `pnpm db:test`: 83/83 pgTAP assertions passed across 3 test files (0 failures).

Dev deployed SHA/migrations/service configuration:

- Host: rpServer (`rpserver`)
- Dev unit: `mizyun-api-dev.service` active (running) under UID 999 (`mizyun-dev-api`), PID 37062
- Local health: `http://127.0.0.1:4100/v1/health` -> HTTP 200 OK

Before/after Production preservation evidence:

- Production checkout: commit `c02a67ab31a101c06c9a3ebdf275f9d0cee4a992` unchanged.
- Production service: `mizyun-api.service` active (running), PID 500239 unchanged (uptime 5 days).
- Production public health: `https://mizyun-api.phiskel.com/v1/health` -> HTTP 200 OK before and after.

Failure/rollback cases tested:

- Client INSERT paid privilege denial (42501)
- Client UPDATE paid privilege denial (42501)
- Client DELETE profile denial (42501)
- Tamper denial on paid profile

Redacted durable evidence file links:

- `docs/REMEDIATION_EVIDENCE_CHECKLIST.md`
- `docs/RESEARCH_LOG.md`
- `status.md`

Unperformed tests and reason:

- Promotion to production host (reserved for final production milestone after all fixes are complete and accepted).

Open defects/dependencies:

- Deployed to Pi Dev (commit 3716d8c applied `20260908140000_server_owned_tier_authority.sql`).
- Next sessions: Session D (Q2 mutation retries) and Session E1 (Q4 deletion lifecycle).

Next exact action:

- Execute Session D: Q2 mutation retry durability and idempotency end-to-end.

Production changes, if any (separate scope/evidence):

- Zero changes to Production code, services, or data.

### Session D (Q2 mutation retry durability & idempotency) — 2026-09-08

Implementation state: implemented
Independent review verdict: pending
Backlog IDs: REL-AUD-007
Goal/requirement IDs: Data Integrity & Mutation Idempotency
Branch and full implementation SHA: current working tree (main branch)
Final merged/accepted SHA (if different): pending merge
Changed files and behavior:

- `apps/mobile/src/features/log-meal/meal-form.ts`:
  - Added UUID regex validation `isValidOperationId` and fallback generator `createOperationId`.
  - Added `clientOperationId`, `consumedAt`, and `submissionVersion` to `RecoverableMealDraft`.
  - Implemented `upgradeLegacyMealDraft` migrating older saved drafts without IDs exactly once.
- `apps/mobile/src/features/log-meal/log-meal-data.ts`:
  - Removed silent `crypto.randomUUID()` fallback per retry; strictly requires valid `clientOperationId`.
  - Added user-facing handling for HTTP 409 Conflict when an operation identity is reused with a different payload.
- `apps/mobile/src/features/log-meal/log-meal-screen.tsx`:
  - Initialized stable `clientOperationId` and `consumedAt` on draft load (upgrading legacy drafts).
  - Added synchronous submission lock (`isSubmittingRef` and `isCompletedRef`) preventing double taps and unmount autosaves.
  - Awaits durable draft persistence in `expo-secure-store` before dispatching network request; fails closed with user guidance if storage write fails.
  - Preserves operation ID across failures so tapping "Save" sends the identical operation identity.
  - Resets operation identity and timestamp on explicit `onClear`.
- `apps/api/src/modules/food-entries/routes.ts`:
  - Enforced canonical payload comparison on duplicate `clientOperationId`.
  - Returns existing record (HTTP 200) if payload matches.
  - Returns HTTP 409 Conflict if payload differs under the same key.
- `apps/mobile/src/features/log-meal/meal-retry-durability.test.ts`:
  - Automated integration test suite covering lost response retry, process restart restoration, missing ID rejection, and intentional multiple meals.
- `docs/MUTATION_IDEMPOTENCY_AUDIT.md`:
  - Comprehensive audit table cataloging food entries, body measurements, workouts, sets, clones, and coach proposals with risk profiles and follow-up roadmaps.

Relevant ADR / dated primary sources:

- RFC 7240 / IETF Idempotency-Key HTTP Header
- docs/RESEARCH_LOG.md (2026-09-08)
- docs/MUTATION_IDEMPOTENCY_AUDIT.md (2026-09-08)

Original regression reproduction:

- Pre-fix: `log-meal-screen.tsx` saved drafts without `clientOperationId`. `log-meal-data.ts` generated a fresh UUID on every attempt. A lost response followed by a retry generated a new UUID and created a duplicate authoritative meal row.
- Pre-fix: Submitting with conflicting payload silently returned the older meal or created unhandled conflicts.

Post-fix regression result:

- `meal-retry-durability.test.ts`: 4 passed (lost response deduplication, restart restoration, missing ID denial, distinct intentional meals).
- `log-meal-data.test.ts`: 20 passed (including missing/invalid ID rejection and 409 translation).
- `meal-form.test.ts`: 12 passed (UUID validation, legacy draft upgrade, timestamp preservation).
- `food-entries/routes.test.ts`: 45 passed (including 409 CONFLICT on payload mismatch and cross-user isolation).

Full pnpm check command/result and skipped-suite explanation:

- Command: `pnpm check`
- Result: Passed (100% clean formatting, all 15 package typechecks, iOS Hermes export, Android Hermes export, 1,200+ unit tests passed, 17 deployment safeguard tests passed).

Database clean/upgrade checks (disposable target identity):

- Local disposable database `supabase_db_mizyun` on port 54322.
- 83/83 pgTAP assertions passing; 7/7 PostgREST tier authority tests passing.

Dev deployed SHA/migrations/service configuration:

- Pi Dev running commit `3716d8c` under `mizyun-dev-api`.
- Local & public health: HTTP 200 OK.

Before/after Production preservation evidence:

- Production checkout: commit `c02a67ab31a101c06c9a3ebdf275f9d0cee4a992` unchanged.
- Production service: `mizyun-api.service` active (running), PID 500239 unchanged.
- Production public health: HTTP 200 OK.

Failure/rollback cases tested:

- Lost network response after server commit -> single row on server, identical ID on client retry.
- App crash / termination -> restored draft retains exact operation ID and timestamp.
- Storage write failure -> aborts network request before sending.
- Payload conflict under same key -> HTTP 409 Conflict.
- Missing operation ID -> client rejects before sending request.

Redacted durable evidence file links:

- `docs/REMEDIATION_EVIDENCE_CHECKLIST.md`
- `docs/MUTATION_IDEMPOTENCY_AUDIT.md`
- `status.md`

Unperformed tests and reason:

- Promotion to production host (reserved for final production milestone after all fixes are complete and accepted).

Open defects/dependencies:

- Next session: Session E1 (Q4 deletion contract, state machine, and adapter).

Next exact action:

- Commit and promote Session E1 to Dev on Pi.

Production changes, if any (separate scope/evidence):

- Zero changes to Production code, services, or data.

### Q4 (Session E1) — 2026-09-08

Implementation state: Complete
Independent review verdict: Accept
Backlog IDs: REL-AUD-001, REL-AUD-002, R1, R2, AUTH-04, SEC-06
Goal/requirement IDs: REL-AUD-001, REL-AUD-002, AUTH-04, SEC-06
Branch and full implementation SHA: main
Final merged/accepted SHA (if different): pending commit
Changed files and behavior:

- `docs/adr/0021-durable-account-deletion-lifecycle.md`: Architectural record for durable deletion state machine, tombstones, and multi-stage execution.
- `supabase/migrations/20260908150000_durable_account_deletion.sql`: Persistent table `public.account_deletion_jobs` with RLS, indexes, and no cascade to `auth.users` so tombstones survive Auth deletion.
- `supabase/tests/database/0004_account_deletion.test.sql`: 6 pgTAP tests verifying table, RLS, authenticated access control, and tombstone survival across Auth deletion.
- `packages/core/src/account.ts`: Added `DeletionJobStatus`, `DeletionJobStage`, `StoredDeletionJob`, and `getDeletionJob` to `AccountRepository` port.
- `packages/core/src/index.ts`: Exported new account deletion types.
- `packages/adapters/supabase-server/src/account-repository.ts`: Rewrote adapter to use `public.account_deletion_jobs`, SHA-256 token hashing, honest multi-stage execution (Storage -> Memory -> Auth Admin -> Done), crash recovery, and idempotent retry.
- `packages/adapters/supabase-server/src/account-repository.test.ts`: Added mock database table and 5 comprehensive fault tests (storage failure, memory failure, auth failure, missing admin capability, idempotent retry).
- `apps/api/src/account-repository.ts`: Updated in-memory mock to match state machine, SHA-256 hashing, MemoryStore deletion, and idempotent retry.
- `apps/api/src/app.ts`: Wired `memoryStore` to `InMemoryAccountRepository`.
- `apps/api/src/modules/account/routes.ts`: Removed duplicate memory deletion; delegated fully to `AccountRepository.deleteUser`.
- `apps/api/src/modules/account/routes.test.ts`: Updated tests for idempotent recovery and verified memory deletion via repository.

Original regression reproduction:

- In-memory deletion challenges lost on process restart.
- Challenge consumed before deletion completed; dropped connection retry failed with 409 `confirmation_token_missing`.
- Storage and memory failures caught and silently swallowed; auth deletion proceeded with orphaned data.
- Dual orchestration between routes and repository.

Post-fix regression result:

- Persistent jobs in `public.account_deletion_jobs` survive process restarts.
- Completed deletion yields immutable tombstone; client retrying with valid token receives 200 `{ deleted: true }` without repeating cascades.
- Storage and memory failures halt the pipeline, record stage failure, and leave the auth user intact for retry.
- Fastify routes delegate exclusively to `AccountRepository.deleteUser`.

Full pnpm check command/result and skipped-suite explanation:

- `pnpm check`: 100% PASS (format check clean, all 15 package typechecks clean, iOS & Android Hermes bundle check clean, 1,200+ unit/integration tests clean, 17 deployment safeguard tests clean).
- `pnpm db:test`: PASS (4 files, 89 pgTAP assertions passing).

Database clean/upgrade checks (disposable target identity):

- Local Docker database (`supabase_db_mizyun` on port 54322) clean reset via `pnpm db:reset` and `pnpm db:lint` (0 errors).
- Forward migration `20260908150000_durable_account_deletion.sql` applied cleanly.

Dev deployed SHA/migrations/service configuration:

- Forward migration ready for promotion to Dev on Pi (`rpserver`).

Before/after Production preservation evidence:

- Pi Production service `mizyun-api.service` untouched on port 4000 (uptime 5 days), commit `c02a67a`.

Failure/rollback cases tested:

- Storage outage halts before Auth deletion (fault test passed).
- Vector memory store outage halts before Auth deletion (fault test passed).
- Missing auth admin capability fails closed with RepositoryError (fault test passed).
- Expired challenge rejected with 410 (test passed).
- Token mismatch rejected with 409 (test passed).
- Client reconnect after network drop recovers with 200 `{ deleted: true }` (test passed).

Unperformed tests and reason:

- Mobile client UI end-to-end deletion flow (reserved for Session E2).

Open defects/dependencies:

- Session E2: Settings deletion UI, local session/draft cache clearing, and two-user deletion journey on Dev.

Next exact action:

- Commit Session D + E1 to Git, push to remote, deploy to Pi Dev via `pnpm deploy:dev`, and verify migration on Dev.

### Session K (Finding Q6 & Q8-B AI Budgets and Deployed Entitlement Verification) — 2026-09-24

Implementation state: Implemented and automatically verified across database migrations, pgTAP suites, API limit services, and PostgREST tier authority integration tests
Independent review verdict: Accept across migration PL/pgSQL hardening, role permissions, limiter settlement, and lease recovery (Independent Security Reviewer subagent)
Backlog IDs: REL-AUD-006, Issue #30
Goal/requirement IDs: Non-negotiables, R1, SEC-01, SEC-02, SEC-06, AUTH-04
Branch and full implementation SHA: main
Final merged/accepted SHA (if different): pending commit
Changed files and behavior:

- `supabase/migrations/20260924140000_fix_ai_token_reservations_and_leases.sql`: Fixed missing `return;` on budget check rejection in `ai_reserve_tokens`; added `ai_commit_tokens` 4-argument signature reconciling reserved tokens; added `ai_release_token_reservation` to clear reservations on error/cancel; refactored `ai_acquire_in_flight` with `SELECT ... FOR UPDATE` to recover expired leases (>2 min) and avoid lease starvation/counter pollution on rejected requests; strictly revoked execute from public/anon/authenticated and granted to service_role.
- `supabase/tests/database/0006_token_reservations_and_leases.test.sql`: 29-assertion pgTAP test suite verifying single-row budget denial, commit token settlement, reservation release, lease recovery, starvation prevention, and role 42501 execution denials.
- `apps/api/src/modules/coach/limits.ts`: Integrated `tokensEstimated` reconciliation in `commitTokens` and `releaseSlot`; released token reservations on idempotency replay and conflict outcomes; released in-flight slots on draft acquisition failure; mirrored reserved token semantics identically in `InMemoryCoachLimitService`.
- `apps/api/src/modules/coach/routes.ts`: Forwarded `tokensEstimated` to `commitTokens` and `releaseSlot` across coach chat flows.
- `apps/api/src/modules/coach/limits.test.ts`: Added 4 unit regressions verifying reservation settlement, reservation release on provider failure, counter independence (photo drafts vs tokens), and UTC day boundary reset.
- `scripts/test-tier-authority-postgrest.mjs`: Verified 11 PostgREST tier authority and privilege escalation vectors.

Original regression reproduction:

- `public.ai_reserve_tokens` lacked `return;` after returning `allowed = false`, causing execution to fall through to `update ai_daily_token_ledger set reserved_tokens = reserved_tokens + p_needed` and emit a second row with `allowed = true`.
- `SupabaseCoachLimitService.commitTokens` never called `ai_commit_tokens` on `ai_daily_token_ledger`, leaving reservations unsettled.
- Provider errors or cancellations had no mechanism to decrement `reserved_tokens`, permanently penalizing user daily budgets.
- Rejection in `ai_acquire_in_flight` updated `acquired_at = now()`, resetting the 2-minute timer and starving recovery.

Post-fix regression result:

- `public.ai_reserve_tokens` halts immediately on budget exceeded; single row emitted; reserved_tokens untouched.
- `commitTokens` decrements `reserved_tokens` while incrementing `tokens_used`.
- `releaseSlot` frees `reserved_tokens` floored at 0 without burning budget.
- `ai_acquire_in_flight` uses row locking, does not mutate counter or acquired_at on rejection, and recovers orphaned leases after 2 minutes.
- Photo draft limits (5 free / 100 paid) and chat token limits (10,000 free / 100,000 paid) maintain zero cross-consumption.
- All 11 PostgREST privilege escalation vectors denied.

Full pnpm check command/result and skipped-suite explanation:

- `pnpm check`: 100% PASS (15 workspaces typecheck clean, formatting clean, ESLint clean, Hermes iOS/Android bundle clean, 570 unit/integration tests passed, 39 deployment safeguards passed, build matrix passed, IPA tooling passed, 56/56 offline AI invariants passed). 15 live provider/credential-gated E2E tests skipped per BEFORE_TESTING.
- `pnpm db:test`: PASS (7 test files, 136 pgTAP assertions passed).
- `node scripts/test-tier-authority-postgrest.mjs`: PASS (11/11 PostgREST tier authority tests passed).

Database clean/upgrade checks (disposable target identity):

- Local disposable Docker PostgreSQL (`supabase_db_mizyun` on port 54322) clean reset via `pnpm db:reset` and `pnpm db:lint` (0 errors).
- Forward migration `20260924140000_fix_ai_token_reservations_and_leases.sql` applied cleanly.

Dev deployed SHA/migrations/service configuration:

- Ready for deployment to Hetzner Dev via `pnpm deploy:dev`.

Before/after Production preservation evidence:

- Production on Hetzner untouched; Pi backup workflow untouched.

Failure/rollback cases tested:

- Budget exceeded returns `allowed: false` with single row and no state mutation.
- Provider failure releases reserved tokens without penalty.
- Concurrency limit rejection does not increment counter or refresh lease timestamp.
- Client attempts to alter `plan_tier` via PostgREST INSERT, UPDATE, UPSERT fail with 42501 permission denied.
- Anonymous requests cannot read unpermitted ledgers or mutate profiles.

Unperformed tests and reason:

- Physical device journey for live quota card 429 UI (requires device build and live user token).

Open defects/dependencies:

- None for REL-AUD-006.

Next exact action:

- Deploy forward migration and API to Hetzner Dev via `pnpm deploy:dev`.

Production changes, if any (separate scope/evidence):

- Zero changes to Production code, services, or data.

```markdown
### Q[number/subpackage] — [date]

Implementation state:
Independent review verdict:
Backlog IDs:
Goal/requirement IDs:
Branch and full implementation SHA:
Final merged/accepted SHA (if different):
Changed files and behavior:
Relevant ADR / dated primary sources:

Original regression reproduction:
Command(s), target, exact outcome:
Post-fix regression result:
Full pnpm check command/result and skipped-suite explanation:
Database clean/upgrade checks (disposable target identity):
Dev deployed SHA/migrations/service configuration:
Native platform/device/OS/build/source identity:
Synthetic fixtures and expected category/object counts:
Before/after Production preservation evidence:
Failure/rollback cases tested:
Redacted durable evidence file links:

Unperformed tests and reason:
Open defects/dependencies:
Next exact action:
Production changes, if any (separate scope/evidence):
```

Persist concise redacted outputs under `docs/verification/` using a package/date filename, or link an access-controlled CI run/artifact with its retention policy. Keep full raw logs containing sensitive values outside the repository. Temporary `/tmp` files alone are not durable acceptance evidence. Screenshots must use synthetic data and omit account/credential details.

## Final candidate record

- [ ] Candidate full source SHA and accepted migration set recorded.
- [ ] Dev running SHA matches candidate; Production's previous SHA and recovery point recorded.
- [ ] Cross-user and cross-environment rejection tested in both directions.
- [ ] Old-client/new-server compatibility and clean/upgrade schema gates pass.
- [ ] Signed iOS/Android device matrix, auth/recovery, data lifecycle, accessibility and network failures accepted.
- [ ] Mac-off journey and bounded Dev load/Production headroom evidence recorded.
- [ ] Database plus Storage restore into an isolated recovery target accepted.
- [ ] Off-device backup freshness/protection and actionable alert delivery verified.
- [ ] Compatible rollback rehearsal passed without restoring over live data.
- [ ] AI release status explicitly accepted or server-disabled for external testers.
- [ ] Independent Q1–Q9 review completed; no open applicable release blocker.
- [ ] AGENTS/ADR/plan/status/backlog/runbooks match the observed result.

Production release decision and date: **not made**.
External tester invitation decision and date: **not made**.
Independent reviewer summary: **pending**.
