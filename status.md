# Mizyun current status

> Fast-changing session handoff. Update this file at the end of every development session. Last updated: **2026-09-08** (Sessions B, C, D, E1, E2, F complete: Q9 deployment safeguards, Q6 tier authority, Q2 mutation retry durability, Q4 durable account deletion & mobile lifecycle, Q5 complete paged export & native file delivery).

## Remediation Sessions E2 & F (Q4 deletion lifecycle UI & Q5 complete paged export delivery) — 2026-09-08

Sessions E2 and F completed the durable account deletion user experience and complete, paged account data export with native file sharing (REL-AUD-001, REL-AUD-002, R1, R2, AUTH-04, SEC-06):

- **Q4 Mobile Deletion UI & Cache Purge (Session E2)**:
  - `apps/mobile/src/features/settings/account-data-card.tsx`:
    - Implemented explicit deletion stage progression (`idle` -> `requesting_challenge` -> `erasing_server_data` -> `clearing_local_cache` -> `failed`).
    - Handled challenge retry vs re-issuance cleanly based on failure reason (`expired`/`mismatch` clear token, `network`/`server` allow instant retry).
    - Hardened `signOut()` with `.catch(() => {})` so downstream rejection on already-deleted auth identities does not trigger false failure alerts.
    - Updated confirmation copy to accurately state that active systems are immediately purged while backups are aged out over the standard retention schedule.
  - `apps/mobile/src/features/settings/account-data-management.ts`:
    - Implemented `clearLocalUserData(userId, options)`: comprehensively wipes meal, workout, weight, and coach drafts from secure storage; revokes local AI consent decisions; cancels all pending coach reminders via `expo-notifications`.
  - `apps/api/src/account-deletion.e2e.test.ts`:
    - Created comprehensive end-to-end multi-stage deletion test verifying 2-user isolation: deleting User A purges all User A records across 10 tables, clears private storage files, deletes auth identity, and preserves User B completely intact.
  - **Independent Security & Privacy Subagent Audit**:
    - Per `AGENTS.md`, delegated full review of ADR-0021, migration `20260908150000`, RLS policies, pipeline order, and mobile cache clearing to an independent auditor subagent.
    - **Verdict: ACCEPT**. Verified tombstone survival without cascading FK, multi-stage fail-closed cleanup, and complete local cache purge.

- **Q5 Complete Account Export & Native File Delivery (Session F)**:
  - `docs/ACCOUNT_EXPORT_INVENTORY.md`:
    - Cataloged all 10 user-owned data categories (`profiles`, `goals`, `food_entries`, `exercises`, `workouts`, `workout_sets`, `body_measurements`, `conversations` + `messages`, `memories`, `private_media`, `feedback`), detailing column schemas, sensitivity, exclusions, and pagination strategy.
  - `packages/contracts/src/account.ts` & `packages/core/src/account.ts`:
    - Added `exportManifestSchema` with version `"2026-09-08"`, ISO timestamp, `completeness: "complete" | "partial"`, and exhaustive record count breakdown.
    - Updated `exportedMediaAssetSchema` / `ExportedMediaAsset` with `objectPath`, `purpose`, `mimeType`, `byteSize`, and `downloadUrl`.
  - `packages/adapters/supabase-server/src/account-repository.ts`:
    - Replaced the previous 10,000-record query limit with `fetchAllPaged`: deterministic offset/limit batch paging (500 items/batch) iterating until table exhaustion.
    - Generated 24-hour signed download URLs for private media assets via `mediaStorage.signDownloadUrl`.
    - Returns `manifest` with exact category counts matching delivered data.
  - `apps/api/src/account-repository.ts` & `apps/api/src/modules/account/routes.ts`:
    - Updated in-memory repository and wire serializer to serialize `manifest` (enriched with real `memories` count from `MemoryStore`) and `privateMedia` with download URLs.
  - `apps/mobile/src/features/settings/account-data-management.ts` & `account-data-card.tsx`:
    - Added `saveExportToFile` using `expo-file-system` to write `${Paths.document}/mizyun-account-export-${timestamp}.json`.
    - Updated `handleExport` in `AccountDataCard` to save to file and share via native `Share.share({ url: saved.fileUri })`. Distinguishes success (`sharedAction`) from cancellation (`dismissedAction`).

- **Verification & Quality Gates**:
  - `pnpm check`: 100% clean (format check, all 15 package typechecks, iOS and Android Hermes bundle exports, 1,200+ unit tests, 17 deployment safeguard tests).
  - Vitest suites for modified packages:
    - `@mizyun/adapter-supabase-server`: 14 files passed, 64 tests passed.
    - `@mizyun/api`: 28 files passed, 411 tests passed.
    - `@mizyun/mobile`: 35 files passed, 256 tests passed.
  - Pi Production untouched: PID 500239 active, commit `c02a67a`, public health HTTP 200 OK.
  - Pi Dev active: UID 999 (`mizyun-dev-api`), public health HTTP 200 OK.

Next exact action: commit changes, push to `origin/main`, deploy forward migration `20260908150000` to Dev on Pi via `pnpm deploy:dev`, and verify public Dev health.

## Engineering instruction update — 2026-09-08

Updated `AGENTS.md` and `docs/SESSION_GUIDE.md` at the user's request to require agent delegation for substantive work, disjoint file ownership, coordinator-controlled shared operations, independent review of sensitive changes, and evidence-based completion. Preserved the current explicit Dev shared-Gemini/autoconfirm testing exception; clarified that it does not prove admission or resource isolation. Replaced blanket whole-repository formatting with scoped formatting when unrelated work is present and moved the adapter typing rule into module guidance.

A read-only helper reviewed the rules while the coordinator edited documentation. Verification: scoped Prettier, local link/path checks and `git diff --check`; no application test run or deployment was needed for these instruction-only changes. Pre-existing mobile/Coach/Settings edits and the untracked account-deletion integration test were preserved. This note does not supersede the active remediation package: resume its current E2 work/evidence after inspecting the live working tree, using the new collaboration rules.

## Remediation Session E1 (Q4 account deletion state machine & tombstones) — 2026-09-08

Session E1 implemented the durable account deletion state machine, database tombstones, and multi-stage execution pipeline (REL-AUD-001, REL-AUD-002, R1, R2, AUTH-04, SEC-06):

- **ADR-0021 Recorded**: `docs/adr/0021-durable-account-deletion-lifecycle.md` documents persistent state machine, durable tombstones, honest multi-stage cleanup, single orchestration authority, and lost final response recovery.
- **Database Migration & Tombstones** (`supabase/migrations/20260908150000_durable_account_deletion.sql`):
  - Created `public.account_deletion_jobs` (`id`, `user_id`, `challenge_hash`, `status`, `stage`, `expires_at`, `completed_at`, `error_message`, `created_at`, `updated_at`).
  - Intentionally omitted `ON DELETE CASCADE` foreign key to `auth.users(id)` so the tombstone job row survives Auth deletion as permanent audit proof.
  - Granted full privileges to `service_role`; granted `SELECT` to `authenticated` guarded by RLS policy `user_id = auth.uid()`; revoked direct client writes.
- **Database Tests**:
  - `supabase/tests/database/0004_account_deletion.test.sql` (6 tests, all passed): Table existence, service_role insert, authenticated direct insert denial (42501), own job select allowed, cross-user job select denied, and **tombstone survival after `auth.users` deletion**.
  - All 89 pgTAP assertions passing across all 4 database test files.
- **Core Domain & Ports**:
  - `packages/core/src/account.ts`: Added `DeletionJobStatus`, `DeletionJobStage`, `StoredDeletionJob`, and `getDeletionJob` to `AccountRepository` port.
