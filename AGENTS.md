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
- Table row interfaces for `RepositorySupabaseClient.from<T>` in `packages/adapters/supabase-server` must explicitly extend `Record<string, unknown>` to satisfy TypeScript constraints.

## Primary working environment

For Mizyun, the **Founder Raspberry Pi 5** (Ubuntu Server 24.04 ARM64,
reachable from this Mac over SSH as `rpserver` / `mizyun-pi`) hosts two
strictly isolated environments running side-by-side:

1. **Development (`dev`)**:
   - Repo checkout: `/var/lib/mizyun/dev/repo`
   - Services: `mizyun-api-dev.service` (port 4100), `mizyun-supabase-dev.service` (port 8100 Kong, port 5433 Postgres)
   - Public hostnames: `https://mizyun-api-dev.phiskel.com`, `https://mizyun-supabase-dev.phiskel.com`
   - Mobile app: `com.mizyun.dev` ("Mizyun Dev", built via `pnpm mobile:founder-dev:ios`)
   - Deployment: `pnpm deploy:dev [sha]` (via `scripts/deploy-dev.mjs` and `scripts/promote-dev.sh`)
   - AI policy: Dev shares the Gemini project with Production; `AI_EXTERNAL_ACCESS=true` is enabled for all accounts as testing is bounded to founder and testing partner.
   - Identity: Dev uses auto-confirmed email authentication to satisfy Supabase Row Level Security (`user_id = auth.uid()`).

2. **Production (`production`)**:
   - Repo checkout: `/home/mizyun/mizyun` (`/var/lib/mizyun/repo`)
   - Services: `mizyun-api.service` (port 4000), `mizyun-supabase.service` (port 8000 Kong, port 5432 Postgres)
   - Public hostnames: `https://mizyun-api.phiskel.com`, `https://mizyun-supabase.phiskel.com`
   - Mobile app: `com.mizyun.app` ("Mizyun", built via `pnpm mobile:founder-production:ios`)
   - Deployment: `pnpm deploy:production <sha>` (via `scripts/deploy-remote.mjs` and `scripts/promote-production.sh`)

The Windows PC (`mizyun-pc`) is kept as a hot backup.

Daily workflow:

- **Feature development & daily test loop**:
  - Implement and verify on the Mac (`pnpm check` must pass).
  - Push commit to remote and deploy to Dev on the Pi via `pnpm deploy:dev [sha]`.
  - Test on the installed `com.mizyun.dev` iPhone app against the public Dev API/Supabase hosts.
- **Production release milestone**:
  - Once features are verified on Dev and merged into `main`, promote the exact accepted SHA to Production via `pnpm deploy:production <sha>`.
  - Production promotion takes a database/storage backup before any schema changes, applies forward migrations, restarts `mizyun-api.service`, and checks public production health.
  - Test on the installed `com.mizyun.app` Production iPhone build.
  - Record evidence (commit SHA, public health, device journey) in `status.md`.

Consequences and expectations:

- The Raspberry Pi keeps running even when the Mac is off; both public endpoints and both installed mobile apps coexist seamlessly on the founder's iPhone.
- Never run destructive commands (`db:reset`, `db:verify`, volume pruning) against the Pi. `pnpm db:verify` runs only against the local disposable Mac database.
- Dev and Production databases and auth tenants are completely isolated; credentials and tokens are strictly non-interchangeable.
- Before any deployment, `pnpm check` must pass on the Mac.
- Always run `pnpm format` before committing and deploying so session documentation updates pass the pre-deployment `prettier --check .` gate.
- The Pi dev checkout (`/var/lib/mizyun/dev/repo`) must remain pristine; never leave unstaged or modified files on the Pi during ad-hoc testing, as `promote-dev.sh` fails closed on dirty working trees.

## Verification

Run `pnpm check` before committing. Provider integration tests remain disabled until every item in `docs/BEFORE_TESTING.md` is complete.

Use `docs/QUALITY_GATES.md` as the definition of done for implementation, data, mobile, calculation, media, and AI changes.
