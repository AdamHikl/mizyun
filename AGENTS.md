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

## Primary working environment

For Mizyun, the **Founder production PC** (Windows host, WSL2 Ubuntu
22.04, reachable from this Mac over SSH as `mizyun-pc`, repo at
`/home/mizyun/mizyun`) is the primary testing environment for the
duration of the single-founder alpha. The Mac remains the code-edit
and pre-promotion verification machine; it does not run the local
Supabase/API stack for daily testing. This rule stays in effect until
the user explicitly changes it.

Default workflow for every commit:

- implement + format/typecheck/test on the Mac (`pnpm check` must
  pass);
- commit on `main` and push the exact SHA to `origin/main`;
- promote the SHA to the production PC via
  `pnpm deploy:remote <sha>` (which calls
  `scripts/promote-production.sh` on the PC);
- test on the installed `com.mizyun.app` Production iPhone build
  against the public production API/Supabase hosts
  (`https://mizyun-api.phiskel.com`,
  `https://mizyun-supabase.phiskel.com`);
- record evidence (commit SHA, public health, device journey) in
  `status.md`.

Consequences and expectations:

- the production PC is expected to keep running even when the Mac is
  off — the Production iPhone app and public API are the durable
  testing surface;
- the local Mac dev Supabase/API is reserved for schema and migration
  work and for one-off debugging; do not treat it as a long-running
  parallel test stack;
- a founder-only enablement model means mistakes hit the founder
  directly, not real users, so the faster promote→test loop is
  acceptable; this is **not** a paying-user posture, and the
  managed/hosted/second-operator gates from `docs/INFRASTRUCTURE_EVOLUTION_PLAN.md`
  still apply before any cutover;
- before any promote, run `pnpm check` on the Mac; before any
  production migration, run `pnpm db:verify` on the Mac against a
  clean local reset to keep the schema diff honest.

## Verification

Run `pnpm check` before committing. Provider integration tests remain disabled until every item in `docs/BEFORE_TESTING.md` is complete.

Use `docs/QUALITY_GATES.md` as the definition of done for implementation, data, mobile, calculation, media, and AI changes.
