# Mizyun infrastructure evolution plan

> Self-hosted Mizyun-operated Supabase on the Slovakia PC for the alpha track (per ADR-0016 amendment 2026-07-25). Managed Supabase returns as the production-track shape via INFRA-PORT-001. The portability requirement is unchanged.

## Direction

For the alpha track, Mizyun self-hosts Supabase on Adam's Slovakia
PC rather than using a managed cloud provider. The Slovakia PC is
an EU member state, so EU residency per ADR-0017 is preserved. The
PC runs 24/7 with a Cloudflare Tunnel as the only inbound path;
no public IP is exposed.

The single-host alpha risk (no off-site backup, no PITR, no second
operator) is explicitly accepted and reversed by INFRA-PORT-001
before any paying-user cutover. The portability requirement is
unchanged: business logic stays outside Supabase-specific adapters
so a future move to managed Supabase (or another EU host) is a
data migration, not a rewrite.

The long-term target is still **Mizyun-operated infrastructure in
an EU data center**, initially on rented EU virtual or dedicated
servers. Owning physical hardware is not a product requirement.
Operational control, data portability, documented recovery, and
replaceable vendors are the goals. The alpha self-hosted PC is a
proof of operational ownership that informs the production
shape; it is not the production shape itself.

A single Linux server is acceptable for the alpha track under the
conditions in ADR-0016 amendment 2026-07-25. It is not an
acceptable production target for sensitive user data; that
constraint is reversed only by INFRA-PORT-001.

## Data ownership map

| Data                                     | Alpha authority (self-hosted Slovakia PC)       | Long-term authority                                                            |
| ---------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------ |
| Accounts and identities                  | Self-hosted Supabase Auth on the PC             | Mizyun-operated Supabase Auth or a replacement identity adapter                |
| Food, training, body, goals and settings | Self-hosted Supabase PostgreSQL on the PC       | Mizyun-operated PostgreSQL                                                     |
| Coach conversations                      | Self-hosted Supabase PostgreSQL on the PC       | Mizyun-operated PostgreSQL                                                     |
| Durable AI memory                        | `memory_items` in self-hosted PostgreSQL        | The same portable schema in Mizyun-operated PostgreSQL                         |
| Optional future embeddings               | PostgreSQL/pgvector only after measured need    | PostgreSQL/pgvector or a replaceable memory adapter                            |
| Progress photos                          | Private self-hosted Supabase Storage on the PC  | Mizyun-operated Supabase Storage with independent S3-compatible object storage |
| Model inputs and outputs                 | Transient Mistral stateless requests with ZDR   | Still transient, or a later evaluated self-hosted model provider               |
| Model keys and server secrets            | `~/.cloudflared/alpha.env` on the PC, mode 0600 | Mizyun-operated secrets manager, never application files                       |
| Product analytics                        | Consent-based bounded/aggregate data only       | Same policy on Mizyun-operated infrastructure                                  |

Mistral is never the durable memory authority. The API selects a bounded grounding snapshot and sends only what is necessary for one request.

## Architecture stages

### Stage 0 — Local reproducible development

Current foundation:

- committed migrations and pgTAP ownership tests;
- local Supabase through the pinned CLI;
- repository ports for identity, feature data, conversations, memory, and media;
- server-only model-provider composition;
- no dashboard-only schema changes.

Exit:

- every schema change rebuilds from migrations;
- every user-owned table has RLS and a `user_id` index;
- export and deletion contracts cover every durable data category.

### Stage 1 — Self-hosted Slovakia PC (alpha track)

Single EU Linux host running Supabase + Fastify + Cloudflare Tunnel.
Operated by Adam with Mac-side dev loop. Replaces the prior
"Managed EU foundation" Stage 1 for the alpha period.

- the PC runs `supabase start` (long-lived) plus the Fastify API
  under a systemd unit, both on a private Docker network;
- a Cloudflare named tunnel exposes `alpha.mizyun.app` (API) and
  `supabase-alpha.mizyun.app` (Supabase Studio) on stable URLs;
