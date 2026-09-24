#!/usr/bin/env bash
set -Eeuo pipefail

# mac-daily-backup-sync.sh
# Syncs production backups from the Raspberry Pi 5 (rpserver) to the Mac.
# Runs once per day whenever the Mac is turned on / awake.

backup_dir="${MIZYUN_LOCAL_BACKUP_DIR:-$HOME/Backups/mizyun}"
state_file="$backup_dir/.last_sync_date"
log_dir="$HOME/Library/Logs"
log_file="$log_dir/mizyun-backup-sync.log"
ssh_alias="${MIZYUN_PRODUCTION_SSH_ALIAS:-rpserver}"
remote_dir="${MIZYUN_REMOTE_DIR:-/home/mizyun/mizyun}"
force="${1:-}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

mkdir -p "$backup_dir" "$log_dir"

# Local retention is independent of whether today's remote backup or sync can
# run, so offline and already-synchronized days cannot extend local retention.
node "$script_dir/prune-backups.mjs" --root "$backup_dir" >> "$log_file" 2>&1

log() {
  local msg="[$(date '+%Y-%m-%d %H:%M:%S')] $*"
  echo "$msg"
  echo "$msg" >> "$log_file"
}

today="$(date '+%Y-%m-%d')"

if [[ "$force" != "--force" ]] && [[ -f "$state_file" ]]; then
  last_sync="$(cat "$state_file" 2>/dev/null || true)"
  if [[ "$last_sync" == "$today" ]]; then
    log "Daily backup already synchronized today ($today). Exiting."
    exit 0
  fi
fi

log "Checking connectivity to $ssh_alias..."
if ! ssh -o BatchMode=yes -o ConnectTimeout=8 "$ssh_alias" "true" 2>/dev/null; then
  log "Cannot connect to $ssh_alias over SSH (offline or Tailscale disconnected). Will retry on next check."
  exit 0
fi

log "Triggering fresh production backup on $ssh_alias..."
remote_output="$(mktemp)"
trap 'rm -f "$remote_output"' EXIT INT TERM
if ! ssh -o BatchMode=yes "$ssh_alias" "cd $remote_dir && bash scripts/backup-production.sh" > "$remote_output" 2>&1; then
  cat "$remote_output" >> "$log_file"
  log "ERROR: remote backup generation failed; refusing to mark stale archives as a successful daily backup."
  exit 1
fi
cat "$remote_output" >> "$log_file"
fresh_name="$(sed -n 's|^Production backup created: .*/\([0-9]\{8\}T[0-9]\{6\}Z\)$|\1|p' "$remote_output" | tail -n 1)"
if [[ -z "$fresh_name" ]]; then
  log "ERROR: remote backup did not report a completed timestamped archive."
  exit 1
fi

log "Syncing backup archives from $ssh_alias:/srv/mizyun/backups/ to $backup_dir/..."
rsync -avz --partial "$ssh_alias:/srv/mizyun/backups/" "$backup_dir/" >> "$log_file" 2>&1

# Verify the integrity of the latest backup
latest_backup="$backup_dir/$fresh_name"
if [[ -f "$latest_backup/SHA256SUMS" ]] && [[ -f "$latest_backup/database.dump" ]] && [[ -f "$latest_backup/private-storage.tar.gz" ]]; then
  log "Verifying checksums for fresh backup: $fresh_name..."
  if (cd "$latest_backup" && shasum -a 256 -c SHA256SUMS >> "$log_file" 2>&1); then
    log "Checksum verification passed for $fresh_name."
  else
    log "ERROR: Checksum verification failed for $fresh_name!"
    exit 1
  fi
else
  log "ERROR: fresh backup $fresh_name is incomplete after synchronization."
  exit 1
fi

printf '%s\n' "$today" > "$state_file"
log "Daily backup sync completed successfully for $today."
