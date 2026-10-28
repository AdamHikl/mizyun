#!/usr/bin/env bash
set -Eeuo pipefail

# mizyun-send-alert.sh
# Dispatches actionable operational alerts for Mizyun services.
# Used by systemd OnFailure units and operational monitors.

unit_name="${1:-unknown-unit}"
message="${2:-Service unit $unit_name failed on $(hostname)}"
webhook_url="${MIZYUN_ALERT_WEBHOOK_URL:-}"
env_file="${MIZYUN_ALERT_ENV_FILE:-/etc/mizyun/alerts.env}"

# Root sources this file: accept it only when owned by us (root on the hosts)
# and not writable by group or others.
if [[ -f "$env_file" && ! -L "$env_file" && -O "$env_file" ]] &&
  [[ -z "$(find "$env_file" -maxdepth 0 \( -perm -020 -o -perm -002 \))" ]]; then
  # shellcheck disable=SC1090
  source "$env_file"
  webhook_url="${MIZYUN_ALERT_WEBHOOK_URL:-$webhook_url}"
elif [[ -e "$env_file" ]]; then
  echo "Ignoring $env_file: it must be a regular file owned by root and not group/world-writable." >&2
fi

timestamp="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
host="$(hostname)"

# Always log to syslog / journald
logger -t mizyun-alert -p daemon.crit "ALERT [$host] $unit_name: $message"
echo "[$timestamp] CRITICAL ALERT [$host] $unit_name: $message" >&2

# JSON string escaping for the webhook body. Callers may pass arbitrary text.
json_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\r'/\\r}"
  value="${value//$'\t'/\\t}"
  printf '%s' "$value" | tr -d '\000-\037'
}

# If webhook is configured, dispatch HTTP POST. Slack/Mattermost read "text";
# Discord reads "content". Telegram needs its own bot URL format.
if [[ -n "$webhook_url" ]]; then
  text="$(json_escape "🚨 [MIZYUN ALERT - $host] $message
Host: $host
Timestamp: $timestamp")"
  payload="$(printf '{"text":"%s","content":"%s"}' "$text" "$text")"

  # The URL goes through curl's config on stdin, not argv, so other local
  # users cannot read it from the process list.
  url_config="$(printf 'url = "%s"' "$(printf '%s' "$webhook_url" | sed 's/[\\"]/\\&/g')")"
  if printf '%s\n' "$url_config" | curl --silent --show-error --fail --max-time 10 \
    --config - \
    -H "Content-Type: application/json" \
    -d "$payload" >/dev/null 2>&1; then
    echo "[$timestamp] Alert webhook delivered successfully." >&2
  else
    echo "[$timestamp] WARNING: Failed to deliver alert webhook." >&2
  fi
fi

exit 0