- migrations deploy via `pnpm deploy:remote` (Mac → PC over SSH);
- Auth redirect URLs gain the tunnel URL alongside the mobile
  deep-link;
- service-role and Mistral keys live in
  `~/.cloudflared/alpha.env` on the PC, mode `0600`;
- the `private-media` Storage bucket is created by the migration
  with `ON CONFLICT DO NOTHING`; the runbook verifies the bucket
  settings on the PC after the first `db:push`;
- AI-OPS-002 (`revoke execute on function public.ai_* from
public, anon, authenticated`) is mandatory and verified per
  ADR-0017.

Alpha risk Adam accepts:

- no off-site backup target — `pg_dump` and `rclone sync` of the
  private-media bucket are local only;
- no PITR;
- single host, no replication, no second operator;
- Cloudflare Tunnel depends on a stable tunnel URL. If Adam uses
  `trycloudflare.com` ephemeral URLs, the mobile bundle must be
  rebuilt on every tunnel restart. A named tunnel + custom
  domain is the answer once Adam is ready to register one.

Exit (Stage 2 transition — handled by INFRA-PORT-001):

- off-site backup target configured (Backblaze B2 / second host);
- PITR or daily-restore drill exercised against a scratch
  environment;
- second operator on-call rotation;
- Cloudflare Access in front of Supabase Studio;
- documented subprocessors, DPAs, data locations, retention,
  access, incident response, and deletion;
- keep development, staging, and production identities, databases,
  buckets, keys, and model workspaces separate.

### Stage 2 — Portability hardening

This stage runs while managed Supabase remains authoritative.

- keep business rules outside Supabase-specific adapters;
- keep PostgreSQL migrations compatible with the selected self-hosted Postgres target;
- pin and inventory every required extension;
- add provider contract suites that run against both managed and self-hosted adapters;
- create versioned exports for application data, `auth` identities, private objects, and configuration;
- record checksums and object counts for export/import verification;
- rehearse restoring managed database backups into an isolated self-hosted environment;
- decide whether migration will preserve the JWT signing key or intentionally force every user to sign in again;
- measure database size, object bytes, peak connections, request rate, backup duration, restore duration, and monthly fully loaded managed cost.

Exit:

- a self-hosted staging restore passes schema, row-count, checksum, RLS, Auth, Storage, export, deletion, and mobile contract tests;
- a written rollback procedure has been rehearsed;
- no feature depends on an undocumented managed-platform-only capability.

### Stage 3 — Mizyun-operated staging

Operate a production-shaped staging environment for at least 90 days before considering a user-data cutover.

Minimum topology:

- at least two API instances behind a TLS-terminating reverse proxy/load balancer;
- PostgreSQL with encrypted storage, connection pooling, automated backups, point-in-time recovery or equivalent WAL archiving, and an off-host copy;
- private S3-compatible object storage that is not tied to one server disk;
- self-hosted Supabase Auth, REST, Storage, and required gateway services at pinned, tested versions;
- production SMTP;
- a secrets manager rather than plaintext deployment `.env` files;
- centralized logs with sensitive-payload redaction, metrics, alerts, audit trails, and time synchronization;
- restricted administrative access with MFA, least privilege, patching, vulnerability management, and documented break-glass access.

Required exercises:

- restore a database and object backup into a clean environment;
- lose one API node without user-visible data loss;
- rotate database, signing, storage, and model credentials;
- export and delete a synthetic user across Auth, PostgreSQL, Storage, conversations, and memory;
- deploy and roll back a Supabase component upgrade;
- run load, failover, security, and disaster-recovery tests.

Exit:

- two qualified operators can independently restore and operate the stack;
- 90 days of staging operation meets the provisional service objectives;
- no unresolved P0/P1 security, data-loss, deletion, or recovery defect remains.

### Stage 4 — Shadow migration and cutover rehearsal

Use synthetic/staging data first, then a production clone only under the approved data-handling procedure.

