#!/usr/bin/env bash
set -Eeuo pipefail

# mizyun-host-watch.sh
# Periodic host check run by mizyun-host-watch.timer. Alerts through
# mizyun-send-alert when a condition persists for confirm_runs consecutive
# runs, repeats while it lasts and reports recovery. Checks low disk, low
# available memory, inactive critical units, automatic unit restarts and
# unhealthy containers. Watching units here instead of adding stop hooks keeps
# mizyun-api-dev.service free of hooks, which the Dev backup freeze requires.

# Word-split lists below must never glob.
set -f

env_file="${MIZYUN_ALERT_ENV_FILE:-/etc/mizyun/alerts.env}"
# Root sources this file: accept it only when owned by us and not writable by
# others, as for mizyun-send-alert.
if [[ -f "$env_file" && ! -L "$env_file" && -O "$env_file" ]] &&
  [[ -z "$(find "$env_file" -maxdepth 0 \( -perm -020 -o -perm -002 \))" ]]; then
  # shellcheck disable=SC1090
  source "$env_file"
elif [[ -e "$env_file" ]]; then
  echo "Ignoring $env_file: it must be a regular file owned by root and not group/world-writable." >&2
fi

default_units="mizyun-api.service mizyun-api-dev.service mizyun-supabase.service mizyun-supabase-dev.service cloudflared.service docker.service"
# An explicitly empty MIZYUN_WATCH_UNITS (the Pi) disables unit checks.
watch_units="${MIZYUN_WATCH_UNITS-$default_units}"
disk_paths="${MIZYUN_WATCH_DISK_PATHS:-/}"
disk_percent="${MIZYUN_WATCH_DISK_PERCENT:-85}"
mem_available_percent="${MIZYUN_WATCH_MEM_AVAILABLE_PERCENT:-10}"
confirm_runs="${MIZYUN_WATCH_CONFIRM_RUNS:-2}"
repeat_minutes="${MIZYUN_WATCH_REPEAT_MINUTES:-60}"
docker_health="${MIZYUN_WATCH_DOCKER_HEALTH:-true}"
state_dir="${MIZYUN_WATCH_STATE_DIR:-/var/lib/mizyun-host-watch}"
meminfo="${MIZYUN_WATCH_MEMINFO:-/proc/meminfo}"
alert_command="${MIZYUN_WATCH_ALERT_COMMAND:-/usr/local/sbin/mizyun-send-alert}"
maintenance_lock="${MIZYUN_PRODUCTION_LOCK_FILE:-/run/lock/mizyun-production-maintenance.lock}"
dev_lock="${MIZYUN_DEV_LOCK_FILE:-/tmp/mizyun-deploy-dev.lock}"
host="$(hostname)"

for value in "$disk_percent" "$mem_available_percent" "$confirm_runs" "$repeat_minutes"; do
  if [[ ! "$value" =~ ^[0-9]+$ ]]; then
    echo "Host watch thresholds must be whole numbers." >&2
    exit 2
  fi
done
if (( confirm_runs < 1 || disk_percent < 1 || disk_percent > 100 || mem_available_percent > 100 )); then
  echo "Host watch thresholds are out of range." >&2
  exit 2
fi
if [[ "$docker_health" != "true" && "$docker_health" != "false" ]]; then
  echo "MIZYUN_WATCH_DOCKER_HEALTH must be true or false." >&2
  exit 2
fi
mkdir -p "$state_dir/conditions" "$state_dir/restarts"
chmod 700 "$state_dir"

now="$(date -u +%s)"
active_keys=" "
failures=0

alert() {
  if ! "$alert_command" "mizyun-host-watch" "$1"; then
    failures=$((failures + 1))
    return 1
  fi
}

# Record one observation of a persisting condition. State per key holds
# "<consecutive runs> <last alert epoch>".
observe() {
  local key="$1" message="$2" file count=0 last=0
  file="$state_dir/conditions/$key"
  active_keys="$active_keys$key "
  if [[ -f "$file" ]]; then
    read -r count last < "$file" || true
    [[ "$count" =~ ^[0-9]+$ ]] || count=0
    [[ "$last" =~ ^[0-9]+$ ]] || last=0
  fi
  count=$((count + 1))
  if (( count >= confirm_runs )) && { (( last == 0 )) || (( now - last >= repeat_minutes * 60 )); }; then
    if alert "$message"; then
      last="$now"
    fi
  fi
  printf '%s %s\n' "$count" "$last" > "$file"
}

# Condition keys are path-safe: '/' becomes '_'.
key_for() {
  printf '%s' "$1" | tr -c 'A-Za-z0-9._@-' '_'
}

# Disk usage.
for path in $disk_paths; do
  used="$(df -P "$path" 2>/dev/null | awk 'NR==2 {gsub("%", "", $5); print $5}')" || used=""
  if [[ ! "$used" =~ ^[0-9]+$ ]]; then
    observe "disk-unreadable-$(key_for "$path")" "Cannot read disk usage for $path on $host."
  elif (( used >= disk_percent )); then
    observe "disk-$(key_for "$path")" "Disk $path is ${used}% full on $host (threshold ${disk_percent}%)."
  fi
