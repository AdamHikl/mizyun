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
: "${MIZYUN_API_SERVICE:=mizyun-api.service}"
: "${MIZYUN_LOCAL_API_URL:=http://127.0.0.1:4000}"

# 3. Cross-environment service guard
normalized_service="${MIZYUN_API_SERVICE%.service}"
if [[ "$normalized_service" == "mizyun-api-dev"* ]]; then
  echo "FATAL: Refusing to run production promotion against dev service $MIZYUN_API_SERVICE." >&2
  exit 2
fi
service_unit="${normalized_service}.service"

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
migration_state=not_started
backup_state=not_started
candidate_readiness=not_checked
rollback_readiness=not_checked
rollback_outcome=not_attempted
deployment_environment=production
sha_marker=".git/mizyun-production-sha"

record_journal() {
  local status="$1" prev="$2" target="$3" message="$4"
  local checked_out_sha
  checked_out_sha="$(git rev-parse HEAD)" || return 1
  # Keep this writer inline: the streamed promotion script must keep working
  # after checking out an older candidate that lacks a new helper file.
  if ! node - "$journal_file" "$status" "$prev" "$target" "$service_unit" \
    "$migrations_applied" "$migration_state" "$backup_state" "$candidate_readiness" \
    "$rollback_outcome" "$rollback_readiness" "$checked_out_sha" "$deployment_environment" "$message" <<'JOURNAL_NODE'
const fs = require("node:fs");
const [file, status, previousSha, targetSha, service, migrationsApplied, migrationState,
  backupState, readinessResult, rollbackOutcome, rollbackReadiness, checkedOutSha,
  environment, message] = process.argv.slice(2);
let fd;
let originalSize;
try {
  fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT |
    fs.constants.O_APPEND | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK, 0o600);
  const stat = fs.fstatSync(fd);
  if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.geteuid() || (stat.mode & 0o022)) {
    throw new Error("unsafe journal file");
  }
  originalSize = stat.size;
  const entry = Buffer.from(JSON.stringify({ timestamp: new Date().toISOString(), status,
    environment, previousSha, targetSha, checkedOutSha, service,
    migrationsApplied: migrationsApplied === "true", migrationState,
    migrationIds: null, migrationChecksums: null, backupState, backupReference: null,
    readinessResult, rollbackOutcome, rollbackReadiness,
    runningSha: null, runningReleaseVerified: false, message }) + "\n");
  let offset = 0;
  while (offset < entry.length) {
    const written = fs.writeSync(fd, entry, offset, entry.length - offset);
    if (written <= 0) throw new Error("incomplete journal write");
    offset += written;
  }
  fs.fsyncSync(fd);
  fs.closeSync(fd);
  fd = undefined;
} catch {
  // A short append must not corrupt the next recovery entry. The deploy lock
  // serializes this repair; failure to repair still fails the promotion.
  if (fd !== undefined && originalSize !== undefined) {
    try { fs.ftruncateSync(fd, originalSize); fs.fsyncSync(fd); } catch {}
  }
  if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }
  process.exitCode = 1;
}
JOURNAL_NODE
  then
    echo "FATAL: Required release journal write failed ($status); promotion cannot be accepted." >&2
    return 1
  fi
}

