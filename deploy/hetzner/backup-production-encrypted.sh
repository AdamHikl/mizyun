#!/usr/bin/env bash
set -Eeuo pipefail

# Root-only, crash-safe Production backup exporter for the Hetzner host.
# Produces one age-encrypted archive that a read-only Pi account can pull.

export_root="${MIZYUN_BACKUP_EXPORT_ROOT:-/srv/mizyun/backup-export/outgoing}"
export_parent="$(dirname "$export_root")"
work_root="${MIZYUN_BACKUP_WORK_ROOT:-/srv/mizyun/backup-work}"
recipient_file="${MIZYUN_BACKUP_AGE_RECIPIENT_FILE:-/etc/mizyun/backup-age-recipient}"
repo_dir="${MIZYUN_PRODUCTION_REPO:-/var/lib/mizyun/repo}"
compose_dir="${MIZYUN_SUPABASE_DIR:-/srv/mizyun/supabase}"
storage_parent="${MIZYUN_STORAGE_PARENT:-/srv/mizyun/supabase/volumes}"
db_config_dir="${MIZYUN_DB_CONFIG_DIR:-/var/lib/docker/volumes/supabase_db-config/_data}"
db_container="${MIZYUN_DB_CONTAINER:-supabase-db}"
retention_days="${MIZYUN_VM_EXPORT_RETENTION_DAYS:-7}"
min_free_kib="${MIZYUN_BACKUP_MIN_FREE_KIB:-1048576}"
export_group="${MIZYUN_BACKUP_EXPORT_GROUP:-mizyun-backup-reader}"
maintenance_lock="${MIZYUN_PRODUCTION_LOCK_FILE:-/run/lock/mizyun-production-maintenance.lock}"
caller_holds_lock="${MIZYUN_BACKUP_CALLER_HOLDS_LOCK:-false}"
test_fail_after_freeze="${MIZYUN_BACKUP_TEST_FAIL_AFTER_FREEZE:-false}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
release_dir="$export_root/$timestamp"
staging_export=""
plain_dir=""
services_frozen=false

if [[ "$EUID" -ne 0 ]]; then
  echo "This backup exporter must run as root." >&2
  exit 2
fi
if [[ "$export_root" == "/" || "$export_parent" == "/" || "$work_root" == "/" ]]; then
  echo "Refusing unsafe backup root." >&2
  exit 2
fi
if [[ ! "$retention_days" =~ ^[0-9]+$ ]] || (( retention_days < 1 )); then
  echo "Retention must be a positive number of days." >&2
  exit 2
fi
if [[ "$db_container" != "supabase-db" ]]; then
  echo "Unexpected Production database container: $db_container" >&2
  exit 2
fi
if [[ "$test_fail_after_freeze" != "false" && "$test_fail_after_freeze" != "true" ]]; then
  echo "MIZYUN_BACKUP_TEST_FAIL_AFTER_FREEZE must be true or false." >&2
  exit 2
fi

for command in age docker find flock getfacl getfattr sha256sum sort tar xargs; do
  command -v "$command" >/dev/null || {
    echo "Missing required command: $command" >&2
    exit 2
  }
done
getent group "$export_group" >/dev/null || {
  echo "Missing backup export group: $export_group" >&2
  exit 2
}
for path in "$recipient_file" "$repo_dir/.git" "$compose_dir/docker-compose.yml" "$storage_parent/storage" "$db_config_dir"; do
  [[ -e "$path" ]] || {
    echo "Missing required backup source: $path" >&2
    exit 2
  }
done
recipient="$(tr -d '[:space:]' < "$recipient_file")"
if [[ ! "$recipient" =~ ^age1[0-9a-z]+$ ]]; then
  echo "Invalid age recipient file." >&2
  exit 2
fi