done

# Available memory.
mem_total="$(awk '$1 == "MemTotal:" {print $2}' "$meminfo" 2>/dev/null)" || mem_total=""
mem_available="$(awk '$1 == "MemAvailable:" {print $2}' "$meminfo" 2>/dev/null)" || mem_available=""
if [[ ! "$mem_total" =~ ^[0-9]+$ || ! "$mem_available" =~ ^[0-9]+$ ]] || (( mem_total == 0 )); then
  observe "memory-unreadable" "Cannot read memory usage on $host."
else
  available=$((mem_available * 100 / mem_total))
  if (( available < mem_available_percent )); then
    observe "memory" "Only ${available}% memory available on $host (threshold ${mem_available_percent}%)."
  fi
fi

# Production backups and deployments stop the tunnel and API on purpose while
# holding this lock. Skip state checks during that window; the confirmation
# count still catches a unit left stopped afterwards.
# lslocks only reads the lock table: taking the lock here, even briefly, could
# make a starting backup or deployment fail its non-blocking flock. Dev
# deployments and the Dev backup freeze share the Dev deploy lock.
held_locks=""
if command -v lslocks >/dev/null; then
  held_locks="$(lslocks --noheadings --output PATH 2>/dev/null)" || held_locks=""
fi
lock_held() {
  printf '%s\n' "$held_locks" | grep -Fxq -- "$1"
}

for unit in $watch_units; do
  key="$(key_for "$unit")"
  maintenance=false
  if lock_held "$maintenance_lock"; then
    maintenance=true
  elif [[ "$unit" == *-dev.service ]] && lock_held "$dev_lock"; then
    maintenance=true
  fi
  if [[ "$maintenance" == "false" ]]; then
    state="$(systemctl show "$unit" --property=ActiveState --value 2>/dev/null)" || state="unknown"
    if [[ "$state" != "active" ]]; then
      observe "unit-$key" "Unit $unit is ${state:-unknown} on $host."
    fi
  else
    # Keep, but do not advance, a unit condition seen before maintenance.
    if [[ -f "$state_dir/conditions/unit-$key" ]]; then
      active_keys="${active_keys}unit-$key "
    fi
  fi
  # NRestarts counts only automatic Restart= restarts; a manual start or
  # restart resets it, so crashes just before a deployment can be missed.
  # State: "<last count> <last alert epoch>"; alerts repeat at most once per
  # repeat interval during a crash loop.
  restarts="$(systemctl show "$unit" --property=NRestarts --value 2>/dev/null)" || restarts=""
  if [[ "$restarts" =~ ^[0-9]+$ ]]; then
    file="$state_dir/restarts/$key"
    previous=""
    last=0
    if [[ -f "$file" ]]; then
      read -r previous last < "$file" || true
    fi
    [[ "$last" =~ ^[0-9]+$ ]] || last=0
    if [[ "$previous" =~ ^[0-9]+$ ]] && (( restarts > previous )); then
      if (( last == 0 || now - last >= repeat_minutes * 60 )); then
        if alert "Unit $unit restarted automatically $((restarts - previous)) time(s) since the last check on $host; inspect journalctl -u $unit."; then
          last="$now"
        fi
      else
        echo "Unit $unit restarted again; alert suppressed until the repeat interval passes." >&2
      fi
    fi
    printf '%s %s\n' "$restarts" "$last" > "$file"
  fi
done

if [[ "$docker_health" == "true" ]] && command -v docker >/dev/null; then
  if unhealthy="$(docker ps --filter health=unhealthy --format '{{.Names}}' 2>/dev/null)" &&
    restarting="$(docker ps --filter status=restarting --format '{{.Names}}' 2>/dev/null)"; then
    for name in $unhealthy; do
      observe "container-$(key_for "$name")" "Container $name is unhealthy on $host."
    done
    for name in $restarting; do
      observe "container-restarting-$(key_for "$name")" "Container $name is restarting repeatedly on $host."
    done
  else
    observe "docker-unreadable" "Cannot list containers on $host."
  fi
fi

# Report recovery for alerted conditions that cleared, and forget the rest.
set +f
for file in "$state_dir"/conditions/*; do
  [[ -f "$file" ]] || continue
  key="$(basename "$file")"
  case "$active_keys" in
    *" $key "*) continue ;;
  esac
  count=0
  last=0
  read -r count last < "$file" || true
  # Keep the state for a retry when the recovery alert cannot be dispatched.
  if [[ "$last" =~ ^[0-9]+$ ]] && (( last > 0 )); then
    alert "Recovered: $key on $host." || continue
  fi
  rm -f -- "$file"
done

if (( failures > 0 )); then
  echo "Host watch could not dispatch $failures alert(s)." >&2
  exit 1
fi
