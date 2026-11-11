# Hetzner RAM reduction, Dev and Production (2026-11-11)

Adam asked to reduce the RAM that Mizyun Dev and Production use on the Hetzner
CX23 (3,819 MiB, no swap) without changing capabilities, and approved four
changes, Dev first. This follows the
[2026-11-08 Production trim](HETZNER_PROD_SUPABASE_SLIM_2026-11-08.md).

## Changes

| #   | Change                                                                                                                                                                                            | Where           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| 1   | Kong runs one nginx worker (`KONG_NGINX_WORKER_PROCESSES: "1"`) instead of one per CPU core                                                                                                       | Dev, Production |
| 2   | Supavisor removed; `supabase-db` binds `127.0.0.1:5432` directly, as Dev does on 5433                                                                                                             | Production      |
| 3   | API units run `cd apps/api && exec node --import tsx src/server.ts` instead of `pnpm --filter @mizyun/api start` (drops the resident pnpm and tsx CLI processes; `WorkingDirectory` is unchanged) | Dev, Production |
| 4   | imgproxy removed; Storage runs with `ENABLE_IMAGE_TRANSFORMATION: "false"`                                                                                                                        | Dev, Production |

Dev Storage `mem_limit` was raised from 150m to 200m: it was running at 143 MiB
of 150 MiB.

## Evidence that the removed parts are unused

- No app, API or package code calls `render/image` or passes `transform` to a
  Storage call; signed URLs are plain object URLs.
- Kong logs for the previous 7 days, both stacks: zero `/storage/v1/render`
  requests.
- Production `pg_stat_activity`: only PostgREST, Auth, Storage, pg_cron/pg_net
  and Supavisor's own sessions. No host process held a connection to 5432 or 6543. `promote-production.sh` already connects to the database container
  directly.
- `MIZYUN_PRODUCTION_DB_URL` keeps its `127.0.0.1:5432` form, so no secret or
  env file changed.

## Repository changes

- `deploy/hetzner/docker-compose.private.yml`: items 1, 2 and 4 for Production.
- `deploy/hetzner/mizyun-api.service`, `mizyun-api-dev.service`: item 3.
- `deploy/raspberry-pi/docker-compose.dev.yml`: repo copy of the Dev stack
  file, same edits as on the VM.
- `scripts/analytics-dashboard/collect.mjs` and its test: the Production
  source guard expects `supabase-db` on loopback 5432 and no pooler.
- `scripts/backup-dev-encrypted.py`: `mizyun-dev-imgproxy` is no longer an
  expected Dev container.

## Dev: applied and verified (15:52–15:57Z)

- VM file `/var/lib/mizyun/dev/supabase/docker-compose.yml`; previous copy
  `docker-compose.yml.before-ram-slim-20261111T155242Z`.
- Unit `/etc/systemd/system/mizyun-api-dev.service`; previous copy
  `/root/mizyun-api-dev.service.before-direct-node-20261111T155414Z`. The
  installed unit and the repo file have the same SHA-256 (`17f9a812…`).
- Five Dev containers healthy; Kong has one worker.
- Kong: `/auth/v1/health` 200, `/auth/v1/settings` 200, `/storage/v1/status`
  200, render route 404 (expected).
- API healthy 5 s after restart; public `mizyun-api-dev.phiskel.com/v1/health`
  200 and public Dev Auth health 200.
- Signed-in smoke with the synthetic Dev account through the public hosts:
  sign-in 200; `/v1/me`, `/v1/profile`, `/v1/exercises`, `/v1/food-entries`,
  `/v1/workouts`, `/v1/photo-backups`, `/v1/readiness` all 200; sign-out 204.
- Memory: Kong 182 → 82 MiB, imgproxy 14 → 0, Storage 143 → 161 MiB (it was
  held down by its limit), API processes 3 → 2 (node plus tsx's esbuild
  helper).

## Production: applied and verified (16:05–16:08Z)

- Backup first: `mizyun-backup.service` 16:05:20Z–16:05:52Z, Result=success,
  archive `20261111T160520Z`. A first attempt at 16:03:43Z failed with
  "Production database still has client sessions after write freeze": the
  containers stopped in under a second and the check ran before Postgres had
  closed their sessions. Production recovered by itself (health 200) and the
  retry passed. The nightly 02:15Z run had succeeded.
