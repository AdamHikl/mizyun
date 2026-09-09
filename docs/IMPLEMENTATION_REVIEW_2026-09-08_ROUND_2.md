# Implementation review — round 2, 2026-09-08

Review performed September 8; documentation and handoff finalized September 9, 2026.

## Decision and scope

**Do not close Q1–Q9 or promote this candidate for initial external testers yet.** Substantial implementation exists, but the Session J blanket acceptance is contradicted by current source, fresh probes, and live permissions. Both environment separation and release patches remain partially complete. Q6's original tier-write bypass appears repaired; its full deployed acceptance remains unverified in this review.

Reviewed Mac source `e41e2406929ec89a5328e7869466fd109e5b9b9b`, including the implementation through `425b3e01b088cf8efff3820143dde319d50281f0`. Read-only Pi inspection found Dev at that latter SHA and Production still at `c02a67ab31a101c06c9a3ebdf275f9d0cee4a992`. The Production backend therefore does not contain these fixes; the installed native artifact was not independently verified. No deployment, service restart, database reset, live provider request, or app-code modification was performed by this review.

Three independent helper agents reviewed (1) mobile retries/builds/tier authority, (2) deletion/export/privacy, and (3) consent/AI authorization/evaluation. The coordinator reviewed live host permissions, deployment scripts, probes, test output, and closure claims. Source and state-machine inspection is not physical UI acceptance. No new signed iOS/Android journey or restore rehearsal was performed.

The original [implementation plan](REMEDIATION_IMPLEMENTATION_PLAN_2026-09-08.md) still supplies the exit criteria. Findings below supplement it; historical session records are not fresh acceptance evidence. Preserve the explicitly approved shared Gemini project, Dev AI enablement for founder/testing partner, and autoconfirm exception. Those choices themselves are not defects; enforcement of the intended scope and budget remains required.

## Per-issue verdict

| Issue                      | Verdict                                           | What improved                                                             | What prevents closure                                                                                                      |
| -------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Q1 runtime isolation       | Partially fixed, P1                               | Dedicated Dev UID; Production env/repo/Docker masks; resource limits      | Dev identity reads Production backups and writes executable Dev checkout                                                   |
| Q2 retry durability        | Partially fixed, P1                               | Pre-submit operation ID/timestamp persistence and synchronous submit lock | Incomplete canonical payload comparison, editable unknown-outcome retries, restore/autosave races                          |
| Q3 build separation        | Partially fixed, P1                               | Explicit EAS variant/profile and native identity checks added             | Actual Expo entry point fails open for missing/foreign configuration; native guards fail open; signed artifacts unaccepted |
| Q4 account deletion        | Partially fixed, P1                               | Persistent job and storage failures now stop deletion                     | No complete resumable lifecycle, write barrier, concurrency claim, or reliable post-Auth recovery                          |
| Q5 account export          | Regressed, P1                                     | Broader inventory, paged queries and JSON file delivery                   | Persistent path queries nonexistent `feedback`; completeness, paging, media and native sharing gaps                        |
| Q6 tier authority          | Original bypass appears fixed; acceptance blocked | Restricted column grants and claims-aware trigger                         | Full deployed JWT/PostgREST and upgrade matrix not independently established                                               |
| Q7 consent continuation    | Partially fixed, P1/P2                            | Typed pending actions and execution mutex replace recursive flow          | Retry key lost, hidden save errors, stale account generation/version and action context                                    |
| Q8-A admission             | Partially fixed, P1                               | Intended founder/testing-partner policy documented                        | Token authentication/self-attestation alone does not enforce that bounded admission                                        |
| Q8-B eligibility/budgets   | Partially fixed, P1                               | Unknown age denied, adult attestation and current server consent checked  | Token check is not reservation; under-accounting, no aggregate money cap, crash-leaked slots                               |
| Q8-C evaluation/governance | Blocked, P1                                       | Versioned synthetic corpus and deterministic screening checks             | No measured model response quality/cost/latency; fixture checks incorrectly presented as model acceptance                  |
| Q9 promotion safety        | Partially fixed, P1                               | Explicit candidate flow, lock and rollback handlers                       | Dev accepts Production DB and `.service` alias; migration/rollback/readiness evidence incomplete                           |
| R3/R8 final release gates  | Blocked                                           | Correctly left open in prior session                                      | Signed candidate, physical journeys, standalone operation and off-device restore still required                            |

