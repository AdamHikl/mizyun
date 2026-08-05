# Development and Windows production runbook

This is the operating guide for keeping Mizyun development on the MacBook and
the persistent founder-production environment on the Windows PC. Read this in
future sessions before starting, promoting, restoring, or debugging the backend.

The PC environment is suitable for Adam's private/founder alpha. It is not yet
release-grade production for paying users: one Windows PC is still one failure
domain, and the backup/restore, monitoring, SMTP, patching, and second-operator
gates in [`INFRASTRUCTURE_EVOLUTION_PLAN.md`](../INFRASTRUCTURE_EVOLUTION_PLAN.md)
remain mandatory.

## The separation contract

| Concern       | MacBook development                       | Windows PC production                                    |
| ------------- | ----------------------------------------- | -------------------------------------------------------- |
| Purpose       | coding, destructive resets, tests         | persistent daily-use data                                |
| Supabase      | CLI local stack; development only         | official self-hosted Docker Compose stack in Ubuntu/WSL2 |
| API           | `pnpm dev:api`, watch mode                | `mizyun-api.service`, production mode                    |
| Configuration | ignored repository `.env`                 | `/etc/mizyun/production.env`, outside Git                |
| Database      | disposable; `pnpm db:verify` may reset it | persistent; reset commands are forbidden                 |
| Source        | normal `main` checkout                    | detached, exact promoted commit                          |
| Public access | none or a temporary trusted-device route  | named Cloudflare Tunnel with HTTPS                       |
| Data movement | synthetic fixtures only                   | never copied back to development                         |

Three rules prevent accidental cross-environment damage:

1. Never run `pnpm db:reset`, `pnpm db:verify`, `supabase reset.sh`, or
   `docker compose down -v` on the PC.
2. Never copy PC secrets or real records into the Mac development environment.
3. Promote only with `pnpm deploy:remote`; do not manually pull and restart.

`NODE_ENV=production` also fails closed in code unless durable Supabase URL,
publishable-key, and service-role configuration are present. The deterministic
vision stub is forbidden in production.

## Daily Mac development

Use the normal local loop:

```bash
cd /Users/adam/Documents/mizyun
git status --short --branch
pnpm db:start
pnpm dev:api
pnpm dev:mobile
```

The ignored root `.env` contains only Mac development values. Use
[`LOCAL_BACKEND.md`](./LOCAL_BACKEND.md) to create it. Local data can be reset at
any time:

```bash
pnpm db:verify
```

Do not point the development mobile build at the PC merely to test unfinished
code. The phone can hold both apps simultaneously: the Dev build uses
`com.mizyun.dev`/`mizyun-dev://`, while the Production build uses
`com.mizyun.app`/`mizyun://`. Build each variant with its own ignored endpoint
file and never reuse a production publishable key in the Dev file.

For Dev, copy `apps/mobile/env.dev.example` to `apps/mobile/.env.local` and
fill in the Mac's reachable development URLs. Add
`mizyun-dev://auth/callback` to the Mac Supabase Auth redirect allow-list.
For Production, copy `apps/mobile/env.production.example` to
`apps/mobile/.env.local` and fill in the PC's publishable key:

```dotenv
EXPO_PUBLIC_API_URL=https://mizyun-api.phiskel.com
EXPO_PUBLIC_SUPABASE_URL=https://mizyun-supabase.phiskel.com
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<production-publishable-key>
EXPO_PUBLIC_AUTH_REDIRECT_URI=mizyun://auth/callback
```

Select the native app identity at build time. Regenerate the ignored native
project before switching variants; `expo run:ios` reuses an existing project
and otherwise keeps its previous bundle ID:

```bash
MIZYUN_APP_VARIANT=dev pnpm --filter @mizyun/mobile exec expo prebuild --clean --platform ios
MIZYUN_APP_VARIANT=dev pnpm --filter @mizyun/mobile exec expo run:ios
MIZYUN_APP_VARIANT=production pnpm --filter @mizyun/mobile exec expo prebuild --clean --platform ios
MIZYUN_APP_VARIANT=production pnpm --filter @mizyun/mobile exec expo run:ios --configuration Release
```

Use the equivalent `expo run:android` command for Android. The two bundle IDs
and schemes make the installs independent; each app has its own SecureStore
session and its own Supabase database. Only the publishable key belongs in the
mobile build. The local iOS Dev variant deliberately removes the APNs
entitlement because Apple Personal Teams cannot provision Push Notifications;
Production retains the notification capability. On first install from a
Personal Team, enable Developer Mode and trust the developer profile on the
iPhone before launching.

A Production-endpoint build signed directly to an iPhone with an Apple Personal
Team also needs the local signing override because Personal Teams cannot
provision APNs. This does not change normal Production/distribution builds:

```bash
MIZYUN_IOS_DISABLE_PUSH=1 MIZYUN_APP_VARIANT=production pnpm --filter @mizyun/mobile exec expo prebuild --clean --platform ios
MIZYUN_IOS_DISABLE_PUSH=1 MIZYUN_APP_VARIANT=production pnpm --filter @mizyun/mobile exec expo run:ios --configuration Release
```