- **Supabase Server Adapter**:
  - `packages/adapters/supabase-server/src/account-repository.ts`: Rewrote adapter to use `public.account_deletion_jobs`, SHA-256 token hashing, atomic confirmation, honest multi-stage pipeline (`storage` -> `memory` -> `auth` -> `tombstone`), crash resilience, and idempotent retry.
- **In-Memory Mock Adapter & Route Single Authority**:
  - `apps/api/src/account-repository.ts`: Updated to mirror the state machine, SHA-256 hashing, memory store cleanup, and idempotent retry.
  - `apps/api/src/app.ts`: Injected `memoryStore` into `InMemoryAccountRepository`.
  - `apps/api/src/modules/account/routes.ts`: Removed duplicate memory cleanup; delegated fully to `AccountRepository.deleteUser`.
- **Fault Tests & Verification**:
  - `packages/adapters/supabase-server/src/account-repository.test.ts` (11 passed): Storage failure halts before auth, memory failure halts before auth, auth failure recorded, missing admin capability fails closed, idempotent retry on completed returns `{ deleted: true }`.
  - `apps/api/src/modules/account/routes.test.ts` (11 passed): Complete deletion, memory deletion via repository, idempotent recovery for lost final response, random token rejection (409).
  - `pnpm check`: 100% clean (format check, all 15 package typechecks, iOS & Android Hermes exports, 1,200+ unit tests, 17 deployment safeguard tests).
  - `pnpm db:test`: 89/89 pgTAP assertions passing.

Next exact action: deploy forward migration to Dev on Pi via `pnpm deploy:dev`, then proceed to Session E2 (Settings deletion UI, local session/draft cache clearing, and two-user deletion journey on Dev).

Session D resolved the mutation retry deduplication finding (REL-AUD-007 / Q2 / R7):

- **Client Durable Draft & Identity Lifecycle**:
  - `apps/mobile/src/features/log-meal/meal-form.ts`: Added UUID validation (`isValidOperationId`), fallback UUID generator (`createOperationId`), and draft migration helper `upgradeLegacyMealDraft` which migrates legacy keyless drafts exactly once with stable `clientOperationId` and `consumedAt`.
  - `apps/mobile/src/features/log-meal/log-meal-data.ts`: Removed the silent `crypto.randomUUID()` fallback on retry; now strictly requires a valid `clientOperationId`. Added user-facing error message for HTTP 409 Conflict.
  - `apps/mobile/src/features/log-meal/log-meal-screen.tsx`:
    - Generates stable `clientOperationId` and `consumedAt` upon initiating a draft, restoring them from `expo-secure-store`.
    - Implemented synchronous submission lock (`isSubmittingRef` and `isCompletedRef`) preventing double taps and unmount autosaves.
    - Awaits durable draft persistence in secure storage before making the network request; fails closed with user guidance if storage write fails.
    - On network timeout or dropped connection, retains the exact same `clientOperationId` and `consumedAt` so subsequent Save attempts submit the identical operation identity.
    - Explicit `onClear` resets operation identity and timestamp.
- **Server Deduplication & Conflict Guard**:
  - `apps/api/src/modules/food-entries/routes.ts`: Enforces canonical payload comparison on duplicate `clientOperationId`. If the meal payload matches, returns the existing record (HTTP 200). If the payload differs under the same key, returns HTTP 409 Conflict.
- **Automated Tests**:
  - `apps/mobile/src/features/log-meal/meal-retry-durability.test.ts`: Automated integration test suite covering lost-response retry survival, process restart restoration, missing ID rejection, and distinct intentional meals. (4 passed)
  - `apps/mobile/src/features/log-meal/log-meal-data.test.ts`: Added missing/invalid ID rejection and 409 translation tests. (20 passed)
  - `apps/mobile/src/features/log-meal/meal-form.test.ts`: Added UUID validation and draft upgrade tests. (12 passed)
  - `apps/api/src/modules/food-entries/routes.test.ts`: Added 409 Conflict on payload mismatch and cross-user isolation tests. (45 passed)
- **Mutation Idempotency Audit**:
  - Created `docs/MUTATION_IDEMPOTENCY_AUDIT.md`: Cataloged all write paths (food entries, body measurements, workouts, sets, clones, and coach proposals) with risk profiles and follow-up roadmaps.
- **Quality Gates & Production Preservation**:
  - `pnpm check` passed 100% clean (all 15 package typechecks, iOS & Android Hermes exports, 1,200+ unit tests, 17 deployment safeguard tests).
  - Pi Production untouched: PID 500239 active (uptime 5 days), commit `c02a67ab31a101c06c9a3ebdf275f9d0cee4a992`, public health HTTP 200 OK.
  - Pi Dev active: commit `3716d8c` running under `mizyun-dev-api`, public health HTTP 200 OK.

Next exact action: execute Session E1 (Q4 account deletion contract, state machine, and adapter).

## Remediation Session C (Q6 server-owned tier authority) — 2026-09-08

Session C resolved the authenticated write-path escalation finding (REL-AUD-006 / R6):

- **Database Migration** (`supabase/migrations/20260908140000_server_owned_tier_authority.sql`):
  - `service_role` granted full authority on `public.profiles`.
  - Whole-table `INSERT`, `UPDATE`, and `DELETE` revoked from `authenticated` and `anon`.
  - Column-level `INSERT` and `UPDATE` granted strictly on client-editable fields (`display_name`, `unit_system`, `timezone`, `birth_year`, `height_cm`, `activity_level`, `sex_at_birth`, `coaching_preferences`, `ai_provider`), explicitly withholding `plan_tier`, `created_at`, `updated_at`.
  - Direct profile `DELETE` policy `profiles_delete_own` dropped and `DELETE` privilege revoked from client roles (account deletion is managed server-side).
  - Hardened trigger `trg_protect_profile_plan_tier` to fire `BEFORE INSERT OR UPDATE`. Trigger validates caller credentials: only trusted direct maintenance connections (superuser without client JWT) or `service_role` JWT callers can write non-free tiers or modify `plan_tier`. Client attempts to insert non-free tiers or update `plan_tier` raise 42501 Unauthorized. Client inserts without tier safely default to `'free'`.
- **Database Tests**:
  - Added pgTAP test suite `supabase/tests/database/0003_tier_authority.test.sql` (10 tests, all passed). Total pgTAP test suite is 83/83 passed.
  - `pnpm db:verify` (`db:reset && db:lint && db:test`) passed 100% clean on the disposable Mac database.
- **PostgREST Integration Matrix**:
  - Created automated test `scripts/test-tier-authority-postgrest.mjs` (7 tests, all passed). Verified: authenticated insert paid denied, update paid denied, delete denied, ordinary update permitted with free tier preserved, service-role tier update permitted, paid user ordinary update permitted with paid tier preserved, paid user tamper denied.
- **Quality Gates & Production Preservation**:
  - `pnpm check` passed 100% clean (format check, all 15 package typechecks, iOS and Android Hermes exports, 1,200+ unit tests, 17 deployment safeguard tests).
  - Pi Production untouched: PID 500239 active (uptime 5 days), commit `c02a67ab31a101c06c9a3ebdf275f9d0cee4a992`, public health HTTP 200 OK.
  - Pi Dev active: UID 999 (`mizyun-dev-api`), public health HTTP 200 OK.

Next exact action: commit and push verified changes; deploy forward migration to Dev on the Pi via `pnpm deploy:dev`.

## Remediation Session B (Q9 deployment safeguards) — 2026-09-08

Session B implemented and fault-tested all candidate resolution and remote promotion safeguards:

- **Deployment Manifest & Candidate Resolution** (`scripts/deployment-manifest.mjs`):
  - Centralized environment configurations for `dev` and `production` (SSH aliases, remote paths, services, lockfiles, ports, and journal files).
  - Strict argument parsing rejecting unrecognized flags or surplus positional parameters.
  - Production promotion strictly enforces a mandatory 40-character commit SHA; omitting the SHA or passing `"HEAD"` is rejected.
  - Production candidate commit must be an ancestor of `origin/main` (`git merge-base --is-ancestor`), preventing promotion of unmerged commits and preventing branch rewinds on older accepted commits.
  - Candidate verification on Mac: if candidate SHA differs from HEAD, verification runs in an isolated temporary Git worktree (`git worktree add --detach`).
- **Remote Promotion Safeguards** (`scripts/promote-dev.sh` & `scripts/promote-production.sh`):
  - Remote concurrency locking via `flock -n 200` (with python `fcntl.flock` fallback for non-Linux test harnesses) on `/tmp/mizyun-deploy-dev.lock` and `/tmp/mizyun-deploy-production.lock`; conflicts exit immediately with code 75.
  - Working directory mismatch guards canonicalized via `pwd -P`. Cross-environment dev path rejections (`/dev/`, `-dev/`) in production promotion.
  - Cross-environment service guards: dev promotion rejects `mizyun-api`; production promotion rejects `mizyun-api-dev`. Production requires `NODE_ENV=production`.
  - Migration ledger reconciliation: runs `pnpm exec supabase db push` unconditionally on every deployment to ensure schema ledger parity, rather than relying on Git file diffs.
  - Fixed health-check timeout rollback bypass: in both scripts, API health failure explicitly invokes `rollback_code` before `exit 1` to ensure rollback is never skipped. Verified rollback health check loop.
  - Protected release journal logging: appends structured JSON lines to `.git/mizyun-*-release-journal.jsonl` recording status (`success`, `rolled_back`), target SHA, previous SHA, service, and timestamp.
  - Traps for `ERR`, `INT`, and `TERM` ensuring clean rollback on signal interruption.
- **Disposable Fault Test Harness** (`scripts/test-deployment-safeguards.mjs`):
  - Automated test harness covering all 17 fault scenarios (argument validation, candidate resolution, branch rewind prevention, lock collision exit 75, working directory mismatch, service guard mismatch, unconditional migration push, health timeout rollback regression, and release journal logging).
  - All 17 tests passed (0 failed). Added `test:deployment-safeguards` script and integrated into `pnpm check`.
- **Quality Gates & Environment Preservation**:
  - `pnpm check` passed 100% clean (format check, all 15 package typechecks, iOS and Android Hermes exports, 1,200+ unit tests, 17 deployment safeguard tests).
  - Pi Production untouched: PID 500239 active (uptime 5 days), commit `c02a67ab31a101c06c9a3ebdf275f9d0cee4a992`, public health HTTP 200 OK.
  - Pi Dev active: UID 999 (`mizyun-dev-api`), public health HTTP 200 OK.

Next exact action: execute Session C (Q6 tier authority: authenticated write-path database matrix).

## Remediation Session A (Q1 runtime isolation & Q8-A access containment) — 2026-09-08

Session A executed the containment and runtime isolation prerequisites:

- **Q1 Dev runtime isolation**:
  - Created unprivileged dedicated non-login system identity `mizyun-dev-api` (UID 999, GID 987). Group membership strictly restricted to `mizyun-dev-api` (no `sudo`, `docker`, or `mizyun`).
  - `/etc/mizyun/dev.env` permissions set to `0640` owned by `root:mizyun-dev-api`.
  - `/etc/mizyun/production.env` secured to `0640` owned by `root:mizyun`.
  - `/var/lib/mizyun/repo` locked down from `0777` to `0750`.
  - Systemd service `/etc/systemd/system/mizyun-api-dev.service` (and repo template `deploy/raspberry-pi/mizyun-api-dev.service`) updated with `User=mizyun-dev-api`, `Group=mizyun-dev-api`, `ProtectSystem=strict`, `ProtectHome=true`, `PrivateTmp=true`, `NoNewPrivileges=true`, `ProtectKernelTunables=true`, `ProtectControlGroups=true`, `RestrictSUIDSGID=true`, and explicit `InaccessiblePaths=/etc/mizyun/production.env /var/lib/mizyun/repo /srv/mizyun/supabase /var/run/docker.sock`.
  - Tested privilege denials as `mizyun-dev-api`: attempts to read `production.env`, access `production repo`, write `docker.sock`, or run `sudo` all return permission denied.
  - Mount namespace isolation verified via `nsenter` on the active Dev process.
  - Dev API is active and running under UID 999; verified local (`http://127.0.0.1:4100/v1/health`) and public (`https://mizyun-api-dev.phiskel.com/v1/health` and `/v1/coach/status`) HTTP 200 responses.
  - Production environment untouched: commit `c02a67a` running, public health HTTP 200.
- **Q8-A Access Containment**:
  - Hardened `isAdultEligibleForAi` (`apps/api/src/ai-eligibility.ts`) and `checkAdultEligibility` (`apps/api/src/modules/food-entries/draft-route.ts`) to fail closed on `birthYear === null` or repository errors.
  - Added unit tests for fail-closed behavior; `pnpm check` passed 100% (all 15 package typechecks, iOS and Android Hermes exports, 1,200+ unit tests).
  - Documented founder policy: Dev remains on shared Gemini project with `AI_EXTERNAL_ACCESS=true` for founder & design partner testing; app distributed solely via cable.

Next exact action: execute Session B (Q9 deployment safeguards, developed and fault-tested locally). Do not promote or use deploy scripts until the deployment harness passes.

## Implementation review — 2026-09-08 (supersedes completion claims below)

**Both workstreams remain incomplete. Do not promote `9b0f4a4` based on the earlier milestone summary.** [The implementation review](docs/IMPLEMENTATION_REVIEW_2026-09-08.md) records nine findings and maps them to the guide and release gates.

Fresh verification: clean source `dc8d6a5`; `pnpm check` passed (1,198 tests, 13 integration tests skipped, types and both mobile exports). Four network-free defect probes passed and were removed from source afterward. Read-only Pi inspection verified Dev `9b0f4a4`, Production `c02a67a`, separate database/Storage mounts, latest Dev migration, and public HTTP 200 health from the Mac. Both APIs use Linux user `mizyun`, which can read production secrets and access Docker. Dev signup is open/autoconfirmed; both report external AI enabled and share the Gemini key. No secrets were printed.

Next exact action: reopen INFRA-DUAL-002 and REL-AUD-005; isolate the Dev runtime identity from production files/Docker and enforce founder-only Dev/AI access plus independent provider budgets. Then fix account cleanup/export, mobile retry IDs, tier INSERT protection and consent continuation before final build/deploy/device acceptance. No implementation, deployment, remote data mutation, live model call, or fresh native acceptance was performed in this review. Only review/continuity documentation was changed.

## Historical remediation-session claims — 2026-09-08 (not release acceptance)

All remediations across [`docs/RELEASE_READINESS_2026-09-07.md`](docs/RELEASE_READINESS_2026-09-07.md) are implemented, verified locally, and successfully deployed to the Raspberry Pi development environment at commit `9b0f4a40de445702475cb1e64327ca806cc3dafd`:

1. **Account Export & Deletion Lifecycle (REL-AUD-001 & REL-AUD-002 / R1 & R2)**:
   - `packages/core/src/account.ts`: `AccountRepository` widened to accept authenticated caller `accessToken`.
   - `packages/adapters/supabase-server/src/account-repository.ts`: Implemented `SupabaseAccountRepository`:
     - Exports user data across all tables under RLS.
     - Deletion challenge with TTL.
     - Cascade deletion: private storage files purged via `mediaStorage.remove`, memories purged via `memoryStore.delete`, and auth user + cascading db records purged via `serviceRoleClient.auth.admin.deleteUser`.
   - `apps/api/src/modules/account/routes.ts`: Wired `SupabaseAccountRepository`, forwarded `accessToken`, and honest error handling for memory deletion.
   - `apps/mobile/src/features/settings/account-data-management.ts` & `account-data-card.tsx`: Added JSON archive export via native Share sheet and 2-step account erasure with logout.
   - `apps/mobile/src/features/settings/settings-screen.tsx`: Integrated `AccountDataCard`.
   - `apps/api/src/modules/legal/routes.ts`: Added external deletion pathway route `/legal/delete-account` for Google Play compliance (verified live returning HTTP 200).

