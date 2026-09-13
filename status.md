# Mizyun current status

> Fast-changing operational snapshot. Last updated: **2026-09-13**.
> For historical logs, audit entries, and prior session handoffs, see:
>
> - [`docs/archive/status/STATUS_HISTORY_2026-09-10_THROUGH_2026-09-12.md`](docs/archive/status/STATUS_HISTORY_2026-09-10_THROUGH_2026-09-12.md) (Handoffs from Sep 10 through Sep 12)
> - [`docs/archive/status/STATUS_HISTORY_THROUGH_2026-09-09.md`](docs/archive/status/STATUS_HISTORY_THROUGH_2026-09-09.md) (Handoffs through Sep 9)

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
| **Local Mac**     | Apple Silicon (`darwin-arm64`) | `7ead1a3` (clean) | `pnpm check`: 100% clean                                  | Primary feature development & local verification                                |
| **Pi Dev**        | Raspberry Pi 5 (`mizyun-pi`)   | `d053dcd`         | HTTP 200 (`https://mizyun-api-dev.phiskel.com/v1/health`) | Port 4100 API / 8100 Kong / 5433 DB; UID 999 unprivileged; worker leases active |
| **Pi Production** | Raspberry Pi 5 (`mizyun-pi`)   | `3bad20c`         | HTTP 200 (`https://mizyun-api.phiskel.com/v1/health`)     | Port 4000 API / 8000 Kong / 5432 DB; all forward migrations applied             |
| **Windows PC**    | Windows / WSL2 (`mizyun-pc`)   | `—`               | Standby hot backup                                        | Retained as secondary backup per ADR-0020                                       |

## Implementation versus release gate status

- **Implemented & Deployed to Dev on Pi (`d053dcd`)**:
  - `LOCAL-WORKER-001`: Multi-tier agent orchestration with local Qwen3.8:27b-q8_0 worker via MCP & CLI, baseline tracking register, and workout history card overflow fix.
  - `OBS-002`: Product analytics backend migration `20260913100000_product_analytics_backend.sql` applied on Pi Dev.
  - `PROD-GATE-001`: Progress photos gated to Dev variant; Production runs lean 3-action dock and feedback-only shortcuts.
  - Sub-fixes verified: `FIX-WORKOUT-001` (comma parsing), `FIX-MEAL-001` (stale draft timestamps), `FIX-AI-PHOTO-001` (UTC photo scan quota matching UI).
  - Apple Push Notifications (APNs) direct HTTP/2 gateway authentication enabled.
- **Physical Device Installation Verified (Gate R3 Part B)**:
  - Compiled and installed updated release build on physical iPhone (**Adam's Iphone 😋** / iPhone 16 Pro, UDID `7FBC9ACC-918A-5A9B-8D22-B9F1FF652A06`):
    - `Mizyun Dev` (`com.mizyun.development`, Release configuration, commit `7ead1a3`, **Push Notifications enabled** via renewed Apple provisioning profile `29598fbb-4d6a-4de7-9be8-7e0281303dc5`, targeting `https://mizyun-api-dev.phiskel.com`).
    - Verified fix `AUTH-001`: `profileLoading` no longer blocks app startup on `<LoadingScreen />`; abort timeout added to `fetchProfile()`. App successfully launches into main navigation.
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