mkdir -p "$export_parent" "$export_root" "$work_root"
chgrp "$export_group" "$export_parent"
chmod 2750 "$export_parent"
chgrp "$export_group" "$export_root"
chmod 2750 "$export_root"
chmod 700 "$work_root"
if [[ "$caller_holds_lock" == "false" ]]; then
  exec 9>"$maintenance_lock"
  if ! flock -n 9; then
    echo "Another Hetzner Production maintenance operation is running." >&2
    exit 75
  fi
elif [[ "$caller_holds_lock" != "true" ]]; then
  echo "MIZYUN_BACKUP_CALLER_HOLDS_LOCK must be true or false." >&2
  exit 2
else
  exec 9>"$maintenance_lock"
  if flock -n 9; then
    echo "Deployment backup requires an already-held Production maintenance lock." >&2
    exit 75
  fi
fi

available_kib="$(df -Pk "$work_root" | awk 'NR==2 {print $4}')"
if [[ ! "$available_kib" =~ ^[0-9]+$ ]] || (( available_kib < min_free_kib )); then
  echo "Insufficient free disk for backup staging." >&2
  exit 1
fi

resume_services() {
  if [[ "$services_frozen" != true ]]; then
    return 0
  fi
  /usr/local/sbin/mizyun-backup-recover
  services_frozen=false
}