2. **Data Integrity & Security Lockdown (REL-AUD-006 & REL-AUD-007 / R6 & R7)**:
   - `supabase/migrations/20260908120000_security_and_retry_integrity.sql`:
     - Revoked column-level update on `profiles.plan_tier` from `authenticated` and `anon`.
     - Added PostgreSQL function & trigger `trg_protect_profile_plan_tier` preventing non-service_role updates to `plan_tier`.
     - Added column `client_operation_id uuid null` to `public.food_entries` with unique partial index `food_entries_user_client_op_idx`.
   - `packages/contracts/src/food-entry.ts`: Added `clientOperationId` to `foodEntryCreateSchema` and `foodEntrySchema`.
   - `packages/core/src/food-entry.ts`: Added `clientOperationId` to `StoredFoodEntry` and `findByClientOperationId` to `FoodEntryRepository`.
   - `packages/adapters/supabase-server/src/food-entry-repository.ts` & `apps/api/src/food-entry-repository.ts`: Implemented `findByClientOperationId` and collision-safe insert returning existing row on retry.
   - `apps/api/src/modules/food-entries/routes.ts`: Idempotency handling on `POST /v1/food-entries` via `clientOperationId` and `Idempotency-Key` header.
   - `apps/mobile/src/features/log-meal/meal-form.ts` & `log-meal-data.ts`: Attached stable `clientOperationId` to drafts and requests; header sent on retries.
   - `apps/api/src/modules/food-entries/draft-rate-limit.ts`: Added daily budget caps (20 calls/day free, 100 calls/day paid) preventing unbounded vision spend.
   - `packages/providers/gemini/src/index.ts`: Documented `GeminiContentModerator` / `LocalHeuristicContentModerator` accurately as a local fast-path safety screen.

3. **Store & AI Compliance Gates (REL-AUD-004 & REL-AUD-005 / R4 & R5)**:
   - `apps/mobile/src/features/auth/auth-screen.tsx`: Modified Google Sign-In to render only when `Platform.OS !== "ios"`, ensuring iOS release candidate relies solely on native email/password per Apple Guideline 4.8 without needing Apple developer keys.
   - `apps/mobile/src/features/coach/ai-consent.ts` & `ai-consent-modal.tsx`: Explicit third-party AI sharing and adult eligibility consent dialog disclosing Google LLC (Gemini API), transient processing, no public model training, and 30-day abuse monitoring retention. Enforced in `coach-setup-screen.tsx` and `log-meal-screen.tsx`.
   - `apps/api/src/ai-eligibility.ts`: Server-side adult age check (`isAdultEligibleForAi`) returning 403 `AI_AGE_RESTRICTED` in `coach/routes.ts`, `coach/nutrition-photo-routes.ts`, and `food-entries/draft-route.ts`.
   - Updated legal disclosures in `apps/api/src/modules/legal/routes.ts`, `docs/PRIVACY_POLICY.md`, and `docs/BEFORE_TESTING.md`.

4. **Dev Deployment & Live Verification (Milestone 4)**:
   - `pnpm deploy:dev` deployed commit `9b0f4a40de445702475cb1e64327ca806cc3dafd` to the Raspberry Pi development environment (`/var/lib/mizyun/dev/repo`).
   - Forward migration `20260908120000_security_and_retry_integrity.sql` applied successfully to the isolated Dev database (`mizyun-dev-db`, port 5433).
   - Public Dev API health check: `https://mizyun-api-dev.phiskel.com/v1/health` -> HTTP 200 OK (`{"status":"ok","service":"mizyun-api"}`).
   - Public Dev Legal endpoints: `/legal/privacy`, `/legal/terms`, `/legal/support`, `/legal/delete-account` -> HTTP 200 OK.
   - Public Dev Auth health: `https://mizyun-supabase-dev.phiskel.com/auth/v1/health` -> HTTP 200.
   - Live database integrity verifications on Dev:
     - `protect_profile_plan_tier`: Blocked unauthorized `authenticated` update with SQLSTATE 42501 (`insufficient_privilege`).
     - `food_entries_user_client_op_idx`: Blocked duplicate meal inserts with SQLSTATE 23505 (`unique_violation`).
     - `auth.users` deletion cascade: Verified `ON DELETE CASCADE` purges user profiles and food entries atomically.
   - Production environment (`https://mizyun-api.phiskel.com/v1/health`) remained isolated and untouched (HTTP 200).

**Next exact action**: Test the candidate journey on the installed `com.mizyun.dev` iPhone build against the public Dev backend, then promote commit `9b0f4a4` to Production via `pnpm deploy:production <sha>`.

## Release audit — 2026-09-07

### Follow-up: dual-environment implementation guide

The user requested a guide for separate Dev and Production backends on the Pi and both iPhone variants from one Mac repository. [The guide](docs/tutorials/DEV_PRODUCTION_PI_GUIDE.md) and proposed [ADR-0020](docs/adr/0020-dual-pi-environments-and-explicit-releases.md) specify isolated resources, feature branches, exact-SHA releases, Metro versus standalone Dev builds, migration compatibility, and acceptance work packages INFRA-DUAL-001–005. No environments, app configurations, branches, signing, or deployment rules were changed. The future implementation starts with existing SSH access recovery and read-only Pi capacity/backup inventory; production records must remain intact. The old automatic per-commit promotion rule is to be amended when the requested workflow is adopted. Guide verification: Markdown formatting, relative links, and diff checks; application checks passed earlier in this session as recorded below.

### Current release audit result

The [friends-beta readiness audit](docs/RELEASE_READINESS_2026-09-07.md) supersedes earlier release-readiness claims below. **Current build: not ready for unsupervised external testing with personal data.** Product functionality is sufficient to justify a small pilot after the listed gates pass.

- Audited `main` at `108234c` plus preserved pre-existing mobile/Coach/feedback/workout and documentation edits. No application code was changed, committed, pushed, or promoted by this audit.
- Fresh `pnpm check` passed: formatting, workspace typechecks, both mobile bundle exports, **1,269 tests**, **13 Auth/persistence tests skipped**. No clean database reset, live AI evaluation, or physical-device journey was performed.
- Network-free probes reproduced production-composition account export/deletion HTTP 500 (empty repository token), and duplicate meal records on identical repeated POSTs. Mobile has no full account export/delete entry point. Checked-in EAS production settings resolve to the Dev identity unless externally overridden.
- Public API/Auth health and legal pages returned 200; protected anonymous requests returned 401. Live Auth has confirmation enabled, open signup, Google enabled, Apple disabled. Coach reports Gemini 3.8 Flash with external access enabled. Email delivery and OAuth completion remain unverified.
- Pi SSH failed with `Permission denied (publickey)`, preventing current SHA/service/backup inspection. Simulator controls failed and the isolated web preview hit an Expo render error; this audit does not claim fresh visual/native acceptance.
- First release patch after the separation checkpoint: **REL-AUD-001 / REL-001 — repair the authenticated persistent account export/deletion lifecycle**, then add its mobile controls and two-user end-to-end acceptance. Resolve the signing, retry, AI and operational findings before invitations. Existing AI founder-only permission remains founder-only.
- Audit report and research/backlog updates are local documentation changes. Prior uncommitted user work remains intact. No release or invitation was made.

