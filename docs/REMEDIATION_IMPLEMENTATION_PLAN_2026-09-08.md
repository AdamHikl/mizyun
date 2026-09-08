# Implementation plan for review findings Q1–Q9

Prepared 2026-09-08 for future implementation sessions and independent follow-up review. **This is a plan, not evidence of fixes.** The baseline is [the implementation review](IMPLEMENTATION_REVIEW_2026-09-08.md); its Q identifiers are retained. The original [environment guide](tutorials/DEV_PRODUCTION_PI_GUIDE.md), [R1–R9 release gates](RELEASE_READINESS_2026-09-07.md), and repository engineering rules continue to apply.

## 1. How to execute this plan

Work on one bounded package at a time. Each package needs: a regression that exposes the current defect, an implementation, automated verification, and the applicable environment/device evidence. Commit completion, Dev deployment, independent verification, and production release are different milestones. Do not mark a backlog row `done` from code presence or a green unit suite alone.

Before each session, read the continuity documents required by AGENTS.md and the selected section below. Inspect the current branch, dirty state, installed versions and live target metadata. Preserve unrelated work. The reviewed baseline was source `dc8d6a5`, Dev `9b0f4a4`, Production `c02a67a`; these are historical observations, not future deployment arguments. Recheck official documentation and record sources in RESEARCH_LOG.md before implementing the affected segment.

Use short `codex/*` branches, the existing lockfile, synthetic test accounts/media, and forward-only migrations. Keep business rules in core, contracts in contracts, Supabase specifics in its adapter, and composition in apps/api. New lifecycle persistence must have explicit authorization, RLS and ownership indexes. Never print secrets or real health data into evidence. No persistent Pi database reset, production-data copy into Dev, broad Docker cleanup, or production fault injection belongs in this plan.

### Recommended session sequence

| Session | Scope                                                                | Exit before proceeding                                                                              |
| ------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| A       | Q8-A immediate access containment; Q1 runtime isolation              | Founder-only/disabled Dev AI, restricted Dev access, Dev runtime denied Production files and Docker |
| B       | Q9 deployment safeguards, developed and fault-tested locally         | Exact-candidate/target/lock/rollback harness passes; safe Dev deployment path demonstrated          |
| C       | Q6 tier authority                                                    | Authenticated write-path database matrix passes                                                     |
| D       | Q2 meal retries; separate follow-up for other mutation paths         | Actual screen survives lost responses and restart without duplicates                                |
| E1      | Q4 deletion contract/state machine and adapter                       | Durable, authorized, resumable cleanup passes fault tests                                           |
| E2      | Q4 mobile/Dev lifecycle acceptance                                   | Two-user Auth/Storage/database deletion and retry evidence                                          |
| F       | Q5 complete export and native file delivery                          | Paginated records and private photo archive verified with independent expected counts               |
| G       | Q8-B server consent/eligibility/budgets, then Q7 mobile continuation | No unauthorized provider calls; first-use consent executes once                                     |
| H       | Q3 local/EAS profiles and native identities                          | Guarded configuration matrix, both apps, standalone Dev and paid-team signing verified              |
| I       | Q8-C current-model evaluation, if AI will be offered externally      | All provider/project/evaluation gates accepted; otherwise external AI stays disabled                |
| J       | Shared final acceptance and review                                   | R3/R8 evidence complete and independent review has no open release blockers                         |

The sessions are scopes, not duration estimates. Split large packages rather than skipping acceptance. Local Q2/Q6/Q7 development can proceed while infrastructure access is blocked. Shared Pi changes and schema deployments are sequential.

**Bootstrap rule:** session A uses a narrowly scoped, reviewed operator procedure for configuration/identity changes; it must not trust the defective deploy scripts. Preserve prior unit/config metadata securely, preview the changes, and restart only affected Dev services. Session B must fix the deploy path before using it for later patches. If a configuration-only production containment change is necessary, identify it explicitly, preserve the founder workflow where policy allows, and record its separate production change evidence; it is not authorization to promote the entire unaccepted candidate.

## 2. Q1 — Isolate the Dev runtime from Production

**Tracking:** INFRA-DUAL-002; supports INFRA-DUAL-001/005. **Dependencies:** read-only inventory and Q8-A containment. **Files:** `deploy/raspberry-pi/mizyun-api-dev.service`, Dev service/env templates, provisioning instructions, ADR-0020 and relevant runbooks.

