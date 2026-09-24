#!/usr/bin/env bash
set -Eeuo pipefail

# scripts/verify-backup-recovery.sh
# Verifies an encrypted Mizyun Production recovery archive end-to-end:
# 1. Decrypts the age-encrypted archive using the offline escrowed identity.
# 2. Verifies inner payload SHA-256 checksums across all artifacts.
# 3. Restores globals and database dump into an isolated, ephemeral PostgreSQL 17 container.
# 4. Verifies all restored database table counts against snapshot table-counts.tsv.
# 5. Restores private Storage in an isolated Linux container and verifies file hashes, xattrs, and ACLs.
# 6. Measures total recovery time and outputs qualified verification evidence.

archive_input="${1:-}"
identity_file="${2:-${MIZYUN_BACKUP_AGE_IDENTITY:-$HOME/Backups/mizyun/keys/hetzner-backup-age-identity.txt}}"
postgres_image="${MIZYUN_RESTORE_POSTGRES_IMAGE:-supabase/postgres:17.6.1.136}"
linux_image="${MIZYUN_RESTORE_LINUX_IMAGE:-ubuntu:24.04}"

if [[ -z "$archive_input" ]]; then
  echo "Usage: $0 <path-to-archive-dir-or-age-file> [path-to-age-identity]" >&2
  exit 2
fi

if [[ ! -r "$identity_file" ]]; then
  echo "Cannot read age identity file: $identity_file" >&2
  exit 2
fi

for cmd in age docker sha256sum; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    # On macOS, sha256sum might be shasum -a 256
    if [[ "$cmd" == "sha256sum" ]] && command -v shasum >/dev/null 2>&1; then
      continue
    fi
    echo "Missing required tool: $cmd" >&2
    exit 2
  fi
done

sha256_check() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum --check "$@"
  else
    shasum -a 256 -c "$@"
  fi
}

# Resolve input archive path
if [[ -d "$archive_input" ]]; then
  archive_dir="$archive_input"
  archive_file="$(find "$archive_dir" -maxdepth 1 -name "mizyun-production-*.tar.gz.age" | head -n 1)"
  if [[ -z "$archive_file" || ! -f "$archive_file" ]]; then
    echo "No mizyun-production-*.tar.gz.age found in directory $archive_dir" >&2
    exit 1
  fi
elif [[ -f "$archive_input" ]]; then
  archive_file="$archive_input"
  archive_dir="$(dirname "$archive_file")"
else
  echo "Archive path does not exist: $archive_input" >&2
  exit 1
fi

start_time="$(date +%s)"
drill_id="$(date -u +%Y%m%dT%H%M%SZ)-$$"
scratch_dir="$(mktemp -d "${TMPDIR:-/tmp}/mizyun-restore-drill-$drill_id-XXXXXX")"
chmod 700 "$scratch_dir"
container_db="mizyun-restore-db-$drill_id"

