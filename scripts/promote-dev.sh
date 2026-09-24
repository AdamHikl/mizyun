#!/usr/bin/env bash
set -Eeuo pipefail

# Ensure standard input is disconnected from any terminal or stream (fail closed on unexpected prompt)
exec 0</dev/null
export CI=true

# Runs inside the Hetzner development checkout (/var/lib/mizyun/dev/repo).
# It is invoked by deploy-dev.mjs and must never touch the production stack.

target_sha="${1:-}"
dev_env="${MIZYUN_DEV_ENV_FILE:-/etc/mizyun/dev.env}"
lock_file="${MIZYUN_DEV_LOCK_FILE:-/tmp/mizyun-deploy-dev.lock}"
expected_dir="${MIZYUN_DEV_REMOTE_DIR:-/var/lib/mizyun/dev/repo}"
journal_file=".git/mizyun-dev-release-journal.jsonl"
host_role_file="${MIZYUN_DEPLOY_HOST_ROLE_FILE:-/etc/mizyun/host-role}"
expected_host_role="${MIZYUN_EXPECTED_DEPLOY_HOST_ROLE:-hetzner-primary-1d36b436-f4d5-4a29-b249-4153975563f3}"

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

if [[ ! -r "$host_role_file" ]] || [[ "$(cat "$host_role_file")" != "$expected_host_role" ]]; then
  echo "FATAL: This host is not the expected Hetzner deployment authority." >&2
  exit 2
fi

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

# Verify git safe.directory strictly allows only the dev repository and forbids wildcard '*'
global_safe_dirs="$(git config --global --get-all safe.directory 2>/dev/null || true)"
if [[ "$global_safe_dirs" == *"*"* ]]; then
  echo "FATAL: git safe.directory contains unsafe wildcard '*'; must be restricted to $expected_dir." >&2
  exit 2
fi
if [[ -n "$expected_dir" ]] && [[ "$expected_dir" != "/" ]]; then
  if ! git config --global --get-all safe.directory 2>/dev/null | grep -qFx "$expected_dir"; then
    git config --global --add safe.directory "$expected_dir" 2>/dev/null || true
  fi
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
: "${MIZYUN_API_SERVICE:=mizyun-api-dev.service}"
: "${MIZYUN_LOCAL_API_URL:=http://127.0.0.1:4100}"

# 4. Cross-environment service guard
normalized_service="${MIZYUN_API_SERVICE%.service}"
if [[ "$normalized_service" == "mizyun-api" ]]; then
  echo "FATAL: Refusing to run dev promotion against production service $MIZYUN_API_SERVICE." >&2
  exit 2
fi

if [[ "$normalized_service" != "mizyun-api-dev" ]]; then
  echo "FATAL: Refusing dev promotion against unauthorized service $MIZYUN_API_SERVICE (expected mizyun-api-dev or mizyun-api-dev.service)." >&2
  exit 2
fi
service_unit="${normalized_service}.service"

if [[ "$MIZYUN_DEV_DB_URL" =~ :5432(/|\?|$) ]]; then
  echo "FATAL: MIZYUN_DEV_DB_URL points to production database port 5432! Refusing dev promotion." >&2
  exit 2
fi

# Require an explicit, canonical Dev database endpoint. PostgreSQL/libpq uses
# the default port when it is omitted, which could otherwise target Production.
if [[ ! "$MIZYUN_DEV_DB_URL" =~ ^postgres(ql)?://[^/@]+:[^/@]+@127\.0\.0\.1:5433/postgres([?].*)?$ ]]; then
  echo "FATAL: MIZYUN_DEV_DB_URL must be the canonical localhost:5433 Dev database URL." >&2
  exit 2
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Refusing development deployment because the Hetzner Dev checkout is dirty." >&2
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
    "$ts" "$status" "$target" "$prev" "$service_unit" "$migrations_applied" "$message")"
  echo "$entry" >> "$journal_file" 2>/dev/null || true
}