### Implementation

1. Inventory actual service users/groups, directory traversal permissions, runtime command, Node/pnpm paths, env-file ownership, Docker socket permissions, sudo rules and bind mounts. Record names/modes only. Verify Production SHA/health and backup recoverability before changes that could affect its host.
2. Create a dedicated non-login runtime identity, for example `mizyun-dev-api`. Keep it out of `mizyun`, `docker`, and `sudo` groups. Preserve the operator's deployment account; do not remove operator access as a side effect.
3. Give the runtime read/execute access only to Dev code/runtime dependencies and narrowly scoped writable Dev runtime directories. Prefer root/systemd credential loading or a Dev-only readable env file. Production env files, backups, Storage directories and checkout must not become readable through supplementary groups or permissive ancestor directories.
4. Update the unit to use the new identity and reviewed systemd sandboxing. Retain `NoNewPrivileges`, private temporary space, memory/CPU limits and restart behavior. Apply read-only filesystem protection and explicit writable paths where compatible. Check installed systemd support rather than copying unsupported directives.
5. Audit how dependencies are executed. The runtime must not be able to alter code or scripts later executed by a privileged operator. Keep deploy/migration privileges outside the application process. Treat running arbitrary package install hooks as the operator as a separate trusted-code boundary; document it.
6. Apply idempotently to Dev, reload systemd, restart Dev and verify authenticated synthetic functionality. Preserve the live Production paths. Update templates to match the installed topology and record adoption details in the ADR without asserting unperformed acceptance.

### Required tests and evidence

- As the actual Dev runtime identity, attempts to read Production env, traverse Production private data/backups, write Production code, connect to Docker socket, or administer Production services fail. Tests report access denied, never secret contents.
- Dev can read its needed configuration, start, connect to its own database and Storage, and serve a synthetic authenticated journey.
- Production SHA, health and an approved synthetic sentinel remain unchanged before/after Dev restart/deploy.
- Record service user/group, effective limits, relevant permission modes and redacted command results. A `User=` line alone is insufficient.

**Recovery:** restore only the affected Dev unit/permissions if Dev fails to start; leave Dev stopped if safe isolation cannot be maintained. Do not resolve failures by restoring broad Production/Docker access and claiming completion.

## 3. Q2 — Make mutation retries stable end to end

**Tracking:** REL-AUD-007 / R7. **Files:** mobile `log-meal-screen.tsx`, `meal-form.ts`, `log-meal-data.ts`, `logging-draft-storage.ts`; food contracts/core/repositories/routes and corresponding tests.

### Implementation

1. Define a logical submission record: version, operation UUID, fixed `consumedAt`, normalized payload, and outcome state. Use an Expo/RN-compatible UUID source. Validate IDs when restoring drafts.
2. Generate identity before the first network attempt and **await durable draft persistence before submitting**. Keep the same ID, timestamp and payload through double taps, timeouts, app termination and transport errors. If persistence fails, surface recovery guidance instead of sending an unrepeatable mutation.
3. Restore identity and submission payload before enabling Save. Upgrade older saved drafts that lack an ID exactly once. Prevent a delayed autosave from resurrecting a completed draft or overwriting another user's draft. Use a synchronous submission lock as well as UI disabled state.
4. Remove the data-layer fallback that silently invents a new key per retry. Require the operation identity on this new flow. Keep the existing API compatible with older installed clients; document their remaining retry limitations until the supported-client policy changes.
5. Handle edits after an ambiguous outcome explicitly: reconcile the original operation first, then edit the confirmed record or start a deliberate new entry. Never quietly rotate the key after a timeout, or send changed content under an old key and silently accept stale data.
6. Enforce `(user_id, operation_id)` uniqueness atomically. On a racing insert, retrieve the matching row. Define a conflict response for the same key with a different canonical payload. Normalize omitted/null fields consistently. Rotate/clear identity only after confirmed success or an explicit new-entry decision.
7. Audit manual weight, workouts, sets, copy/clone and multi-session proposal mutations in a separate table. Each needs existing idempotency evidence or a bounded follow-up implementation. Meal-only completion does not close the broader REL-AUD-007 criterion.

