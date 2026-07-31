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

pnpm exec supabase db push --db-url "$MIZYUN_PRODUCTION_DB_URL" --dry-run
pnpm exec supabase db push --db-url "$MIZYUN_PRODUCTION_DB_URL"
migrations_applied=true

sudo -n systemctl restart "$MIZYUN_API_SERVICE"
curl --silent --show-error --fail --max-time 15 \
  "$MIZYUN_LOCAL_API_URL/v1/system/status" >/dev/null

printf '%s\n' "$target_sha" > .git/mizyun-production-sha
trap - ERR
echo "Production promotion succeeded: $target_sha"
