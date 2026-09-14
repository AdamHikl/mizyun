# Mizyun engineering instructions

## Session continuity

Before starting implementation, inspect the working tree, read root `AGENTS.md`, the compact `status.md`, and `docs/START_HERE.md`. Use `docs/feature-map.json` or `pnpm context <feature-id>` to focus on relevant requirements, ADRs, runbooks, and code. Review full `goals.md` / `docs/BUSINESS_ALIGNMENT.md` when addressing product direction, pricing, or uncertain intent, and full `plan.md` when changing roadmap sequencing. Follow `docs/SESSION_GUIDE.md` for startup, research, verification, and handoff procedures.

At the end of every development session, update `status.md` with evidence, the next exact action, and any blocker. Manage tasks and executable inventory using GitHub Issues (`gh issue`); update issue status labels (`status:active`, `status:ready`, `status:blocked`, `status:done`) or create new issues with appropriate priority, status, and area labels when work is discovered, started, blocked, or completed. Change `plan.md` only when sequencing or phase status changes, and change `goals.md` only when product direction changes.

Inspect the current working tree before editing and preserve pre-existing work, including work from another active session. Read the newest applicable status entry; older next-action paragraphs are historical, not additional instructions to execute. Resolve conflicting completion claims against current code and reproducible evidence rather than copying them forward.

When working on review findings Q1–Q9, read the relevant sections of `docs/REMEDIATION_IMPLEMENTATION_PLAN_2026-09-08.md` and maintain `docs/REMEDIATION_EVIDENCE_CHECKLIST.md`. These documents define closure requirements, not proof that a fix is complete.

## Agent collaboration — required for substantive work

The user explicitly wants future sessions to use agents. For substantive implementation, reviews, research, or planning, delegate at least one concrete, bounded subtask to a helper agent while the coordinating agent performs useful independent work. Prefer repository agent/subagent tools; do not create separate user-visible tasks unless requested.

- Start by identifying the active work package, independent subtasks, and file ownership. Suitable delegations include regression-test investigation, a separate module, focused primary-source research, and independent review of a completed diff. Do not delegate the same implementation twice.
- Give each helper the objective, relevant requirements/plan sections, allowed files, constraints, acceptance checks, and expected deliverable. Helpers read applicable AGENTS instructions and focused context; the coordinator owns complete session continuity.
- Assign disjoint write ownership. Only the coordinator edits shared continuity documents (`status.md`, `plan.md`, evidence registers) and manages GitHub Issues, unless that ownership is explicitly transferred. If another session changes an owned file, inspect and coordinate before editing; never reset or overwrite its work.
- Only the coordinator may commit, push, deploy, change credentials or remote configuration, restart shared services, or run destructive disposable-database checks. Helpers must not perform these actions independently. Serialize shared database/native-build resources and final workspace checks.
- Require an independent agent review for changes to authentication, authorization, account deletion/export, migrations/RLS, AI access/budgets, or deployment. The reviewer must not author the code being reviewed. Run review alongside documentation or other useful coordinator work, then resolve findings before closing the package.
- Helpers report files changed or source references, commands and actual outcomes, assumptions, outstanding risks, and blockers. The coordinator reads the actual diff, validates the evidence, integrates the result, and runs the final required checks after writes have settled. An agent's completion message is not acceptance evidence by itself.
- Keep delegation proportional: use the fewest agents that provide useful independent work and avoid recursive delegation without coordinator agreement. If tools are unavailable or the task is too small/sequential to split usefully, work locally and briefly record the exception; do not invent agent participation or stop otherwise feasible work.
- **Local Qwen agent paused (user decision 2026-09-14)**: The local Qwen worker/agent (MLX, Ollama, OpenCode, batch runner) is paused indefinitely and must NOT be used because it is too slow. Do not route tasks or dispatch subagent work to local Qwen. For delegations, use built-in repository subagents (`invoke_subagent` with `research` or `self`) or execute directly as the coordinator.

## Completion and evidence

- AI admission policy (user decision 2026-09-10): authenticated, adult-eligible users gain access to enabled AI features immediately after current consent is saved, without founder approval or email-list enrollment. `AI_ALLOWED_EMAILS` is deprecated and ignored. Preserve consent/revocation, authentication, provider kill switches and usage limits. See ADR-0024; this does not change Auth email-verification settings or prove release acceptance.

