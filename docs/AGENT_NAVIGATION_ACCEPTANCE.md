# Agent Navigation and Repository Memory — Acceptance Evidence

> Living acceptance register for `DOCS-NAV-001` through `DOCS-NAV-004` and `CODEBASE-SIMPLIFY-001`. Tracks evidence, document inventories, link validation, line counts, manifest coverage, and independent helper exercises.

> **Current status (2026-09-23):** `SIMPLIFY-01` restored compact, current startup guidance and `SIMPLIFY-02` repaired the navigation failure boundaries recorded below. The older sections remain historical evidence; their Pi/Mistral/Qwen topology, old signal names, and blanket completion claims are not current acceptance.

## 2026-09-22 — `SIMPLIFY-01` current startup evidence

Baseline was local `HEAD` `ed70df727fdb38940b686b1dd2647d519f8478cd` with 81 pre-existing modified/untracked entries. The review therefore covers committed HEAD plus disclosed working-tree state and is not a clean-commit audit.

| Measurement                                                             |  Before |  After |            Change |
| ----------------------------------------------------------------------- | ------: | -----: | ----------------: |
| `status.md` lines                                                       |     808 |     51 |     -757 (-93.7%) |
| `status.md` bytes                                                       | 149,736 |  8,244 | -141,492 (-94.5%) |
| Normal startup lines (`AGENTS.md` + `status.md` + `docs/START_HERE.md`) |     993 |    236 |     -757 (-76.2%) |
| Normal startup bytes                                                    | 167,384 | 26,017 | -141,367 (-84.5%) |

The live status now retains current work packages, Hetzner Dev/Production authority, Pi recovery scope, the paused-Qwen rule, consent-based AI admission, unresolved Q1–Q9/release gates, and one exact next action. The complete former status is preserved in [`docs/archive/status/STATUS_HISTORY_2026-09-13_THROUGH_2026-09-22.md`](archive/status/STATUS_HISTORY_2026-09-13_THROUGH_2026-09-22.md), with relative links rebased after the move.

Current routing changes:

- `environment-build-deployment` points to the Hetzner guide and dedicated deploy skills; its limitation identifies Hetzner as authority, the Pi as recovery storage, and local Qwen as paused.
- `coach-consent-budgets` identifies Gemini as the only active provider and authentication + adult eligibility + current consent as admission. Email allowlisting is deprecated; ADR-0024 is routed explicitly.
- Architecture matches actual composition: Gemini-or-disabled on the server and Expo Router/Auth/analytics/notification composition on mobile, without a React Query provider.
- The verification skill separates exact-SHA Hetzner Dev/Production evidence from generic health and device acceptance.
- The roadmap's topology paragraph now describes Hetzner rather than the superseded Pi/Windows deployment path; sequencing is unchanged.

Stage 1 changes are documentation/navigation only. They do not claim a deployment, native build, provider call, device acceptance, Production release, or closure of a remediation gate.

### Independent cold-start exercises

A non-author helper started from `docs/START_HERE.md`, current `status.md`, and the named navigation commands. Shared bootstrap is 105 lines / 12,083 bytes; including root `AGENTS.md`, normal startup is 236 lines / 26,017 bytes.

| Scenario                 | Commands and bounded output                                                                                      | Result                                                                                                                                                                                                    |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Meal retry/pagination    | `pnpm context meal-logging`; 59 lines / 3,130 bytes in 441 ms                                                    | Located the meal owner, API/contract/mobile paths, retry and pagination tests, mobile instructions, and open Q2. The manifest now prioritizes `meal-list-screen.tsx` and `log-meal-data.test.ts`.         |
| Account deletion         | `pnpm context account-lifecycle`; 57 lines / 2,758 bytes in 348 ms                                               | Located route, mobile interface, contract/port/adapter, database test, mobile instructions, and open Q4/Q5 without claiming closure.                                                                      |
| AI consent/admission     | `pnpm context coach-consent-budgets`; final recheck 59 lines / 3,644 bytes in 444 ms                             | Routed only current architecture, ADR-0024, PAT-002 and the provider gate. All agree on Gemini-or-disabled, no user provider switch, consent-based adult access, deprecated allowlisting, and open Q7/Q8. |
| Shared food contract     | `pnpm impact --since HEAD --json` plus `pnpm context contracts-shared`; impact 17,291 bytes, context 1,900 bytes | Located the contract owner/export/test and declared consumers. The audit also reproduced the Stage 2 owner-vs-consumer/package-fanout defect; it is not hidden or treated as accepted.                    |
| Hetzner deploy/preflight | `pnpm context environment-build-deployment`; 56 lines / 2,550 bytes in 338 ms                                    | Located Hetzner authority, role-specific aliases/services, deploy skills/preflights, exact-SHA release rule, Pi recovery scope, and open signing/R8 gates.                                                |

