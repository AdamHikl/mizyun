# Hetzner backend operations

Hetzner CX23 in Helsinki is the primary Mizyun backend. Dev and Production are
isolated on one VM. The Raspberry Pi retains its pre-migration files and data
and acts only as the encrypted off-host backup destination.

## Fixed topology

| Role               | SSH alias            | Checkout                   | API / database                   |
| ------------------ | -------------------- | -------------------------- | -------------------------------- |
| Dev deploy         | `mizyun-hetzner-dev` | `/var/lib/mizyun/dev/repo` | 4100 / 5433                      |
| Production deploy  | `mizyun-hetzner`     | `/var/lib/mizyun/repo`     | 4000 / 5432                      |
| Operations         | `mizyun-hetzner-ops` | n/a                        | root, manual infrastructure only |
| Backup destination | `rpserver`           | `/srv/mizyun/vm-backups`   | no active app traffic            |

Public traffic continues through the existing Cloudflare hostnames. Local
services bind to loopback. The root-owned `/etc/mizyun/host-role` marker must
equal the unique value in `scripts/deployment-manifest.mjs`; deployment fails
closed if it is missing or different.

## Deploy

Run `pnpm check` first. Dev accepts the chosen pushed commit; Production
requires an explicit full SHA reachable from `origin/main`.

```bash
pnpm deploy:dev [full-sha]
pnpm deploy:production <full-sha>
```

The drivers fetch their promotion protocol from `origin/main`, verify the
unique host marker in the same SSH connection that mutates the checkout, and
use restricted non-root accounts. Production takes an encrypted backup before
migration. Do not override the host alias, role marker, checkout path, service,
or database target to bypass a failed guard.

After a deployment, verify service start/PID, deployed SHA, the relevant public
health route, and the actual mobile journey. A health response alone is not
release acceptance.

## Daily encrypted backup

At 02:15 UTC, `mizyun-backup.timer` briefly closes the public tunnel and stops
Production writers. It records a consistent PostgreSQL custom dump, database
globals, private Storage with ACLs/xattrs, encrypted recovery configuration,
table counts, container image inventory, and the deployed SHA. Production is
resumed before compression and age encryption finishes. The VM retains seven
days of atomic encrypted exports.

At 03:15 UTC, `mizyun-backup-pull.timer` on the Pi pulls through a dedicated
read-only forced-`rrsync` key, verifies the encrypted SHA-256 and a six-hour
freshness limit, publishes atomically, and retains 90 days. The VM has no key
or account that can delete Pi copies. Current Pi capacity is the SD card, so
monitor free space and move `/srv/mizyun/vm-backups` to dedicated media before
backup growth threatens the one-GiB safety floor.

The private age identity is stored only on the founder Mac at
`/Users/adam/Backups/mizyun/keys/hetzner-backup-age-identity.txt`. Do not copy
it to Hetzner, the Pi, Git, logs, or a chat. This design has a daily RPO; writes
after the last completed archive can be lost if the VM fails.

Useful checks:

```bash
ssh mizyun-hetzner-ops 'systemctl status mizyun-backup.timer --no-pager'
ssh rpserver 'sudo systemctl status mizyun-backup-pull.timer --no-pager'
ssh rpserver 'sudo cat /srv/mizyun/vm-backups/last-success.json'
```

## Restore drill and disaster recovery

Never restore over the live database first. Copy one Pi archive to the Mac,
decrypt it locally, verify `PAYLOAD_SHA256SUMS`, then restore globals and the
custom database dump into a blank isolated PostgreSQL 17 target. Extract
Storage with `--xattrs --acls`, compare file hashes, xattrs, ACLs, table counts,
and representative Auth/Storage/application rows. Record the archive timestamp
and result in `status.md`.

For a real VM loss, provision a clean replacement, install the pinned
infrastructure, restore encrypted configuration with restrictive ownership,
restore globals before the database, restore Storage metadata, verify locally,
and only then redirect Cloudflare. Recovery is manual; never automatically
overwrite a surviving database.

## Pi preservation

Do not delete or reset `/var/lib/mizyun/dev/repo`, `/var/lib/mizyun/repo`, the
old Supabase directories/volumes, or legacy backups. The old Pi application
services remain stopped/frozen after cutover so they cannot accept writes.
Starting them is an explicit incident decision, not a normal deployment path.