### Required tests and evidence

- Server commits, response is dropped, user retries: one row, one set of totals, same returned ID.
- Same scenario with process/app restart and draft restoration; legacy keyless draft migration; two simultaneous requests; double tap.
- Persistence failure sends no request; changed payload under the same key conflicts; different users can use the same UUID without cross-user access.
- A new intentional identical meal creates a second record; retry never does. Verify a real mobile screen path, not only a helper supplied with an explicit test key.
- Record synthetic before/after row counts, stable operation/record IDs, and device/API versions. Do not retain real meal data.

## 4. Q3 — Guard all build identities and configurations

**Tracking:** INFRA-DUAL-003; REL-AUD-003 / R3 Part A. **Dependencies:** isolated reachable Dev; final R3 Part B waits for all patches. **Files:** mobile `eas.json`, `app.config.js`, app manifest, configuration validation/composition, founder build scripts and build-check tests.

### Implementation

1. Define one reviewed matrix for `development` (Dev client), `preview` (standalone Dev), and `production` (store). Explicitly select business variant and EAS environment; never infer business environment from `NODE_ENV`. Development/preview use `com.mizyun.dev` and `mizyun-dev`; production uses `com.mizyun.app` and `mizyun`.
2. Validate API host, Supabase host, public key provenance, redirect URI, package/bundle ID and build profile together. Public keys are opaque: prove their environment using approved metadata/Auth tests, not guessed string patterns. Reject unknown/mixed settings. Retain disposable local-debug configuration as a distinct, explicitly allowed mode.
3. Inspect EAS project linkage and remote public environment variables without printing credentials. Ensure variant selection is available at config evaluation time. Record public project identifiers and redacted presence checks. Do not assume local ignored env files will be uploaded.
4. Install the SDK-compatible Dev client using Expo's supported package resolution. Review notification plugins/capabilities and the old Personal Team workaround against actual usage. Dev client and standalone preview replace each other; both coexist with Production.
5. Guard local native directories. Either use isolated per-variant worktrees/directories or verify their generated identity and require a clean prebuild on mismatch. Do not silently erase manually maintained native changes. `run` must never compile a stale Production project against Dev values or the reverse.
6. Verify paid Apple team, registered identifiers, profiles and capabilities. Configure proper Android release signing and Play artifact generation. Founder sideload/debug signing is not store evidence. Add visible Dev branding and non-secret build/source/server identity for support.

### Required tests and evidence

- Evaluate all three profiles in a clean process with hostile/conflicting ambient env values; assert identity, callback and endpoints. Missing required settings fail clearly. Test both variant-switch directions with existing native directories.
- Inspect built iOS/Android identities, schemes, signing and embedded public hosts. Scan artifacts for privileged-secret patterns without printing matches.
- Install Dev and Production together; accounts/sessions and callbacks remain separate. Test cold/warm email confirmation/recovery and supported OAuth. Confirm the iOS email-only decision from R4 works on the signed candidate.
- Dev client supports Metro; preview and Production launch and work with Mac/Metro off. Record build IDs, source SHA, device OS and artifact hashes where available.
- Final TestFlight/Play candidate acceptance is a separate step after fixes; config tests alone cannot close R3.

## 5. Q4 — Implement reliable account deletion

**Tracking:** REL-AUD-001/002 / R1/R2; AUTH-04, SEC-06. **Dependencies:** Q1/Q9 for remote acceptance. **Files:** core account ports/use case, account contracts/routes, Supabase account/Storage/memory adapters, new forward migration, Settings deletion flow.

### Design checkpoint

Record an ADR for the durable deletion lifecycle before coding it. Recommended shape: a persisted, idempotent deletion operation with bounded challenge TTL, atomic confirmation, cleanup stages, retries, and a terminal result. Distinguish deletion confirmation expiry from an already accepted deletion job; an accepted job must continue after the challenge expires or the API restarts. Prefer one explicit orchestration owner rather than duplicated cleanup in the adapter and route.

A minimal job/tombstone that must survive Auth deletion must not be accidentally cascaded away with `auth.users`. Retain only the identifiers/status needed for cleanup and a documented short retention period. Protect it with RLS and privileged writes; provide only a narrow owner/status interface. Document user ownership indexing and post-deletion receipt handling. Do not expose service-role access to clients.