Archive link validation passed. The latest archive warns that its topology and next actions may be superseded and points back to live status. No active route sends a cold-start reader to Pi deployment, local Qwen execution, email allowlisting, Mistral runtime, or user-selectable provider instructions. Controlled before/after context-byte savings remain unmeasured; do not claim the provisional 30% target from this one post-change run.

### Stage 1 verification

- `pnpm check`: passed on 2026-09-22 from the disclosed shared dirty tree. It included 0 navigation errors with 11 retained review-freshness warnings, 27/27 navigation tests, formatting, all 15 workspace typechecks, iOS/Android Hermes exports, 493 mobile tests, 565 API tests with 15 policy-gated E2E tests skipped, 39 deployment safeguards, Hetzner/backup/OAuth/build-matrix/IPA safeguards, and 56/56 offline AI invariants.
- `git diff --check`: passed.
- Independent non-author cold-start/contradiction review: passed Stage 1 after stale ADR/PAT routing was corrected. The same reviewer documented the still-open Stage 2 failure boundaries; helper completion alone was not used as acceptance.
- Evidence tier: implemented and automatically verified only. No Dev deployment, device acceptance, or Production release was performed for this documentation/navigation slice.

## 2026-09-23 — `SIMPLIFY-02` navigation-strengthening evidence

