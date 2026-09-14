# Mizyun current status

> Fast-changing operational snapshot. Last updated: **2026-09-14**.
> For historical logs, audit entries, and prior session handoffs, see:
>
> - [`docs/archive/status/STATUS_HISTORY_2026-09-10_THROUGH_2026-09-12.md`](docs/archive/status/STATUS_HISTORY_2026-09-10_THROUGH_2026-09-12.md) (Handoffs from Sep 10 through Sep 12)
> - [`docs/archive/status/STATUS_HISTORY_THROUGH_2026-09-09.md`](docs/archive/status/STATUS_HISTORY_THROUGH_2026-09-09.md) (Handoffs through Sep 9)

## Active handoff — Offline cache paused (`OFFLINE-CACHE-001`, 2026-09-14)

- **State:** Founder stopped the implementation workflow. The work package remains `active`/in progress, not completed.
- **Local-only work:** `apps/mobile/src/features/auth/profile-cache.ts` remains untracked. Dashboard caching, application wiring, account-deletion purge, tests and verification are unfinished.
- **Release boundary:** The untracked cache work is explicitly excluded from Dev and Production deployments and from both iPhone builds. Resume, review and verify it in a later session before any deployment.
- **Next exact action:** Preserve the untracked helper and resume only when the founder requests `OFFLINE-CACHE-001`; complete the missing integration, deletion coverage and tests before running release gates.

## Active handoff — Coach workout/meal intent disambiguation (`FIX-COACH-INTENT-001`, 2026-09-14)

- **Implemented:** `apps/api/src/modules/coach/nutrition-action.ts` is now a conservative classifier with two safeguards. (1) A **workout-signal veto**: workouts/training/exercises/sessions plus common activity and exercise names, including plurals (`walk`, `run`, `jog`, `ride`, `swim`, `cycle`, `hike`, `sprint`, `lift`, `cardio`, `gym`, `hiit`, `sets`, `reps`, `squats`, `deadlifts`, `bench`, ...), and Slovak `cvičenie*`/`tréning*`. (2) A **food-context requirement**: a quantity with a unit or a common food/drink word (English plus a small Slovak set). Doubtful statements stay with the grounded text Coach. The mobile app only renders `meal_log` proposals; there is no mobile-side intent logic to keep in sync.
- **Verification:** 24/24 unit tests pass, including 8 new negative cases — 5 of them ("Add two hour walk to my completed workouts today", "Log my morning run", "Add 3 sets of squats to today's log", "I had 5 squats this morning", "Zapíš môj tréning na pondelok") were genuine false positives under the old regex. Full `pnpm check` green (navigation, formatting, typecheck, mobile bundle, all package tests, deployment safeguards, build matrix, AI-eval invariants). Source: base `765ef59` plus this commit (the classifier change and this handoff entry land together).
- **Independent review: PENDING (open gate).** AGENTS.md requires an independent agent review for AI-access/budget-adjacent changes. The local Qwen worker cannot run inside the agent sandbox (no Metal GPU: `mlx.core` fails with "No Metal device available"; the 28 GB 8-bit model is cached but unusable from sandboxed processes), and the out-of-sandbox launch was rejected because the auto-reviewer 404'd: `http://127.0.0.1:8000/v1/responses` serves Qwen models instead of a reviewer model. Work proceeded locally per the AGENTS.md exception clause; the package does not close until an independent review lands.
- **Hygiene:** generated `.agents/tasks/batch-report-*.json` files are now excluded from the Prettier gate (`.prettierignore`) and the mutable `batch-report-latest.json` pointer from git (`.gitignore`); the prior session's uncommitted batch artifacts were committed as `765ef59`.
- **Needs user input (recorded in `backlog.md`):** Google Play accounts (`PLAY-001`–`006`), Apple accounts (`APPLE-004`, `STORE-002/003`), founder alpha week (`ALPHA-001`), and approval to run the MLX reviewer out of sandbox (or a fix to the `:8000` reviewer endpoint).
- **Next exact action:** obtain the independent review of the `nutrition-action.ts` diff, then `pnpm deploy:dev <sha>` and accept the workout-vs-meal routing on the `com.mizyun.dev` iPhone build (e.g. "Add two hour walk to my completed workouts today" must reach the grounded Coach, not a meal draft).