cleanup() {
  local exit_status=$?
  trap - EXIT INT TERM
  if [[ "$services_frozen" == true ]]; then
    resume_services || exit_status=1
  fi
  [[ -z "$plain_dir" || ! -d "$plain_dir" ]] || rm -rf -- "$plain_dir"
  [[ -z "$staging_export" || ! -d "$staging_export" ]] || rm -rf -- "$staging_export"
  exit "$exit_status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

plain_dir="$(mktemp -d "$work_root/.plain-$timestamp-XXXXXX")"
staging_export="$(mktemp -d "$export_root/.incomplete-$timestamp-XXXXXX")"
chmod 700 "$plain_dir" "$staging_export"

# Bound the cross-layer recovery point: remove every Production writer while
# leaving the database engine available for pg_dump.
services_frozen=true
systemctl stop cloudflared.service
systemctl stop mizyun-api.service
mapfile -t non_db_services < <(
  cd "$compose_dir"
  docker compose config --services | awk '$0 != "db"'
)
if (( ${#non_db_services[@]} > 0 )); then
  (
    cd "$compose_dir"
    docker compose stop "${non_db_services[@]}"
  )
fi

remaining_clients="$(docker exec "$db_container" psql -U supabase_admin -d postgres -Atc \
  "select count(*) from pg_stat_activity where backend_type = 'client backend' and pid <> pg_backend_pid();")"
if [[ "$remaining_clients" != "0" ]]; then
  echo "Production database still has client sessions after write freeze." >&2
  exit 1
fi
if [[ "$test_fail_after_freeze" == "true" ]]; then
  echo "Intentional failure after the Production write freeze." >&2
  exit 86
fi

docker exec "$db_container" pg_dump -U supabase_admin -d postgres --format=custom \
  > "$plain_dir/database.dump"
docker exec -i "$db_container" pg_restore --list \
  < "$plain_dir/database.dump" > /dev/null
docker exec "$db_container" pg_dumpall -U supabase_admin --globals-only \
  > "$plain_dir/globals.sql"

tar --xattrs --xattrs-include='*' --acls --create --gzip \
  --file "$plain_dir/storage.tar.gz" --directory "$storage_parent" storage
tar --xattrs --acls --list --gzip --file "$plain_dir/storage.tar.gz" > /dev/null
(
  cd "$storage_parent"
  find storage -type f -print0 | sort -z | xargs -0 -r sha256sum
) > "$plain_dir/storage-files.sha256"
(
  cd "$storage_parent"
  while IFS= read -r -d '' path; do
    getfattr --dump --match='.*' --no-dereference "$path"
  done < <(find storage -print0 | sort -z)
) > "$plain_dir/storage-xattrs.txt"
(
  cd "$storage_parent"
  while IFS= read -r -d '' path; do
    getfacl --absolute-names --numeric "$path"
  done < <(find storage -print0 | sort -z)
) > "$plain_dir/storage-acls.txt"

config_paths=(
  etc/mizyun/production.env
  srv/mizyun/supabase/.env
  srv/mizyun/supabase/docker-compose.yml
  srv/mizyun/supabase/docker-compose.vm-private.yml
  srv/mizyun/supabase/run.sh
  var/lib/docker/volumes/supabase_db-config/_data
  etc/cloudflared/token
)
present_config_paths=()
for path in "${config_paths[@]}"; do
  [[ -e "/$path" ]] && present_config_paths+=("$path")
done
tar --xattrs --xattrs-include='*' --acls --create --gzip \
  --file "$plain_dir/recovery-config.tar.gz" --directory / \
  "${present_config_paths[@]}"

docker exec "$db_container" psql -U supabase_admin -d postgres -Atc \
  "select quote_ident(schemaname)||'.'||quote_ident(relname) from pg_stat_user_tables order by 1" |
  while IFS= read -r table_name; do
    row_count="$(docker exec "$db_container" psql -U supabase_admin -d postgres -Atc "select count(*) from $table_name")"
    printf '%s\t%s\n' "$table_name" "$row_count"
  done > "$plain_dir/table-counts.tsv"

source_sha="$(git -c safe.directory="$repo_dir" -C "$repo_dir" rev-parse HEAD)"
{
  printf 'created_at=%s\n' "$timestamp"
  printf 'source_sha=%s\n' "$source_sha"
  printf 'database_container=%s\n' "$db_container"
  printf 'format_version=1\n'
} > "$plain_dir/metadata.txt"
docker ps --format '{{.Names}}\t{{.Image}}' | sort > "$plain_dir/container-images.tsv"

(
  cd "$plain_dir"
  sha256sum database.dump globals.sql storage.tar.gz recovery-config.tar.gz \
    storage-files.sha256 storage-xattrs.txt storage-acls.txt table-counts.tsv \
    metadata.txt container-images.tsv > PAYLOAD_SHA256SUMS
  sha256sum --check PAYLOAD_SHA256SUMS > /dev/null
)
chmod 600 "$plain_dir"/*

# Resume Production before compression/encryption; the consistent plaintext
# pair is already complete and remains root-only until the trap removes it.
resume_services

tar --create --gzip --directory "$plain_dir" . |
  age --encrypt --recipient "$recipient" \
    --output "$staging_export/mizyun-production-$timestamp.tar.gz.age"
chmod 640 "$staging_export/mizyun-production-$timestamp.tar.gz.age"
(
  cd "$staging_export"
  sha256sum "mizyun-production-$timestamp.tar.gz.age" > SHA256SUMS
  sha256sum --check SHA256SUMS > /dev/null
)
printf '%s\n' "$timestamp" > "$staging_export/COMPLETE"
chmod 640 "$staging_export/SHA256SUMS" "$staging_export/COMPLETE"
chgrp -R "$export_group" "$staging_export"
chmod 750 "$staging_export"

if [[ -e "$release_dir" ]]; then
  echo "Refusing to replace existing backup export: $release_dir" >&2
  exit 1
fi
mv -T -- "$staging_export" "$release_dir"
staging_export=""

rm -rf -- "$plain_dir"
plain_dir=""

# The VM keeps a short export buffer. The Pi owns the independent 90-day copy.
while IFS= read -r -d '' candidate; do
  name="$(basename "$candidate")"
  if [[ "$name" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] && [[ "$candidate" != "$release_dir" ]]; then
    rm -rf -- "$candidate"
  fi
done < <(find "$export_root" -mindepth 1 -maxdepth 1 -type d -mtime "+$retention_days" -print0)

echo "Encrypted Production backup created: $release_dir"
