#!/usr/bin/env bash
set -Eeuo pipefail

# Runs inside Ubuntu on the Windows production PC. It is invoked by
# deploy-remote.mjs and must never be run against the Mac development stack.

target_sha="${1:-}"
production_env="${MIZYUN_PRODUCTION_ENV_FILE:-/etc/mizyun/production.env}"

if [[ ! "$target_sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Expected one full 40-character production commit SHA." >&2
  exit 2
fi

if [[ ! -r "$production_env" ]]; then
  echo "Cannot read $production_env." >&2
  exit 2
fi

set -a
# shellcheck disable=SC1090
source "$production_env"
set +a

: "${MIZYUN_PRODUCTION_DB_URL:?missing MIZYUN_PRODUCTION_DB_URL}"
: "${MIZYUN_DB_CONTAINER:=supabase-db}"
: "${MIZYUN_PRODUCTION_DB_SSLMODE:=disable}"
: "${MIZYUN_API_SERVICE:=mizyun-api}"
: "${MIZYUN_LOCAL_API_URL:=http://127.0.0.1:4000}"

if [[ "${NODE_ENV:-}" != "production" ]]; then
  echo "Refusing promotion because NODE_ENV is not production." >&2
  exit 2
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Refusing promotion because the PC checkout is dirty." >&2
  exit 2
fi

previous_sha="$(git rev-parse HEAD)"
migrations_applied=false

rollback_code() {
  local failure_line="$1"
  echo "Promotion failed near line $failure_line; restoring API code $previous_sha." >&2
  git checkout --detach "$previous_sha" >/dev/null 2>&1 || true
  pnpm install --frozen-lockfile >/dev/null 2>&1 || true
  sudo -n systemctl restart "$MIZYUN_API_SERVICE" >/dev/null 2>&1 || true
  if [[ "$migrations_applied" == true ]]; then
    echo "Database migrations are forward-only and were not reverted; inspect compatibility." >&2
  fi
}
trap 'rollback_code "$LINENO"' ERR

git fetch --prune origin main
git cat-file -e "${target_sha}^{commit}"
git merge-base --is-ancestor "$target_sha" origin/main
git checkout --detach "$target_sha"
pnpm install --frozen-lockfile

# A release backup is mandatory before schema mutation. This backs up the
# database and private Storage bytes without resetting either environment.
bash scripts/backup-production.sh

if [[ -n "$(git diff --name-only "$previous_sha" "$target_sha" -- supabase/migrations)" ]]; then
  # The self-hosted stack publishes Supavisor on localhost, but its tenant
  # routing is intentionally not part of founder production. Resolve the
  # database container directly so migrations do not depend on pooler SNI and
  # use the local Postgres server's non-TLS endpoint.
  production_db_url="$MIZYUN_PRODUCTION_DB_URL"
  if [[ "${MIZYUN_PRODUCTION_DB_DIRECT_CONTAINER:-true}" == "true" ]]; then
    db_container_ip="$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$MIZYUN_DB_CONTAINER")"
    [[ -n "$db_container_ip" ]] || die "could not resolve database container IP: $MIZYUN_DB_CONTAINER"
    production_db_url="$(printf '%s' "$production_db_url" | sed "s#@127.0.0.1:5432/#@$db_container_ip:5432/#")"
  fi
  export PGSSLMODE="$MIZYUN_PRODUCTION_DB_SSLMODE"

  pnpm exec supabase db push --db-url "$production_db_url" --dry-run
  pnpm exec supabase db push --db-url "$production_db_url"
  migrations_applied=true
else
  echo "No migration changes between $previous_sha and $target_sha; skipping database push."
fi

sudo -n systemctl restart "$MIZYUN_API_SERVICE"
api_ready=false
for _attempt in {1..15}; do
  if curl --silent --show-error --fail --max-time 2 \
    "$MIZYUN_LOCAL_API_URL/v1/health" >/dev/null 2>&1; then
    api_ready=true
    break
  fi
  sleep 1
done
if [[ "$api_ready" != true ]]; then
  echo "API did not become healthy within 15 seconds." >&2
  exit 1
fi

printf '%s\n' "$target_sha" > .git/mizyun-production-sha
trap - ERR
echo "Production promotion succeeded: $target_sha"