## Active handoff — Native MLX Local Worker, Backlog Split & Coach Workout Intent (`LOCAL-WORKER-003`, `FIX-COACH-INTENT-001`, 2026-09-13)

- **Backlog separation & cleanup**:
  - Divided backlog into two distinct files: [`backlog.md`](backlog.md) (retained exclusively for 53 to-do/active/ready/research/blocked items) and [`completed-backlog.md`](completed-backlog.md) (dedicated archive for 114 completed/superseded work packages and implementation evidence). Formatted and verified with Prettier.
- **Coach workout vs meal intent bug (`FIX-COACH-INTENT-001`, P1, `ready`)**:
  - User demonstrated natural language workout logging ("Add two hour walk to my completed workouts today") being mistakenly intercepted as a meal draft.
  - Root cause reproduced: `isExplicitMealLoggingIntent` in `apps/api/src/modules/coach/nutrition-action.ts` matched prefix `/^(?:please\s+)?(?:log|add|record)\b/i`, but the negative lookahead `!/\b(?:workout|training|exercise|session)\b/i` failed because `\bworkout\b` does not match plural `workouts`, nor activity nouns like `walk`, `run`, `swim`, `cardio`.
  - Added `FIX-COACH-INTENT-001` to `backlog.md` and created bounded Qwen task packet [`.agents/tasks/task-coach-intent.json`](.agents/tasks/task-coach-intent.json).
  - Local MLX Qwen batch run: `task-splash-color-001` completed in 134.7s, changing only `apps/mobile/app.json` and `apps/mobile/src/components/animated-icon.tsx`; the worker verification and a fresh coordinator `pnpm --filter @mizyun/mobile typecheck` both passed. `task-coach-intent-001` then exceeded the 300-second MLX request timeout before returning edits; its precise retry/help requirement is recorded under Session engineering in `backlog.md`. No commit, push, deployment, remote-infrastructure access, credential change, or remote configuration change was attempted.
  - Overnight-worker hardening: MLX request timeout is now configurable from the batch manifest and set to 15 minutes (bounded to 1–30 minutes); the batch supervisor converts worker exceptions into concrete blockers and continues to later tasks, but halts for coordinator review after any out-of-allowlist write. The MLX-LM/Qwen runtime supports thinking enabled/disabled, not a literal `xhigh` reasoning level; the stable local configuration is `enable_thinking: true` with a 4,096-token generation budget. An attempted 8,192-token configuration did not remain available, so it was not retained.
- **Previous additions**:
  - `OFFLINE-CACHE-001` (P1, `ready`): Offline profile & daily dashboard cache using SecureStore.
  - `BRAND-SPLASH-001` (P2, `ready`): Splash background color calibration from `#208AEF` to `#0B0F12` ([`.agents/tasks/task-splash-color.json`](.agents/tasks/task-splash-color.json)).
- **Verification**: `pnpm navigation:check` passed (0 errors), `pnpm test:navigation` passed (27/27 tests), mobile typecheck passed.
- **Next exact action**: Retask `FIX-COACH-INTENT-001` only after reducing its MLX context or setting a longer bounded response timeout; retain its two-file allowlist and focused API test. The local Qwen batch monitor checks in every 30 minutes and reports only completion, failure, or a needed action.

## Active handoff — OpenCode local Qwen connection (`LOCAL-WORKER-002`, 2026-09-13)

- **Implemented:** project `opencode.json` now connects directly to MLX-LM on
  `127.0.0.1:8080/v1` using `@ai-sdk/openai-compatible`. Previous Responses
  bridges remain preserved but unused. Launcher disables thinking by default
  and raises the default output budget to 4096. Existing Ollama worker changes
  and mobile work were preserved.
- **Live local evidence:** exact `mlx-community/Qwen3.8-27B-8bit` returned
  `MLX_OK`; OpenCode 1.18.30 completed actual read/write/read tools and `DONE`
  in a disposable directory. MLX-LM 0.31.3 / MLX 0.32.2 on this Mac.