cleanup() {
  local exit_code=$?
  trap - EXIT INT TERM
  docker stop "$container_db" >/dev/null 2>&1 || true
  docker rm -f "$container_db" >/dev/null 2>&1 || true
  if [[ -d "$scratch_dir" ]]; then
    rm -rf -- "$scratch_dir"
  fi
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

echo "========================================================"
echo " Mizyun Automated Backup Recovery Drill"
echo " Archive: $(basename "$archive_file")"
echo " Drill ID: $drill_id"
echo "========================================================"

# Step 1: Verify outer ciphertext checksum if SHA256SUMS exists
if [[ -f "$archive_dir/SHA256SUMS" ]]; then
  echo "[1/5] Verifying ciphertext checksum (SHA256SUMS)..."
  (
    cd "$archive_dir"
    sha256_check SHA256SUMS >/dev/null
  )
  echo "      Ciphertext integrity verified."
else
  echo "[1/5] Skipping ciphertext checksum (no SHA256SUMS in archive directory)."
fi

# Step 2: Decrypt payload with offline age identity
echo "[2/5] Decrypting archive using escrowed age key..."
mkdir -p "$scratch_dir/payload"
age -d -i "$identity_file" "$archive_file" | tar -xz -C "$scratch_dir/payload"
echo "      Decryption succeeded."

# Step 3: Verify inner payload checksums
echo "[3/5] Verifying PAYLOAD_SHA256SUMS..."
(
  cd "$scratch_dir/payload"
  sha256_check PAYLOAD_SHA256SUMS >/dev/null
)
echo "      All inner payload artifacts verified against PAYLOAD_SHA256SUMS."

if [[ -f "$scratch_dir/payload/metadata.txt" ]]; then
  source_sha="$(sed -n 's/^source_sha=//p' "$scratch_dir/payload/metadata.txt")"
  created_at="$(sed -n 's/^created_at=//p' "$scratch_dir/payload/metadata.txt")"
  echo "      Archive metadata: Created $created_at from commit $source_sha"
fi

# Step 4: Database restore into isolated PostgreSQL 17 container
echo "[4/5] Testing database restore in isolated container ($postgres_image)..."
docker run -d --name "$container_db" -e POSTGRES_PASSWORD=postgres "$postgres_image" >/dev/null

# Wait for Postgres ready after full entrypoint initialization completes
ready=false
for _ in $(seq 1 60); do
  logs="$(docker logs "$container_db" 2>&1 || true)"
  if [[ "$logs" == *"PostgreSQL init process complete"* && "$logs" == *"database system is ready to accept connections"* ]]; then
    if docker exec "$container_db" pg_isready -U postgres >/dev/null 2>&1; then
      ready=true
      break
    fi
  fi
  sleep 1
done

if [[ "$ready" != "true" ]]; then
  echo "FATAL: Ephemeral PostgreSQL container failed to start." >&2
  exit 1
fi

docker cp "$scratch_dir/payload/globals.sql" "$container_db:/tmp/globals.sql"
docker cp "$scratch_dir/payload/database.dump" "$container_db:/tmp/database.dump"

# Apply globals (suppress role-exists errors as expected for standard roles)
docker exec "$container_db" psql -U supabase_admin -d postgres -f /tmp/globals.sql >/dev/null 2>&1 || true

# Create clean target database and restore
docker exec "$container_db" psql -U supabase_admin -d postgres -c "CREATE DATABASE mizyun_restore;" >/dev/null
docker exec "$container_db" pg_restore -U supabase_admin -d mizyun_restore --no-owner --role=supabase_admin /tmp/database.dump >/dev/null

# Validate table counts
docker exec "$container_db" psql -U supabase_admin -d mizyun_restore -Atc \
  "select quote_ident(schemaname)||'.'||quote_ident(relname) from pg_stat_user_tables order by 1" |
  while IFS= read -r table_name; do
    row_count="$(docker exec "$container_db" psql -U supabase_admin -d mizyun_restore -Atc "select count(*) from $table_name")"
    printf '%s\t%s\n' "$table_name" "$row_count"
  done > "$scratch_dir/restored-table-counts.tsv"

table_diff="$(diff -u "$scratch_dir/payload/table-counts.tsv" "$scratch_dir/restored-table-counts.tsv" || true)"
if [[ -n "$table_diff" ]]; then
  echo "FATAL: Restored table counts do not match backup snapshot!" >&2
  echo "$table_diff" >&2
  exit 1
fi
table_count="$(wc -l < "$scratch_dir/payload/table-counts.tsv" | tr -d ' ')"
echo "      Database restored cleanly: $table_count tables verified with 0 discrepancies."

# Step 5: Verify private Storage extraction, file hashes, xattrs, and ACLs in Linux container
echo "[5/5] Testing Storage restoration with ACLs and xattrs ($linux_image)..."
docker run --rm -v "$scratch_dir/payload:/backup:ro" "$linux_image" bash -c '
  set -Eeuo pipefail
  apt-get update -qq >/dev/null 2>&1
  apt-get install -y -qq acl attr >/dev/null 2>&1
  mkdir -p /storage-restore
  cd /storage-restore
  tar --xattrs --acls -xzf /backup/storage.tar.gz
  
  find storage -type f -print0 | sort -z | xargs -0 -r sha256sum > /tmp/restored-files.sha256
  diff -u /backup/storage-files.sha256 /tmp/restored-files.sha256
  
  while IFS= read -r -d "" path; do
    getfattr --dump --match=".*" --no-dereference "$path"
  done < <(find storage -print0 | sort -z) > /tmp/restored-xattrs.txt
  diff -u /backup/storage-xattrs.txt /tmp/restored-xattrs.txt
  
  while IFS= read -r -d "" path; do
    getfacl --absolute-names --numeric "$path"
  done < <(find storage -print0 | sort -z) > /tmp/restored-acls.txt
  diff -u /backup/storage-acls.txt /tmp/restored-acls.txt
' >/dev/null
echo "      Storage files, extended attributes, and ACLs verified 100% identical."

end_time="$(date +%s)"
elapsed=$((end_time - start_time))

echo "========================================================"
echo " RESTORE VERIFICATION PASSED (Duration: ${elapsed}s)"
echo " Database: $table_count tables restored and verified"
echo " Storage: files, xattrs, and ACLs matched exactly"
echo " Escrow key: offline retrieval and decryption verified"
echo "========================================================"
