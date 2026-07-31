# ADR-0018: Isolated Mac development and Windows founder production

- Status: accepted
- Date: 2026-07-31

## Context

Mizyun needs two simultaneously usable backend environments. Adam develops and
may destructively rebuild data on the MacBook, while a Windows PC should keep a
stable version and persistent daily-use data. When a Mac version passes its
gates, one exact Git commit is promoted to the PC.

The prior ADR-0016 alpha amendment selected the Slovakia PC but described
running `supabase start` there and running `pnpm db:verify` during deployment.
Current Supabase documentation explicitly limits the CLI local stack to
development and says it must not be exposed externally. In this repository,
`db:verify` includes `db:reset`, so executing it against the PC authority would
erase persistent records.

The physical PC runs Windows. Mizyun's server and operational tooling are Linux-
oriented, and Windows Subsystem for Linux 2 supports systemd services. Supabase
provides an official self-hosted Docker Compose distribution that works on
Windows/Linux environments and is distinct from the CLI development stack.

## Decision

- Keep the MacBook as the only destructive development environment:
  - Supabase CLI local stack;
  - ignored repository `.env`;
  - Fastify watch mode;
  - `db:reset` and `db:verify` allowed only here.
- Run founder production inside Ubuntu/WSL2 on the Windows PC:
  - official Supabase self-hosted Docker Compose stack, not `supabase start`;
  - Fastify under systemd with `NODE_ENV=production`;
  - secrets in `/etc/mizyun/production.env`, outside the checkout;
  - named HTTPS tunnel for API and Supabase gateway only;
  - private Tailscale/SSH path for operations.
- Treat “production” here as Adam's persistent founder environment. It does not
  satisfy the paying-user production gates in ADR-0016 and the infrastructure
  evolution plan.
- Make production configuration fail closed: it requires durable Supabase URL,
  publishable key, and service-role key, and forbids the deterministic vision
  stub.
- Production API startup reads only process/systemd environment. It never loads
  the repository's development `.env`.
- Promote an exact, clean `main` commit from the Mac. The promotion must:
  1. pass `pnpm check` and `pnpm db:verify` on the Mac;
  2. push the exact SHA to canonical `origin/main`;
  3. fetch and verify that SHA on the PC;
  4. back up PostgreSQL and private Storage before schema mutation;
  5. preview and apply pending forward migrations without reset or seed data;
  6. restart and smoke-test the API;
  7. roll application code back on failure while leaving applied migrations
     forward-only.
- Never automatically copy records between development and production.
- Never expose Postgres, SSH, or Studio through the public application tunnel.

## Consequences

- Mac experimentation cannot mutate PC data through normal repository commands.
- A commit and a deployment are separate actions; production's SHA is explicit
  and inspectable.
- Migrations must remain backward compatible with the prior API because an
  applied production migration is not automatically reversed.
- Windows reboot/startup, WSL, Docker, systemd, Tailscale, and Cloudflare become
  part of the founder environment's operational chain and require reboot proof.
- Local backups on the PC do not protect against PC loss. Encrypted off-device
  backups and a restore drill remain blocking work before other users rely on
  the service.
- The ADR-0016 strategic gate remains: one PC is not acceptable as the eventual
  paying-user production authority without redundancy, recovery, monitoring,
  incident ownership, and a second operator.

## Sources

- Supabase local development workflow:
  https://supabase.com/docs/guides/local-development/cli-workflows
- Supabase self-hosting:
  https://supabase.com/docs/guides/self-hosting
- Supabase self-hosting with Docker:
  https://supabase.com/docs/guides/self-hosting/docker
- Microsoft WSL systemd:
  https://learn.microsoft.com/en-us/windows/wsl/systemd
- Microsoft WSL networking:
  https://learn.microsoft.com/en-us/windows/wsl/networking
- Tailscale on Windows with WSL2:
  https://tailscale.com/docs/install/windows/wsl2
- Cloudflare Tunnel as a service:
  https://developers.cloudflare.com/tunnel/advanced/local-management/as-a-service/