- **Source:** `1b02190b3665a813fe5875e3d33762dce34abf6b` plus uncommitted work;
  no commit, push, deployment, or device/release claim in this work package.
- **Verification:** `python3 scripts/worker/smoke-opencode.py` passed in 122.1s
  with completed read/write/read events and exact random file value. Shell/Python
  syntax, changed-file formatting, `git diff --check`, and `pnpm navigation:check`
  passed (navigation has 14 pre-existing stale-review warnings). `pnpm check`
  passed its 27 navigation tests, then stopped on pre-existing formatting in
  `scripts/worker/lib/task-runner.mjs`; subsequent full-gate stages did not run.
- **Independent review:** helper checked primary oMLX/OpenCode/model sources and
  reviewed the config, launcher, smoke test, and guide; no blocking defects.
  Keep MLX-LM for this working setup. oMLX remains an unbenchmarked alternative
  for cache/model-management or concurrent-serving needs.
- **Usage:** [local setup guide](docs/tutorials/LOCAL_QWEN_OPENCODE.md) and
  [agent delegation runbook](.agents/guides/LOCAL_QWEN_OPENCODE_AGENT_GUIDE.md).
  The server is running in this session's terminal; it must remain
  open or be restarted with `bash scripts/worker/run-mlx-server.sh`.
- **Next exact action:** start a new `opencode` session from this repository and
  use the selected local Qwen model for a bounded coding task. Large-context
  quality and sustained parallel throughput are not established by the smoke test.

## Active handoff — Regional Food Standards Decoupled from Coach Preferences (`COACH-PREF-002`, 2026-09-13)

- Decoupled Country / Regional food standards from `CoachPreferencesCard` into a dedicated first-class card and accordion under the **Profile & Goal** section of `SettingsScreen`.
- **Components & Data Layer**:
  - Authored `apps/mobile/src/features/settings/regional-food-standards-data.ts`: pure functions `getCountryStandardDisplay` and `saveCountryStandard` with normalization, ISO 3166-1 alpha-2 validation, and safe preservation of existing `profile.coachingPreferences`.
  - Authored `apps/mobile/src/features/settings/regional-food-standards-card.tsx`: displays active calibration state (`CountryFlag` + localized country name or Global standard icon), interactive `Pressable` trigger, `CountryPickerModal` integration, immediate background persistence, accessible feedback alert, and active activity spinner during saving.
  - Refactored `apps/mobile/src/features/settings/coach-preferences-card.tsx`: completely pruned country picker triggers, modals, and unused styles while guaranteeing `countryCode` is strictly preserved on coach preferences save.
  - Integrated into `apps/mobile/src/features/settings/settings-screen.tsx`: added `Regional Food Standards` CollapsibleSection under Section 1 (Profile & Physical Stats / "Profile & Goal" tab) with live country status in the section subtitle.
- **Worker Infrastructure Hardening** (`scripts/worker/lib/task-runner.mjs`):
  - Upgraded `TaskRunner.validatePath` to support monorepo package suffix matching (e.g. `src/...` resolving to `apps/mobile/src/...`) while strictly maintaining repo root containment and preventing directory traversal escapes (`!absPath.startsWith(this.repoRoot + path.sep)`).
  - Aligned context truncation threshold with skill documentation (>5,000 characters or >150 lines with `contextSnippet`) to prevent token timeouts on local Qwen execution.
- **Independent Audit & Verification**:
  - Independent review subagent verified two-way `countryCode` data preservation, accessibility roles/labels, monorepo boundaries, and security guardrails (**APPROVED - 100% PASS**).
  - Automated tests: all 9 tests in `regional-food-standards-data.test.ts` and all 48 tests in `src/features/settings/` pass.
  - Repository-wide checks: `pnpm check` passed cleanly (exit 0) with all unit tests, typechecks, bundle checks, build matrix, deployment safeguards, and AI evaluation benchmarks green.
- **Next exact action**: Commit and deploy to Pi Dev via `pnpm deploy:dev` to verify the new settings accordion and country picker on physical device.

## Active handoff — Multi-Tier Agent Orchestration (Gemini Coordinator + Qwen Local Worker + Astra Escalation) (`LOCAL-WORKER-001`, 2026-09-13)

