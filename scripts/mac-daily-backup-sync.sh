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

mkdir -p "$backup_dir" "$log_dir"

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
if ! ssh -o BatchMode=yes "$ssh_alias" "cd $remote_dir && bash scripts/backup-production.sh" >> "$log_file" 2>&1; then
  log "Warning: remote backup generation returned non-zero. Proceeding to sync existing archives."
fi

log "Syncing backup archives from $ssh_alias:/srv/mizyun/backups/ to $backup_dir/..."
rsync -avz --partial "$ssh_alias:/srv/mizyun/backups/" "$backup_dir/" >> "$log_file" 2>&1

# Verify the integrity of the latest backup
latest_backup="$(find "$backup_dir" -mindepth 1 -maxdepth 1 -type d | sort -r | head -n 1)"
if [[ -n "$latest_backup" ]] && [[ -f "$latest_backup/SHA256SUMS" ]]; then
  log "Verifying checksums for latest backup: $(basename "$latest_backup")..."
  if (cd "$latest_backup" && awk '{print $1 "  " substr($2, match($2, "[^/]+$"))}' SHA256SUMS | shasum -a 256 -c >> "$log_file" 2>&1); then
    log "Checksum verification passed for $(basename "$latest_backup")."
  else
    log "ERROR: Checksum verification failed for $(basename "$latest_backup")!"
    exit 1
  fi
fi

printf '%s\n' "$today" > "$state_file"
log "Daily backup sync completed successfully for $today."
