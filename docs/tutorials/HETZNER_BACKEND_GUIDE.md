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
# Instant preflight check (<1s, non-destructive)
pnpm deploy:dev:preflight [full-sha]
pnpm deploy:production:preflight <full-sha>

# Deployment execution
pnpm deploy:dev [full-sha]
pnpm deploy:production <full-sha>
```

For AI agents and automated workflows, dedicated skills with compact execution
guidance are maintained under `.agents/skills/deploy-dev/SKILL.md` and
`.agents/skills/deploy-production/SKILL.md`.

The drivers fetch their promotion protocol from `origin/main`, verify the
unique host marker in the same SSH connection that mutates the checkout, and
use restricted non-root accounts. Production takes an encrypted backup before
migration. Do not override the host alias, role marker, checkout path, service,
or database target to bypass a failed guard.

Dev deployment uses a dedicated read-only GitHub Deploy Key (`mizyun-dev-deploy@hetzner`)
at `/home/mizyun-dev-deploy/.ssh/id_ed25519` fetching from `git@github.com:AdamHikl/mizyun.git`.
Git `safe.directory` is strictly restricted to `/var/lib/mizyun/dev/repo` (wildcards
forbidden). Promotion executes non-interactively under `CI=true` and restarts
`mizyun-api-dev.service` matching narrow sudoers privileges.

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
`/Users/adam/Backups/mizyun/keys/hetzner-backup-age-identity.txt` (and founder
password manager). Do not copy it to Hetzner, the Pi, Git, logs, or a chat. This
design has a daily RPO (~24 hours); writes after the last completed archive can
be lost if the VM fails.

Useful checks:

```bash
ssh mizyun-hetzner-ops 'systemctl status mizyun-backup.timer --no-pager'
ssh rpserver 'sudo systemctl status mizyun-backup-pull.timer --no-pager'
ssh rpserver 'sudo cat /srv/mizyun/vm-backups/last-success.json'
```

### Operational alerting

Both `mizyun-backup.service` (Hetzner) and `mizyun-backup-pull.service` (Pi) attach
an automated failure handler via `OnFailure=mizyun-backup-alert@%n.service`.

When a failure occurs:

1. Systemd triggers `mizyun-backup-alert@.service`.
2. The unit executes `/usr/local/sbin/mizyun-send-alert` (`deploy/hetzner/mizyun-send-alert.sh`).
3. Alerts are logged with `daemon.crit` priority to journald / syslog.
4. If `/etc/mizyun/alerts.env` defines `MIZYUN_ALERT_WEBHOOK_URL`, an alert payload
   is dispatched via HTTP POST to the webhook (Slack, Discord, or Telegram).
5. Operator runbook: on alert, inspect `journalctl -u mizyun-backup.service` (or
   `mizyun-backup-pull.service`), check disk space (`df -h`), container health
   (`docker ps`), and database write freeze state.

### Capacity and retention plan

- **Hetzner VM**: Keeps 7 days of atomic encrypted exports in
  `/srv/mizyun/backup-export/outgoing`. Automatic cleanup runs after each backup.
  Requires minimum 1 GiB free disk in `/srv/mizyun/backup-work`.
- **Raspberry Pi**: Retains 90 days in `/srv/mizyun/vm-backups`. Root filesystem
  microSD card currently holds ~7.5 GiB free with a mandatory 1.0 GiB safety floor
  (`min_free_kib=1048576`). Current daily archives average ~5 MB.
- **Dedicated storage trigger**: When daily backup archive size exceeds 25 MB/day
  or total free space on the Pi drops below 3.0 GiB, mount an external dedicated
  USB SSD at `/srv/mizyun/vm-backups` to prevent backup termination.

## Restore drill and disaster recovery

Never restore over the live database first. The repository provides an automated,
ephemeral restore drill runner that validates the entire recovery chain on an
independent machine with Docker:

```bash
pnpm backup:verify <path-to-archive-or-directory> [path-to-age-identity]
```

The drill runner (`scripts/verify-backup-recovery.sh`):

1. Verifies ciphertext `SHA256SUMS` and completion marker.
2. Decrypts the age-encrypted archive using the offline escrowed identity.
3. Verifies `PAYLOAD_SHA256SUMS` across all internal artifacts.
4. Starts an isolated PostgreSQL 17 container (`supabase/postgres:17.6.1.136`),
   applies `globals.sql`, restores `database.dump` into a blank `mizyun_restore`
   database, and compares restored table counts against `table-counts.tsv`.
5. Starts an isolated Linux container (`ubuntu:24.04`), unpacks `storage.tar.gz`
   with `--xattrs --acls`, and compares file hashes against `storage-files.sha256`,
   xattrs against `storage-xattrs.txt`, and ACLs against `storage-acls.txt`.
6. Traps exits to automatically tear down containers and securely purge plaintext.
7. Measures recovery duration (target: under 60 seconds).

Acceptance drill evidence from 2026-09-24:

- Archive: `20260924T021544Z` (commit `43917fa4b69acff04b931c4ef927dab21466a932`)
- Duration: 49 seconds
- Database: 76 tables restored, 0 discrepancies
- Storage: 3 media files, xattrs, and ACLs matched 100%
- Escrow key: offline retrieval and decryption verified without VM or Pi

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
