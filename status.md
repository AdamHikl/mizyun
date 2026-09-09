# Mizyun current status

> Current operational snapshot. Last updated: **2026-09-09**.
> For historical logs, audit entries, and prior session handoffs, see [`docs/archive/status/STATUS_HISTORY_THROUGH_2026-09-09.md`](docs/archive/status/STATUS_HISTORY_THROUGH_2026-09-09.md).

## Active work package — Agent navigation & memory (`DOCS-NAV-001`–`004`) [PARTIAL]

- **Latest independent review:** [N1–N8](docs/AGENT_NAVIGATION_REVIEW_2026-09-09.md) supersede blanket completion below. Fresh `pnpm check` and 15 navigation tests pass, but targeted fixtures expose boundary and manifest validation gaps. Impact lacks source-derived dependencies; archive/pattern references, focused context, current guidance, fixture tests, and CI integration remain incomplete. No implementation fixes or remote actions were performed during this review.

- **Delivered**:
  - Compact operational `status.md` (51 lines) and comprehensive history archive in `docs/archive/status/`.
  - Routing index [`docs/START_HERE.md`](docs/START_HERE.md), decision index [`docs/adr/README.md`](docs/adr/README.md), and pattern catalog [`docs/patterns/README.md`](docs/patterns/README.md).
  - Streamlined startup reading protocol in `AGENTS.md` and `docs/SESSION_GUIDE.md` reducing startup lines to 233 lines (-86.4%).
  - Machine-readable manifest [`docs/feature-map.json`](docs/feature-map.json) covering 100% of API modules (15/15) and mobile features (14/14).
  - Context CLI (`pnpm context`), advisory impact analysis (`pnpm impact`), and automated boundary validator (`pnpm navigation:check`, `pnpm test:navigation`).
  - Independent cold-start navigation exercises across 5 scenarios passed without coordinator hints.
- **Verification Evidence**: Complete living evidence recorded in [`docs/AGENT_NAVIGATION_ACCEPTANCE.md`](docs/AGENT_NAVIGATION_ACCEPTANCE.md); full repository gate (`pnpm check`) passes with zero errors.

## Environment & deployment snapshot

| Environment       | Host & Location                | Deployed SHA                 | Health & Status                                           | Notes                                                            |
| ----------------- | ------------------------------ | ---------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------- |
| **Local Mac**     | Apple Silicon (`darwin-arm64`) | `7faec30d` (dirty: docs/nav) | `pnpm check`: 100% clean                                  | Primary feature development & local verification                 |
| **Pi Dev**        | Raspberry Pi 5 (`mizyun-pi`)   | `993c2df6`                   | HTTP 200 (`https://mizyun-api-dev.phiskel.com/v1/health`) | Port 4100 API / 8100 Kong / 5433 DB; UID 999 unprivileged        |
| **Pi Production** | Raspberry Pi 5 (`mizyun-pi`)   | `c02a67ab`                   | HTTP 200 (`https://mizyun-api.phiskel.com/v1/health`)     | Port 4000 API / 8000 Kong / 5432 DB; PID 500239 (uptime 5+ days) |
| **Windows PC**    | Windows / WSL2 (`mizyun-pc`)   | `—`                          | Standby hot backup                                        | Retained as secondary backup per ADR-0020                        |

## Implementation versus release gate status

