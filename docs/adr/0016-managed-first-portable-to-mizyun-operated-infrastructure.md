# ADR-0016: Managed first, portable to Mizyun-operated infrastructure

- Status: accepted
- Date: 2026-07-23

## Context

Mizyun handles health-related records, private photos, conversations, and future durable AI memory. The product needs a reliable hosted environment before alpha, while the long-term product direction favors control over its infrastructure and data plane.

Operating the entire Supabase stack safely requires more than a Linux host. Self-hosting transfers server maintenance, security hardening, Postgres operations, high availability, backups, disaster recovery, monitoring, SMTP, Storage durability, secrets, upgrades, and on-call response to Mizyun. Building that platform before product validation would delay the user loop and increase data-loss risk.

The existing ports/adapters, PostgreSQL migrations, RLS policies, private Storage abstraction, and stateless Mistral decision already make a managed-first migration path possible.

## Decision

- Use managed Supabase in a specific EU region for hosted development, staging, alpha, and initial production.
- Keep authoritative application records, conversations, and durable AI memory in Mizyun-owned PostgreSQL schemas.
- Keep private media behind `MediaStorage` and model vendors behind stateless provider ports.
- Treat managed services as replaceable operators, not owners of the product data model.
- Build and measure portability while managed Supabase remains authoritative.
- Target Mizyun-operated EU infrastructure only after the operational, economic, compliance, rehearsal, staffing, and rollback gates in `docs/INFRASTRUCTURE_EVOLUTION_PLAN.md` pass.
- Interpret “our own server” as infrastructure operated by Mizyun on EU virtual or dedicated hosts. Physical hardware ownership is optional and is not itself a product objective.
- Never use a single Linux server as the production authority for user data, Auth, photos, and backups.

## Consequences

- The current roadmap continues toward hosted Supabase and physical-device acceptance; self-hosting does not block alpha.
- Business logic must remain outside Supabase-specific adapters and hosted-only features require explicit exit strategies.
- Durable memory will use PostgreSQL first; Mistral remains stateless and replaceable.
- Production self-hosting requires redundant compute, durable object storage, database recovery, monitoring, patching, incident response, and at least two qualified operators.
- Managed-to-self-hosted restoration must account for Postgres/Auth/Storage component-version differences and be rehearsed before production data moves.
- A future cutover is a controlled data migration with checksums, Auth/JWT decisions, object copying, native acceptance, and rollback—not a DNS-only change.

## Amendment 2026-07-25 — Self-hosted alpha track

> Operationally refined by ADR-0018 on 2026-07-31. In particular, the PC uses
> official self-hosted Supabase Docker Compose rather than the development-only
> CLI stack, and production promotion never runs `db:verify`/`db:reset` there.

For the alpha track before the first paying user, the "managed
first" decision above is suspended in favour of self-hosting on
Adam's Slovakia PC. The original managed-first posture remains
binding for production; INFRA-PORT-001 is the segment that
restores it.

### Why this amendment

- Adam does not want user records, photos, and conversations
  held by a third-party cloud provider during alpha. The data is
  sensitive enough that the third-party trust boundary is itself
  the risk.
- The PC is in Slovakia, an EU member state. EU residency per
  ADR-0017 is preserved.
- The PC will run 24/7 with a Cloudflare Tunnel as the only
  inbound path. No public IP, no port forwarding.
- Adam accepts the single-host alpha risk: no off-site backup, no
  PITR, no second operator. This is explicitly an alpha exception
  and is reversed before any paying-user cutover (INFRA-PORT-001).

### Topology (alpha)

- **Mac (workstation)** — pnpm workspace, `supabase start` (long-lived
  on Mac during dev), `pnpm dev` for the Fastify API. Daily dev loop.
- **Slovakia PC (alpha server)** — Docker daemon runs:
  - `supabase start` against the local Supabase stack (the same Docker
    Compose project the Mac uses).
  - `apps/api` container (Fastify) on the same Docker network.
  - `cloudflared` daemon exposing the API (and optionally Supabase
    Studio) on a stable Cloudflare edge URL.
- **Mac → PC deploy** — `pnpm deploy:remote` (new script)
  SSHes into the PC, `git pull`, runs `pnpm db:push` over SSH
  against the long-lived PC stack, restarts the API container.

### Networking

- Cloudflare Tunnel runs on the PC. Inbound paths reach the API
  via `https://<tunnel>.trycloudflare.com` (or a custom domain
  once one is bound).
- Auth redirect URLs:
  - Mac dev: `mizyun://auth/callback` (mobile deep link, unchanged).
  - PC alpha: `mizyun://auth/callback` plus
    `https://<tunnel>.trycloudflare.com/auth/v1/callback` (Supabase
    redirect target).
- API CORS allowlist includes the tunnel URL.
- Mobile bundle ships `EXPO_PUBLIC_API_URL` and
  `EXPO_PUBLIC_SUPABASE_URL` pointing at the tunnel URL.

### What stays the same

- Migrations, RLS policies, RPCs, and the durable limiter surface
  are unchanged — they apply identically against self-hosted
  Postgres. AI-OPS-002 (`revoke execute on function public.ai_*`)
  is mandatory.
- The Fastify backend, the limiter service, the tool registry,
  the Mistral provider — all portable.
- The Cloudflare Tunnel exposes the same `SUPABASE_URL` /
  `SUPABASE_PUBLISHABLE_KEY` shape the mobile bundle expects.

### What changes

- `scripts/db-push.mjs` and `scripts/db-linked-test.mjs` remain;
  they now SSH into the PC and execute against the local PC
  Supabase instead of pushing to a managed project.
- A new `scripts/deploy-remote.mjs` orchestrates the Mac→PC
  workflow.
- `docs/tutorials/HOSTED_RUNBOOK.md` becomes
  `SELFHOSTED_RUNBOOK.md` with Slovakia + Cloudflare Tunnel
  instructions.
- `backlog.md`: INFRA-MANAGED-001 status moves to
  `superseded-by-INFRA-SELFHOST-001`; INFRA-SELFHOST-001 status
  moves from `blocked` to `ready`.

### Alpha risk Adam accepts

- No off-site backup target until the first paying user
  approaches. Backups that exist (Postgres `pg_dump`,
  `rclone` of the `private-media` bucket bytes) are local to the
  PC. A hardware failure loses user data.
- The PC is the production authority for alpha. Single host,
  no replication, no second operator.
- The Cloudflare Tunnel depends on a stable tunnel URL. If Adam
  uses `trycloudflare.com` ephemeral URLs, the mobile bundle
  must be rebuilt on every tunnel restart. A named tunnel +
  custom domain is the answer once Adam is ready to register
  one.

These are explicitly accepted for alpha. INFRA-PORT-001 reverses
them before production cutover.

## Sources

- Supabase self-hosting responsibilities: https://supabase.com/docs/guides/self-hosting
- Self-hosting with Docker and production configuration: https://supabase.com/docs/guides/self-hosting/docker
- Restore a platform project to self-hosted: https://supabase.com/docs/guides/self-hosting/restore-from-platform
- Migrating Supabase Auth users: https://supabase.com/docs/guides/troubleshooting/migrating-auth-users-between-projects
- Supabase regions: https://supabase.com/docs/guides/platform/regions
- Supabase database backups: https://supabase.com/docs/guides/platform/backups
- Cloudflare Tunnel quickstart: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/
- Cloudflare Tunnel named tunnels: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/configure-tunnels/local/
