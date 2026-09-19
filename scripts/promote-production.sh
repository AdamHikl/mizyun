#!/usr/bin/env bash
set -Eeuo pipefail

# Ensure standard input is disconnected from any terminal or stream (fail closed on unexpected prompt)
exec 0</dev/null

# Runs inside the Hetzner Production checkout.
# It is invoked by deploy-remote.mjs and must never be run against the Dev stack.

target_sha="${1:-}"
production_env="${MIZYUN_PRODUCTION_ENV_FILE:-/etc/mizyun/production.env}"
lock_file="${MIZYUN_PRODUCTION_LOCK_FILE:-/run/lock/mizyun-production-maintenance.lock}"
expected_dir="${MIZYUN_REMOTE_DIR:-/var/lib/mizyun/repo}"
journal_file=".git/mizyun-production-release-journal.jsonl"
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

# 2. Validation of target commit SHA
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

# 3. Cross-environment service guard
normalized_service="${MIZYUN_API_SERVICE%.service}"
if [[ "$normalized_service" == "mizyun-api-dev"* ]]; then
  echo "FATAL: Refusing to run production promotion against dev service $MIZYUN_API_SERVICE." >&2
  exit 2
fi

if [[ "$MIZYUN_PRODUCTION_DB_URL" =~ :5433(/|\?|$) ]]; then
  echo "FATAL: MIZYUN_PRODUCTION_DB_URL points to dev database port 5433! Refusing production promotion." >&2
  exit 2
fi

# 4. Working directory and environment guards
current_dir="$(pwd -P)"
if [[ "$current_dir" == *"/dev/"* ]] || [[ "$current_dir" == *"-dev/"* ]] || [[ "$current_dir" == *"/dev/repo"* ]]; then
  echo "FATAL: Current directory ($current_dir) is a dev checkout! Refusing production promotion." >&2
  exit 2
fi

if [[ -n "$expected_dir" ]]; then
  expected_dir_canon="$(cd "$expected_dir" 2>/dev/null && pwd -P || echo "$expected_dir")"
  if [[ "$current_dir" != "$expected_dir_canon" ]]; then
    echo "Current directory ($current_dir) does not match expected production repository ($expected_dir_canon)." >&2
    exit 2
  fi
fi

if [[ "${NODE_ENV:-}" != "production" ]]; then
  echo "Refusing promotion because NODE_ENV is not production." >&2
  exit 2
fi

if [[ ! "$MIZYUN_PRODUCTION_DB_URL" =~ ^postgres(ql)?://[^/@]+:[^/@]+@127\.0\.0\.1:5432/postgres([?].*)?$ ]]; then
  echo "FATAL: MIZYUN_PRODUCTION_DB_URL must be the canonical localhost:5432 Production database URL." >&2
  exit 2
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Refusing promotion because the remote checkout is dirty." >&2
  exit 2
fi

previous_sha="$(git rev-parse HEAD)"
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
  local rollback_ok=true
  echo "Promotion failed near line $failure_line; restoring API code $previous_sha." >&2
  git checkout --detach "$previous_sha" >/dev/null 2>&1 || rollback_ok=false
  pnpm install --frozen-lockfile >/dev/null 2>&1 || rollback_ok=false
  sudo -n systemctl restart "$MIZYUN_API_SERVICE" >/dev/null 2>&1 || rollback_ok=false

  local rollback_healthy=false
  local rollback_attempts="${MIZYUN_HEALTH_RETRIES:-40}"
  local rollback_sleep="${MIZYUN_HEALTH_SLEEP:-1}"
  for _attempt in $(seq 1 "$rollback_attempts"); do
    if curl --silent --show-error --fail --max-time 2 \
      "$MIZYUN_LOCAL_API_URL/v1/health" >/dev/null 2>&1; then
      rollback_healthy=true
      break
    fi
    sleep "$rollback_sleep"
  done
  if [[ "$rollback_ok" == true && "$rollback_healthy" == true ]]; then
    echo "Rollback to $previous_sha succeeded and API is healthy." >&2
    record_journal "rolled_back" "$previous_sha" "$target_sha" "Failure near line $failure_line; rollback succeeded"
  else
    echo "WARNING: API is unhealthy after rollback to $previous_sha." >&2
    record_journal "rollback_failed" "$previous_sha" "$target_sha" "Failure near line $failure_line; rollback health check failed"
  fi
  if [[ "$migrations_applied" == true ]]; then
    echo "Database migrations are forward-only and were not reverted; inspect compatibility." >&2
  fi
}

trap 'rollback_code "$LINENO"' ERR
trap 'rollback_code "$LINENO"; exit 130' INT
trap 'rollback_code "$LINENO"; exit 143' TERM

git fetch --prune origin main
git cat-file -e "${target_sha}^{commit}"
git merge-base --is-ancestor "$target_sha" origin/main
git checkout --detach "$target_sha"
pnpm install --frozen-lockfile

# 5. Mandatory encrypted off-host-ready backup before schema mutation.
# The root-owned unit performs the bounded write freeze and creates an atomic
# encrypted export without granting the deploy user Docker/root access.
sudo -n systemctl start mizyun-backup-for-deploy.service

# 6. Reconcile database migration ledger unconditionally
production_db_url="$MIZYUN_PRODUCTION_DB_URL"
if [[ "${MIZYUN_PRODUCTION_DB_DIRECT_CONTAINER:-true}" == "true" ]]; then
  if [[ "$MIZYUN_DB_CONTAINER" != "supabase-db" ]]; then
    echo "Unexpected Production database container: $MIZYUN_DB_CONTAINER" >&2
    exit 2
  fi
  db_container_ip="$(sudo -n /usr/local/sbin/mizyun-production-db-ip)"
  if [[ ! "$db_container_ip" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
    echo "could not resolve exactly one IPv4 address for database container: $MIZYUN_DB_CONTAINER" >&2
    exit 2
  fi
  production_db_url="$(printf '%s' "$production_db_url" | sed "s#@127.0.0.1:5432/#@$db_container_ip:5432/#")"
fi
export PGSSLMODE="$MIZYUN_PRODUCTION_DB_SSLMODE"

echo "Reconciling migration ledger with Production database..."
pnpm exec supabase db push --db-url "$production_db_url" --dry-run --yes
pnpm exec supabase db push --db-url "$production_db_url" --yes
migrations_applied=true

sudo -n systemctl restart "$MIZYUN_API_SERVICE"
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
  echo "Production API did not become healthy within ${max_attempts} attempts." >&2
  rollback_code "$LINENO"
  exit 1
fi

printf '%s\n' "$target_sha" > .git/mizyun-production-sha
record_journal "success" "$previous_sha" "$target_sha" "Production promotion succeeded"
trap - ERR INT TERM
echo "Production promotion succeeded: $target_sha"