- Implemented the local workhorse and control plane architecture connecting **Gemini 3.8 Flash** (Antigravity coordinator) to **Qwen3.8:27b-q8_0** (local Mac M1 Max Ollama worker) and **Astra** (architect & escalation reviewer).
- **Worker Engine & Transport** (`scripts/worker/`):
  - Built zero-dependency Node.js ESM client (`scripts/worker/lib/ollama-client.mjs`) communicating with Ollama REST API (`http://127.0.0.1:11434`), supporting connection health checks, tags listing, model availability checks, and structured JSON parsing.
  - Implemented `scripts/worker/lib/task-runner.mjs` enforcing the **Worker Contract**: whitelisted `allowedFiles` verification, path-traversal prevention, prohibited action rejection, automated verification command execution, and **bounded retries** (max 2 cycles; self-correction on attempt 1 failure).
  - Built standard Model Context Protocol (MCP) server (`scripts/worker/mcp-server.mjs`) over stdio, exposing `qwen_run_task` and `qwen_check_status` tools. Registered globally in `~/.gemini/config/mcp_config.json`.
  - Built CLI runner (`scripts/worker/run-task.mjs`) with `--check`, `--inline`, and file-based execution.
- **Routing Rules, Skills & Continuity**:
  - Authored `.agents/rules/model-routing.md`: Defines strict boundaries between Qwen (routine edits, tests, docs), Gemini (decomposition, integration, verification, git/deploy control), and Astra (auth/RLS, migrations, privacy, >2 retry escalation, release approval).
  - Authored `.agents/skills/qwen-task-dispatch/SKILL.md`: Operational guide for packet creation, execution evaluation, and escalation rules.
  - Created `docs/LOCAL_WORKER_BASELINE.md`: Living register to track 10–20 tasks across tokens, wall-clock time, retries, pass rates, and escalation rates.
  - Registered paths in `docs/feature-map.json` under `environment-build-deployment`.
- **Verification & Acceptance Evidence**:
  - Verified local daemon: Ollama is online with pinned `qwen3.8:27b-q8_0` (30.0 GB).
  - Verified MCP stdio protocol: `initialize` and `tools/list` respond with compliant JSON-RPC 2.0 payloads.
  - End-to-end task run (`task-smoke-001`): Qwen received bounded task, generated code, wrote `allowedFiles`, ran verification command, and returned `{ status: "success", attempts: 1 }` in 38.7s.
  - Repository checks: `pnpm navigation:check` (0 errors), `pnpm format:check` (100% clean), `pnpm typecheck` (all 15 packages passed).
- **Next exact action**: Log the first 10–20 development tasks in `docs/LOCAL_WORKER_BASELINE.md` using the MCP tool `qwen_run_task` or CLI runner for routine edits.

## Active handoff — Shared agent skills & context hygiene (`AGENT-SKILLS-001`, 2026-09-13)

- Implemented shared Codex and Antigravity skills in `.agents/skills/` pursuant to [`docs/AGENT_SKILLS_IMPLEMENTATION_GUIDE_2026-09-13.md`](docs/AGENT_SKILLS_IMPLEMENTATION_GUIDE_2026-09-13.md).
- **Stage A complete**: Compacted `status.md` by archiving 20 historical handoffs (Sep 10–12) into `docs/archive/status/STATUS_HISTORY_2026-09-10_THROUGH_2026-09-12.md`, shrinking startup status reading from ~65KB to ~11KB (~83% reduction) while preserving active items and open gates. Established living acceptance register in [`docs/AGENT_SKILLS_ACCEPTANCE.md`](docs/AGENT_SKILLS_ACCEPTANCE.md).
- **Stage B complete**: Authored three core P0 shared skills:
  - `mizyun-session-context`: Fast focused startup checklist, `pnpm context <id>`, `pnpm impact` advisory radius, bounded context packet.
  - `mizyun-verify-handoff`: Tiered verification, quality gates (`docs/QUALITY_GATES.md`), mandatory non-author review, 5 distinct evidence levels.
  - `mizyun-plan-next-session`: Structured future-session planning, platform research, zero-mutation planning boundary.