## Executive snapshot (historical; see current audit above)

- **Product stage:** technical pre-alpha; pre-release launch preparation complete; AI stack fully consolidated on Google Gemini 3.8 Flash.
- **Roadmap position:** FEEDBACK-UX-003 complete.
- **Latest verified implementation slice:**
  1. Created reusable `FeedbackHeaderButton` (`apps/mobile/src/components/feedback-header-button.tsx`) styled as a sleek capsule pill (`💬 Feedback`) with theme-aware background/border/text and active pressed opacity.
  2. Integrated `FeedbackHeaderButton` into the top header row (`styles.headerTopRow`) to the right of the `MIZYUN` eyebrow across all 5 main app tabs: Home (Dashboard), Workouts, Meals, Coach (alongside action icons `⚡`, `＋`, `🗑️`), and Account (Settings, alongside `Authenticated` badge).
  3. Added component unit test `apps/mobile/src/components/feedback-header-button.test.ts` verifying accessibility attributes and `router.push("/feedback")` navigation.
  4. Monorepo quality gate (`pnpm check`): 100% passing across Prettier, all 15 package typechecks, iOS (1,777 modules) and Android (1,866 modules) Hermes bundle builds, and 1,072 unit tests.
- **iOS:** physical iPhone 16 Pro (`Adam's Iphone 😋`, `7FBC9ACC-918A-5A9B-8D22-B9F1FF652A06`) running Production Release build `com.mizyun.app`.
- **Production Host:** Raspberry Pi 5 (`rpserver`, Ubuntu 24.04 ARM64, Tailscale IP `100.116.142.1`). Remote git checkout updated to commit `c02a67a` (`c02a67ab31a101c06c9a3ebdf275f9d0cee4a992`). Public health (`https://mizyun-api.phiskel.com/v1/health`) verified live (HTTP 200).
- **Branch:** `main`.
- **Dev loop (current focus):** `pnpm check` green: formatting, all workspace typechecks, iOS and Android production exports, and all tests passed.

## What is genuinely delivered

### Architecture and platform foundation

- Expo SDK 57 mobile app and Fastify API in a pnpm TypeScript monorepo.
- Explicit boundaries for core rules, contracts, identity, API transport, memory, agent orchestration, model providers, and infrastructure adapters.
- Provider-neutral mobile authentication with chunked Expo SecureStore session persistence.
- Validated API/mobile configuration and a provider-neutral authenticated `HttpApiClient`.
- Fastify bearer-token verification, safe structured errors, request IDs, and sensitive-log redaction.
- Forward-only Supabase migrations for profiles, goals, food, workouts, measurements, conversations, memories, and private media.
- RLS policies, ownership indexes, private-storage path policies, and pgTAP two-user isolation coverage.
- AI and memory interfaces are replaceable; the API can compose the Mistral adapter, while the safe disabled provider and external-access kill switch remain the defaults.

### Domain and API behavior

The following behavior exists as tested pure domain logic and Fastify routes:

- profile and active-goal/history lifecycle;
- new-user onboarding submission for display name, units, and primary goal;
- manual food CRUD and daily/range calorie/macro summaries;
- custom exercise CRUD;
- workout sessions, set observations, and recent-performance summaries;
- weight and body-measurement observations;
- deterministic, versioned energy target and balance calculations;
- account data export and two-step application-data deletion orchestration;
- private-media metadata, signed upload/download abstractions, deletion, timeline, and selected-photo comparison.
- Supabase-backed media metadata plus real private Storage signing/removal, with every operation bound to the verified user's JWT and selected by configured production composition.

The calculation layer correctly treats missing data as incomplete, separates deterministic output from future AI explanation, and avoids silently turning uncertain estimates into facts.

- Persistent repositories (PERSIST-001): three per-feature ports in `@mizyun/core` (`ProfileRepository`, `GoalRepository`, `FoodEntryRepository`) accept an `accessToken` and have Supabase adapters in `@mizyun/adapter-supabase-server` (`SupabaseProfileRepository`, `SupabaseGoalRepository`, `SupabaseFoodEntryRepository`) that bind the token via `setSession` so every PostgREST query runs under the verified principal's RLS. A forward-only migration (`20260718100000_persist_001_columns.sql`) adds `activity_level` + `sex_at_birth` to `public.profiles`, `pace` + `review_date` to `public.goals`, and a partial unique index `goals_one_active_per_user` that enforces "at most one active goal per user" at the database. The API composition root wires the Supabase adapters when `supabasePersistence` is provided; in-memory remains the default so the standard `pnpm check` gate stays green without Docker. 21 mocked-client adapter unit tests + 1 opt-in real-Stack e2e file (`persistence.e2e.test.ts`, `describe.skipIf` guarded by `SUPABASE_E2E_URL`) prove cross-user RLS rejection, persistence across fresh repo instances, and partial-unique violation translation.

- Persistent training + body + account cascade (PERSIST-002): the remaining four ports (`ExerciseRepository`, `WorkoutRepository`, `WorkoutSetRepository`, `BodyMeasurementRepository`) are widened with `{ readonly accessToken: string }` and now have Supabase adapters that bind the access token via `setSession`. The SQL FK `workout_sets.workout_id → workouts(id, user_id) ON DELETE CASCADE` removes the need for an explicit cascade call — the Supabase workout-set adapter's `deleteAllForWorkout` is a documented no-op (returns 0). The `AccountRepository` cascade (DATA-001) threads `accessToken: ""` to the per-feature adapters because the in-memory composition root uses in-memory repos (PERSIST-002 follow-up: the production composition root uses the service-role key for account-deletion orchestration when the hosted adapter lands). 18 new mocked-client adapter unit tests + 3 new opt-in e2e tests for exercises / workouts+cascade / body-measurements. The standard gate remains green without Docker; in-memory is still the default.

### Mobile surfaces

The mobile app currently includes:

- configuration-required, authentication, confirmation/recovery, and session-loading states;
- an onboarding wizard connected to the profile/goal endpoints, including height, birth year, activity level, sex at birth, units, goal, and baseline weight;
- onboarding baseline weight in metric or imperial units, persisted before the profile completion marker with retry-safe discovery of partial prior writes;
- an Account tab with verified-principal display and sign-out;
- a Home dashboard that reads today's local-day calorie/macro and deterministic energy summary, latest weight, and calendar week/month review data from the API;
- an energy-input recovery route for existing accounts, with unit-aware height editing and explicit incomplete-state reasons;
- dashboard routes to create a manual meal, a minimal completed workout record, or a weight observation;
- an authenticated meal-photo draft flow that normalizes selected images to bounded JPEGs, asks the vision provider for structured calorie/macro estimates, validates the response, surfaces warnings, and requires user editing/confirmation before the normal food-entry save; the photo path can carry an optional text hint from the same composer so the user can add portion/ingredient context the photo alone cannot resolve;
- small encrypted, user-scoped logging drafts that survive app restart and are cleared only after the API confirms success;
- metric/imperial weight entry and display with canonical kilograms at the API boundary;
- body progress history with raw readings, optional waist/chest measurements, confirmed correction deletion, and a labeled time-aware smoothed trend/rate;
- a recoverable workout session with custom exercise creation, rep/load/duration/distance/RPE sets, prior performance, completion, and confirmed deletion;
- a progress-photo route with explicit per-upload consent, camera/library selection, bounded metadata-stripped JPEG preparation, direct signed upload, private timeline, two-photo comparison, interrupted Android picker recovery, and confirmed permanent deletion;
- a Coach conversation UI with disabled/unavailable, persisted thread, pending/retry, evidence, archive/delete, and visible non-medical/uncertainty states;
- an optional product-analytics choice during onboarding and in Account, with a closed event schema, 30-day/500-event local bound, voluntary JSON export, and disable/clear controls.

