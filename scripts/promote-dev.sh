#!/usr/bin/env bash
set -Eeuo pipefail

# Runs inside the Pi development checkout (/var/lib/mizyun/dev/repo).
# It is invoked by deploy-dev.mjs and must never touch the production stack.

target_sha="${1:-}"
dev_env="${MIZYUN_DEV_ENV_FILE:-/etc/mizyun/dev.env}"
lock_file="${MIZYUN_DEV_LOCK_FILE:-/tmp/mizyun-deploy-dev.lock}"
expected_dir="${MIZYUN_DEV_REMOTE_DIR:-/var/lib/mizyun/dev/repo}"
journal_file=".git/mizyun-dev-release-journal.jsonl"

# 1. Acquire remote concurrency lock
acquire_lock() {
  local lockfile="$1"
  exec 200>"$lockfile"
  if command -v flock >/dev/null 2>&1; then
    if ! flock -n 200; then
      echo "Deployment lock $lockfile is held by another process; aborting." >&2
      exit 75
    fi
  else
    if ! python3 -c 'import sys, fcntl; fcntl.flock(200, fcntl.LOCK_EX | fcntl.LOCK_NB)' 2>/dev/null; then
      echo "Deployment lock $lockfile is held by another process; aborting." >&2
      exit 75
    fi
  fi
}
acquire_lock "$lock_file"

# 2. Guard working directory and reject production paths
current_dir="$(pwd -P)"
if [[ -n "$expected_dir" ]]; then
  expected_dir_canon="$(cd "$expected_dir" 2>/dev/null && pwd -P || echo "$expected_dir")"
  if [[ "$current_dir" != "$expected_dir_canon" ]]; then
    echo "Current directory ($current_dir) does not match expected dev repository ($expected_dir_canon)." >&2
    exit 2
  fi
fi

if [[ "$current_dir" == *"/home/mizyun/mizyun"* ]] || [[ "$current_dir" == "/var/lib/mizyun/repo" ]]; then
  echo "FATAL: Current directory ($current_dir) is the production checkout! Refusing dev promotion." >&2
  exit 2
fi

# 3. Validation of target commit SHA
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

# 4. Cross-environment service guard
if [[ "$MIZYUN_API_SERVICE" == "mizyun-api" ]]; then
  echo "FATAL: Refusing to run dev promotion against production service mizyun-api." >&2
  exit 2
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Refusing development deployment because the Pi dev checkout is dirty." >&2
  exit 2
fi

previous_sha="$(git rev-parse HEAD 2>/dev/null || echo "none")"
migrations_applied=false

record_journal() {
  local status="$1"
  local prev="$2"
  local target="$3"
  local message="$4"
  local ts
  ts="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  local entry
  entry="$(printf '{"timestamp":"%s","status":"%s","targetSha":"%s","previousSha":"%s","service":"%s","migrationsApplied":%s,"message":"%s"}' \
    "$ts" "$status" "$target" "$prev" "$MIZYUN_API_SERVICE" "$migrations_applied" "$message")"
  echo "$entry" >> "$journal_file" 2>/dev/null || true
}

rollback_code() {
  local failure_line="$1"
  echo "Dev promotion failed near line $failure_line; restoring API code $previous_sha." >&2
  if [[ "$previous_sha" != "none" ]]; then
    git checkout --detach "$previous_sha" >/dev/null 2>&1 || true
    pnpm install --frozen-lockfile >/dev/null 2>&1 || true
    sudo -n systemctl restart "$MIZYUN_API_SERVICE" >/dev/null 2>&1 || true

    local rollback_healthy=false
    for _attempt in {1..10}; do
      if curl --silent --show-error --fail --max-time 2 \
        "$MIZYUN_LOCAL_API_URL/v1/health" >/dev/null 2>&1; then
        rollback_healthy=true
        break
      fi
      sleep 1
    done
    if [[ "$rollback_healthy" == true ]]; then
      echo "Rollback to $previous_sha succeeded and API is healthy." >&2
    else
      echo "WARNING: API is unhealthy after rollback to $previous_sha." >&2
    fi
  fi
  if [[ "$migrations_applied" == true ]]; then
    echo "Database migrations are forward-only and were not reverted; inspect compatibility." >&2
  fi
  record_journal "rolled_back" "$previous_sha" "$target_sha" "Failure near line $failure_line; rollback initiated"
}

trap 'rollback_code "$LINENO"' ERR
trap 'rollback_code "$LINENO"; exit 130' INT
trap 'rollback_code "$LINENO"; exit 143' TERM

git fetch --prune origin
git cat-file -e "${target_sha}^{commit}"
git checkout --detach "$target_sha"
pnpm install --frozen-lockfile

# 5. Migration ledger reconciliation (unconditional check against target DB)
echo "Reconciling migration ledger with Dev database..."
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
  rollback_code "$LINENO"
  exit 1
fi

printf '%s\n' "$target_sha" > .git/mizyun-dev-sha
record_journal "success" "$previous_sha" "$target_sha" "Dev promotion succeeded"
trap - ERR INT TERM
echo "Development deployment succeeded: $target_sha"
