# Self-hosted runbook — INFRA-SELFHOST-001

Operational runbook for the Slovakia PC that runs the alpha-track
Mizyun stack. The local Supabase stack on Adam's Mac remains the
canonical development surface; this runbook is about the shared,
networked, multi-device alpha surface that lives on the PC.

Audience: Adam (operator + engineer) and any future second
operator on-call.

## Why this exists

AI-MOB-001 needs a reachable backend for physical-iPhone integration
testing. ADR-0016 amendment 2026-07-25 commits Mizyun to self-hosted
alpha on the Slovakia PC; ADR-0017 locks AI governance (EU residency,
ZDR, per-feature workspaces, free-vs-paid caps) and requires the
limiter surface to be locked down before any alpha deployment.

## Topology

| Component      | Mac (workstation)                   | Slovakia PC (alpha server)                                  |
| -------------- | ----------------------------------- | ----------------------------------------------------------- |
| Source code    | pnpm workspace + `git push`         | `git pull` via `pnpm deploy:remote`                         |
| Supabase stack | `pnpm db:start` (long-lived on Mac) | `pnpm db:start` (long-lived on PC)                          |
| API process    | `pnpm dev:api` (Fastify watch mode) | Docker container on the PC's docker net                     |
| Tunnel         | none                                | `cloudflared` daemon (named tunnel)                         |
| Backups        | local only (dev sandbox)            | local `pg_dump` + `rclone sync`; **no off-site target yet** |
| Mobile bundle  | dev: `localhost` URLs               | alpha: tunnel URL via `EXPO_PUBLIC_*`                       |

The Mac's daily-dev loop is unchanged. The PC is the
production-shape target for alpha.

## PC provisioning checklist (one-time)

The PC runs Linux (Ubuntu/Debian recommended). Steps run on the
PC itself, not on the Mac.

1. **Install Docker Engine + Compose plugin.**

   ```sh
   sudo apt update
   sudo apt install -y docker.io docker-compose-plugin
   sudo usermod -aG docker $USER
   newgrp docker
   ```

2. **Install the Supabase CLI pinned to `2.109.1`.**

   ```sh
   sudo npm i -g supabase@2.109.1
   supabase --version
   # must report 2.109.1
   ```

3. **Install `cloudflared`** and authenticate:

   ```sh
   # On Debian/Ubuntu the package is `cloudflared` from
   # https://pkg.cloudflare.com/
   sudo apt install -y cloudflared
   cloudflared tunnel login
   ```

4. **Create the named tunnel:**

   ```sh
   cloudflared tunnel create mizyun-alpha
   cloudflared tunnel route dns mizyun-alpha alpha.mizyun.app
   cloudflared tunnel route dns mizyun-alpha supabase-alpha.mizyun.app
   ```

   The first command prints a credentials JSON to
   `~/.cloudflared/<UUID>.json` (mode `0600`). The DNS commands
   bind the hostnames to the tunnel; replace with whatever Adam
   registers.

5. **Configure the tunnel** at `~/.cloudflared/config.yml`:

   ```yaml
   tunnel: mizyun-alpha
   credentials-file: /home/mizyun/.cloudflared/<UUID>.json
   ingress:
     - hostname: alpha.mizyun.app
       service: http://localhost:4000
     - hostname: supabase-alpha.mizyun.app
       service: http://localhost:54321
     - service: http_status:404
   ```

6. **Run the tunnel as a systemd service** so it survives reboots:

   ```sh
   sudo cloudflared service install
   sudo systemctl enable cloudflared
   sudo systemctl start cloudflared
   cloudflared tunnel info mizyun-alpha
   # must report "HEALTHY"
   ```

7. **Initialise the Supabase project** on the PC:

   ```sh
   git clone <mizyun-repo> ~/mizyun
   cd ~/mizyun
   pnpm install
   supabase start
   # capture the printed API URL, anon key, service_role key
   ```

8. **Apply migrations** from the local checkout (this is what
   `pnpm deploy:remote` does end-to-end; for the first time, run
   it manually so Adam sees the output):

   ```sh
   pnpm db:push
   ```