rollback_code() {
  local failure_line="$1"
  local rollback_ok=true
  echo "Promotion failed near line $failure_line; restoring API code $previous_sha." >&2
  git checkout --detach "$previous_sha" >/dev/null 2>&1 || rollback_ok=false
  pnpm install --frozen-lockfile >/dev/null 2>&1 || rollback_ok=false
  sudo -n systemctl restart "$service_unit" >/dev/null 2>&1 || rollback_ok=false
  sudo -n systemctl start cloudflared.service >/dev/null 2>&1 || rollback_ok=false

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
  if [[ "$rollback_healthy" == true ]]; then
    rollback_readiness=passed
  else
    rollback_readiness=failed
  fi
  if [[ "$rollback_ok" == true && "$rollback_healthy" == true ]]; then
    echo "Rollback to $previous_sha succeeded and API is healthy." >&2
    rollback_outcome=code_restored_health_passed
    printf '%s\n' "$previous_sha" > "$sha_marker" || echo "WARNING: Could not restore the checkout SHA marker." >&2
    if ! record_journal "rolled_back" "$previous_sha" "$target_sha" "Failure near line $failure_line; code restored and local health passed"; then
      echo "WARNING: Rollback completed but its required release journal receipt failed." >&2
    fi
  else
    echo "WARNING: Rollback operations or API health failed after restoring $previous_sha." >&2
    rollback_outcome=failed
    rm -f "$sha_marker" || echo "WARNING: Could not invalidate the checkout SHA marker." >&2
    if ! record_journal "rollback_failed" "$previous_sha" "$target_sha" "Failure near line $failure_line; rollback operations or local health failed"; then
      echo "WARNING: Failed rollback could not be recorded in the required release journal." >&2
    fi
  fi
  if [[ "$migrations_applied" == true ]]; then
    echo "Database migrations may have committed; they are forward-only and were not reverted. Inspect the migration ledger and code compatibility." >&2
  fi
}

abort_promotion() {
  local failure_status="$1" failure_line="$2"
  # No recursive ERR trap or second signal may bypass recovery and release the
  # deployment lock (fd 200) before rollback and its receipt finish.
  trap - ERR
  trap '' INT TERM
  set +e
  rollback_code "$failure_line"
  exit "$failure_status"
}

if ! record_journal "started" "$previous_sha" "$target_sha" "Promotion started; release acceptance pending"; then
  exit 1
fi
trap 'abort_promotion "$?" "$LINENO"' ERR
trap 'abort_promotion 130 "$LINENO"' INT
trap 'abort_promotion 143 "$LINENO"' TERM

git fetch --prune origin main
git cat-file -e "${target_sha}^{commit}"
git merge-base --is-ancestor "$target_sha" origin/main
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

# 5. Mandatory encrypted off-host-ready backup before schema mutation.
# The root-owned unit performs the bounded write freeze and creates an atomic
# encrypted export without granting the deploy user Docker/root access.
backup_state=attempted
sudo -n systemctl start mizyun-backup-for-deploy.service
backup_state=complete

# Backup recovery resumes the previous code against the previous schema. Stop
# API workers before replacing their in-place code/dependencies or migrating.
sudo -n systemctl stop "$service_unit"
git checkout --detach "$target_sha"
pnpm install --frozen-lockfile

# 6. Reconcile database migration ledger unconditionally

echo "Reconciling migration ledger with Production database..."
pnpm exec supabase db push --db-url "$production_db_url" --dry-run --yes
# A failed db push can have committed earlier migrations. Mark the attempt
# before invoking it so rollback never falsely claims an untouched database.
migration_state=attempted
migrations_applied=true
pnpm exec supabase db push --db-url "$production_db_url" --yes
migration_state=complete

sudo -n systemctl restart "$service_unit"
# The shared tunnel Requires this API unit and stops with it. Restore public
# routing explicitly after restarting the API (also required during rollback).
sudo -n systemctl start cloudflared.service
api_ready=false
candidate_readiness=failed
max_attempts="${MIZYUN_HEALTH_RETRIES:-40}"
sleep_duration="${MIZYUN_HEALTH_SLEEP:-1}"
for _attempt in $(seq 1 "$max_attempts"); do
  if curl --silent --show-error --fail --max-time 2 \
    "$MIZYUN_LOCAL_API_URL/v1/health" >/dev/null 2>&1; then
    api_ready=true
    candidate_readiness=passed
    break
  fi
  sleep "$sleep_duration"
done

if [[ "$api_ready" != true ]]; then
  echo "Production API did not become healthy within ${max_attempts} attempts." >&2
  abort_promotion 1 "$LINENO"
fi

record_journal "success" "$previous_sha" "$target_sha" "Candidate checkout and local health passed; running release identity unverified"
printf '%s\n' "$target_sha" > "$sha_marker"
trap - ERR INT TERM
echo "Production promotion succeeded: $target_sha"
