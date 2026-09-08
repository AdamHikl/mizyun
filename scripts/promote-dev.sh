#!/usr/bin/env bash
set -Eeuo pipefail

# Runs inside the Pi development checkout (/var/lib/mizyun/dev/repo).
# It is invoked by deploy-dev.mjs and must never touch the production stack.

target_sha="${1:-}"
dev_env="${MIZYUN_DEV_ENV_FILE:-/etc/mizyun/dev.env}"

if [[ ! "$target_sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Expected one full 40-character development commit SHA." >&2
  exit 2
fi

if [[ ! -r "$dev_env" ]]; then
  echo "Cannot read $dev_env." >&2
  exit 2
fi

set -a
# shellcheck disable=SC1090
source "$dev_env"
set +a

: "${MIZYUN_DEV_DB_URL:?missing MIZYUN_DEV_DB_URL}"
: "${MIZYUN_DEV_DB_SSLMODE:=disable}"
: "${MIZYUN_API_SERVICE:=mizyun-api-dev}"
: "${MIZYUN_LOCAL_API_URL:=http://127.0.0.1:4100}"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Refusing development deployment because the Pi dev checkout is dirty." >&2
  exit 2
fi

previous_sha="$(git rev-parse HEAD 2>/dev/null || echo "none")"
migrations_applied=false

rollback_code() {
  local failure_line="$1"
  echo "Dev promotion failed near line $failure_line; restoring API code $previous_sha." >&2
  if [[ "$previous_sha" != "none" ]]; then
    git checkout --detach "$previous_sha" >/dev/null 2>&1 || true
    pnpm install --frozen-lockfile >/dev/null 2>&1 || true
    sudo -n systemctl restart "$MIZYUN_API_SERVICE" >/dev/null 2>&1 || true
  fi
  if [[ "$migrations_applied" == true ]]; then
    echo "Database migrations are forward-only and were not reverted; inspect compatibility." >&2
  fi
}
trap 'rollback_code "$LINENO"' ERR

git fetch --prune origin
git cat-file -e "${target_sha}^{commit}"
git checkout --detach "$target_sha"
pnpm install --frozen-lockfile

if [[ "$previous_sha" == "none" ]] || [[ -n "$(git diff --name-only "$previous_sha" "$target_sha" -- supabase/migrations)" ]]; then
  echo "Applying pending migrations to Dev database..."
  dev_db_url="$MIZYUN_DEV_DB_URL"
  if [[ "$dev_db_url" != *"sslmode="* ]]; then
    if [[ "$dev_db_url" == *"?"* ]]; then
      dev_db_url="${dev_db_url}&sslmode=${MIZYUN_DEV_DB_SSLMODE}"
    else
      dev_db_url="${dev_db_url}?sslmode=${MIZYUN_DEV_DB_SSLMODE}"
    fi
  fi
  export PGSSLMODE="$MIZYUN_DEV_DB_SSLMODE"

  pnpm exec supabase db push --db-url "$dev_db_url"
  migrations_applied=true
else
  echo "No migration changes between $previous_sha and $target_sha; skipping database push."
fi

sudo -n systemctl restart "$MIZYUN_API_SERVICE"
api_ready=false
for _attempt in {1..20}; do
  if curl --silent --show-error --fail --max-time 2 \
    "$MIZYUN_LOCAL_API_URL/v1/health" >/dev/null 2>&1; then
    api_ready=true
    break
  fi
  sleep 1
done

if [[ "$api_ready" != true ]]; then
  echo "Dev API did not become healthy within 20 seconds." >&2
  exit 1
fi

printf '%s\n' "$target_sha" > .git/mizyun-dev-sha
trap - ERR
echo "Development deployment succeeded: $target_sha"
