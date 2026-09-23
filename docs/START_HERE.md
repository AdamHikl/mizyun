# Mizyun Developer Starting Index

> Single routing entry point for coding sessions and contributors. Start here to navigate product intent, current operational state, architecture, decisions, runbooks, and verification gates.

## 1. Current State & Active Work

- **Current Operational Status**: [`status.md`](../status.md) — compact active work, current authorities, qualified evidence, blockers, and one next action. Follow its dated archive links for history; archived next actions are not current instructions.
- **Backlog & Task IDs**: [GitHub Issues](https://github.com/AdamHikl/mizyun/issues) (redirected from [`backlog.md`](../backlog.md)) — ordered executable work items, task IDs, and acceptance definitions (`gh issue list`).
- **InVenture preparation & growth**: [October 2–3 meeting plan](INVENTURE_PROGRAM_PLAN_2026-09-23.md) — active presentation milestone, positioning, collaborator asks and path toward 100,000+ users.
- **Roadmap & Phase Exit Criteria**: [`plan.md`](../plan.md) — sequencing from modular foundation to production release.

## 2. Product Intent & Requirements

- **Product Mission & Principles**: [`goals.md`](../goals.md) — mission, launch wedge, primary outcomes (O1–O5), non-goals.
- **Business Alignment**: [`docs/BUSINESS_ALIGNMENT.md`](BUSINESS_ALIGNMENT.md) — target persona, pricing hypothesis, audited feature matrix.
- **Detailed Requirements**: [`docs/PRODUCT_REQUIREMENTS.md`](PRODUCT_REQUIREMENTS.md) — granular functional requirements and invariant IDs.

## 3. Architecture, Boundaries & Decisions

- **System Architecture**: [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) — monorepo package layers, dependency rules, composition roots.
- **Feature Manifest**: [`docs/feature-map.json`](feature-map.json) — machine-readable feature graph, entry points, schemas, and tests.
- **Architecture Decisions**: [`docs/adr/README.md`](adr/README.md) — index of ADR 0001–0022 with statuses and supersessions.
- **Engineering Patterns**: [`docs/patterns/README.md`](patterns/README.md) — proven patterns (storage RLS, AI adapters, pure core calculations).

## 4. Runbooks & Daily Operations

- **Runbook Hub**: [`docs/tutorials/README.md`](tutorials/README.md) — setup, local backend, simulators, emulators, troubleshooting.
- **Primary Hetzner Host (Dev/Prod)**: [`docs/tutorials/HETZNER_BACKEND_GUIDE.md`](tutorials/HETZNER_BACKEND_GUIDE.md) — deployment, backup, restore, and incident operations.
- **Retired Pi Hosting Guide**: [`docs/tutorials/DEV_PRODUCTION_PI_GUIDE.md`](tutorials/DEV_PRODUCTION_PI_GUIDE.md) — historical topology only; the Pi is no longer a deployment target.
- **Daily Mac Quickstart**: [`docs/tutorials/QUICKSTART.md`](tutorials/QUICKSTART.md) — local Mac development loop.
- **Testing Runbook**: [`docs/tutorials/TESTING.md`](tutorials/TESTING.md) — execution commands for test suites and gates.

## 5. Quality Gates & Release Evidence

- **Definition of Done**: [`docs/QUALITY_GATES.md`](QUALITY_GATES.md) — data, mobile, calculation, media, and AI quality bars.
- **Provider Checklist**: [`docs/BEFORE_TESTING.md`](BEFORE_TESTING.md) — requirements before enabling live external model calls.
- **Release Verification**: [`docs/REMEDIATION_EVIDENCE_CHECKLIST.md`](REMEDIATION_EVIDENCE_CHECKLIST.md) — Q1–Q9 closure criteria & evidence.

## 6. Developer Navigation Commands

```bash
# Explore a feature's code, contracts, tests, relationships, and instructions
pnpm context <feature-id>        # e.g., pnpm context meal-logging
pnpm context --list              # list all mapped features

# Analyze blast radius and affected features from your changes
pnpm impact --since origin/main  # advisory change impact analysis

# Validate feature map, local links/anchors, and architectural boundaries
pnpm navigation:check
```

## 7. Historical Archive

Past status logs, retired operational audits, and legacy host notes are preserved under [`docs/archive/`](archive/). They provide historical context and evidence, not active instructions.