- Override `/srv/mizyun/supabase/docker-compose.vm-private.yml`; previous copy
  `docker-compose.vm-private.yml.before-ram-slim-20261111T160612Z`.
- `supabase-pooler` and `supabase-imgproxy` removed, then
  `docker compose up -d --wait` 16:06:13Z–16:06:31Z recreated db, storage and
  kong. Five Production containers healthy; no pooler or imgproxy container
  remains; Kong has one worker.
- Listeners: `127.0.0.1:5432` (db), `127.0.0.1:8000` (Kong), `127.0.0.1:4000`
  (API). Nothing on 6543.
- Unit `/etc/systemd/system/mizyun-api.service`; previous copy
  `/root/mizyun-api.service.before-direct-node-20261111T160653Z`. Only the
  `ExecStart` line and its comment differ from the previous installed unit.
  The repo unit's `OnFailure=mizyun-alert@%n.service` line is still not
  installed, because the alert template is not installed on the VM (#349).
- API healthy 4 s after restart with one node process plus tsx's esbuild
  helper.
- Checks: Kong `/auth/v1/health` 200, `/auth/v1/settings` 200,
  `/storage/v1/status` 200, REST table read 200; public
  `mizyun-api.phiskel.com/v1/health` 200 and `/v1/readiness` 200; public
  Auth health 200; login with `MIZYUN_PRODUCTION_DB_URL` on `127.0.0.1:5432`
  returns `postgres`; `mizyun-supabase`, `mizyun-api` and `cloudflared`
  active; live app traffic through Kong after the change returned 200/204.

## Result

|                                   | Before    | After     |
| --------------------------------- | --------- | --------- |
| VM available RAM                  | 1,326 MiB | 2,025 MiB |
| Production Kong                   | 249 MiB   | 82 MiB    |
| Dev Kong                          | 182 MiB   | 85 MiB    |
| Supavisor                         | 168 MiB   | removed   |
| imgproxy (both)                   | 30 MiB    | removed   |
| Production API (anonymous memory) | 197 MiB   | 129 MiB   |
| Dev API (anonymous memory)        | 219 MiB   | 126 MiB   |

The "after" figures were read about a minute after the restarts; the API and
Storage figures will grow somewhat with uptime. Production Storage read
232 MiB right after its restart (149 MiB before).

## Open items

- `promote-dev.sh` compares the installed Dev unit with the candidate's
  template and aborts on a mismatch, after migrations have run, so every
  later `pnpm deploy:dev` must use a commit that contains these unit files.
  The Dev checkout's copy of `backup-dev-encrypted.py` expects imgproxy until
  the next Dev deploy.
- Independent Opus review of the diff: three blockers, all resolved (the Dev
  backup's working-directory check, now moot because `WorkingDirectory` is
  unchanged; the Dev unit hash check above; pooler removal before recreating
  db, done in that order).
- `pnpm check` PASS on the working tree before commit (input SHA-256
  `926ad9ce…`). Focused tests: collector 11/11, Dev backup 20/20, Hetzner
  operations and deployment safeguards 27/27. `pnpm db:verify` not run (no
  schema change).
- Signed-in Production device journeys were not checked.

## Rollback

Restore the `before-ram-slim` Compose files and the `before-direct-node`
units, run `docker compose up -d --wait` in each stack directory (Production:
`sh run.sh start`), then `systemctl daemon-reload` and restart the two API
units. Postgres data is a bind mount and is not touched by any step.

## Threadfolio backend

`threadfolio-api-dev.service` is one bundled Node process with a 128 MiB heap
cap and `MemoryMax=256M`; it uses 29 MiB and has no wrappers, containers or
gateway. Nothing to remove; left unchanged.

## Not verified

- Signed-in physical-device journeys on either app after the change.
- The Dev backup script on the VM's Dev checkout still lists imgproxy until
  the next `pnpm deploy:dev`; it is a manual tool with no timer.

## Sources

- Kong configuration reference, `nginx_worker_processes` (default `auto`):
  <https://docs.konghq.com/gateway/latest/reference/configuration/>
- tsx Node.js enhancement, `node --import tsx`:
  <https://tsx.is/dev-api/node-cli>
- Docker Compose merge rules, `!reset` and `!override`:
  <https://docs.docker.com/reference/compose-file/merge/>
