#!/usr/bin/env bash
set -Eeuo pipefail

# Logical database + private Storage backup for the Windows/WSL production
# host. The destination must be on a disk outside the live Supabase directory.

production_env="${MIZYUN_PRODUCTION_ENV_FILE:-/etc/mizyun/production.env}"
if [[ ! -r "$production_env" ]]; then
  echo "Cannot read $production_env." >&2
  exit 2
fi

set -a
# shellcheck disable=SC1090
source "$production_env"
set +a

: "${MIZYUN_BACKUP_DIR:?missing MIZYUN_BACKUP_DIR}"
: "${MIZYUN_DB_CONTAINER:=supabase-db}"
: "${MIZYUN_STORAGE_DIR:?missing MIZYUN_STORAGE_DIR}"

if [[ "${NODE_ENV:-}" != "production" ]]; then
  echo "Refusing backup because NODE_ENV is not production." >&2
  exit 2
fi
if [[ ! -d "$MIZYUN_STORAGE_DIR" ]]; then
  echo "Storage directory does not exist: $MIZYUN_STORAGE_DIR" >&2
  exit 2
fi

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
release_dir="$MIZYUN_BACKUP_DIR/$timestamp"
mkdir -p "$MIZYUN_BACKUP_DIR"
chmod 700 "$MIZYUN_BACKUP_DIR"
exec 9>"$MIZYUN_BACKUP_DIR/.backup.lock"
if ! flock -n 9; then
  echo "Another production backup is already running." >&2
  exit 1
fi

# Prune before generation so an unrelated backup failure cannot keep already
# expired archives in place.
node scripts/prune-backups.mjs --root "$MIZYUN_BACKUP_DIR"

staging_dir="$(mktemp -d "$MIZYUN_BACKUP_DIR/.incomplete-$timestamp-XXXXXX")"
cleanup() {
  if [[ -n "${staging_dir:-}" ]] && [[ -d "$staging_dir" ]]; then
    rm -rf -- "$staging_dir"
  fi
}
trap cleanup EXIT INT TERM
chmod 700 "$staging_dir"

docker exec "$MIZYUN_DB_CONTAINER" \
  pg_dump --username postgres --dbname postgres --format=custom \
  > "$staging_dir/database.dump"
docker exec -i "$MIZYUN_DB_CONTAINER" \
  pg_restore --list < "$staging_dir/database.dump" > /dev/null
tar --create --gzip --file "$staging_dir/private-storage.tar.gz" \
  --directory "$MIZYUN_STORAGE_DIR" .
tar --list --gzip --file "$staging_dir/private-storage.tar.gz" > /dev/null

chmod 600 "$staging_dir/database.dump" "$staging_dir/private-storage.tar.gz"
(
  cd "$staging_dir"
  sha256sum database.dump private-storage.tar.gz > SHA256SUMS
  sha256sum --check SHA256SUMS > /dev/null
)
chmod 600 "$staging_dir/SHA256SUMS"
if [[ -e "$release_dir" ]]; then
  echo "Refusing to replace an existing backup: $release_dir" >&2
  exit 1
fi
mv -T -- "$staging_dir" "$release_dir"
staging_dir=""
echo "Production backup created: $release_dir"
