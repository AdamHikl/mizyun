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

All alerts go through `/usr/local/sbin/mizyun-send-alert <unit> <message>`
(`deploy/hetzner/mizyun-send-alert.sh`). It always logs at `daemon.crit` to
journald (`journalctl -t mizyun-alert`) and, when `/etc/mizyun/alerts.env`
sets `MIZYUN_ALERT_WEBHOOK_URL`, posts JSON with both `text` (Slack,
Mattermost) and `content` (Discord) to that webhook. The alert scripts source
`alerts.env` as root and ignore it unless it is a regular file owned by root
and not group- or world-writable; webhook and ping URLs are passed to `curl`
on stdin, never in the process list.

| Signal                                         | Mechanism                                                                                                    |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Backup or Pi pull failed                       | `OnFailure=mizyun-backup-alert@%n.service` on both backup units                                              |
| Production API, Supabase, Dev Supabase, tunnel | `OnFailure=mizyun-alert@%n.service`: each crash, failed start or stop timeout; at most 3 per unit per 30 min |
| Automatic restart of a watched unit            | `mizyun-host-watch.timer` compares systemd `NRestarts` every 5 minutes; at most one alert per hour per unit  |
| Watched unit not active (incl. a manual stop)  | host watch, after two consecutive runs; paused while the matching maintenance lock is held                   |
| Disk ≥ 85 % used, available memory < 10 %      | host watch, after two consecutive runs; repeats hourly; sends "Recovered" when cleared                       |
| Unhealthy or restarting Docker container       | host watch (`docker ps --filter health=unhealthy` / `status=restarting`)                                     |
| Backup or Pi pull did not succeed on schedule  | optional dead-man ping (`mizyun-heartbeat`) to an external check, e.g. healthchecks.io                       |
| Public API or tunnel unreachable               | external uptime monitor (outside Hetzner); the only signal if the whole VM is down                           |

On systemd 255 (`RestartMode=normal`) a crashing unit passes through the
failed state before `Restart=on-failure` restarts it, so `OnFailure` reports
each crash; the `StartLimitBurst` on `mizyun-alert@.service` caps a crash loop
and the host watch keeps reporting it hourly. A clean `systemctl stop`
(backup, deployment) is not a failure. `mizyun-api-dev.service` deliberately
has no `OnFailure`/`ExecStopPost` hook: the Dev backup freeze
(`scripts/backup-dev-encrypted.py`) refuses units with stop or completion
hooks, so the host watch alone covers Dev API restarts and stops. A manually
stopped tunnel, as in the 32-minute Production outage, is caught by the host
watch and the external monitor, never by `OnFailure`.

The host watch never takes a lock. It reads `lslocks` and pauses unit-state
checks while `/run/lock/mizyun-production-maintenance.lock` is held (all
units) or `/tmp/mizyun-deploy-dev.lock` is held (`*-dev.service` only).
Known gaps: a manual `systemctl start`/`restart` resets `NRestarts`, so crashes
just before a deployment can go unreported; exited containers inside an
otherwise active Supabase unit are not reported unless Docker restarts them.

Thresholds and the watched unit list are optional `alerts.env` settings:
`MIZYUN_WATCH_DISK_PATHS` (space-separated, default `/`),
`MIZYUN_WATCH_DISK_PERCENT` (85), `MIZYUN_WATCH_MEM_AVAILABLE_PERCENT` (10),
`MIZYUN_WATCH_CONFIRM_RUNS` (2), `MIZYUN_WATCH_REPEAT_MINUTES` (60),
`MIZYUN_WATCH_DOCKER_HEALTH` (`true`) and `MIZYUN_WATCH_UNITS` (default: both
APIs, both Supabase stacks, `cloudflared` and `docker`; set it to empty on the
Pi).

On an alert, inspect `journalctl -u <unit> -n 200`, `systemctl status <unit>`,
`df -h`, `free -m` and `docker ps -a`. For a backup failure also check the
database write freeze state.

### Monitoring setup (one-time, Adam)

These steps need accounts and root access, so only Adam performs them. They
restart no service. Run steps 4–6 only after this change is on `main` and Dev
has been deployed to that commit, so the new files exist in the pristine Dev
checkout on Hetzner (`/var/lib/mizyun/dev/repo`). Run nothing in steps 5–6
between 02:00 and 02:45 UTC or during a deployment.

1. **Alert channel.** Create an incoming webhook in a private Discord channel
   or Slack workspace that you read on your phone. Keep the URL secret.
