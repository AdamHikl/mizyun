#!/usr/bin/env bash
set -Eeuo pipefail

# Idempotent safety net used by the exporter trap and systemd ExecStopPost.
compose_dir="${MIZYUN_SUPABASE_DIR:-/srv/mizyun/supabase}"
public_health_url="${MIZYUN_PRODUCTION_PUBLIC_HEALTH_URL:-https://mizyun-api.phiskel.com/v1/health}"

if [[ "$EUID" -ne 0 ]]; then
  echo "Production backup recovery must run as root." >&2
  exit 2
fi

cd "$compose_dir"
docker compose up -d --wait
systemctl start mizyun-api.service
for _attempt in $(seq 1 90); do
  if curl --silent --show-error --fail --max-time 2 \
    http://127.0.0.1:4000/v1/health >/dev/null 2>&1; then
    systemctl start cloudflared.service
    systemctl is-active --quiet mizyun-supabase.service
    systemctl is-active --quiet mizyun-api.service
    systemctl is-active --quiet cloudflared.service
    for _public_attempt in $(seq 1 60); do
      if curl --silent --show-error --fail --max-time 3 \
        "$public_health_url" >/dev/null 2>&1; then
        exit 0
      fi
      sleep 1
    done
    echo "Production tunnel did not recover after backup." >&2
    exit 1
  fi
  sleep 1
done

echo "Production API did not recover after backup." >&2
exit 1
