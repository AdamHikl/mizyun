#!/usr/bin/env bash
set -Eeuo pipefail

# Root-only Pi pull job. The VM SSH key is forced through read-only rrsync.

source_host="${MIZYUN_BACKUP_SOURCE_HOST:-62.238.44.10}"
source_user="${MIZYUN_BACKUP_SOURCE_USER:-mizyun-backup-reader}"
identity_file="${MIZYUN_BACKUP_SSH_IDENTITY:-/etc/mizyun-backup/hetzner-pull}"
known_hosts="${MIZYUN_BACKUP_KNOWN_HOSTS:-/etc/mizyun-backup/known_hosts}"
destination="${MIZYUN_BACKUP_DESTINATION:-/srv/mizyun/vm-backups}"
retention_days="${MIZYUN_BACKUP_RETENTION_DAYS:-90}"
max_age_seconds="${MIZYUN_BACKUP_MAX_AGE_SECONDS:-21600}"
min_free_kib="${MIZYUN_BACKUP_MIN_FREE_KIB:-1048576}"

if [[ "$EUID" -ne 0 ]]; then
  echo "This backup pull must run as root." >&2
  exit 2
fi
if [[ "$destination" == "/" ]] || [[ ! "$retention_days" =~ ^[0-9]+$ ]] || (( retention_days < 1 )); then
  echo "Unsafe backup destination or retention." >&2
  exit 2
fi
if [[ ! "$source_host" =~ ^[A-Za-z0-9.-]+$ ]] || [[ ! "$source_user" =~ ^[A-Za-z0-9_-]+$ ]]; then
  echo "Unsafe backup source host or user." >&2
  exit 2
fi
for command in flock rsync sha256sum; do
  command -v "$command" >/dev/null || {
    echo "Missing required command: $command" >&2
    exit 2
  }
done
for file in "$identity_file" "$known_hosts"; do
  [[ -r "$file" ]] || {
    echo "Missing backup transport file: $file" >&2
    exit 2
  }
done

mkdir -p "$destination"
chmod 700 "$destination"
exec 9>"$destination/.pull.lock"
if ! flock -n 9; then
  echo "Another VM backup pull is running." >&2
  exit 75
fi

available_kib="$(df -Pk "$destination" | awk 'NR==2 {print $4}')"
if [[ ! "$available_kib" =~ ^[0-9]+$ ]] || (( available_kib < min_free_kib )); then
  echo "Insufficient Pi disk space for backup pull." >&2
  exit 1
fi

ssh_transport="ssh -i $identity_file -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=$known_hosts"
incoming="$(mktemp -d "$destination/.incoming-XXXXXX")"
cleanup() {
  local exit_status=$?
  trap - EXIT
  [[ ! -d "$incoming" ]] || rm -rf -- "$incoming"
  exit "$exit_status"
}
trap cleanup EXIT

# Pull into an isolated staging tree. Existing verified backups are used as
# hard-link references but are never writable by the remote source.
rsync --archive --partial-dir=.rsync-partial --link-dest="$destination" \
  --include='/[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z/***' \
  --exclude='/*' \
  --chmod=Du=rwx,Dgo=,Fu=rw,Fgo= \
  --rsh="$ssh_transport" "$source_user@$source_host:/" "$incoming/"

incoming_count=0
while IFS= read -r -d '' candidate; do
  name="$(basename "$candidate")"
  [[ "$name" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || continue
  archive="$candidate/mizyun-production-$name.tar.gz.age"
  [[ -f "$candidate/COMPLETE" && -f "$candidate/SHA256SUMS" && -f "$archive" ]] || {
    echo "Incomplete staged backup: $name" >&2
    exit 1
  }
  [[ "$(tr -d '[:space:]' < "$candidate/COMPLETE")" == "$name" ]] || {
    echo "Staged completion marker does not match directory: $name" >&2
    exit 1
  }
  (
    cd "$candidate"
    sha256sum --check SHA256SUMS > /dev/null
  )
  incoming_count=$((incoming_count + 1))
done < <(find "$incoming" -mindepth 1 -maxdepth 1 -type d -print0)
if (( incoming_count == 0 )); then
  echo "No complete VM backup was staged." >&2
  exit 1
fi

while IFS= read -r -d '' candidate; do
  name="$(basename "$candidate")"
  [[ "$name" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || continue
  if [[ -e "$destination/$name" ]]; then
    rm -rf -- "$candidate"
  else
    mv -T -- "$candidate" "$destination/$name"
  fi
done < <(find "$incoming" -mindepth 1 -maxdepth 1 -type d -print0)
rm -rf -- "$incoming"

verified_count=0
latest_name=""
while IFS= read -r -d '' candidate; do
  name="$(basename "$candidate")"
  [[ "$name" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || continue
  archive="$candidate/mizyun-production-$name.tar.gz.age"
  [[ -f "$candidate/COMPLETE" && -f "$candidate/SHA256SUMS" && -f "$archive" ]] || {
    echo "Incomplete pulled backup: $name" >&2
    exit 1
  }
  [[ "$(tr -d '[:space:]' < "$candidate/COMPLETE")" == "$name" ]] || {
    echo "Backup completion marker does not match directory: $name" >&2
    exit 1
  }
  (
    cd "$candidate"
    sha256sum --check SHA256SUMS > /dev/null
  )
  touch "$candidate/.verified"
  verified_count=$((verified_count + 1))
  [[ "$name" > "$latest_name" ]] && latest_name="$name"
done < <(find "$destination" -mindepth 1 -maxdepth 1 -type d -print0)

if (( verified_count == 0 )) || [[ -z "$latest_name" ]]; then
  echo "No complete VM backup was pulled." >&2
  exit 1
fi
latest_epoch="$(date -u -d "${latest_name:0:8} ${latest_name:9:2}:${latest_name:11:2}:${latest_name:13:2} UTC" +%s)"
now_epoch="$(date -u +%s)"
age_seconds=$((now_epoch - latest_epoch))
if (( age_seconds < 0 || age_seconds > max_age_seconds )); then
  echo "Latest VM backup is stale: $latest_name" >&2
  exit 1
fi

while IFS= read -r -d '' candidate; do
  name="$(basename "$candidate")"
  if [[ "$name" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] && [[ -f "$candidate/.verified" ]] && [[ "$name" != "$latest_name" ]]; then
    rm -rf -- "$candidate"
  fi
done < <(find "$destination" -mindepth 1 -maxdepth 1 -type d -mtime "+$retention_days" -print0)

printf '{"lastVerified":"%s","verifiedAt":"%s","ageSeconds":%s}\n' \
  "$latest_name" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$age_seconds" \
  > "$destination/last-success.json"
chmod 600 "$destination/last-success.json"
echo "Verified VM backup on Pi: $latest_name"
