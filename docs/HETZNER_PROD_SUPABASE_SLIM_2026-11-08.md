# Production Supabase services disabled to free RAM (2026-11-08)

Adam asked to remove the unused parts of the Production self-hosted Supabase
stack on the Hetzner CX23 to reduce memory use, and approved disabling Studio,
Meta, Realtime and Edge Functions.

## Before

- VM: 3,819 MiB RAM, no swap; 760 MiB available.
- Container memory: Studio 227 MiB, Realtime 192 MiB, Meta 113 MiB, Edge
  Functions 26 MiB (about 558 MiB in total).

## Evidence that they are unused

- Kong log window since the 02:15Z backup restart: only `/rest/v1`, `/auth/v1`
  and `/storage/v1/status` requests; no `/realtime`, `/functions`, `/pg` or
  dashboard requests.
- `volumes/functions` holds only the upstream `hello` template and `main`.
- No app, API or script code opens Realtime channels, invokes Edge Functions,
  or calls pg-meta or Studio (independent Opus review of
  `deploy/hetzner/docker-compose.private.yml`; no blockers).
- Backup, recovery, deploy and host-watch scripts look only for `supabase-db`
  and the API health endpoint.
- The Dev stack already runs without these four services.

## Change

- `deploy/hetzner/docker-compose.private.yml` (installed as
  `/srv/mizyun/supabase/docker-compose.vm-private.yml`) puts `studio`, `meta`,
  `realtime` and `functions` behind a `disabled` profile and resets Kong's
  `depends_on` (upstream Kong depends on Studio). Previous file kept on the VM
  as `docker-compose.vm-private.yml.before-slim-<UTC timestamp>`.
- Because the nightly backup only stops the services Compose lists, the four
  containers were removed (`docker compose --profile disabled rm -sf ...`) so
  their database sessions cannot fail the backup's write-freeze check.
- Kong now returns 503 for the Realtime, Functions, `/pg` and dashboard routes.
- Kept: db, auth, rest, storage, kong, imgproxy (storage image transformation
  is enabled) and supavisor (owns `127.0.0.1:5432`, used by
  `MIZYUN_PRODUCTION_DB_URL` for community maintenance and promotion).

## Steps and results (2026-11-08 UTC)

1. Validated the candidate with `docker compose config` on the VM: services
   auth, db, imgproxy, kong, rest, storage, supavisor; Kong and Supavisor ports
   still bound to `127.0.0.1`.
2. `mizyun-backup.service` 19:46:14Z–19:47:27Z: Result=success; public API
   health 200 afterwards.
3. Installed the override, removed the four containers and ran
   `docker compose up -d --wait`: all seven Production containers healthy.
4. Checks: Kong `/auth/v1/health` 200, `/auth/v1/settings` 200, REST table read
   200, `/storage/v1/status` 200, `/realtime/v1/api/ping` 503 (expected);
   public `mizyun-api.phiskel.com/v1/health` 200 and
   `mizyun-supabase.phiskel.com/auth/v1/health` 200; `mizyun-supabase`,
   `mizyun-api` and `cloudflared` active; live app traffic through Kong
   returned 200/204.
5. After: 1,371 MiB available (from 760 MiB).

## Not verified

- The next scheduled backup (2026-11-09 02:15Z) with the new service list.
- Signed-in Production device journeys after the change.

## Rollback

Restore the `before-slim` override on the VM (or remove the four profile
entries) and run `sh run.sh start` in `/srv/mizyun/supabase`.

## Possible follow-up

Supavisor (about 160–180 MiB) could be replaced by binding the db container to
`127.0.0.1:5432` directly, as Dev does. That needs retesting of community
maintenance, `promote-production.sh` and the backup client check.