### Implementation

1. Require the administrative deletion capability in persistent composition. Remove partial-success fallbacks. Missing dependencies fail setup or deletion explicitly.
2. Define backward-compatible contracts: request challenge, confirm/start, report pending/retryable failure/completed status. Keep `deleted:true` reserved for completed active-system cleanup. If adding asynchronous status, version/add endpoints so older clients cannot interpret “accepted” as “deleted.”
3. Bind operation/challenge to the verified account. Store challenge/receipt secrets hashed, avoid logging them, use atomic confirmation and per-user serialization. Repeated confirmation returns the same operation. Design a narrowly scoped expiring receipt or equivalent status mechanism for a lost final response after Auth is gone.
4. Block new writes/uploads/provider calls for an account being deleted, including direct PostgREST/Storage paths where applicable. Handle in-flight provider/upload operations and issued signed URLs so they cannot recreate data after cleanup. Use database policies/state and reconciliation, not only a mobile flag.
5. Enumerate all private objects with bounded pagination, including orphan uploads, feedback attachments and export artifacts. Do not rely solely on existing media metadata. Treat confirmed missing objects as idempotent success; authorization, listing, timeout and deletion failures remain retryable errors.
6. Delete durable memory/provider references and other external resources according to their actual adapters. Reconcile relational rows and finally delete Auth when dependencies permit. Verify completion, persist the minimal result, and reconcile retries safely. SQL cascade is one step, not the whole lifecycle.
7. Clear local session, drafts, consent caches and generated app-owned export files. Provide honest progress/failure/resume UI. Explain active-system deletion versus backup and processor retention; user-saved copies outside the app cannot be remotely erased.
8. Implement backup deletion accounting: retention expiry, restricted recovery access, and reapplication of deletion tombstones after restore before serving traffic. Do not promise immediate erasure from historical backups unless that is implemented and verified.

### Required tests and evidence

- Real disposable two-user test: seed every durable category and synthetic private objects; delete A via the same API/mobile flow; A Auth/refresh access and active data are removed while B is unchanged.
- Failure injection at every cleanup stage, partial Storage deletion, metadata-list failure, missing object, Auth failure, duplicate confirmation, concurrent delete, restart after each stage and lost final response.
- Existing tokens, direct Storage/PostgREST writes, signed uploads, and in-flight AI requests cannot resurrect deleted data. Verify behavior on the actual installed Supabase version.
- No successful response if an external cleanup obligation remains unresolved; pending state can recover without manually editing the database.
- Record category/object counts and operation transitions using synthetic identifiers, plus iOS/Android screen evidence. Never test by deleting the founder's account.

## 6. Q5 — Export complete records and usable private media

**Tracking:** REL-AUD-001/002 / R1/R2. **Dependencies:** agree lifecycle/artifact cleanup with Q4. **Files:** account export port/contracts/adapter/routes, per-feature paging interfaces, Settings export controller and native file adapter.

### Implementation

1. Build an export inventory from all current migrations and data stores. For each category list fields, ownership, pagination, required transformations and exclusions with reasons. Include profile/preferences, goals/history, meals, exercises, workouts/sets, body data, conversations/messages, all memory states, feedback/attachments, media metadata/files, consent and relevant user-facing usage records introduced by Q8. Never export credentials, refresh tokens or administrative secrets.
2. Define a versioned manifest with generated time, counts, schema version and explicit completeness/failure status. Choose and document a consistency model under concurrent edits. Prefer a bounded snapshot/export job; do not claim transactional consistency across independent API pages and Storage downloads without proof.
3. Add deterministic paging (stable order plus unique tie-breaker) and iterate until exhaustion under actual server caps. Handle page failures, empty pages and concurrent edits without silent truncation. Keep pagination behind repository/adapter interfaces.
4. Deliver a portable archive containing JSON and actual private media bytes with paths/checksums. If staged authenticated downloads are used internally, the final saved export must remain useful after signed URLs expire. A list of expiring links is not a complete offline photo export.
5. Bound memory, CPU, disk use and concurrent export jobs on the Pi. Stream/batch files rather than loading an entire account into API RAM. Use private temporary artifacts, short retention, authorization on every status/download, and cleanup on expiry/deletion. Do not store export bodies in logs.
6. Use an Expo-compatible file/sharing adapter to write and share an actual `.json` or archive file with correct MIME metadata. Distinguish cancelled sharing from success, preserve recoverability after download failure, and remove app-owned temporary files on a defined schedule.
7. Make UI, API legal pages, privacy documents and store disclosures match the delivered categories, limits, deletion and retention behavior. Any deliberate exclusion must be visible; do not label a partial export “all data.”