9. **Configure `~/.cloudflared/alpha.env`** (mode `0600`):

   ```sh
   SUPABASE_PROJECT_REF=alpha
   SUPABASE_DB_PASSWORD=<from supabase start output>
   SUPABASE_URL=http://localhost:54321
   SUPABASE_PUBLISHABLE_KEY=<anon key from supabase start>
   SUPABASE_SERVICE_ROLE_KEY=<service_role key from supabase start>
   MISTRAL_API_KEY=<mizyun-text-coach workspace key>
   MISTRAL_VISION_API_KEY=<mizyun-vision-draft workspace key>
   MISTRAL_MODEL=mistral-medium-latest
   MISTRAL_VISION_MODEL=<release-pinned dated vision model>
   AI_EXTERNAL_ACCESS=false
   API_PORT=4000
   MIZYUN_ALLOWED_ORIGINS=https://alpha.mizyun.app
   chmod 600 ~/.cloudflared/alpha.env
   ```

10. **Start the API under systemd** so it survives reboots. The
    simplest path is a systemd unit that runs `pnpm start`:

    ```ini
    # /etc/systemd/system/mizyun-api.service
    [Unit]
    Description=Mizyun API
    After=docker.service
    Requires=docker.service

    [Service]
    Type=simple
    User=mizyun
    WorkingDirectory=/home/mizyun/mizyun
    EnvironmentFile=/home/mizyun/.cloudflared/alpha.env
    ExecStart=/usr/bin/pnpm start --filter @mizyun/api
    Restart=on-failure

    [Install]
    WantedBy=multi-user.target
    ```

    ```sh
    sudo systemctl daemon-reload
    sudo systemctl enable --now mizyun-api
    sudo systemctl status mizyun-api
    ```

11. **Verify the tunnel + API end-to-end** from the Mac:

    ```sh
    curl https://alpha.mizyun.app/v1/system/status
    # must return {"status":"ok",...} with a 200
    ```

## Local operator setup (Mac)

The repo's gitignored root `.env` carries the local-dev secrets
only. The PC-side secrets stay on the PC.

```sh
echo 'SUPABASE_URL=http://127.0.0.1:54321' >> .env
echo 'SUPABASE_PUBLISHABLE_KEY=<anon>' >> .env
echo 'SUPABASE_SERVICE_ROLE_KEY=<service_role>' >> .env
echo 'MISTRAL_API_KEY=<text-coach workspace>' >> .env
chmod 600 .env
```

For tunnel-routed deploys, the Mac also needs the SSH key:

```sh
ssh-keygen -t ed25519 -N '' -f ~/.ssh/id_ed25519_mizyun
# add the public key to the PC's ~/.ssh/authorized_keys for user `mizyun`
```

Add the SSH alias at `~/.ssh/config`:

```
Host mizyun-pc
    HostName <pc-lan-ip-or-domain>
    User mizyun
    IdentityFile ~/.ssh/id_ed25519_mizyun
```

## Deploying from Mac

```sh
pnpm deploy:remote
```

The script:

1. Verifies the local tree is clean, the SSH alias works, and the
   PC tunnel reports HEALTHY.
2. `git push` to the canonical remote (so the PC's `git pull` is
   not blocked by missing refs).