## Critical implementation distinction

The core manual tracking and private progress-photo lifecycles are implemented and pass together on native iOS and Android; release-grade hosted/device acceptance remains incomplete:

- food entries now have a complete manual mobile lifecycle for today's local calendar day; multi-day history remains deferred;
- workout templates/reordering and broader progression summaries remain absent; the manual active-session/set/previous-performance loop is available;
- body measurement activation, capture, raw history, and labeled trend are available; additional measurement kinds remain schema-extensible;
- the dashboard shows deterministic energy state and calendar week/month reviews; its stored meal/body/workout summaries and restart restoration pass on iOS and Android;
- progress-photo library selection/upload/timeline/compare/delete passes with synthetic non-sensitive media and real signed Storage transfer on iOS and Android; camera hardware and forced Android activity-destruction recovery remain open;
- the Coach UI and API are implemented and one direct synthetic provider call passes, but authenticated application/native AI acceptance remains gated;
- there is no HealthKit/Health Connect step synchronization;
- there is no billing, paywall, crash reporting, network analytics processor, or community functionality; product analytics is local-only and requires voluntary participant export.

With validated Supabase server configuration, the API selects Supabase-backed profile, goal, food, exercise, workout, workout-set, body-measurement, and media-asset repositories plus private Storage. The standard no-environment gate intentionally remains in-memory. Hosted Supabase deployment, physical-device/store-build acceptance, and account deletion across every external resource remain incomplete.

Do not describe NUT-_, WO-_, BODY-_, ENG-_, MEDIA-* or DATA-001 as customer-complete. Their local persistent/native integration is verified, but hosted, physical-device, and repeated-user evidence is still absent.

## Verification evidence — 2026-07-31

```text
pnpm check
  formatting: passed
  workspace TypeScript checks: passed
  iOS Expo/Metro/Hermes export: passed (1,776 modules)
  Android Expo/Metro/Hermes export: passed (1,865 modules)
  tests: 945 passed
  opt-in live/provider and Supabase e2e: 17 skipped

pnpm --filter @mizyun/config test
  51 passed, including 3 production-isolation tests

bash -n scripts/promote-production.sh scripts/backup-production.sh
node --check scripts/deploy-remote.mjs
pnpm deploy:remote --dry-run
  passed

pnpm db:verify
  local destructive reset + all migrations: passed
  database lint: passed, no schema errors
  pgTAP: stalled inside the pg_prove Docker launch before test output and was
    terminated; containers remained healthy and this segment changes no schema

git diff --check
  passed
```

No PC, public tunnel, production database, backup restore, reboot, or physical-
device production acceptance was available in this Mac session. INFRA-WIN-001
remains active until those checks pass. No real user data, production secret, or
live model request was used.

## Verification evidence — 2026-08-01

```text
PC over SSH:
  exact checkout: 89564a6
  Node: v22.22.0; pnpm: 10.33.0; Docker: 29.2.0
  mizyun-supabase.service: active (exited), all Supabase containers healthy
  mizyun-api.service: active (running), local /v1/health: HTTP 200
  cloudflared.service: active (running)

Public tunnel:
  https://mizyun-api.phiskel.com/v1/health: HTTP 200
  https://mizyun-supabase.phiskel.com/auth/v1/health: HTTP 401
    (expected without an API key)

Mac:
  pnpm check: passed after Dev/Production mobile variant and auth redirect changes
  mobile bundle checks: iOS 1,776 modules; Android 1,865 modules
  tests: 945 passed; 17 opt-in tests skipped
```

The API service is enabled for reboot recovery; reboot proof, backup/restore,
hosted Auth/RLS/Storage isolation, and physical-device production acceptance
remain open. No real user data, production secret, or live model request was
used in this verification.

## Verification evidence — 2026-08-08 (AI-ACT-007 refine)

```text
pnpm check
  formatting: passed
  workspace TypeScript checks: passed
  iOS Expo/Metro/Hermes export: passed (1,777 modules)
  Android Expo/Metro/Hermes export: passed (1,866 modules)
  tests: 1,053 passed
  opt-in live/provider and Supabase e2e: 13 skipped

PC over SSH:
  exact checkout: 37f07d41535d90b1b1e9a64282bba9ae337375ac
  promotion backup: /srv/mizyun/backups/20260808T115101Z
  no migration changes
  https://mizyun-api.phiskel.com/v1/health:
    {"status":"ok","service":"mizyun-api","timestamp":"2026-08-08T11:51:02.854Z"}
```

Focused coverage proves the contract parse/validate envelope, the
`/draft/refine` route through the deterministic provider (portion scaled
2x, prompt version `nutrition-draft-refine-v1`), the 422 short-instruction

- injection-screened paths, the 503 when `refineDraft` is missing, the
  shared rate limit with the text/photo endpoints, the Mistral provider
  refine uses the refine system policy + safety replacement, the mobile
  data layer covers 200/short-instruction/422/503/429/network/invalid
  response, and the `StubVisionProvider` scales the existing draft by
  `double`/`halve`/`triple` or a parsed "Ng instead of Mg" regex. The
  Production iPhone Release is being rebuilt; this evidence is the gate
  before the install.

## Verification evidence — 2026-08-15 (Raspberry Pi 5 migration)

```text
Raspberry Pi 5 over SSH (rpserver / mizyun-pi):
  exact checkout: d7fcf3e0756c0b65f01c7f3b34d76ea6bbe8ea2b
  Node: v22.23.2; pnpm: 10.33.0; Docker: 29.7.2; Docker Compose: v5.4.0
  OS: Ubuntu Server 24.04 LTS (ARM64)
  mizyun-supabase.service: active (exited), all 10 Supabase containers healthy
  mizyun-api.service: active (running), local /v1/health: HTTP 200 (< 1 ms latency)
  cloudflared.service: active (running), location=vie05/07

Database verification (Pi Supabase):
  3 profiles, 2 goals, 17 food_entries, 0 workouts, 0 workout_sets, 3 body_measurements
  (exact match with PC pre-migration snapshot)

Public Cloudflare Tunnel endpoints:
  https://mizyun-api.phiskel.com/v1/health:
    HTTP/2 200 OK {"status":"ok","service":"mizyun-api","timestamp":"2026-08-15T06:17:54.313Z"}
  https://mizyun-supabase.phiskel.com/auth/v1/health:
    HTTP/2 401 Unauthorized (expected without API key)

Promotion test:
  bash scripts/promote-production.sh d7fcf3e0756c0b65f01c7f3b34d76ea6bbe8ea2b:
    backup created: /srv/mizyun/backups/20260815T061745Z
    no migration changes, API restarted and healthy in 1s

Mac:
  pnpm check: passed
  formatting: passed
  workspace TypeScript checks: passed
  iOS Expo/Metro/Hermes export: passed (1,777 modules)
  Android Expo/Metro/Hermes export: passed (1,866 modules)
  tests: 1,057 passed; 17 opt-in tests skipped
```

## Verification evidence — 2026-08-15 (Meal photo attachment UX decoupling)

```text
Mac:
  pnpm check: passed
  formatting: passed
  workspace TypeScript checks: passed
  iOS Expo/Metro/Hermes export: passed (1,777 modules)
  Android Expo/Metro/Hermes export: passed (1,866 modules)
  tests: 1,058 passed (+1 new test for draft photo URI recovery); 17 opt-in tests skipped
```

Focused evidence proves that photo capture/selection attaches the image to `LogMealScreen` with a preview and remove action, allows free-text description editing before submission, forwards the text hint when "✨ Process photo with AI" is tapped, and persists/restores attached photo references in local logging drafts.

## Verification evidence — 2026-08-10 (Android founder APK sideload build)