### Required tests and evidence

- Seed synthetic records exceeding the effective server page cap and the old 10,000 limit; validate complete IDs/counts with an independent fixture ledger. Include conversations with multiple pages of messages and media with orphan/attachment cases.
- Cross-user export/status/download access fails. Expired artifact links fail. Partial page/download failures never produce an apparently complete archive.
- Save and reopen the archive through iOS Files and Android file sharing; parse JSON and verify media checksums offline after internal download links expire.
- Test app interruption, share cancellation, low disk, large account resource bounds and account deletion during export. Record size, counts, peak resource observations and cleanup evidence without personal payloads.

## 7. Q6 — Protect entitlement authority on every database write path

**Tracking:** REL-AUD-006 / R6. **Files:** new migration after `20260908120000`, profile policies/grants/triggers, profile adapter and pgTAP tests.

### Implementation

1. Inspect effective table/column/default grants, profile creation trigger, own-row policies, RPCs and privileged update paths. Reproduce the INSERT/delete-reinsert bypass only with disposable synthetic users.
2. For this patch, retaining `profiles.plan_tier` is acceptable; a billing subsystem is unnecessary. Make the tier server-owned: authenticated creation can only produce the default free tier, authenticated updates cannot change it, and delete/reinsert cannot grant paid privileges.
3. Remove broad write grants where column-level restrictions are needed, then grant only the explicitly client-editable fields. Reconcile get-or-create and Auth-trigger creation so normal onboarding works. Use a defense-in-depth INSERT/UPDATE trigger or policy as appropriate, and document whether direct profile DELETE is still needed.
4. Ensure a SECURITY DEFINER trigger uses a trustworthy caller/claims distinction; `current_user` may be the function owner. Reject unauthorized or missing claims on client paths while preserving the narrowly defined service-role and migration/maintenance authority.
5. Add a forward migration; do not rewrite the deployed migration. Preserve legitimate existing paid tiers. Investigate unexpected tiers through a redacted audit rather than automatically downgrading users without evidence.

### Required tests and evidence

- Authenticated own INSERT paid, UPDATE paid, UPSERT conflict/non-conflict, DELETE/reinsert and relevant RPC attempts cannot escalate tier.
- Normal free signup/get-or-create and ordinary profile edits still work; paid users cannot lose/change their tier through unrelated edits.
- Trusted entitlement updates work; anonymous/cross-user paths fail; API quota calculation observes the authoritative tier.
- Clean disposable Mac schema gate and upgrade-from-previous-schema tests pass. Repeat the matrix through authenticated PostgREST on Dev; root SQL and mocked clients alone do not close this finding.

## 8. Q7 — Fix consent continuation and account-scoped UI state

**Tracking:** REL-AUD-005; Q7 is a UI fix, not external-AI approval. **Dependencies:** Q8-B consent contract, or a clearly marked local seam until it exists. **Files:** `ai-consent.ts`, `ai-consent-modal.tsx`, `coach-setup-screen.tsx`, `log-meal-screen.tsx`, new component tests.

### Implementation

1. Use one shared consent controller. Model loading, required, saving, granted, revoked and error states explicitly. Treat server consent/version as authoritative; local cache improves UX only.
2. Save pending action **data** (action kind, captured input, user/session identity), not a self-referential callback that retains old consent state. After confirmed consent, dispatch the authorized action once without rerunning an obsolete gate. Clear it before executing and use an execution lock.
3. Handle consent-write failure: no provider call, visible retry, no false success. Decline/dismiss sends nothing and leaves manual tracking available. Do not imply durable consent when only local storage succeeded.
4. On account change, logout, unmount or revocation, cancel pending actions, clear transient granted state and ignore late async completions from the old user. Load the new user's consent before enabling AI actions.
5. Preserve request input while the modal is open; define what happens if it changes. The action authorized by the disclosure must be the action that executes. Provide discoverable revocation, with server enforcement via Q8.