- **Stage C complete**: Hardened operational skills & scripts:
  - `check-unprocessed-feedback`: Removed blanket sandbox escape directive, enforced bounded sanitized summaries, guarded against bulk marking.
  - `scripts/check-user-feedback.mjs`: Added stdin SQL piping and 30s timeout guard matching `check-beta-pro-requests.mjs`.
  - `check-beta-pro-requests`: Separated read-only query from tier mutation actions, documented APNs/Expo push side effects, and clarified ADR-0024 policy boundary (immediate AI Coach access upon adult consent; Beta Pro is photo quota upgrade only).
- **Stage D complete**: Registered `.agents/skills` under `environment-build-deployment` in `docs/feature-map.json`; `pnpm navigation:check` passes with 0 errors.
- **Independent Audit & Review**: Research subagent independently audited the diff against all 7 guide criteria; relative link depths in P0 skills resolved to `../../../`; certified **APPROVED (100% PASS)**.
- **Verification**: `pnpm check` passed cleanly (exit 0) with all unit tests, bundle exports, deployment safeguards, build matrix, and AI invariant tests green. Prettier formatting 100% clean (`pnpm format:check`).

## Active product handoff — Product analytics backend implemented & verified (`OBS-002`, 2026-09-13)

- Implemented the first-party product analytics backend (`OBS-002`) following [the architecture, privacy rules, and staged implementation plan](docs/PRODUCT_ANALYTICS_IMPLEMENTATION_PLAN_2026-09-13.md), incorporating user disclosure update: removed legacy copy claiming data stays on device; updated disclosures in Onboarding and Settings to state coarse telemetry is sent to Mizyun servers to improve app UX, linked to user account with full export and erasure rights.
- **Database & RLS** (`supabase/migrations/20260913100000_product_analytics_backend.sql`):
  - Created `product_analytics_consents` and `product_analytics_events` with strict RLS (`user_id = auth.uid()`), `on delete cascade` referencing `auth.users(id)`, and direct client writes revoked (`GRANT SELECT ON ... TO authenticated`).
  - Implemented transactional SECURITY DEFINER RPCs: `record_product_analytics_events` (acquires `FOR UPDATE` lock on consent, verifies active epoch and consent granted), `update_product_analytics_consent` (increments revision, generates new epoch on re-grant or revoke, cascades event deletion on revoke), `clear_product_analytics_events` (deletes user events, rotates epoch, increments revision), and `cleanup_expired_product_analytics` (prunes events older than 90-day retention).
- **Contracts & Domain** (`packages/contracts`, `packages/core`):
  - Defined strict discriminated union `analyticsEventV2Schema` for version 2 events with UUIDs, session tracking, sequential numbering, and strict closed property sets. Explicitly rejects food names, nutrient values, health metrics, free-form text, and auth tokens.
  - Defined transport schemas: `analyticsConsentRequestSchema`, `analyticsConsentResponseSchema`, `analyticsBatchIngestRequestSchema` (max 50 events), `analyticsBatchIngestResponseSchema`, `analyticsClearRequestSchema`, `analyticsClearResponseSchema`, and `analyticsEventsListResponseSchema`.
  - Added `productAnalyticsEvents` to `ExportManifest.counts` and `productAnalytics` to `AccountExport`.
- **API & Adapters** (`apps/api`, `packages/adapters/supabase-server`):
  - Added `GET /v1/analytics/consent`, `PUT /v1/analytics/consent`, `POST /v1/analytics/events` (with 32KB payload limit, clock skew checks < 5m future and < 72h past), `DELETE /v1/analytics/events`, and `GET /v1/analytics/events`.
  - Wired `ProductAnalyticsRepository` into `apps/api` composition root and in-memory adapter; wired analytics data into `exportForUser` and `deleteForUser`.
  - Enforced strict 30-day read-time retention filtering across server repository queries, in-memory repository, mobile client export, and local event store reads.