Baseline remained local `HEAD` `ed70df727fdb38940b686b1dd2647d519f8478cd` plus the disclosed shared dirty tree. GitHub issue [#124](https://github.com/AdamHikl/mizyun/issues/124) tracks this bounded tooling slice. No feature-map schema extension was needed.

Implemented behavior:

- Process-level typo and ambiguous-alias failures now render real IDs and titles. `meal-loggin` suggests `meal-logging`; `tokens` lists `auth` and `coach-consent-budgets`; neither output contains `undefined` or silently selects a feature.
- Context discovery walks the actual ancestors of mapped implementation paths, stops at the real repository boundary (including symlink resolution), returns only real in-repository `AGENTS.md` files, deduplicates shared ancestors, and remains subject to the existing 120-line bound. Backend-only `system-health` now surfaces root `AGENTS.md`; mobile features also surface `apps/mobile/AGENTS.md`.
- Impact output separates `direct-owner`, `referenced-consumer`, `package-reverse-dep`, and semantic propagation. The broad package-membership fallback was removed, so unmatched package files remain explicitly unmapped instead of fanning out to every feature in that package.
- Review metadata now compares committed changes against `lastReviewedSha..HEAD` and reports local staged, unstaged, and untracked owned paths separately. Local modifications remain visible when HEAD has not changed or the reviewed SHA is absent from a shallow checkout; unavailable committed freshness is an explicit warning rather than a false fresh result.
- Navigation validation now measures all relevant source under `apps`, `packages`, and `scripts`, including tests and executable fixtures. Generated/build output, snapshots, declaration files, dependencies, and Expo artifacts are explicit exemptions. The current advisory reports 175 of 501 relevant files as unmapped; this remains visible follow-up inventory rather than a fabricated green result.
- The validator reports the normal startup set at 236 lines / 25,987 bytes and warns, without failing or rewriting files, above 120 status lines or 350 total startup lines.

Regression evidence before the full repository gate:

- `pnpm test:navigation`: 38/38 passed, preserving the original 27 and adding process, ancestor-instruction/symlink, freshness/shallow-history, impact classification, unmapped, missing-base, inert-command, coverage, and startup-budget fixtures.
- `pnpm navigation:check`: passed with 0 errors and 22 warnings: 11 retained committed-review warnings, 10 separately classified local-drift warnings, and 1 mapped-source-coverage warning.
- Direct CLI probes passed: typo and ambiguous-alias processes exited 1 with real suggestions; backend context found root instructions; current dirty impact JSON exposed direct, referenced, propagated, and unmapped groups.
- An independent non-author review reproduced missing-SHA drift suppression and outside-repository instruction discovery through symlinks. The coordinator separated local status from committed-history availability, added explicit unavailable warnings, enforced realpath containment, narrowed coverage exemptions, preserved machine-readable compatibility aliases, and added adversarial regressions before rerunning acceptance.
- Fresh `pnpm check` passed from the shared working tree after the adversarial follow-up fixes: 0 navigation errors with the 22 disclosed advisories, 38/38 navigation fixtures, repository formatting, all 15 workspace typechecks, iOS/Android Hermes exports, 493 mobile tests, 565 API tests with 15 policy-gated E2E tests skipped, 39 deployment safeguards, Hetzner/backup/OAuth/build-matrix/IPA safeguards, and 56/56 offline AI invariants.
- `git diff --check` passed after targeted formatting.

Evidence tier remains implemented and automatically verified only. This tooling/documentation slice does not require or claim Dev deployment, device acceptance, database work, native builds, provider calls, or Production release. The source changes remain uncommitted in the shared working tree until the user requests a commit.

## Historical 2026-09-09 baseline and evidence

### 1. Baseline & Environment Metadata

- **Date**: 2026-09-09
- **HEAD Commit SHA**: `7faec30d0c2e7e165891dd970004c8865936ccde`
- **Working Tree State at Start**: Dirty (`backlog.md`, `status.md`, `docs/REMEDIATION_EVIDENCE_CHECKLIST.md`, `docs/AGENT_NAVIGATION_IMPLEMENTATION_PLAN.md`)
- **Node.js**: v22.x+
- **pnpm**: 10.33.0

---

### 2. Stage 1 Inventory & Contradiction Evidence (`DOCS-NAV-001`)

### Startup Line Count Comparison

| Document                         | Before Stage 1 (Lines) | After Stage 1 (Lines) | Delta                     | Notes                                                                         |
| -------------------------------- | ---------------------- | --------------------- | ------------------------- | ----------------------------------------------------------------------------- |
| `AGENTS.md`                      | 125                    | 125                   | 0                         | Streamlined startup reading paragraph; preserved all mandatory safety rules   |
| `status.md`                      | 910                    | 51                    | -859                      | Historical entries (lines 11–910) moved to archive snapshot                   |
| `docs/START_HERE.md`             | 0                      | 57                    | +57                       | New concise routing index                                                     |
| `goals.md`                       | 149                    | 149                   | 0                         | Unchanged stable product intent (read on product/pricing/intent scope)        |
| `docs/BUSINESS_ALIGNMENT.md`     | 165                    | 165                   | 0                         | Unchanged business bridge (read on business/pricing scope)                    |
| `plan.md`                        | 365                    | 365                   | 0                         | Unchanged roadmap (read on sequencing scope)                                  |
| `docs/SESSION_GUIDE.md`          | 144                    | 140                   | -4                        | Two authority questions separated; 5-step startup order                       |
| **Normal Startup Reading Total** | **1,714 lines**        | **233 lines**         | **-1,481 lines (-86.4%)** | Target $\le 350$ lines achieved (`AGENTS.md` + `status.md` + `START_HERE.md`) |

### Document Classification & Authority Mapping

| Classification          | Count | Representative Files                                                                                            | Authority Rule                                                                         |
| ----------------------- | ----- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **Rules**               | 5     | `AGENTS.md`, `apps/mobile/AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/QUALITY_GATES.md`, `docs/BEFORE_TESTING.md` | Defines what MUST happen. Overrides all lower documents.                               |
| **Product Intent**      | 2     | `goals.md`, `docs/BUSINESS_ALIGNMENT.md`                                                                        | Defines product goals, target user, non-goals, launch wedge.                           |
| **Decisions**           | 21    | `docs/adr/0001` through `0021`, `docs/adr/README.md`                                                            | Defines durable architecture choices. Authoritative until explicitly superseded.       |
| **Procedures**          | 11    | `docs/SESSION_GUIDE.md`, `docs/tutorials/README.md`, 9 individual runbooks                                      | Reusable operational memory. Does not authorize commands without current task context. |
| **Current Observation** | 2     | `status.md`, `docs/IMPLEMENTATION_REVIEW_2026-09-09_ROUND_3.md`                                                 | Live operational snapshot, latest verified SHAs, open blockers.                        |
| **Historical Evidence** | 7     | `docs/archive/status/*`, `docs/RELEASE_READINESS_2026-09-07.md`, Round 1 & 2 reviews                            | Past state and historical test runs. Never treated as fresh live proof.                |
| **Pending Work**        | 3     | `backlog.md`, `plan.md`, `docs/REMEDIATION_EVIDENCE_CHECKLIST.md`                                               | Ordered tasks, exit criteria, and remediation tracking.                                |

### Documented Contradictions & Reconciliations

1. **Host Topology (`plan.md` vs. Reality)**:
   - _Contradiction_: `plan.md` historically cited `INFRA-WIN-001` (Windows/WSL2 host) as active milestone.
   - _Reality_: ADR-0020 and AGENTS.md establish Raspberry Pi 5 (`mizyun-pi`) as primary side-by-side host (Dev: 4100/8100/5433, Prod: 4000/8000/5432). Windows PC is hot backup.
   - _Reconciliation_: `plan.md` lines 48–56 reconciled to ADR-0020 topology; documented in `docs/tutorials/README.md` and indexed in `docs/adr/README.md`.
2. **AI Provider (`plan.md` vs. Reality)**:
   - _Contradiction_: `plan.md` historically referenced Mistral as primary text-coach milestone.
   - _Reality_: Gemini is the sole active model provider (`gemini-3.8-flash` default, `gemini-3.6-flash` fallback per ADR-0019); Mistral provider was removed in migration `20260903120000_remove_mistral_provider.sql`.
   - _Reconciliation_: Reconciled in `plan.md`, `docs/tutorials/README.md`, and `docs/patterns/README.md` (PAT-002).
3. **ADR-0020 Status**:
   - _Contradiction_: `docs/adr/0020-dual-pi-environments-and-explicit-releases.md` header previously labeled status as "proposed implementation target".
   - _Reality_: Pi Dev and Production stacks are installed and operational; ADR-0020 is accepted with open release gates (R3 Part B, R8).
   - _Reconciliation_: ADR-0020 header and `docs/adr/README.md` synchronized to "Accepted" status with explicit open release gate notes.
4. **Q1 Dev Repo Writable Conflict**:
   - _Contradiction_: `status.md` historical text claimed Dev repo was removed from `ReadWritePaths`, but `mizyun-api-dev.service` and live SSH probes (Round 3) confirmed `/var/lib/mizyun/dev/repo` was writable.
   - _Reconciliation_: Recorded as an open blocker in current `status.md` and `docs/REMEDIATION_EVIDENCE_CHECKLIST.md` rather than accepted as closed.
5. **Inbound Links to `status.md`**:
   - 28 inbound references across 16 files identified. 0 fragment anchor links found (`status.md#...`). All inbound links resolve cleanly to the root snapshot `status.md`.

---

### 3. Stage 2 Manifest Coverage & Context CLI (`DOCS-NAV-002`)

- **Manifest Path**: `docs/feature-map.json`
- **Schema Specification**: `docs/feature-map.schema.json` (`schemaVersion: 1`)
- **Feature Count**: 15 features mapped
- **API Module Coverage**: 15/15 (100% of `apps/api/src/modules/*` mapped)
- **Mobile Feature Coverage**: 14/14 (100% of `apps/mobile/src/features/*` mapped)
- **Features Mapped**:
  1. `meal-logging`
  2. `workouts-sets`
  3. `profile-goals-energy`
  4. `body-media`
  5. `auth`
  6. `account-lifecycle`
  7. `coach-consent-budgets`
  8. `user-feedback`
  9. `environment-build-deployment`
  10. `contracts-shared`
  11. `database-schema`
  12. `composition-roots`
  13. `analytics-observability`
  14. `legal-compliance`
  15. `system-health`
- **Context CLI**:
  - Implemented under `scripts/navigation/context.mjs` and exposed via `pnpm context`.
  - Supports `--list`, `<feature-id>`, `--json`, and `--all`.
  - Default human-readable output bounded to $\le 120$ lines with explicit omitted item counts.
  - Unknown feature IDs exit with code 1 and Levenshtein-based suggestions; never silently fabricates similar features.

---

### 4. Stage 2 Impact Analysis & Boundary Validation (`DOCS-NAV-003`)

- **Impact CLI**:
  - Implemented under `scripts/navigation/impact.mjs` and exposed via `pnpm impact --since <ref>`.
  - Combines 3 signals: direct file ownership, package/workspace reverse dependencies, and explicit semantic impact edges (`affects` / `dependsOn`).
  - Git diff parsed via argument arrays, NUL delimiters (`-z`), and `git merge-base` without shell interpolation.
  - Excludes sensitive files (`.env`, secrets, `.git`, `node_modules`).
  - Graph traversal uses cycle-protected visited set; reports unmapped files as unknown coverage.
- **Navigation Validator & Boundary Enforcer**:
  - Implemented under `scripts/navigation/check.mjs` and exposed via `pnpm navigation:check`.
  - Validates feature map structure, path existence, and relationship integrity.
  - Validates internal Markdown links and anchors across all navigation documents.
  - Enforces architectural import boundaries: pure `packages/core`, neutral `packages/agent-runtime` & `packages/memory`, and mobile server-secret isolation.
- **Navigation Test Suite**:
  - Implemented under `scripts/navigation/test/` and exposed via `pnpm test:navigation`.
  - 27 passing automated unit/fixture tests covering manifest schema, context CLI options, impact diff parsing, synthetic Git fixtures, boundary violations, and link/anchor checks.

---

### 5. Acceptance Exercises (`DOCS-NAV-004`)

Independent helper subagent (`88c67ab1-49a8-4f01-9c08-16fffc242f33`, post-N1–N8 rerun) executed 5 cold-start exercises using exclusively `docs/START_HERE.md` and `pnpm context <feature-id>` / `pnpm impact`:

| Exercise Scenario                  | Goal                                             | Entry Points Found                                                                                       | Dependencies & Tests                                                                                   | Instructions & Open Gates Identified                                                                                                                  | Outcome                                                                                                                                                                                   |
| ---------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. Meal Retry Durability**       | Locate idempotency & retry logic                 | `apps/api/src/modules/food-entries/routes.ts`, `apps/mobile/src/features/log-meal/index.ts`              | `packages/contracts/src/food-entry.ts`, `meal-retry-durability.test.ts`, `food-entries/routes.test.ts` | Nested `apps/mobile/AGENTS.md`, `supabase/migrations/`; open gate: `REL-AUD-007/Q2` (durable retry persistence); PAT-001                              | **PASSED**: Located canonical entry points, 409 Conflict logic, pre-submit draft persistence, nested instructions, and open Q2 gate without hints. No historical claims treated as fresh. |
| **2. Account Deletion Lifecycle**  | Locate deletion tombstone & pipeline             | `apps/api/src/modules/account/routes.ts`, `apps/mobile/src/features/settings/account-data-management.ts` | `account_deletion_jobs` table, `0004_account_deletion.test.sql`, `account-deletion.e2e.test.ts`        | Nested `apps/mobile/AGENTS.md`; open gates: `REL-AUD-001/Q4` (worker leases/barriers), `REL-AUD-002/Q5` (memory/media export); ADR-0021               | **PASSED**: Located 4-stage deletion pipeline, tombstone cascade, nested rules, and open Q4/Q5 work items.                                                                                |
| **3. AI Consent Continuation**     | Locate consent state machine & token budgets     | `apps/api/src/modules/coach/routes.ts`, `apps/mobile/src/features/coach/ai-consent-controller.ts`        | `packages/agent-runtime`, `ai_daily_token_ledger`, `ai-consent-controller.test.ts`, `test:ai-eval`     | Nested `apps/mobile/AGENTS.md`; open gates: `REL-AUD-005/Q8` (live model benchmarking), `REL-AUD-005/Q7` (UI context preservation); ADR-0019; PAT-002 | **PASSED**: Located `CURRENT_AI_CONSENT_VERSION`, generation barrier counter, 56 offline screener cases, and open model evaluation gates.                                                 |
| **4. Shared Food Contract Change** | Analyze impact of modifying `food-entry.ts`      | Direct: `contracts-shared`, `meal-logging` via `pnpm impact`                                             | Reverse package deps: `@mizyun/contracts` -> `apps/api`, `apps/mobile`, `packages/api-client`          | `docs/adr/0001`, `docs/ARCHITECTURE.md`; signals: `direct-ownership`, `package-reverse-dep`, `semantic-affects`                                       | **PASSED**: Derived reverse workspace package dependencies from source; mapped consumer features (`workouts-sets`, `profile-goals-energy`, `composition-roots`).                          |
| **5. Pi Unit Installation**        | Locate systemd service templates & deploy guards | `scripts/promote-dev.sh`, `scripts/promote-production.sh`, `deploy/raspberry-pi`                         | `test-deployment-safeguards.mjs`, `test-build-matrix.mjs`, `mizyun-api-dev.service`                    | `docs/adr/0020`, `docs/patterns/README.md#pat-004`; open gates: `REL-AUD-003/R3 Part B` (signing keys), `INFRA-DUAL-005/R8` (physical-device journey) | **PASSED**: Identified ports 4100/5433 (Dev) vs 4000/5432 (Prod) invariants, systemd sandboxing, PAT-004 partial status, and explicit open release gates.                                 |

### Exercise Safeguard Verifications:

- **Historical Claims Verification**: Verified that no archived claims from `docs/archive/status/` or superseded reviews were presented as live fresh acceptance evidence.
- **Inert Verification Commands**: Verified that no destructive, modifying, or suggested test command was auto-executed by navigation tools. All execution remains under coordinator control.
- **Nested Guidance Discovery**: Verified that features touching mobile presentation deterministically surface `apps/mobile/AGENTS.md`.
- **Open Findings Visibility**: Verified that features with open remediation items (e.g. Q2, Q4, Q5, Q7, Q8) clearly expose their open gates rather than claiming unconditional completion.

---

### 6. Review Findings Resolution (N1–N8)

Following the independent review in `docs/AGENT_NAVIGATION_REVIEW_2026-09-09.md`, all eight findings were resolved and verified:

1. **N1 (Boundary Protection)**: Upgraded `scripts/navigation/check.mjs` to parse imports via TypeScript `ts.preProcessFile(code, true, true)`. Enforces strict denial of `@mizyun/adapter-supabase-server`, `@mizyun/adapters-supabase-server`, vendor SDKs in core, and dynamic vendor imports. Verified via negative fixture tests.
2. **N2 (Source-Derived Impact Dependency Graph)**: Upgraded `scripts/navigation/impact.mjs` to dynamically read workspace package manifests and resolve package reverse dependencies. Output reports distinct signals (`direct-ownership`, `package-reverse-dep`, `semantic-affects`) with complete reason chains. Guarded `main()` against execution on import.
3. **N3 (Manifest Validation & Feature Coverage)**: Enhanced validator to verify `migrationPaths`, `docs`, realpath containment (preventing symlink escapes), relation types, 40-character hex SHA format, and directory coverage. Mapped `apps/mobile/src/features/dev` under `environment-build-deployment` ensuring 14/14 mobile feature directories are covered.
4. **N4 (Archive Links & Pattern Source Paths)**: Rebased 6 relative links in `docs/archive/status/STATUS_HISTORY_THROUGH_2026-09-09.md` (`../../`). Corrected canonical pattern sources in `docs/patterns/README.md` (`20260714101000_user_data.sql`, `20260714103000_private_media.sql`, `apps/api/src/modules/coach/routes.ts`). Integrated pattern source existence checks and archive link validation into `pnpm navigation:check` with hard errors on broken anchors.
5. **N5 (Guidance & Claims Reconciliation)**: Reconciled `plan.md` lines 48–56 to ADR-0020 topology (Raspberry Pi 5 Dev/Prod) with Windows PC as secondary hot backup. Updated ADR-0020 header to `accepted` with explicit open release gate notes. Clarified that Gemini is the sole active model provider and Mistral was decommissioned. Updated `status.md` to distinguish verified implementations from open remediation items.
6. **N6 (Focused Context CLI)**: Enhanced `scripts/navigation/context.mjs` to discover and render applicable nested instructions (`apps/mobile/AGENTS.md`), `Requirements & Work Items`, and `Open Acceptance Gates & Findings`.
7. **N7 (Synthetic Fixture Test Regressions)**: Upgraded `scripts/navigation/test/` with isolated disposable Git repositories in `/tmp` using `git init`. Removed all hard-coded Git history depth dependencies (`HEAD~1`, `HEAD~5`). Added negative tests for all boundary violations, invalid metadata, symlink escapes, and broken anchors.
8. **N8 (CI Integration)**: Added `.github/workflows/navigation-check.yml` to run `pnpm navigation:check` and `pnpm test:navigation` on PRs and pushes to `main`.

---

### 7. Historical Repository Verification

- `pnpm navigation:check`: Passed (0 errors, 0 warnings)
- `pnpm test:navigation`: Passed (27/27 tests passing, ~1.8s)
- `pnpm check`: Passed (navigation checks, test:navigation, format:check, typecheck, bundle:check, unit tests, deployment safeguards, build matrix, AI evaluation invariants)
- `git diff --check`: Passed (0 whitespace or conflict marker errors)