1. Pin compatible managed and self-hosted Postgres/Supabase component versions.
2. Restore the database into an isolated target and resolve version/extension differences.
3. Copy private object bytes to the target object store and verify count, size, and checksum manifests.
4. Validate Auth identities, password hashes, redirect configuration, and the JWT migration decision.
5. Run every repository contract, RLS, Storage, export, deletion, API, and native acceptance test.
6. Rehearse DNS/API endpoint changes and mobile backward compatibility.
7. Measure the write-freeze/delta-copy window and prove rollback to managed Supabase.

Exit:

- two complete cutover rehearsals succeed within the approved recovery window;
- the rollback path is faster than the maximum tolerated outage;
- data-protection and incident owners approve the production runbook.

### Stage 5 — Production cutover

Use a planned maintenance window unless tested logical replication provides a safer near-zero-downtime path.

1. Announce the maintenance window and freeze writes.
2. Take final database and object backups.
3. Apply the final database delta and object copy.
4. Verify manifests, critical queries, RLS, Auth, signed Storage access, conversation/memory retrieval, and deletion.
5. Switch the API endpoint and validate mobile compatibility.
6. Monitor error, latency, authentication, database, Storage, and AI-provider signals.
7. Roll back immediately if a predefined safety threshold fails.
8. Retain the managed source read-only only for the approved rollback period, then delete it under the documented retention procedure.

Exit:

- production service objectives hold through the observation window;
- export/deletion and two-user isolation pass on the new authority;
- the old processor confirms deletion after the rollback period.

## Migration triggers

Self-hosting work may start only when at least one strategic trigger exists:

- managed-service limitations block a required product or compliance capability;
- a customer or regulator requires an infrastructure control the managed service cannot provide;
- measured managed cost materially exceeds the fully loaded self-hosted cost for a sustained period;
- scale or latency requirements cannot be met economically on the managed platform;
- reducing a material processor or jurisdiction dependency is worth the operational burden.

Production cutover additionally requires all operational gates:

- at least two qualified operators; no single-person on-call dependency;
- a named security/incident owner and a reviewed data-protection impact assessment;
- tested monitoring, patching, backup, restore, failover, key rotation, deletion, and rollback;
- at least 90 days of production-shaped staging evidence;
- sufficient budget for redundancy, off-site backups, monitoring, and incident response.

Self-hosting is not justified only because one server's monthly rental appears cheaper than a managed bill. Compare staffing, security, support, backup storage, recovery time, monitoring, downtime risk, and opportunity cost.

## Provisional service objectives

These are planning targets to validate before beta, not current promises:

| Objective                         | Initial target                            |
| --------------------------------- | ----------------------------------------- |
| API availability                  | 99.9% monthly                             |
| Database recovery point objective | 15 minutes                                |
| Database recovery time objective  | 4 hours                                   |
| Critical alert acknowledgement    | 30 minutes during supported hours         |
| Backup restore exercise           | At least quarterly                        |
| Access review                     | At least quarterly and after role changes |

Targets must be revised using actual user expectations, staffing, regulatory advice, and measured recovery exercises before becoming contractual.

## Portability rules starting now

- Mobile talks to Mizyun API and provider-neutral identity/storage clients, never directly to a model vendor.
- Core business rules never depend on Supabase, AWS, Docker, or a model SDK.
- Vendor code remains inside adapters/providers and is selected in composition roots.
- Durable schemas and migrations stay in version control.
- User IDs remain Mizyun's ownership boundary across records, conversations, memory, and media.
- Service-role, database, signing, storage, and model credentials remain server-only.
- No private object relies on a permanent public URL.
- No hosted model conversation becomes authoritative.
- Every durable category supports export, deletion, and restore verification.
- Managed-only features require an ADR and an exit strategy before adoption.

## Near-term action

Do not begin self-hosting implementation during the current AI/mobile acceptance work. The next infrastructure action is `INFRA-MANAGED-001`: create a hosted EU development/staging Supabase project, deploy the committed migrations, and prove physical-device Auth/RLS/Storage behavior.

The self-hosting work begins with `INFRA-PORT-001` only after hosted acceptance produces real measurements to design against.