- **Implemented & Verified locally on Mac**:
  - **Block 2 (Local Native Release Builds & Device Acceptance / Gate R3)**: ADR-0023 accepted retiring EAS in favor of 100% local Xcode and Android Gradle builds; `with-android-release-signing` plugin enforcing fail-closed keystore configuration; `scripts/mobile-founder-dev-android.sh` with variant isolation; build matrix verification passing.
  - **Block 3 (Account Deletion Durability / Finding Q4 Closure)**: Migration `20260909150000_account_deletion_worker_leases.sql` adding `worker_id` and `lease_expires_at` with composite index; atomic worker lease CAS preventing concurrent execution of destructive steps; resumable stage state machine (`storage` -> `memory` -> `auth` -> `done`) preventing regression to `'none'`; pre-auth orphaned media reconciliation sweep; mobile automatic session cleanup and signout upon detecting completed deletion; pgTAP tests updated and 100% passing.
  - **Block 4 (Account Export Completeness / Finding Q5 Closure — Pragmatic Scope)**: Raised memory store list ceiling to 10,000 for bounded exports; account export route fetches complete stored memories up to 10,000; manifest counts verified truthful; mobile settings copy updated to explicitly explain that records are exported as JSON and private photos are provided as temporary 24-hour signed download links rather than embedded files. Heavyweight streaming/checksums deferred per user directive.
  - **AI Access & Cost Safeguards (Finding Q8 Verification)**: Verified `authorizeAiAccess` strictly enforces verified adult status (18+), explicit unrevoked consent version matching, and email allowlist admission. Daily token limits and conservative free-tier rate limits (5k tokens/day, 3 req/min, 1 in-flight) guard against runaway usage.
  - Navigation & boundary suite: manifest coverage, realpath link resolution, pure core isolation, mobile adapter boundary, and synthetic fixture tests.
  - Remediations Q1–Q9 implementations: Q1 systemd sandboxing template, Q2 canonical payload hashing & conflict detection, Q3 build matrix isolation (16/16), Q4 worker leased deletion, Q5 bounded export completeness, Q6 server-owned tier authority (PostgREST & pgTAP verified), Q7 consent state machine & generation barrier, Q8 adult eligibility & offline screener (56/56), Q9 deployment safeguards (23/23).
  - All standard gates pass: format check, typecheck (14 packages), dual-platform bundle checks (iOS & Android Hermes), 748+ unit tests.
- **Open Implementation Work (Remediation Checklist)**:
  - Q1: Re-verify Dev checkout removal from ReadWritePaths on Pi during deploy.
  - Q2: Durable unknown-outcome persistence for ambiguous retries.
  - Q7/Q8: Consent UI context preservation and live model evaluation.
  - Q9: Remote readiness probe identity and live promotion proof.
- **Explicitly Held / Blocked Release Gates**:
  - **Gate R3 Part B**: Physical release build signing verification on local hardware via Xcode and Android keystore.
  - **Gate R8**: Physical device journey on iPhone via cable install (standalone without Metro) & off-device backup restore rehearsal into isolated target.
  - **Production Promotion**: Separately gated milestone requiring explicit user authorization, clean pre-promotion backup, and accepted physical device evidence.

## Current blockers & known contradictions

1. **Pi Containment / Q1 Resolution**: Block 1 sandbox configuration is deployed on Dev, but live probe verification noted Dev checkout in ReadWritePaths in earlier history. Re-verification scheduled during deployment block.
2. **Release Gates R3/R8**: Physical device testing and off-device recovery rehearsal remain open dependencies before promoting candidate to Production.

## Next exact action

Execute Priority 1 & 2 (Deployment & Physical Device End-to-End Acceptance): Deploy current candidate with worker leases and export fixes to Pi Dev (`pnpm deploy:dev`), run remote permission and path isolation probes, compile signed standalone apps (`com.mizyun.dev` and `com.mizyun.app`), install on iPhone/Android, and execute end-to-end verification (login, logging, retry, export, deletion).

## Evidence & archive links

- Acceptance register: [`docs/AGENT_NAVIGATION_ACCEPTANCE.md`](docs/AGENT_NAVIGATION_ACCEPTANCE.md)
- Historical status archive: [`docs/archive/status/STATUS_HISTORY_THROUGH_2026-09-09.md`](docs/archive/status/STATUS_HISTORY_THROUGH_2026-09-09.md)
- Remediation evidence checklist: [`docs/REMEDIATION_EVIDENCE_CHECKLIST.md`](docs/REMEDIATION_EVIDENCE_CHECKLIST.md)
- Navigation implementation plan: [`docs/AGENT_NAVIGATION_IMPLEMENTATION_PLAN.md`](docs/AGENT_NAVIGATION_IMPLEMENTATION_PLAN.md)
- Review Round 3: [`docs/IMPLEMENTATION_REVIEW_2026-09-09_ROUND_3.md`](docs/IMPLEMENTATION_REVIEW_2026-09-09_ROUND_3.md)