### Required tests and evidence

- First-ever Accept closes once and issues exactly one request for Coach, text draft, photo draft and refine. Double Accept and rapid taps do not duplicate requests.
- Decline, dismissal, failed persistence, stale consent version and revoked consent issue zero provider calls.
- Switch A→B during loading/saving: no A consent/input/request leaks into B; pending callbacks after unmount are inert.
- Component interaction tests plus first-use acceptance on both native platforms. Storage-helper tests alone are insufficient.

## 9. Q8 — Enforce external-AI eligibility, consent and budgets

**Tracking:** REL-AUD-005/006; INFRA-DUAL-002. Keep three subpackages distinct.

### Q8-A: Contain current exposure

1. Inventory current signup modes, API admission policy, AI provider flags, model identifiers, key/project separation and quotas without logging values. Recheck public and local reachability.
2. Restrict public Dev access to invited synthetic/founder accounts. Gate protected API access and provider invocation with an explicit server-owned allowlist/policy; disabling signup alone does not remove already-created unauthorized accounts. Review existing accounts without exporting personal data into logs.
3. Until Q8-B/C pass, disable external AI for unapproved principals across every provider path. Preserve the documented founder exception only with explicit server enforcement. Retain manual features and honest disabled states.
4. Provision independently scoped Dev provider credentials/project and measurable budget controls. A second key in the same unbounded project is not independent cost containment. Prove environment ownership without exposing keys. Keep Production's credential intact unless a deliberate separately scoped rotation is needed.
5. Record allowed account policy, enabled paths and before/after health. A change in flags is containment, not completion of the external release gate.

### Q8-B: Implement one server authorization and budget boundary

**Files:** `packages/config/src/server.ts`, `apps/api/src/ai-eligibility.ts`, provider composition, Coach and nutrition draft routes, existing `modules/coach/limits.ts`, food draft limiter, contracts/consent persistence and forward migrations.

1. Enumerate all provider entry points, including Coach tools/continuations, text/photo/refine, nutrition actions, fallbacks and future background work. Enforce common authorization before sensitive data leaves the process; route authentication alone is insufficient.
2. Persist explicit, versioned AI-sharing consent with confirmed adult eligibility, timestamps and revocation. Clients may request consent changes only for themselves; they cannot grant tester admission or entitlement. Use normalized errors for missing/stale consent, unknown eligibility, denial and unavailable verification.
3. Fail closed on absent age/consent/profile or lookup error. Birth year alone cannot establish that someone turning 18 later this year is already 18: use the minimum appropriate adult attestation and reject contradictions, or another documented eligibility design. Do not collect exact birth dates merely to simplify a test.
4. Consent must cover provider/data categories and remain revocable. Old/direct clients without accepted consent must receive a setup-required response, never bypass checks. Recheck deletion/revocation before queued or retried provider work as needed; document in-flight behavior.
5. Extend the existing durable limiter through a provider-neutral policy rather than a second uncoordinated counter. Atomically reserve per-user daily/in-flight allowance and environment-level bounded cost before dispatch; finalize actual use and handle failed/unknown calls conservatively. Include provider retries, fallback calls and tool rounds. Restart or extra API replicas must not replenish budgets.
6. Distinguish request caps, token caps and monetary ceilings. Record pricing/version assumptions and conservative reservations for images/output. Configure provider quotas/alerts as additional controls; a billing alert alone is not a hard spending limit.
7. Include consent/user-facing usage in Q5 export and Q4 deletion as appropriate; document minimal operational retention. Log only bounded metadata and normalized errors.

**Tests:** zero fake-provider invocations for unknown/minor/uninvited/unconsented/revoked/deleting principals, including direct API calls and lookup failures; all paths covered; concurrent requests cannot overspend; process restart preserves budgets; Dev exhaustion does not consume the Production allowance; unsupported configuration fails startup safely. Use deterministic clocks and realistic database concurrency tests.

### Q8-C: Establish provider and evaluation evidence