## Q1 — Production backups remain exposed to Dev

Fresh SSH permission checks, without reading backup contents, found:

```text
Dev UID/GID: mizyun-dev-api (999/987), no supplementary groups
/etc/mizyun/production.env: Dev identity denied read
/var/run/docker.sock: Dev identity denied read
/srv/mizyun/backups: mode 777
/srv/mizyun/backups/20260908T075712Z/: mode 775
.../database.dump: mode 664, mizyun:mizyun; Dev identity CAN READ
.../private-storage.tar.gz: mode 664, mizyun:mizyun
/var/lib/mizyun/dev/repo: mode 775, mizyun:mizyun-dev-api; Dev identity CAN WRITE
```

Effective unit settings mask Production env/repo/Supabase/Docker, but do not mask backups. `ProtectSystem=strict` prevents filesystem writes except allowed paths; it does not deny reading world-readable backup data. The unit explicitly allows writes to the Dev repository, enabling a compromised API to persist changes to its own executable checkout. These are residual isolation defects, despite the useful dedicated identity.

**Close with:** separate deploy-owner and runtime write permissions, private backup directory/files plus service namespace denial, minimal dedicated runtime writable paths, and actual runtime-identity denial probes for every Production asset including backup/archive parent traversal. Verify synthetic Dev functionality afterward. Do not remove existing backups as a shortcut.

Live resource snapshot: 3,983 MiB RAM, 1,493 MiB available, 1,011 MiB swap used, approximately 8 GiB filesystem free. This is inventory, not sustained concurrent-load/recovery acceptance.

## Q2 — Stable IDs do not yet make meal retries reliable

In `apps/api/src/modules/food-entries/routes.ts:264`, duplicate comparison covers name/macros but omits `consumedAt` and `details`. A fresh Fastify injection probe submitted the same operation key with changed date/details: both responses were 200, with the same ID and original values. A changed canonical payload should conflict, not silently lose the user's edits.

`apps/mobile/src/features/log-meal/log-meal-screen.tsx:245` rebuilds a persisted retry payload from editable form state. After an unknown commit outcome, changed calories can produce a permanent conflict; the ignored fields above silently return old data. Preserve an immutable submitted operation and reconcile its outcome before creating a new edited operation.

The Save control around line 958 and submit path do not gate on draft restoration. A slow restore can allow a new operation before the old one is recovered. Autosaves around line 179 are unawaited, and draft storage has no serialization/generation barrier: a pending write can recreate a cleared draft. The helper durability tests provide stable IDs and mocked deduplication rather than covering these screen/storage boundaries.

**Close with:** real screen + controlled storage/network tests for delayed restore, lost response plus edits/restart, concurrent saves, pending autosave versus clear, and complete server payload conflict checks. Other write paths in `docs/MUTATION_IDEMPOTENCY_AUDIT.md` remain follow-ups; do not close broad REL-AUD-007 based only on meal helpers.

## Q3 — The guarded matrix is not the actual build boundary

`packages/config/src/build-matrix.ts` is stricter than `apps/mobile/app.config.js:40–66`. Fresh clean-process probes of the actual Expo configuration accepted a Production profile with no URLs/callback, unrelated hostnames with a foreign callback, and an unknown build-profile value. All resolved successfully as `com.mizyun.app`. Tests of the separate matrix do not secure this entry point.

The founder iOS script assumes `ios/Mizyun.xcodeproj/project.pbxproj`, suppresses failed identity lookup and rejects only a nonempty mismatch. Missing/renamed identity therefore fails open; Android uses a similar pattern. The build-matrix runner checks script text rather than exercising real stale-project switches. `expo-dev-client` is absent despite the EAS development-client profile; EAS project settings/signing and final Android/iOS artifacts remain unverified.

**Close with:** one validator actually invoked by Expo and native scripts; reject unknown/missing profile, required host/key/callback omissions and foreign values; fail closed if native identity cannot be read; test both native variant switches and actual EAS/local entry points. Then supply signed artifact IDs, configured endpoints/callbacks, and two-app standalone device evidence. R3 Part A is not closed merely because isolated config-unit tests pass.

