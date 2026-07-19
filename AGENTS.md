# Mizyun engineering instructions

## Session continuity

Before starting implementation, read `goals.md`, `docs/BUSINESS_ALIGNMENT.md`, `plan.md`, and `status.md` completely, then inspect `backlog.md` and the relevant requirements/ADR files. Follow `docs/SESSION_GUIDE.md` for start, research, verification, and handoff procedures.

At the end of every development session, update `status.md` with evidence, the next exact action, and any blocker. Update `backlog.md` when work is discovered, started, blocked, or completed. Change `plan.md` only when sequencing or phase status changes, and change `goals.md` only when product direction changes.

## Research before implementation

Before starting a new segment, check the current official documentation for every platform or service materially affected by that segment. Prefer primary sources. Record architectural decisions and links in `docs/adr/` when they influence a durable design choice.

Record dated primary sources and implementation consequences in `docs/RESEARCH_LOG.md`, even when no ADR is required.

## Module boundaries

- `packages/core` contains pure business rules and must not depend on frameworks, databases, mobile APIs, or model vendors.
- `packages/contracts` contains versioned schemas shared across processes.
- `packages/agent-runtime` may depend on provider-neutral ports, never a vendor SDK.
- `packages/memory` owns memory policies and ports, never a particular vector database.
- Vendor code belongs in `packages/providers/<provider>`.
- Infrastructure code belongs in `packages/adapters/<technology>`.
- `apps/api` is the server composition root. It selects concrete adapters and exposes transport routes.
- `apps/mobile` owns presentation and device integration, not domain calculations.

New features should be vertical modules with explicit public exports. Do not import another module's internal files.

## Safety and data handling

- Treat health information and photos as sensitive.
- Never put service-role keys or model API keys in mobile code.
- Every user-owned database table requires Row Level Security and a `user_id` index.
- AI output is advisory and uncertain; deterministic calculations remain in domain code.
- Photo-derived nutrition values require user confirmation before becoming authoritative.

## Verification

Run `pnpm check` before committing. Provider integration tests remain disabled until every item in `docs/BEFORE_TESTING.md` is complete.

Use `docs/QUALITY_GATES.md` as the definition of done for implementation, data, mobile, calculation, media, and AI changes.
