#!/usr/bin/env bash
set -Eeuo pipefail

# mizyun-send-alert.sh
# Dispatches actionable operational alerts for Mizyun services.
# Used by systemd OnFailure units and operational monitors.

unit_name="${1:-unknown-unit}"
message="${2:-Service unit $unit_name failed on $(hostname)}"
webhook_url="${MIZYUN_ALERT_WEBHOOK_URL:-}"
env_file="${MIZYUN_ALERT_ENV_FILE:-/etc/mizyun/alerts.env}"

if [[ -f "$env_file" ]]; then
  # shellcheck disable=SC1090
  source "$env_file"
  webhook_url="${MIZYUN_ALERT_WEBHOOK_URL:-$webhook_url}"
fi

timestamp="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
host="$(hostname)"

# Always log to syslog / journald
logger -t mizyun-alert -p daemon.crit "ALERT [$host] $unit_name: $message"
echo "[$timestamp] CRITICAL ALERT [$host] $unit_name: $message" >&2

# If webhook is configured, dispatch HTTP POST (Discord / Slack / Telegram / generic webhook)
if [[ -n "$webhook_url" ]]; then
  payload="$(printf '{"text":"🚨 [MIZYUN ALERT - %s] %s\nHost: %s\nTimestamp: %s"}' \
    "$host" "$message" "$host" "$timestamp")"
  
  if curl --silent --show-error --fail --max-time 10 \
    -H "Content-Type: application/json" \
    -d "$payload" \
    "$webhook_url" >/dev/null 2>&1; then
    echo "[$timestamp] Alert webhook delivered successfully." >&2
  else
    echo "[$timestamp] WARNING: Failed to deliver alert webhook." >&2
  fi
fi

exit 0