## Q4 — A stored deletion job is not yet resumable deletion

`packages/adapters/supabase-server/src/account-repository.ts:589–834` adds durable state but still runs a synchronous pipeline. Job transitions around line 679 have no compare-and-swap claim/per-user serialization. There is no comprehensive deleting-state barrier across direct database writes, uploads, and provider callbacks. Media enumeration around line 711 remains capped at 10,000; the media repository excludes soft-deleted rows and does not inventory bucket orphans.

After Auth deletion succeeds around line 815, a final job-write failure around line 834 cannot safely resume from that stage: the retry reruns prior stages and treats absent Auth as an error. The mobile challenge is held in React state (`account-data-card.tsx:45`); a restart loses it, issuing a new challenge refuses an in-progress job, and normal authenticated confirmation provides no durable recovery receipt/status route after account deletion or challenge expiry. These are source-level failure cases, not newly executed destructive tests.

The deletion e2e swaps token verification to Auth `/user`; production uses `getClaims`. Consequently its post-deletion 401 is not evidence that the actual API rejects an already-issued JWT. Supabase explicitly documents that deleting a user does not invalidate already-issued access tokens until expiry: [user management](https://supabase.com/docs/guides/auth/managing-user-data). Tombstone retention and restore-time reconciliation remain unimplemented/unproven.

**Close with:** atomic lifecycle ownership, resumable per-stage checkpoints and idempotent absent-resource handling; write/admission barriers; bounded full object enumeration; durable client recovery/status; actual production-auth-path token tests; failure injection before/after every external effect; complete two-user inventory and isolated backup-restoration reconciliation. Native cleanup must include exported files and report cleanup failures appropriately.

## Q5 — Persistent export currently fails, and completeness remains overstated

**Reproduced regression:** `account-repository.ts:324` queries `feedback`, while the schema and `feedback-repository.ts:67` use `user_feedback`. Production composition supplies `clientFor` (`apps/api/src/app.ts:553`), selecting this new paginated path. A fresh schema-constrained repository probe failed with `Error exporting feedback: relation public.feedback does not exist`, including when the account has no feedback. Existing adapter tests pass because they do not exercise this path against the actual table inventory.

Other residual gaps:

- `fetchAllPaged` around line 90 uses offset pagination with a nonunique sort, no stable snapshot/tie-breaker, and assumes a full 500-row page is available. A lower server cap prematurely ends enumeration.
- Goals still have a 500 limit; memories retain capped list paths. Some durable fields are omitted and consent lookup errors are ignored.
- Private media at lines 344–366 consists of expiring signed URLs, not photos saved in a portable offline archive; signing failures are swallowed while the manifest can still say `complete` (around line 492).
- Full arrays and unrestricted `Promise.all` accumulate in memory. Paging alone does not prove bounded export resource use for lifetime data.
- `account-data-card.tsx:113–117` uses React Native Share with a file URL/path message; Android attachment delivery has not been demonstrated. Saved JSON in the app document directory is not included in local account-deletion cleanup.

**Close with:** schema-backed persistent regression first, then inventory/count and stable pagination/snapshot tests above actual server limits, explicit partial-failure semantics, bounded export construction, portable private-media delivery or approved truthful scope, artifact cleanup, and offline iOS/Android file verification. Fixing the table name alone does not close Q5.

## Q6 — Original tier escalation is repaired in source

Migration `20260908140000_server_owned_tier_authority.sql` revokes broad authenticated INSERT/UPDATE/DELETE, grants safe profile columns, and adds a claims-aware INSERT/UPDATE trigger preserving trusted server writes. No new concrete bypass was found in this review. The Dev migration ledger includes this version, along with 20260908120000, 20260908150000 and 20260908160000.

The previous seven PostgREST checks do not establish the entire matrix or prove their exact deployed target. Missing independent acceptance includes INSERT/UPDATE/UPSERT branches, delete/reinsert, anonymous/cross-user/missing-claims cases, legitimate onboarding and service writes, and a realistic upgrade from the old schema. A clean reset is not an upgrade test.

**Close with:** record exact Dev target/SHA/migration and real JWT/PostgREST matrix plus clean and upgrade results. Preserve the present fix; this verdict requests evidence, not speculative rewriting.

## Q7 — Consent resumes actions, but loses key context and hides failures

`apps/mobile/src/features/coach/coach-setup-screen.tsx:435` resumes a pending send using `sendInternal(undefined, action.text)`, losing the retry key captured around lines 460–464. The send path creates a new key around line 306. A lost-response retry routed through consent can duplicate a message/provider operation.

`ai-consent-controller.ts:336–340` stores consent-save failures as state `error`, while modal visibility only covers `required` (around line 201). Coach/meal callers do not display that error or retry control. The modal closes during saving and failure can leave the user with no visible recovery.

The save completion at lines 307–330 checks user ID, not an account/action generation. A fresh extracted-controller probe with A→B→A switching dispatched a newly pending A action when the earlier A consent save completed. This is not acceptance of the new action. The probe also confirmed failed save leaves `status=error`, hidden modal, and retained pending action. React recommends invalidating stale async completions: [useEffect reference](https://react.dev/reference/react/useEffect).

`ai-consent.ts:69–90` and controller consent reads discard consent-version currency. Server rejection of obsolete consent can leave the UI believing consent is already granted. Pending refine/Coach actions also need their draft/conversation snapshot rather than mutable current screen context.

**Close with:** preserve retry key and complete action snapshot, generation-tag all async completions, display recoverable save/load errors, enforce current consent version, and test the actual rendered consumers for failure, account switching, revocation, changed conversation/draft and retries. Existing hand-built hook-dispatcher tests are useful but insufficient native/UI evidence.

## Q8 — Authorization improved; admission, cost and model evidence are incomplete

### Q8-A: enforce the approved testing scope

Authentication plus adult self-attestation/consent is not a founder/testing-partner admission boundary. `apps/api/src/plugins/authentication.ts` and `authorizeAiAccess` do not provide that allowlist. Any otherwise eligible account admitted to the public Dev system can reach enabled AI. Shared provider project/autoconfirm remain approved exceptions, not proof that only the intended people can obtain accounts. Verify direct signup/existing-account admission and a server kill switch without changing the user's approved sharing policy implicitly.

### Q8-B: token reservation is only a check

`ai_reserve_tokens` in `20260724120000_ai_ops_001_limits.sql:115–133` locks and reads usage but never increments reserved usage. After the RPC transaction ends, concurrent requests can each pass against the same remaining budget. The newly added draft paths call this function (`limits.ts:349–359`); persistent storage alone does not make it a durable reservation.

Text/photo usage commits hardcode 500/1,500 tokens instead of accounting for actual attempted calls including fallback/retries. Failed paths release without accounting for already billable work; `commitDraftTokens` ignores RPC errors. Limits remain per user, with no aggregate environment money ceiling. Persistent in-flight entries have no expiring lease, so a crash can consume capacity indefinitely. Pending work also needs deletion/revocation rechecks at actual execution boundaries.

**Close with:** atomic reserved+spent ledger and reservation ownership, reconciliation of actual cost for every attempt, conservative failure accounting, checked commits, aggregate cap/kill switch and expiring recoverable leases. Prove concurrent near-cap requests and process crashes with a real database. Credit the corrected unknown-age rejection, adult attestation and server consent checks; do not conflate them with complete budget enforcement.

### Q8-C: 56 passing fixture checks are not a model benchmark

`scripts/run-ai-evaluation.mjs:135–155` computes nutrition bounds from each fixture's own ground truth and checks fixture flags/macros. It never compares a model estimate. Lines 170–178 check that policy arrays are nonempty, not whether a response obeys them. Injection fixtures all pass through the text screener rather than actual memory/tool/image boundaries. Lines 196–205 print hard-coded simulated latency percentages and token counts.

The versioned corpus and text-screening regression checks are useful groundwork. They do not establish weighed-photo accuracy, training recommendation safety, body-photo response behavior, or measured Gemini cost/latency. The Session I/J acceptance and corresponding BEFORE_TESTING checkboxes were therefore unsupported. Actual project billing/data-use settings cannot be established by linking generic terms.

**Close with:** separate fixture/screener tests from model evaluations, define thresholds beforehand, capture redacted actual candidate/fallback responses and measured usage/latency against synthetic fixtures through real application boundaries, adjudicate failures, and evidence actual project settings. Keep live provider integration gated until prerequisite approval/configuration requirements are satisfied. No live provider test was run in this review.

## Q9 — Dev deployment still accepts Production targets

Fresh disposable mocked runs of the actual `scripts/promote-dev.sh` showed both cases exiting 0 and reporting success:

```text
Case: Dev env contains Production DB port
called: supabase db push --db-url postgresql://synthetic:synthetic@127.0.0.1:5432/postgres?sslmode=disable
called: systemctl restart mizyun-api-dev

Case: Dev service uses Production alias
called: systemctl restart mizyun-api.service
```

All commands above were fake binaries in a temporary fixture; no real migration/restart occurred. Guard at `promote-dev.sh:68` rejects literal `mizyun-api` but permits equivalent `mizyun-api.service`. The DB URL has no binding to the expected Dev database instance/port. Directory and environment-variable naming checks do not compensate for this.

Rollback at lines 94–120 can journal `rolled_back` even when restart/readiness fails. Generic HTTP health does not identify running SHA or database readiness. Historical migration checksum drift and rollback schema compatibility are not established; in-place checkout/dependency replacement affects the live service before acceptance. The existing 17-case harness does not cover the full Production install/backup/migration/restart/health failure matrix. Local remote-fetch failure handling and temporary-worktree cleanup also deserve targeted regression coverage.

**Close with:** bind canonical host/repo/service/env/database identities to a reviewed manifest, normalize service aliases, reject wrong DB before any mutation, use SHA/dependency-aware readiness, report failed recovery accurately, verify migration history and compatibility, and exercise both deployers with comprehensive stage fault injection. Repair and test locally before relying on these scripts to promote later patches.

## Verification and limitations

- `pnpm check` freshly passed formatting, typechecks, iOS/Android JS bundles, all executed workspace test suites, 17 deployment safeguard cases, and the clean-process matrix runner. API reported 422 passed/15 integration tests skipped; mobile 282 passed. Earlier-session database/e2e results were not re-reported as fresh.
- The aggregate command exited 1 at its final `tsx scripts/run-ai-evaluation.mjs` stage because the sandbox denied the tsx IPC pipe (`listen EPERM`). Rerunning only that stage as `node --import tsx scripts/run-ai-evaluation.mjs` exited 0 (56 fixture/screener checks). This is a runner restriction, not a failing app assertion, and not a successful literal `pnpm check` exit.
- Fresh focused probes: persistent export wrong-table failure; duplicate meal date/details accepted with original result; actual Expo configuration fail-open cases; controller stale-save/hidden-error cases; mocked Dev deployment wrong-DB/service acceptance; live Dev identity reading Production backup and writing its checkout.
- No fresh clean-reset/upgrade/real PostgREST matrix, destructive deletion, cross-environment token journey, physical mobile acceptance, measured live AI evaluation, sustained resource test or off-device restore was run. These remain explicit acceptance work.

## Recommended next sessions

1. **Containment and promotion safety:** Q1 backup/runtime permissions, Q8-A admission, Q9 target binding and truthful recovery. Develop/fault-test deployment repairs locally before remote use. Preserve approved Dev provider policy.
2. **Data correctness and lifecycle:** Q5 schema regression first, then complete export and Q4 resumability/write barriers; Q6 deployed and upgrade acceptance in a disposable controlled matrix.
3. **Mobile reliability:** Q2 immutable retry/restore races, Q7 contextual consent continuation and error UI, Q3 actual entry-point/native guards. Delegate independent regression review and keep shared doc ownership with the coordinator.
4. **AI accounting and evaluation:** Q8-B real reservations/leases/cost ceiling, then Q8-C properly gated measured evaluation and truthful governance records.
5. **Final acceptance:** re-review exact candidate, test both installed identities with Mac/Metro off, cold/warm auth, real export/deletion/retries, cross-environment rejection and off-device restore. Only then resolve R3/R8 and consider explicit Production promotion/tester invitations.

Each session must preserve the original plan's full exit criteria, include regressions at the failing boundary, and update source SHA, actual test result, Dev deployment, device acceptance and release state separately. This review changes documentation only; it does not claim the defects have been fixed.
