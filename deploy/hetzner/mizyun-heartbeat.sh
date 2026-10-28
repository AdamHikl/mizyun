#!/usr/bin/env bash
set -Eeuo pipefail

# mizyun-heartbeat.sh <check>
# Optional dead-man ping (for example healthchecks.io) after a scheduled job
# succeeds. The external service alerts when a ping does not arrive in time.
# <check> selects MIZYUN_HEARTBEAT_URL_<CHECK> from the alerts env file
# ("backup-pull" -> MIZYUN_HEARTBEAT_URL_BACKUP_PULL). Unset means no-op.
# Never fails the calling job.

check="${1:-}"
env_file="${MIZYUN_ALERT_ENV_FILE:-/etc/mizyun/alerts.env}"

if [[ ! "$check" =~ ^[a-z][a-z0-9-]*$ ]]; then
  echo "Usage: mizyun-heartbeat <check>" >&2
  exit 0
fi

if [[ -f "$env_file" && ! -L "$env_file" && -O "$env_file" ]] &&
  [[ -z "$(find "$env_file" -maxdepth 0 \( -perm -020 -o -perm -002 \))" ]]; then
  # shellcheck disable=SC1090
  source "$env_file"
elif [[ -e "$env_file" ]]; then
  echo "Ignoring $env_file: it must be a regular file owned by root and not group/world-writable." >&2
fi

variable="MIZYUN_HEARTBEAT_URL_$(printf '%s' "$check" | tr 'a-z-' 'A-Z_')"
url="${!variable:-}"
if [[ -z "$url" ]]; then
  exit 0
fi
if [[ ! "$url" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?/[A-Za-z0-9._~/-]*$ ]]; then
  echo "WARNING: $variable is not a plain https URL; heartbeat skipped." >&2
  logger -t mizyun-heartbeat -p daemon.warning "$variable is not a plain https URL" || true
  exit 0
fi

# The ping URL is a bearer secret: pass it on stdin, not argv. The pattern
# above already excludes quotes and backslashes.
if printf 'url = "%s"\n' "$url" | curl --silent --show-error --fail --max-time 10 \
  --retry 3 --config - --output /dev/null; then
  echo "Heartbeat sent for $check." >&2
else
  echo "WARNING: heartbeat for $check was not delivered." >&2
  logger -t mizyun-heartbeat -p daemon.warning "heartbeat for $check was not delivered" || true
fi

exit 0