- **Mobile Integration** (`apps/mobile`):
  - Implemented `NetworkAnalyticsClient` with offline queue (up to 500 events), session tracking with 30m inactivity timeouts, optimistic pending denial retries, and batch flushing.
  - Updated `AnalyticsConsentPrompt` on Onboarding and `AnalyticsCard` on Settings with truthful server disclosure copy. Enabled Export and Clear buttons based on active consent status.
  - Integrated with central `AuthProvider` (`auth-context.tsx`): resets local session and clears queue on logout, expiry, account switch, or preview mode; syncs consent on valid session.
  - Adopted a 30-minute inactivity boundary in `_layout.tsx` before emitting `app_session_started` on foreground returns.
- **Operator Tooling & Navigation**:
  - Implemented `scripts/product-analytics.mjs` and npm script `pnpm analytics` (`summary`, `features`, `navigation`, `flows`, `retention`) using secure stdin-fed `psql` transactions and `--json` support. Includes ordered 24h activation tracking and matured D1/D7 cohort retention. Added 10 unit tests in `scripts/product-analytics.test.mjs`.
  - Added `docs/adr/0026-first-party-product-analytics-backend.md` and updated `docs/RESEARCH_LOG.md`.
  - Registered all paths in `docs/feature-map.json`; `pnpm navigation:check` passes (0 errors).
- **Independent Security & Privacy Review**:
  - Non-author security subagent certified CONDITIONAL APPROVAL; all recommendations (safe local session reset on sign-out, settings UI button enablement, in-memory deletion cascade) implemented and verified.
  - Independent plan auditor completed item-by-item verification against `docs/PRODUCT_ANALYTICS_IMPLEMENTATION_PLAN_2026-09-13.md`.
- **Verification**:
  - Full `pnpm check` passed cleanly (exit 0): 44 mobile test files (403 tests), 34 API test files (498 tests), 73 contract tests, 258 core tests, 76 supabase-server tests, 10 CLI unit tests, iOS and Android Hermes bundle checks, 23 deployment safeguards, 16 build matrix checks, and 56 AI invariants.
  - Prettier formatting 100% clean (`pnpm format:check`).
- **Next exact action**: Deploy migration and API to Dev on the Raspberry Pi via `pnpm deploy:dev`, then verify consent grant, event tracking, and settings export/clear on the physical Dev iPhone build (`com.mizyun.development`).

## Environment & deployment snapshot

| Environment       | Host & Location                | Deployed SHA      | Health & Status                                           | Notes                                                                           |
| ----------------- | ------------------------------ | ----------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **Local Mac**     | Apple Silicon (`darwin-arm64`) | `fe19eda` (clean) | `pnpm check`: 100% clean                                  | Primary feature development & local verification                                |
| **Pi Dev**        | Raspberry Pi 5 (`mizyun-pi`)   | `fe19eda`         | HTTP 200 (`https://mizyun-api-dev.phiskel.com/v1/health`) | Port 4100 API / 8100 Kong / 5433 DB; UID 999 unprivileged; worker leases active |
| **Pi Production** | Raspberry Pi 5 (`mizyun-pi`)   | `3bad20c`         | HTTP 200 (`https://mizyun-api.phiskel.com/v1/health`)     | Port 4000 API / 8000 Kong / 5432 DB; all forward migrations applied             |
| **Windows PC**    | Windows / WSL2 (`mizyun-pc`)   | `—`               | Standby hot backup                                        | Retained as secondary backup per ADR-0020                                       |

## Implementation versus release gate status

- **Implemented & Deployed to Dev on Pi (`fe19eda`)**:
  - `PUSH-001`: Direct Apple APNs HTTP/2 gateway authentication and push token auto-registration bridge (`PushRegistrationBridge`) in `_layout.tsx`. Fixed repository push token updates for approved accounts in `SupabaseBetaProRepository` and `InMemoryBetaProRepository`. Added `scripts/send-push.mjs` CLI.
  - `LOCAL-WORKER-001`: Multi-tier agent orchestration with local Qwen3.8:27b-q8_0 worker via MCP & CLI, baseline tracking register, and workout history card overflow fix.
  - `OBS-002`: Product analytics backend migration `20260913100000_product_analytics_backend.sql` applied on Pi Dev.
  - `PROD-GATE-001`: Progress photos gated to Dev variant; Production runs lean 3-action dock and feedback-only shortcuts.
  - Sub-fixes verified: `FIX-WORKOUT-001` (comma parsing), `FIX-MEAL-001` (stale draft timestamps), `FIX-AI-PHOTO-001` (UTC photo scan quota matching UI).
  - Apple Push Notifications (APNs) direct HTTP/2 gateway authentication enabled and live verified.