3. SSHes into the PC and runs:
   - `cd ~/mizyun && git pull --ff-only`
   - `pnpm install --frozen-lockfile`
   - `pnpm db:verify` (uses local PC stack)
   - `pnpm db:push` (uses local PC stack via the same wrapper
     the hosted version used, but pointed at
     `localhost:54322` via the PC's `~/.cloudflared/alpha.env`)
   - `sudo systemctl restart mizyun-api`
4. Smoke-tests `https://alpha.mizyun.app/v1/system/status` from
   the Mac.

Failure modes and rollback:

- If `git pull` fails (local PC has commits the Mac doesn't), the
  script aborts before any migrations.
- If `pnpm db:verify` fails, the script aborts before
  `db:push` — the PC's stack stays at the last-known-good
  migration.
- If `db:push` fails, the script prints the last-known-good
  migration hash so Adam can `pnpm db:reset --local` on the Mac
  and re-run.
- If the smoke test fails, Adam can `ssh mizyun-pc 'sudo
systemctl restart mizyun-api'` to pick up the last-known-good
  commit (since `git pull --ff-only` only fast-forwards).

## Verifying the alpha track

Per ADR-0017 + AI-OPS-002, after the first `db:push`, verify the
limiter ACL against the live PC database:

```sh
ssh mizyun-pc "PGPASSWORD=$SUPABASE_DB_PASSWORD psql -h localhost -p 54322 -U postgres -d postgres -c \"select proname, proacl from pg_proc where pronamespace = 'public'::regnamespace and proname like 'ai_%';\""
```

Expected: every row shows `{service_role=X/postgres,
postgres=X/postgres}` with **no PUBLIC grant**. If PUBLIC is
present, add an emergency migration revoking PUBLIC and re-run
`pnpm db:verify`.

Verify the `private-media` bucket:

```sh
ssh mizyun-pc "PGPASSWORD=$SUPABASE_DB_PASSWORD psql -h localhost -p 54322 -U postgres -d postgres -c \"select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'private-media';\""
```

Expected: `public = false`, `file_size_limit = 15728640`,
`allowed_mime_types = {image/jpeg, image/png, image/webp}`. If
any field differs, the migration's `ON CONFLICT DO NOTHING`
skipped the insert because the bucket already existed; apply
the correct settings via the Storage dashboard.

## AI limiter smoke against the tunnel

```sh
SUPABASE_URL=https://alpha.mizyun.app \
SUPABASE_PUBLISHABLE_KEY=<anon key> \
  bash scripts/ai-ops-001-smoke.sh
```

The script does not bootstrap the disposable user — provision
via the Auth API once, then re-run the smoke on every deploy:

```sh
curl -X POST https://alpha.mizyun.app/auth/v1/signup \
  -H "apikey: <anon key>" \
  -H "Content-Type: application/json" \
  -d '{"email":"smoke+ai-ops-001@mizyun.test","password":"smoke-only-do-not-reuse"}'
```

Free-tier 4th request returns 429; paid-tier 4th request returns 200.

## Cascade deletion drill

Once a quarter, exercise the cascade path against the alpha:

```sh
ssh mizyun-pc "PGPASSWORD=$SUPABASE_DB_PASSWORD psql -h localhost -p 54322 -U postgres -d postgres -c \"set local role service_role; delete from auth.users where id = '<disposable-user-id>';\""
```

Verify the cascade deletes `profiles`, `goals`,
`body_measurements`, `food_entries`, `exercises`, `workouts`,
`workout_sets`, `conversations`, `messages`, `memory_items`,
`media_assets`, `memory_provider_refs`, and the four AI limiter
rows.

## Local backups (alpha only — no off-site target)

Per ADR-0016 amendment 2026-07-25, Adam accepts the single-host
risk for alpha. Local backups run on the PC:

```sh
# Postgres logical dump — run nightly via cron
ssh mizyun-pc "pg_dump -h localhost -p 54322 -U postgres -d postgres | gzip > ~/backups/mizyun-\$(date +%F).sql.gz"

# private-media storage bytes — rclone to a local mirror disk
ssh mizyun-pc "rclone sync /var/lib/docker/volumes/supabase_storage/_data ~/backups/storage/ --progress"
```

A hardware failure on the PC loses user data. Reversed by
INFRA-PORT-001.

## Locking down Supabase Studio

`cloudflared` exposes Supabase Studio on
`supabase-alpha.mizyun.app`. Without auth in front, anyone with
the URL can hit `/login`. **Before any non-self user gets the
URL**, add Cloudflare Access:

1. Cloudflare Zero Trust dashboard → Access → Applications.
2. Add a self-hosted app for `supabase-alpha.mizyun.app`.
3. Allow only Adam's email (and any future operator).
4. Cloudflare Access presents a one-time-pin / IdP login before
   the Studio loads.

This is a follow-up after the alpha smoke; not strictly required
while only Adam knows the URL.

## What's out of scope (deferred)

- Off-site backup target — INFRA-PORT-001.
- PITR or managed-style durability — INFRA-PORT-001.
- Second operator + on-call rotation — INFRA-PORT-001.
- Migrating alpha users to managed Supabase — INFRA-PORT-001
  (or a new INFRA-CUTOVER-001 segment).
- Mobile bundle signing pipeline (`eas build` on Mac) — runs in
  AI-MOB-002 segment.
- A real domain + DNS — Adam's call; once a domain is bound the
  tunnel hostnames in this runbook change accordingly.

## Rollback

If the alpha goes bad:

1. Adam stops the tunnel: `sudo systemctl stop cloudflared`.
   The API and Supabase stay up on `localhost` for debug access.
2. The Mac can still `pnpm dev:api` against the local Supabase
   stack — no functional break.
3. To revert to a known-good commit, SSH into the PC, `cd
~/mizyun && git checkout <good-sha>` and `sudo systemctl
restart mizyun-api`.
4. No off-site backup means no restore from a hardware failure —
   Adam accepts this for alpha.