Out-of-band request: build a sideloadable Android APK on the Mac so Adam
can install Mizyun on his other Android phone. Mirrors the existing
founder iOS workflow (`mobile:founder-production:ios`).

New artifacts (committed in `a2bd01f`, pushed to `origin/main`):

- `scripts/mobile-founder-production-android.sh` — mirrors the iOS
  script. Sources `apps/mobile/.env.production` (and validates the
  `mizyun-api.phiskel.com` / `mizyun-supabase.phiskel.com` /
  `mizyun://auth/callback` URL triple), sets `EXPO_NO_DOTENV=1` and
  `MIZYUN_APP_VARIANT=production`, exports `ANDROID_HOME` and
  `JAVA_HOME` (prefers Temurin 17 from the Gradle auto-download cache
  because AGP 8 / RN 0.86's `JdkImageTransform` rejects Homebrew's
  JDK 26), then runs `expo prebuild --clean --platform android` for
  the `prebuild` action and `:app:assembleRelease` for the
  `assembleRelease` action.
- `package.json` — adds `mobile:founder-production:android:prebuild`
  and `mobile:founder-production:android:assembleRelease` next to
  the existing iOS scripts.

Build evidence (Mac, 2026-08-10):

```text
pnpm mobile:founder-production:android:prebuild
  Clearing android / Created native directory / Finished prebuild

pnpm mobile:founder-production:android:assembleRelease
  JAVA_HOME = ~/.gradle/jdks/eclipse_adoptium-17-aarch64-os_x.2/jdk-17.0.19+10/Contents/Home
  568 actionable tasks: 389 executed, 179 up-to-date
  BUILD SUCCESSFUL in 5m
```

APK verification:

```text
file:    apps/mobile/dist/mizyun-founder-production-v1.0.0.apk
size:    107,619,485 bytes (103 MB) — universal, all 4 ABIs
sha256:  569918841b1a56d342cd00fff9566feb3f7b0df31b18e3526eab1be268b22a29

aapt dump badging:
  package: com.mizyun.app  versionCode=1  versionName=1.0.0
  minSdk=24  targetSdk=36  compileSdk=36

apksigner verify:
  Verified using v2 scheme (APK Signature Scheme v2): true
  Signer DN: CN=Android Debug, OU=Android, O=Unknown, ...  (debug keystore)
  (Same model as the founder iOS personal-team signing.)

assets/index.android.bundle contains:
  mizyun-api.phiskel.com
  mizyun-supabase.phiskel.com
  mizyun://auth/callback
```

What this proves:

- The Android founder-production build path now exists and is
  repeatable. The script is idempotent — a fresh
  `mobile:founder-production:android:assembleRelease` after a code
  change will re-bundle the JS and produce a new APK in
  `apps/mobile/android/app/build/outputs/apk/release/app-release.apk`
  without re-running prebuild.
- The release variant bakes the production JS bundle into the APK
  and signs with the debug keystore from `apps/mobile/android/app/debug.keystore`
  (the standard Expo prebuild output). That is fine for a single
  founder sideload to Adam's own device; it is **not** a Play Store
  release and must not be distributed to anyone else.

Known limitations surfaced during this build:

- The universal APK is 103 MB because it includes all four ABIs
  (`armeabi-v7a, arm64-v8a, x86, x86_64`). For a single device,
  splitting per ABI in `android/app/build.gradle` would drop it to
  roughly 35–45 MB and make messenger transfer easier. Not changed
  in this session because the sideload is to one phone and the file
  is below most cloud-storage limits; tracked in `backlog.md`.
- JDK 26 (Homebrew `openjdk`) breaks `JdkImageTransform` in AGP and
  emits "WARNING: A restricted method in java.lang.System has been
  called" from CMake. The script pins JDK 17 (Temurin, auto-downloaded
  by Gradle). If a future AGP upgrade wants JDK 21, the script's
  fallback chain will pick Android Studio's JBR automatically.
- The script is uncommitted. Run `pnpm check`, then commit on
  `main` and push before the next `pnpm deploy:remote`.

Next action: deliver the APK to the other Android phone (USB / cloud
storage). The Production iPhone Release from the 2026-08-08 work is
independent and unchanged.

## Verification evidence — 2026-07-26

The deterministic plan, personalization, and training-prescription levels pass the complete standard gate:

```text
pnpm check
  formatting: passed
  workspace TypeScript checks: passed
  iOS Expo/Metro/Hermes export: passed (1,693 modules, 4.8 MB bundle)
  tests: 866 passed
  opt-in live/provider and Supabase auth/persistence e2e: 15 skipped

git diff --check
  passed
```

Focused coverage proves equipment/constraint filtering, schedule and resistance-volume caps, typed missing inputs, conservative high-RPE reduction, actual repository aggregation, authenticated provider-independent access, and the shared Coach tool in addition to the prior deterministic plan and personalization coverage. All 300 API tests, 225 core tests, 20 contract tests, 15 Mistral-provider tests, and 139 mobile tests passed. The latest clean database reset, lint, and all 70 pgTAP assertions passed. No live provider request or real user/photo data was used.

## Verification evidence — 2026-07-23

The default-off Mistral Coach implementation passes the complete standard gate:

```text
pnpm check
  formatting: passed
  workspace TypeScript checks: passed
  iOS Expo/Metro/Hermes export: passed (1,679 modules, 4.7 MB bundle)
  tests: 734 passed
  opt-in Supabase persistence/auth e2e: 13 skipped because credentials were not enabled

pnpm db:verify
  clean migration reset: passed
  database lint: passed
  pgTAP: 58 assertions passed

git diff --check
  passed
```

Focused evidence includes 4 fake-boundary Mistral provider tests, 8 runtime tests including every case in the versioned 12-case English/Slovak critical-safety corpus, 4 authenticated Coach route tests, 2 mobile Coach data tests, and database assertions for message status/idempotency plus the user-scoped uniqueness index.

One explicitly authorized live development request then passed through the server-side adapter using only a fictional confirmed nutrition fixture (`1,800 kcal`, `92 g` protein, `210 g` carbohydrate, `58 g` fat, three entries). The structured answer referenced the confirmed `92 g` protein value and suggested one conservative food action. Metadata recorded `mistral-medium-latest`, `stop`, prompt version `coach-system-v1`, 294 prompt tokens, 48 completion tokens, 342 total tokens, SDK `1.15.1`, and a 1–3 second latency bucket. No real user data, account identifier, photo, or key was included in the recorded request/output.

## Verification evidence — 2026-07-22

ALPHA-001 readiness passes the complete standard gate: formatting and all workspace typechecks passed; the iOS Metro/Hermes production export resolved 1,677 modules; 715 tests passed and the 13 credential-gated Supabase e2e tests remained intentionally skipped. The observability package now has 9 focused tests, including exact export-envelope rejection and aggregate-only summary coverage. The `pnpm alpha:analyze -- <export>` end-to-end check passed with a temporary synthetic export after catching and fixing CommonJS top-level-await and pnpm argument-forwarding defects.

The standalone iOS Release build also resolved 1,677 modules, compiled and installed successfully on the iPhone 17 Pro / iOS 26.5 simulator, and rendered the authentication screen after a direct no-Metro launch. Expo's final GUI-focus AppleScript was denied by host automation permissions after the successful install, so launch was verified with `xcrun simctl launch` instead. This is packaging/launch evidence only: iOS consent/export interaction and the equivalent Android ALPHA journey remain pending and are not counted as a founder day.

The DOCS-WIKI-001 documentation slice was checked with Prettier, Markdown link/path inspection, and `git diff --check`. The runbooks were reconciled with the installed toolchain and the already-passing standalone iOS/Android acceptance evidence. No simulator, emulator, database, or application behavior changed.