1. Inspect actual Google project billing, data-use settings, region, retention, enabled model/fallbacks and contractual recipient. Record dated redacted evidence. Reconcile docs with the deployed model, not a copied model name.
2. Recheck current terms and processing/retention sources. Accurately describe what is sent, model-training use, international processing and backup/processor limits; do not infer a universal 30-day promise from unrelated grounding terms.
3. Complete BEFORE_TESTING and the AI implementation plan for the selected model: synthetic critical-safety/injection/grounding/tool-authorization/failure tests, contraindications and nutrition estimate evaluation, measured cost/latency, thresholds and limitations fixed before evaluating.
4. Run only the live tests allowed by the current gate and authorization. Do not enable credential-gated suites wholesale to obtain a green count. Keep external access off/founder-only until the external gate is fully accepted.
5. If shipping a manual-only pilot first, record that decision and prove all external tester provider paths remain disabled server-side. Q8-C remains blocked/deferred; do not mark it `done` because the UI is hidden.

## 10. Q9 — Make deployment validate and promote the exact candidate

**Tracking:** INFRA-DUAL-004; original unsafe CI removal remains credited. **Files:** `scripts/deploy-dev.mjs`, `deploy-remote.mjs`, `promote-dev.sh`, `promote-production.sh`, backup helpers, target manifest, package scripts and disposable deployment harness.

### Implementation

1. Require an explicit full SHA for Production; parse allowed arguments strictly. Define Dev's optional-HEAD behavior explicitly and resolve it once. Fetch/verify canonical origin reachability; Production candidate must be accepted and reachable from current origin/main. Never push an older candidate over main or substitute local HEAD.
2. Verify the exact candidate in a disposable checkout/worktree: lockfile install, `pnpm check`, and applicable clean database/upgrade gates. Record SHA, tool versions and outcomes. The clean database must be a separately identified disposable target; never infer safety from a port number alone.
3. Define an operator-controlled environment manifest: SSH host, real checkout path, service, env-file path, database identity/container, expected API listener/hostname and ledger target. Reject conflicting overrides, wrong current directory, unexpected database identity and symlink escapes before mutations. Credentials remain outside the manifest.
4. Add per-environment remote locks covering migrations, installation, switch/restart, readiness and result recording. Hold the lock through cleanup/rollback. Prevent cross-environment resource actions and overlapping host-heavy work exceeding the Pi capacity budget.
5. Inspect the target database migration ledger every deploy, including same-SHA retries. Detect applied migration checksum drift, unexpected history, missing files and incompatible downgrade attempts. Preview pending forward changes; back up Production before schema mutation and verify backup integrity. A changed-files Git diff is not the migration authority.
6. Make release installation and failure states explicit. Prefer isolated release directories with an environment-specific pointer where practical; if retaining in-place installs initially, stop/coordinate the affected service to avoid a mixed dependency tree and document the limitation. Do not migrate Production paths without a separate reversible rollout procedure.
7. Add readiness exposing the running release identity and critical dependency status without secrets; verify authenticated synthetic functionality. Static `/v1/health` alone cannot prove the new code or database is ready.
8. Explicitly handle all failure exits, signals and partial migrations. Roll back code only when compatible with the resulting schema. Otherwise stop/contain the affected environment and report the required forward recovery. Never automatically restore a database backup over new writes. Verify rollback health too.
9. Record previous/new SHA, target, migration IDs/checksums, backup reference, readiness result and rollback outcome in a protected release journal. CI tests run in disposable infrastructure; untrusted PR code does not receive production credentials.

### Required disposable harness cases

- Local HEAD A, requested SHA B: tests and deployment use B. B is an older accepted main commit while main has advanced: no branch rewind or unrelated push.
- Missing/malformed SHA, unknown option, dirty candidate input, unpushed commit, non-main Production candidate and conflicting targets fail before mutation.
- Two simultaneous same-environment deployments serialize/reject deterministically; Dev cannot restart Production or apply to its database.
- Same SHA with a pending ledger migration reconciles it; modified historical migration and incompatible rollback fail safely.
- Dependency install, backup, migration, restart, readiness timeout, authenticated smoke and SIGTERM failures exercise their intended recovery path. The old `exit 1` bypass is a dedicated regression.
- A completed journal entry requires confirmed running SHA/readiness; failed rollback is clearly distinguishable from successful rollback.