- **Physical Device Installation & Push Delivery Verified (Gate R3 Part B)**:
  - Compiled and installed updated release build on physical iPhone (**Adam's Iphone 😋** / iPhone 16 Pro, UDID `7FBC9ACC-918A-5A9B-8D22-B9F1FF652A06`):
    - `Mizyun Dev` (`com.mizyun.development`, Release configuration, commit `fe19eda`, **Push Notifications enabled** via renewed Apple provisioning profile `29598fbb-4d6a-4de7-9be8-7e0281303dc5`, targeting `https://mizyun-api-dev.phiskel.com`).
    - Verified fix `AUTH-001`: `profileLoading` no longer blocks app startup on `<LoadingScreen />`; abort timeout added to `fetchProfile()`.
    - Verified `PUSH-001`: Device APNs push token (`2e1a63c2362b71ec0fd6d85c815fa14aa36ec32cf6b112744e1d29ae4d14cedf`) auto-registered on launch. Live APNs test notification successfully dispatched and accepted with HTTP 200 by Apple APNs sandbox gateway (`api.sandbox.push.apple.com`, topic `com.mizyun.development`) for `adam.hikl@outlook.com`.
- **Open Implementation Work (Remediation Checklist)**:
  - Q2: Durable unknown-outcome persistence for ambiguous retries across network drops.
  - Q7/Q8: Consent UI context preservation and live model evaluation.
  - Q9: Remote readiness probe identity and live promotion proof.
- **Explicitly Held / Blocked Release Gates**:
  - **Gate R8**: Physical device journey on iPhone (standalone without Metro, Auth redirect, meal logging, export, deletion) & off-device backup restore rehearsal.
  - **Production Promotion**: Separately gated milestone requiring explicit user authorization, clean pre-promotion backup, and accepted physical device evidence.

## Current blockers & known contradictions

1. **Release Gate R8**: Physical device journey testing and off-device recovery rehearsal remain open dependencies before promoting candidate to Production.

## Next exact action

1. Verify the app navigation and workout history card layout on the installed **Mizyun Dev** build on physical iPhone (`Adam's Iphone 😋`).
2. For **Release Gate R8**: Physical device journey testing and off-device recovery rehearsal on installed release builds.

## Evidence & archive links

- Skills Implementation Guide: [`docs/AGENT_SKILLS_IMPLEMENTATION_GUIDE_2026-09-13.md`](docs/AGENT_SKILLS_IMPLEMENTATION_GUIDE_2026-09-13.md)
- Skills Acceptance Register: [`docs/AGENT_SKILLS_ACCEPTANCE.md`](docs/AGENT_SKILLS_ACCEPTANCE.md)
- Historical status archive (Sep 10–12): [`docs/archive/status/STATUS_HISTORY_2026-09-10_THROUGH_2026-09-12.md`](docs/archive/status/STATUS_HISTORY_2026-09-10_THROUGH_2026-09-12.md)
- Historical status archive (Through Sep 9): [`docs/archive/status/STATUS_HISTORY_THROUGH_2026-09-09.md`](docs/archive/status/STATUS_HISTORY_THROUGH_2026-09-09.md)
- Product Analytics Plan: [`docs/PRODUCT_ANALYTICS_IMPLEMENTATION_PLAN_2026-09-13.md`](docs/PRODUCT_ANALYTICS_IMPLEMENTATION_PLAN_2026-09-13.md)
- Remediation evidence checklist: [`docs/REMEDIATION_EVIDENCE_CHECKLIST.md`](docs/REMEDIATION_EVIDENCE_CHECKLIST.md)
- Navigation acceptance register: [`docs/AGENT_NAVIGATION_ACCEPTANCE.md`](docs/AGENT_NAVIGATION_ACCEPTANCE.md)