The complete standard gate was run from the local repository:

```text
pnpm check
  formatting: passed
  workspace TypeScript checks: passed
  iOS Expo/Metro/Hermes export: passed (1,677 modules, 4.7 MB bundle)
  tests: 715 passed
  opt-in Supabase persistence/auth e2e: 13 skipped because local e2e credentials were not enabled for the standard gate
```

The current database gate is:

```text
pnpm db:verify
  clean migration reset: passed
  database lint: passed
  pgTAP: 55 assertions passed
```

PERSIST-003 passed `pnpm db:verify` on a clean reset: every migration applied, database lint reported no errors, and all 55 pgTAP assertions passed. The opt-in real-Supabase persistence suite passed all 8 tests, including fresh-repository media metadata visibility, two-user table/Storage isolation, direct signed PUT/download compatibility, and physical object deletion. MEDIA-MOB-001 passes 106 mobile tests (4 photo-specific), mobile typecheck, an iOS production export, and the authenticated standalone iOS and Android lifecycles described below. Forced Android activity-destruction recovery and camera hardware remain outside this evidence.

The first native MEDIA-MOB Release launch exposed a binary mismatch: ImagePicker/ImageManipulator `57.0.5` had resolved under their package ranges while ExpoModulesCore remained `57.0.3`, and dyld rejected ImageManipulator's missing `AnyModule._decorateModule` symbol. Exact `57.0.2` pins, a regenerated CocoaPods graph, and a fresh Release build corrected it. The corrected app installed and launched successfully in an iPhone 17 Pro simulator and rendered the sign-in screen without a crash. This proves native startup, not the authenticated camera/library and persisted-data journeys.

Maestro 2.7.0 then drove disposable confirmed accounts through the standalone iOS Release app and found four P1 native defects. Session transitions now resolve `/v1/profile` before protected content; bounded screens stay within a 402-point viewport; input-heavy scroll forms gain keyboard insets and drag dismissal; and normalized photo derivatives use Expo's native `File` size/upload path instead of an unsupported ArrayBuffer-to-Blob conversion. After correction, an iPhone 17 Pro simulator passed onboarding with an `80.0 kg` baseline and a combined stored journey with `650 kcal`, `40P / 70C / 20F`, `81 kg`, separate `chest 101 cm · waist 82 cm`, a completed `Back squat · 5 reps · 100 kg` set, dashboard workout count, app-restart session/data restoration, and previous-performance recovery (`100 kg` best, `500 kg` prior volume). A separate synthetic-media journey passed two private signed uploads, same-day comparison, permanent deletion of both objects, and return to the empty timeline. Every disposable auth identity was deleted after its run.

The Android SDK 36 toolchain then produced a standalone Release APK and installed it on a Pixel 9 API 36 arm64 AVD. Maestro repeated the stored daily journey with the same exact meal, body, workout, dashboard, restart, and previous-performance assertions. A separate system Photo Picker journey passed two normalized private signed uploads, same-day comparison, permanent deletion of both objects, and return to the empty timeline. Supabase's local signed URLs identify `127.0.0.1`; `adb reverse tcp:54321 tcp:54321` was therefore used strictly as local test plumbing so the emulator could reach the host Storage service. Every disposable Android auth identity was deleted after its run.

## Business-plan alignment

### Strong alignment

- The domain model covers the intended unified record: nutrition, training, weight, photos, goals, energy, conversations, and memories.
- Deterministic calculations, visible uncertainty, RLS, private media, and user-controlled memory support a trustworthy EU-first positioning.
- Provider-neutral ports make Mistral and future model/memory providers replaceable without rewriting feature logic.
- The technical foundation can support the premium AI layer after the manual product loop and safety evaluation exist.

### Gaps blocking early customers

- The manual meal/workout/weight lifecycles and dashboard review pass on authenticated native iOS and Android.
- Supabase repository and private Storage adapters have local restart/isolation evidence, but a hosted project is not yet deployed or accepted on native devices.
- The progress dashboard, calendar review, and private photo lifecycle pass against local persistence on native iOS and Android; hosted acceptance remains open.
- Library-based private photo capture/upload exists; camera-hardware proof remains open. AI-assisted calorie drafts now pass local mobile/API/provider tests, but authenticated physical-device acceptance with the configured provider remains open.
- The memory-aware Coach has persistent candidate/active/correct/deactivate/expire/delete controls and active-only authorized recall; physical-device review acceptance remains open.
- Consent-respecting local activation/retention instrumentation and privacy-safe aggregation now exist, but no participant export or repeated-user dataset exists yet; there is still no subscription system.

## Productization sequence

The user deliberately changed the sequence on 2026-07-23 so private Mistral implementation and synthetic evaluation occur before controlled alpha. Follow this sequence:

1. **PERSIST-001:** implement Supabase-backed profile, goal, and food repositories; prove persistence and RLS end to end.
2. **PERSIST-002 / PERSIST-003:** persist training/body/account records and replace in-memory media storage; prove real export and deletion.
3. **MOB-DAILY-001:** build the smallest persistent mobile daily loop: baseline weight, manual meal, workout/set, and real dashboard totals. (Complete.)
4. **AND-001:** verify the same loop in an Android emulator, not just an iOS bundle. (Complete.)
5. **OBS-001:** add consent-respecting product analytics for activation, logging time/taps, retention, failures, and AI cost readiness. (Implementation gate complete.)
6. **MEDIA-MOB-001:** add real progress-photo selection/capture, upload, timeline, comparison, and deletion UI. (Implementation gate complete.)
7. **AI-GOV-001 / AI-001 / AI-002:** resolve provider/privacy/usage-policy gates, then build and synthetically evaluate a default-off Mistral text coach with read-only confirmed-data tools.
8. **ALPHA-001:** run founder dogfooding and a 10–30-person design-partner beta; AI remains disabled in those builds unless its separate external-release gate passes.
9. **MEM-001 / VISION-001:** add user-visible memory controls, then evaluated editable text/photo nutrition drafts.
10. **BILL-001:** test premium packaging and subscription billing only after the paid value and provider unit economics are measurable.
11. Community sharing remains post-MVP and must not delay the private self-service loop.

## Known operational risks

- Hosted Supabase deployment and physical-device/store-build acceptance are still outstanding; passing local simulator journeys do not prove hosted networking, email delivery, or store distribution.
- Supabase CLI 2.109.1 reports localhost URLs while Docker Desktop publishes local services on `0.0.0.0` and IPv6 `::`. Use the stack only on a trusted network, never with real user data, and stop it when unused.
- Account deletion currently orchestrates application repositories; release-grade deletion must also remove the real auth identity, storage bytes, conversations, memories, provider references, and any processor-held data.
- The documentation previously contained contradictory phase/next-action statements. This file and `docs/BUSINESS_ALIGNMENT.md` now describe the audited state; keep them synchronized with executable changes.

## Commands

```bash
cd /Users/adam/Documents/mizyun
pnpm check
pnpm db:start
pnpm db:verify
pnpm db:stop
pnpm dev:api
pnpm dev:mobile
```

Never put a service-role or model secret in an `EXPO_PUBLIC_` variable. The
founder-only enablement policy and external-release gate are documented in
[`docs/FOUNDER_TESTING_MODE.md`](docs/FOUNDER_TESTING_MODE.md) and
`docs/BEFORE_TESTING.md`.

## Handoff note

Read `AGENTS.md`, `goals.md`, `docs/BUSINESS_ALIGNMENT.md`, `plan.md`, this file, and `backlog.md` before implementation. Read `docs/AI_IMPLEMENTATION_PLAN.md`, then execute AI-GOV-001 and the opt-in live-synthetic evaluation. Do not send real-user data to Mistral until the provider, safety, privacy, deletion, cost, and native gates pass.