## One-time Windows PC setup

### 1. Install and start Ubuntu/WSL2

From Administrator PowerShell:

```powershell
wsl --install -d Ubuntu
wsl --update
```

Restart Windows if requested. In Ubuntu, verify `systemd`:

```bash
systemctl status
```

Current Ubuntu installations use `systemd` by default. If this installation
does not, follow Microsoft's WSL systemd guide linked in the research log.

Create a dedicated operator account if the Ubuntu account is not already named
`mizyun`:

```bash
sudo adduser mizyun
sudo usermod -aG sudo mizyun
```

All remaining Linux commands run as `mizyun`. Keep the repository in the WSL
ext4 filesystem (`/home/mizyun`), not under `/mnt/c`, for correct permissions and
Docker performance.

### 2. Install the Linux runtime

Inside Ubuntu, install Git, Docker Engine/Compose, Node 22+, Corepack/pnpm,
PostgreSQL client tools, curl, and Tailscale. Use the current official vendor
instructions rather than copying old package URLs from a prior session.

Tailscale inside WSL provides the private SSH path used by the Mac. Install and
enable OpenSSH in Ubuntu, then add the Mac deploy public key to
`/home/mizyun/.ssh/authorized_keys`. Configure this alias on the Mac:

```sshconfig
Host mizyun-pc
    HostName <WSL-Tailscale-name-or-IP>
    User mizyun
    IdentityFile ~/.ssh/id_ed25519_mizyun
```

Verify from the Mac:

```bash
ssh mizyun-pc 'systemctl is-system-running'
```

### 3. Install official self-hosted Supabase

The Supabase CLI stack (`supabase start`) is development-only and must not be
publicly exposed. On the PC use Supabase's official self-hosted Docker setup:

```bash
sudo mkdir -p /srv/mizyun
sudo chown -R mizyun:mizyun /srv/mizyun
cd /srv/mizyun
curl -fsSL https://supabase.link/setup.sh -o setup-supabase.sh
less setup-supabase.sh
sh setup-supabase.sh
```

The installer currently creates `supabase-project` by default. Ensure the final
directory is `/srv/mizyun/supabase` (rename the generated directory before first
start if necessary). Configure strong unique secrets, the production public
Supabase HTTPS URL, `mizyun://auth/callback`, and the project's real domain. Do
not expose Postgres or Studio publicly. Keep the generated Compose `.env`
readable only by `mizyun`:

```bash
chmod 0600 /srv/mizyun/supabase/.env
cd /srv/mizyun/supabase
sh run.sh start
docker compose ps
```

Do not run Supabase's `reset.sh` after this environment becomes authoritative;
it deletes the database and Storage volumes.

### 4. Clone Mizyun and install the service units

```bash
git clone <canonical-repository-url> /home/mizyun/mizyun
cd /home/mizyun/mizyun
corepack enable
pnpm install --frozen-lockfile

sudo cp deploy/windows-wsl/mizyun-supabase.service /etc/systemd/system/
sudo cp deploy/windows-wsl/mizyun-api.service /etc/systemd/system/
sudo systemctl daemon-reload
```

Allow the deploy account to restart only the Mizyun API without an interactive
sudo prompt:

```bash
echo 'mizyun ALL=(root) NOPASSWD: /usr/bin/systemctl restart mizyun-api' \
  | sudo tee /etc/sudoers.d/mizyun-deploy >/dev/null
sudo chmod 0440 /etc/sudoers.d/mizyun-deploy
sudo visudo --check --file=/etc/sudoers.d/mizyun-deploy
```

Copy the production environment template outside the repository and replace
every placeholder without printing secrets:

```bash
sudo mkdir -p /etc/mizyun /srv/mizyun/backups
sudo cp deploy/windows-wsl/production.env.example /etc/mizyun/production.env
sudo chown root:mizyun /etc/mizyun/production.env
sudo chmod 0640 /etc/mizyun/production.env
sudoedit /etc/mizyun/production.env
```

The API's `SUPABASE_URL` stays internal (`http://127.0.0.1:8000`). The database
URL is used only by the promotion tool to apply pending migrations. Percent-
encode special characters in its password.

### Founder-alpha Auth email exception

The single-founder environment currently sets
`ENABLE_EMAIL_AUTOCONFIRM=true`. Account creation therefore issues a confirmed
session without sending email. This is an explicitly accepted founder-alpha
exception because the template `supabase-mail:2500` SMTP host does not exist in
the production Compose stack.

This setting is not acceptable for design partners or external release: it does
not prove mailbox ownership, and password recovery cannot work without outbound
email. Before design-partner beta, AUTH-SMTP-001 must configure a dedicated
transactional provider and domain authentication for
`Mizyun <no-reply@phiskel.com>`, prove confirmation and recovery on physical
devices, and restore `ENABLE_EMAIL_AUTOCONFIRM=false`. Do not use a personal
mailbox as the external product sender.

Enable Supabase. Leave the API unit installed but not enabled until the first
promotion has applied the application migrations:

```bash
sudo systemctl enable --now mizyun-supabase
systemctl status mizyun-supabase --no-pager
```

### 5. Configure the HTTPS tunnel

Install `cloudflared` inside Ubuntu from Cloudflare's official repository. Use a
named tunnel with two public hostnames and no Studio route:

```yaml
tunnel: <tunnel-uuid>
credentials-file: /home/mizyun/.cloudflared/<tunnel-uuid>.json
ingress:
  - hostname: <production-api-host>
    service: http://127.0.0.1:4000
  - hostname: <production-supabase-host>
    service: http://127.0.0.1:8000
  - service: http_status:404
```

Install it as a systemd service and verify both HTTPS endpoints externally. Do
not route Postgres, SSH, or Studio through the public tunnel.

Run the first promotion from the Mac using the procedure below. It applies the
initial migrations and starts the API. After its public smoke test passes,
enable the API for future reboots on the PC:

```bash
sudo systemctl enable mizyun-api
```

### 6. Make WSL start after a Windows reboot

Create a Windows Task Scheduler task that runs at system startup with highest
privileges and executes:

```text
wsl.exe -d Ubuntu --exec /bin/true
```

This starts the WSL distribution; its enabled systemd services start the Docker
stack, API, Tailscale, and Cloudflare Tunnel. Disable Windows sleep/hibernate for
this always-on PC. Reboot once and verify from another device before trusting it:

```bash
curl --fail https://<production-api-host>/v1/health
ssh mizyun-pc 'systemctl is-active mizyun-supabase mizyun-api cloudflared tailscaled'
```

## Promoting a tested Mac version

Promotion deploys one immutable Git commit. It never resets production.

1. Finish the feature on the Mac and commit it to `main`.
2. Ensure Docker and the Mac development Supabase stack are running.
3. Set the public production API URL in the Mac shell.
4. Run the promotion command:

```bash
export MIZYUN_PRODUCTION_API_URL=https://<production-api-host>
pnpm deploy:remote --dry-run
pnpm deploy:remote
```

The command:

1. requires a clean Mac `main` checkout;
2. runs `pnpm check` and destructive database verification only on the Mac;
3. pushes the exact commit to `origin/main`;
4. tells the PC to fetch that exact commit;
5. creates a database and private-Storage backup on the PC;
6. when migration files changed, previews and applies only pending migrations
   using `supabase db push`; when they did not change, records that fact and
   skips the unnecessary database connection. On
   the founder PC, the script resolves `supabase-db` directly and sets
   `PGSSLMODE=disable` because the published Supavisor port is not configured
   with a tenant identifier;
7. restarts the production API and smoke-tests it internally and publicly.

The PC records the deployed SHA in `.git/mizyun-production-sha`:

```bash
ssh mizyun-pc 'cd /home/mizyun/mizyun && cat .git/mizyun-production-sha'
```

Never promote uncommitted files. A migration must be forward-only and compatible
with the previously running API because schema rollback is not automatic.

## Routine operation

Check production without changing it:

```bash
curl --fail https://<production-api-host>/v1/health
ssh mizyun-pc 'systemctl status mizyun-api mizyun-supabase --no-pager'
ssh mizyun-pc 'journalctl -u mizyun-api -n 100 --no-pager'
ssh mizyun-pc 'cd /home/mizyun/mizyun && cat .git/mizyun-production-sha'
```

Create an extra backup before risky maintenance:

```bash
ssh mizyun-pc 'cd /home/mizyun/mizyun && bash scripts/backup-production.sh'
```

The backup directory must be on a different disk from the live Supabase files.
Copy encrypted backups off the PC before allowing anyone besides Adam to rely on
the service. A backup is not accepted until a restore drill verifies both the
database dump and private Storage archive.

After Windows, Docker, Supabase, Node, or tunnel updates, rerun the reboot test
and an authenticated synthetic mobile journey. Never update all layers at once.

## Failure and rollback

- If Mac verification fails, nothing is pushed or changed on the PC.
- If backup or migration preview fails, the API keeps serving the previous code.
- If API restart/smoke fails, the remote script checks out and restarts the
  previous code commit.
- Applied database migrations are not automatically reversed. Forward/backward
  compatible migrations are therefore required.
- To take production offline without deleting data:

  ```bash
  ssh mizyun-pc 'sudo systemctl stop cloudflared'
  ```

- Never use `git reset --hard`, Supabase `reset.sh`, `db:reset`, `db:verify`, or
  `docker compose down -v` as a production rollback.

## Future-session checklist

At the beginning of a backend session:

1. Read the continuity files required by `AGENTS.md` and this runbook.
2. Check Mac Git state and the deployed PC SHA.
3. Confirm which environment the task targets; default to Mac development.
4. Research current official docs before changing WSL, Docker, Supabase,
   Cloudflare, Tailscale, or systemd configuration.

At the end:

1. Run `pnpm check`, `git diff --check`, and the relevant database gate on Mac.
2. Update `status.md`, `backlog.md`, and the research log.
3. Promote only when explicitly intended; committing is not deployment.
4. Record the promoted SHA, backup path, smoke evidence, and any blocker.
