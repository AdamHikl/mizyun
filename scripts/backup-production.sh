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
mkdir -p "$release_dir"
chmod 700 "$MIZYUN_BACKUP_DIR" "$release_dir"

docker exec "$MIZYUN_DB_CONTAINER" \
  pg_dump --username postgres --dbname postgres --format=custom \
  > "$release_dir/database.dump"
tar --create --gzip --file "$release_dir/private-storage.tar.gz" \
  --directory "$MIZYUN_STORAGE_DIR" .

chmod 600 "$release_dir/database.dump" "$release_dir/private-storage.tar.gz"
sha256sum "$release_dir/database.dump" \
  "$release_dir/private-storage.tar.gz" > "$release_dir/SHA256SUMS"
chmod 600 "$release_dir/SHA256SUMS"
echo "Production backup created: $release_dir"
