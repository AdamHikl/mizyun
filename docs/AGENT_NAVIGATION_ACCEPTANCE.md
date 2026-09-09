# Agent Navigation and Repository Memory — Acceptance Evidence

> Living acceptance register for `DOCS-NAV-001` through `DOCS-NAV-004`. Tracks evidence, document inventories, link validation, line counts, manifest coverage, and independent helper exercises.

> **Independent review correction (2026-09-09):** The completion claims below are superseded by [findings N1–N8](AGENT_NAVIGATION_REVIEW_2026-09-09.md). The existing 15 tests and full `pnpm check` pass, but targeted probes show undetected boundary violations and invalid manifests. Archive/pattern links, current guidance, focused context, source-derived impact, fixture coverage, and CI integration need repair. DOCS-NAV-001–004 remain partial; prior exercise outcomes are retained as scoped historical reports, not final acceptance.

## 1. Baseline & Environment Metadata

- **Date**: 2026-09-09
- **HEAD Commit SHA**: `7faec30d0c2e7e165891dd970004c8865936ccde`
- **Working Tree State at Start**: Dirty (`backlog.md`, `status.md`, `docs/REMEDIATION_EVIDENCE_CHECKLIST.md`, `docs/AGENT_NAVIGATION_IMPLEMENTATION_PLAN.md`)
- **Node.js**: v22.x+
- **pnpm**: 10.33.0

---

## 2. Stage 1 Inventory & Contradiction Evidence (`DOCS-NAV-001`)

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

## 3. Stage 2 Manifest Coverage & Context CLI (`DOCS-NAV-002`)

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

## 4. Stage 2 Impact Analysis & Boundary Validation (`DOCS-NAV-003`)

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

## 5. Acceptance Exercises (`DOCS-NAV-004`)

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

## 6. Review Findings Resolution (N1–N8)

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

## 7. Final Repository Verification

- `pnpm navigation:check`: Passed (0 errors, 0 warnings)
- `pnpm test:navigation`: Passed (27/27 tests passing, ~1.8s)
- `pnpm check`: Passed (navigation checks, test:navigation, format:check, typecheck, bundle:check, unit tests, deployment safeguards, build matrix, AI evaluation invariants)
- `git diff --check`: Passed (0 whitespace or conflict marker errors)