2. **Dead-man checks.** In healthchecks.io (or similar), create two checks:
   `mizyun-backup` (period 1 day, grace 2 hours; it should ping shortly after
   02:15 UTC) and `mizyun-backup-pull` (period 1 day, grace 2 hours; after
   03:15 UTC). Set each to notify the same channel. Copy their ping URLs.
3. **External uptime monitor.** In a service outside Hetzner (for example
   UptimeRobot or Better Stack), add HTTP monitors that expect status 200 every
   5 minutes from more than one region:
   - Production readiness: `https://mizyun-api.phiskel.com/v1/readiness`
     (returns 503 while not ready).
   - Dev health: `https://mizyun-api-dev.phiskel.com/v1/health`.

   Alert after three consecutive failures rather than using a fixed
   maintenance window: the backup closes the tunnel briefly each night, and
   after a reboot or missed run (`Persistent=true`) it can run at any time.

4. **Hetzner: alert config.** Keep an existing file; create it only if
   missing. Edit with an editor so the URLs never enter shell history:

   ```bash
   ssh mizyun-hetzner-ops
   install -d -m 0755 -o root -g root /etc/mizyun
   [ -e /etc/mizyun/alerts.env ] || install -m 0600 -o root -g root /dev/null /etc/mizyun/alerts.env
   chown root:root /etc/mizyun/alerts.env && chmod 0600 /etc/mizyun/alerts.env
   nano /etc/mizyun/alerts.env
   ```

   Add (plain `NAME=value` lines only; the file is sourced by root):

   ```bash
   MIZYUN_ALERT_WEBHOOK_URL=https://discord.com/api/webhooks/...
   MIZYUN_HEARTBEAT_URL_BACKUP=https://hc-ping.com/...
   ```

5. **Hetzner: pre-checks.** Each must pass before step 6; stop and report
   otherwise.

   ```bash
   # a) Last night's planned stops must not have failed. Expect no output.
   journalctl -u mizyun-api.service -u cloudflared.service --since yesterday --no-pager \
     | grep 'Failed with result'
   # b) No unrelated unit edits are waiting for a reload. Expect all "no".
   systemctl show -p NeedDaemonReload mizyun-api.service mizyun-api-dev.service \
     mizyun-supabase.service mizyun-supabase-dev.service cloudflared.service
   # c) lslocks shows flock paths (briefly takes the lock; outside maintenance only).
   flock -n /run/lock/mizyun-production-maintenance.lock \
     lslocks --noheadings --output PATH | grep -Fx /run/lock/mizyun-production-maintenance.lock \
     || echo "check failed or lock busy"
   ```

   If (a) shows a planned stop as failed, fix the exit status
   (`SuccessExitStatus=`) before adding `OnFailure`; do not install the
   drop-ins and mute alerts. If (c) prints "check failed or lock busy", confirm no backup or deployment is running (`systemctl is-active mizyun-backup.service mizyun-backup-for-deploy.service`) and retry once; if it still fails, the watch cannot see
   maintenance and will alert during long backups or deployments; report it.

6. **Hetzner: install scripts, units and drop-ins** (as root, from the Dev
   checkout; drop-ins avoid overwriting any live unit drift):

   ```bash
   src=/var/lib/mizyun/dev/repo/deploy/hetzner
   install -m 0755 -o root -g root "$src/mizyun-send-alert.sh" /usr/local/sbin/mizyun-send-alert
   install -m 0755 -o root -g root "$src/mizyun-heartbeat.sh" /usr/local/sbin/mizyun-heartbeat
   install -m 0755 -o root -g root "$src/mizyun-host-watch.sh" /usr/local/sbin/mizyun-host-watch
   install -m 0644 -o root -g root "$src/mizyun-alert@.service" "$src/mizyun-host-watch.service" "$src/mizyun-host-watch.timer" /etc/systemd/system/
   for unit in mizyun-api mizyun-supabase mizyun-supabase-dev cloudflared; do
     install -d -m 0755 "/etc/systemd/system/$unit.service.d"
     printf '[Unit]\nOnFailure=mizyun-alert@%%n.service\n' > "/etc/systemd/system/$unit.service.d/alert.conf"
   done
   systemctl daemon-reload
   systemctl enable --now mizyun-host-watch.timer
   ```

   Do **not** install `backup-production-encrypted.sh` from the Dev checkout:
   it is Production backup code. Its heartbeat line reaches
   `/usr/local/sbin/mizyun-backup-production` only with a Production release
   of this commit, from `/var/lib/mizyun/repo`, after
   `diff /usr/local/sbin/mizyun-backup-production /var/lib/mizyun/repo/deploy/hetzner/backup-production-encrypted.sh`
   shows only the heartbeat block. Until then the `mizyun-backup` check gets
   no pings: leave it paused.