Use fake binaries/temporary repositories and disposable containers for these cases. After the harness passes, demonstrate a safe Dev deployment. Production fault injection is outside scope; actual promotion follows final acceptance.

## 11. Shared final acceptance and independent review

Fill [the evidence checklist](REMEDIATION_EVIDENCE_CHECKLIST.md) as each package progresses. Record implementation SHA and the exact subsequently accepted merge SHA; a squash/merge result must be tested again if it differs. Keep Dev frozen during final candidate acceptance.

Final acceptance must include:

- Every Q1–Q9 assertion has automated and applicable live/native evidence; remaining AI-only work is explicitly blocked with external AI disabled, if choosing a manual pilot.
- Two-user API/database/Storage isolation; cross-environment token rejection both directions; same-email accounts remain independent.
- Clean install and upgrade from the currently deployed schema with synthetic fixtures; supported old-client/new-server compatibility, especially new deletion/consent contracts.
- Both signed native candidates: auth/confirmation/recovery, manual meal/workout/body loop, restart/lost-response behavior, private photo lifecycle, export/deletion, first-use consent or disabled AI, accessibility and poor-network checks.
- Standalone Dev and Production work with Mac/Metro off. Record how this was tested rather than simply counting a Release build.
- Restore database plus Storage into a separate private recovery destination; verify checksums, synthetic relationships, Auth/media configuration and deletion reconciliation before access. Do not expose restored accounts or send mail/AI from the restore lab.
- Off-device backup freshness/access protections, production headroom under bounded Dev load, actionable outage/error alert delivery and a compatible rollback rehearsal. Backup directory presence and HTTP 200 are not substitutes.
- Canonical docs, accepted ADR, env examples, installed service paths, build profiles and release commands agree. Remove false completion claims while retaining historical evidence as historical.

The independent reviewer should inspect the diff and deployed state, rerun defect probes against the implementation, verify evidence provenance, and report each finding as **closed**, **partially fixed**, **blocked**, or **regressed**. A closed source defect does not automatically close R3/R8 distribution/operations gates.

## 12. Prompts for future sessions

### Implement one package

> Implement Q[NUMBER / SUBPACKAGE] from docs/REMEDIATION_IMPLEMENTATION_PLAN_2026-09-08.md. Read AGENTS.md, continuity documents, the implementation review and evidence checklist first. Recheck current code and official docs; preserve unrelated work. Begin with a regression exposing the finding, implement the bounded fix, and run its required tests. Follow bootstrap/dependency rules and do not use an unsafe deployment path. Use only disposable synthetic data for destructive tests and never reset either persistent Pi database. Record exact SHAs, commands/results and remaining evidence in the checklist/status/backlog. Do not mark the finding complete without its closure evidence or promote the full unaccepted candidate. Continue independent local work if a live acceptance dependency is unavailable.

### Review completed fixes

> Independently review Q1–Q9 using docs/IMPLEMENTATION_REVIEW_2026-09-08.md, docs/REMEDIATION_IMPLEMENTATION_PLAN_2026-09-08.md and docs/REMEDIATION_EVIDENCE_CHECKLIST.md. Verify current source and actual Dev/Production SHAs rather than trusting completion labels. Reproduce the original defects and verify the failure-path regressions, effective privileges, configuration/artifact identities, persistence and device/restore evidence. Inspect live state read-only; run destructive/fault tests only on disposable synthetic targets. Return a finding-by-finding verdict with source references, evidence gaps, regressions and the next exact fixes. Distinguish code correctness from production deployment and permission to invite testers. Update continuity documents without silently deploying repairs.

## Research references

The dated sources supporting the original findings remain in [the review](IMPLEMENTATION_REVIEW_2026-09-08.md). Additional planning references: [Expo FileSystem](https://docs.expo.dev/versions/latest/sdk/filesystem/) and [Expo Sharing](https://docs.expo.dev/versions/latest/sdk/sharing/) support native file-based exports. Recheck SDK 57-compatible versions at implementation. systemd manual fetches were blocked (403) and the attempted Supabase JavaScript paging URLs returned 404 during planning; consult installed systemd manuals and current official paging documentation before those implementations rather than treating failed fetches as research evidence. Detailed implementation designs here are project recommendations, not claims that platforms supply the complete lifecycle automatically.