- Keep **implemented**, **automatically verified**, **Dev deployed**, **device accepted**, and **Production released** distinct. Close a work item only when its stated exit criteria are met. Otherwise record the completed portion and the exact remaining check.
- For a defect, demonstrate the failure first where feasible and add a regression that exercises the real failure boundary. Prefer lost-response, restart, concurrency, denied-access and partial-failure cases over tests that merely repeat implementation details.
- Mocks prove isolated behavior, bundle exports prove bundling, and HTTP 200 proves only the endpoint's implemented health check. None substitutes for real Auth/Storage/database isolation, native interaction, restore or release acceptance.
- Record exact source and deployed SHAs, migration versions, test commands/results, skipped suites and reasons, and relevant native build/device identifiers. Never report an earlier session's test result as fresh or count an unrun/credential-gated check as passed.
- Keep redacted durable evidence in the evidence register or linked verification artifacts. Record missing acceptance as a blocker/dependency and continue independent authorized work. Do not silently lower a gate to make a milestone complete.

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

Table row interfaces for `RepositorySupabaseClient.from<T>` in `packages/adapters/supabase-server` must explicitly extend `Record<string, unknown>` to satisfy TypeScript constraints.

## Safety and data handling

- Treat health information and photos as sensitive.
- Never put service-role keys or model API keys in mobile code.
- Every user-owned database table requires Row Level Security and a `user_id` index.
- AI output is advisory and uncertain; deterministic calculations remain in domain code.
- Photo-derived nutrition values require user confirmation before becoming authoritative.

## Primary working environment

For Mizyun, the **Founder Raspberry Pi 5** (Ubuntu Server 24.04 ARM64,
reachable from this Mac over SSH as `rpserver` / `mizyun-pi`) hosts Dev and
Production side-by-side.

**Tailscale network connectivity**: Both this Mac and the Raspberry Pi 5 are connected
via Tailscale. Tailscale is the required network and SSH transport for connecting to
`rpserver` (configured in `~/.ssh/config` pointing to the Pi's Tailscale IP or MagicDNS
hostname `mizyun-pi`). Ensure Tailscale is running on this Mac whenever executing
deployments (`pnpm deploy:dev`, `pnpm deploy:production`), running remote probes,
or performing Pi maintenance.

The topology below is the operational reference;
verify effective isolation and current configuration before relying on it.
Current SHAs and acceptance evidence belong in `status.md`, not this file.

1. **Development (`dev`)**:
   - Repo checkout: `/var/lib/mizyun/dev/repo`
   - Services: `mizyun-api-dev.service` (port 4100), `mizyun-supabase-dev.service` (port 8100 Kong, port 5433 Postgres)
   - Public hostnames: `https://mizyun-api-dev.phiskel.com`, `https://mizyun-supabase-dev.phiskel.com`
   - Mobile app: `com.mizyun.dev` ("Mizyun Dev", built via `pnpm mobile:founder-dev:ios`)
   - Deployment: `pnpm deploy:dev [sha]` (via `scripts/deploy-dev.mjs` and `scripts/promote-dev.sh`)
   - Current approved Dev testing policy: shared Gemini project with Production and `AI_EXTERNAL_ACCESS=true` for all Dev accounts, scoped to founder and testing partner. Preserve this explicit exception unless the user changes it; it does not approve broader external testing or prove that account admission/cost isolation is enforced. Record mismatches as findings.
   - Identity: Dev uses auto-confirmed email authentication under that testing policy. RLS still requires authenticated ownership (`user_id = auth.uid()`); autoconfirm is not an RLS requirement or an access allowlist.

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

- The Raspberry Pi must keep serving when the Mac is off. Prove both apps' standalone operation and session isolation on the current candidate; a Metro development client still depends on Metro.
- Never run destructive commands (`db:reset`, `db:verify`, volume pruning) against the Pi. `pnpm db:verify` runs only against the local disposable Mac database.
- Dev and Production must have separate database/Auth/Storage resources and non-interchangeable Auth credentials/tokens. Verify both directions of token rejection and effective runtime access; separate service names or a shared provider exception do not prove isolation.
- Before any deployment, `pnpm check` must pass on the Mac.
- Format the files changed by the session before final checks. Use repository-wide `pnpm format` only when it will not rewrite unrelated or concurrently edited files; `pnpm check` still checks repository-wide formatting.
- The Pi dev checkout (`/var/lib/mizyun/dev/repo`) must remain pristine; never leave unstaged or modified files on the Pi during ad-hoc testing, as `promote-dev.sh` fails closed on dirty working trees.
- Verify the exact deployment candidate, effective host/path/service/database target, and current tooling safeguards before deploying. A supplied SHA must not silently resolve to a different tested checkout. Never use a release command merely because its name or old documentation claims it is safe.
- Feature work goes to Dev. Production promotion is a separate explicit release milestone with its required acceptance, backup/migration and compatibility evidence; a merge, helper completion or documentation-only change is not a release trigger.

## Verification

Run `pnpm check` before committing. Provider integration tests remain disabled until every item in `docs/BEFORE_TESTING.md` is complete.

Use `docs/QUALITY_GATES.md` as the definition of done for implementation, data, mobile, calculation, media, and AI changes.