7. **Hetzner: verify and send one test alert.**

   ```bash
   systemctl show -p OnFailure mizyun-api.service cloudflared.service mizyun-supabase.service mizyun-supabase-dev.service
   systemctl show -p OnFailure mizyun-api-dev.service   # must be empty
   systemctl start mizyun-alert@manual-test.service     # arrives in the channel as "Unit manual-test failed"
   systemctl start mizyun-host-watch.service && journalctl -u mizyun-host-watch -n 20 --no-pager
   systemctl show cloudflared.service -p Id -p LoadState -p UnitFileState -p After -p Before -p Wants -p Requires -p Requisite -p BindsTo -p PartOf -p Conflicts -p ConflictedBy -p PropagatesStopTo -p StopPropagatedFrom -p Type -p Restart > /tmp/tunnel.txt
   node /var/lib/mizyun/dev/repo/deploy/hetzner/verify-shared-tunnel-dependencies.mjs --snapshot /tmp/tunnel.txt && rm /tmp/tunnel.txt
   ```

   The next morning, check that no false alert arrived from the 02:15 backup.

8. **Pi** (`ssh rpserver`, then `sudo -i`). Copy `mizyun-send-alert.sh`,
   `mizyun-heartbeat.sh`, `mizyun-host-watch.sh`, `mizyun-alert@.service`,
   `mizyun-host-watch.service`, `mizyun-host-watch.timer` and
   `pull-backups-from-hetzner.sh` from the Mac checkout of the merged `main`
   commit to a new root-only directory (for example `/root/mizyun-ops`), then:

   ```bash
   cd /root/mizyun-ops
   diff /usr/local/sbin/mizyun-backup-pull pull-backups-from-hetzner.sh   # expect only the heartbeat block; stop otherwise
   install -m 0755 -o root -g root mizyun-send-alert.sh /usr/local/sbin/mizyun-send-alert
   install -m 0755 -o root -g root mizyun-heartbeat.sh /usr/local/sbin/mizyun-heartbeat
   install -m 0755 -o root -g root mizyun-host-watch.sh /usr/local/sbin/mizyun-host-watch
   install -m 0755 -o root -g root pull-backups-from-hetzner.sh /usr/local/sbin/mizyun-backup-pull
   install -m 0644 -o root -g root mizyun-alert@.service mizyun-host-watch.service mizyun-host-watch.timer /etc/systemd/system/
   install -d -m 0755 /etc/mizyun
   [ -e /etc/mizyun/alerts.env ] || install -m 0600 -o root -g root /dev/null /etc/mizyun/alerts.env
   chown root:root /etc/mizyun/alerts.env && chmod 0600 /etc/mizyun/alerts.env
   nano /etc/mizyun/alerts.env
   ```

   Pi `alerts.env` lines: `MIZYUN_ALERT_WEBHOOK_URL=...`,
   `MIZYUN_HEARTBEAT_URL_BACKUP_PULL=...`, `MIZYUN_WATCH_UNITS=`,
   `MIZYUN_WATCH_DOCKER_HEALTH=false` (keeps the frozen pre-migration stack out
   of the watch) and `MIZYUN_WATCH_DISK_PATHS="/ /srv/mizyun/vm-backups"`.
   Then:

   ```bash
   systemctl show -p NeedDaemonReload mizyun-backup-pull.service   # expect "no"
   systemctl daemon-reload
   systemctl enable --now mizyun-host-watch.timer
   systemctl start mizyun-alert@pi-manual-test.service
   /usr/local/sbin/mizyun-heartbeat backup-pull   # healthchecks.io shows one ping
   ```

9. **Record evidence** (redacted, no URLs): the test alert arrival times,
   the first healthchecks.io pings, the first green uptime checks and the
   `systemctl show` output. Uptime monitoring does not prove backup restore;
   the restore drill below remains separate.

Crash and error reporting for the app and API is not part of this setup; see
the draft [ADR-0085](../adr/0085-crash-error-reporting.md) and #342.

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