rollback_code() {
  local failure_line="$1"
  local rollback_ok=true
  echo "Dev promotion failed near line $failure_line; restoring API code $previous_sha." >&2
  if [[ "$previous_sha" != "none" ]]; then
    git checkout --detach "$previous_sha" >/dev/null 2>&1 || rollback_ok=false
    CI=true pnpm install --frozen-lockfile >/dev/null 2>&1 || rollback_ok=false
    sudo -n systemctl restart "$service_unit" >/dev/null 2>&1 || rollback_ok=false

    local rollback_healthy=false
    for _attempt in {1..10}; do
      if curl --silent --show-error --fail --max-time 2 \
        "$MIZYUN_LOCAL_API_URL/v1/health" >/dev/null 2>&1; then
        rollback_healthy=true
        break
      fi
      sleep 1
    done
    if [[ "$rollback_ok" == true && "$rollback_healthy" == true ]]; then
      echo "Rollback to $previous_sha succeeded and API is healthy." >&2
      record_journal "rolled_back" "$previous_sha" "$target_sha" "Failure near line $failure_line; rollback succeeded"
    else
      echo "WARNING: API is unhealthy after rollback to $previous_sha." >&2
      record_journal "rollback_failed" "$previous_sha" "$target_sha" "Failure near line $failure_line; rollback health check failed"
    fi
  else
    record_journal "rollback_failed" "$previous_sha" "$target_sha" "Failure near line $failure_line; no previous SHA to restore"
  fi
  if [[ "$migrations_applied" == true ]]; then
    echo "Database migrations are forward-only and were not reverted; inspect compatibility." >&2
  fi
}

trap 'rollback_code "$LINENO"' ERR
trap 'rollback_code "$LINENO"; exit 130' INT
trap 'rollback_code "$LINENO"; exit 143' TERM

# Preflight remote origin configuration
origin_url="$(git remote get-url origin 2>/dev/null || true)"
if [[ -z "$origin_url" ]]; then
  echo "FATAL: git remote 'origin' is not configured." >&2
  exit 2
fi

if [[ "$origin_url" == *"/tmp/"* ]] || [[ "$origin_url" =~ \.bundle$ ]] || [[ "$origin_url" == *"/root/"* ]]; then
  echo "FATAL: git remote 'origin' points to a temporary or root bundle ($origin_url); a durable origin URL is required." >&2
  exit 2
fi

export GIT_SSH_COMMAND="ssh -o BatchMode=yes -o ConnectTimeout=15"
if ! git fetch --prune origin; then
  echo "FATAL: Failed to fetch from origin ($origin_url). Check network and deploy credentials." >&2
  exit 2
fi
git cat-file -e "${target_sha}^{commit}"
git checkout --detach "$target_sha"
CI=true pnpm install --frozen-lockfile

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

pnpm exec supabase db push --db-url "$dev_db_url" --yes
migrations_applied=true

# 6. Sync systemd unit if the template has changed (Q1 isolation)
unit_template="deploy/hetzner/mizyun-api-dev.service"
installed_unit="/etc/systemd/system/mizyun-api-dev.service"
if [[ -f "$unit_template" ]]; then
  template_hash="$(sha256sum "$unit_template" | cut -d' ' -f1)"
  installed_hash="$(sha256sum "$installed_unit" 2>/dev/null | cut -d' ' -f1 || echo "none")"
  if [[ "$template_hash" != "$installed_hash" ]]; then
    echo "FATAL: Installed Hetzner Dev systemd unit does not match the candidate template; install it through the infrastructure workflow first." >&2
    exit 2
  fi
fi

sudo -n systemctl restart "$service_unit"
api_ready=false
max_attempts="${MIZYUN_HEALTH_RETRIES:-40}"
sleep_duration="${MIZYUN_HEALTH_SLEEP:-1}"
for _attempt in $(seq 1 "$max_attempts"); do
  if curl --silent --show-error --fail --max-time 2 \
    "$MIZYUN_LOCAL_API_URL/v1/health" >/dev/null 2>&1; then
    api_ready=true
    break
  fi
  sleep "$sleep_duration"
done

if [[ "$api_ready" != true ]]; then
  echo "Dev API did not become healthy within ${max_attempts} attempts." >&2
  rollback_code "$LINENO"
  exit 1
fi

printf '%s\n' "$target_sha" > .git/mizyun-dev-sha
record_journal "success" "$previous_sha" "$target_sha" "Dev promotion succeeded"
trap - ERR INT TERM
echo "Development deployment succeeded: $target_sha"
