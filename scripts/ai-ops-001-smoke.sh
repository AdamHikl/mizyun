#!/usr/bin/env bash
#
# AI-OPS-001 native smoke check.
#
# Boots two API replicas:
#   - free tier on :4000 (3 req/min, 5k tokens/day)
#   - paid tier on :4001 (6 req/min, 100k tokens/day)
#
# Asserts the per-tier limits without ever calling an external model
# (`AGENT_PROVIDER=disabled`, `AI_EXTERNAL_ACCESS=false`). The
# script tears both replicas down on exit and is safe to run
# repeatedly.
#
# Pre-requisites:
#   - `supabase start` (or `pnpm db:start`) is running locally
#   - `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` are exported
#   - `MIZYUN_SMOKE_EMAIL` and `MIZYUN_SMOKE_PASSWORD` point at a
#     disposable Auth identity created by an earlier
#     `pnpm --filter @mizyun/mobile auth:bootstrap` invocation.
#     No real user data lands in fixtures.

set -euo pipefail

FREE_PORT="${FREE_PORT:-4000}"
PAID_PORT="${PAID_PORT:-4001}"
BASE_URL_FREE="http://127.0.0.1:${FREE_PORT}"
BASE_URL_PAID="http://127.0.0.1:${PAID_PORT}"

DISPOSABLE_EMAIL="${MIZYUN_SMOKE_EMAIL:-smoke+ai-ops-001@mizyun.test}"
DISPOSABLE_PASSWORD="${MIZYUN_SMOKE_PASSWORD:-smoke-only-do-not-reuse}"

FREE_PID=""
PAID_PID=""

cleanup() {
  local exit_code=$?
  if [[ -n "${FREE_PID}" ]]; then
    kill "${FREE_PID}" 2>/dev/null || true
  fi
  if [[ -n "${PAID_PID}" ]]; then
    kill "${PAID_PID}" 2>/dev/null || true
  fi
  wait 2>/dev/null || true
  exit "${exit_code}"
}
trap cleanup EXIT INT TERM

wait_for_http() {
  local url="$1"
  local attempts=40
  while (( attempts > 0 )); do
    if curl -fsS -o /dev/null "${url}/v1/health" 2>/dev/null; then
      return 0
    fi
    attempts=$(( attempts - 1 ))
    sleep 0.5
  done
  return 1
}

start_replica() {
  local port="$1"
  local tier="$2"
  local log_file="/tmp/ai-ops-001-${tier}-${port}.log"
  echo "starting ${tier} replica on :${port} (log: ${log_file})"
  (
    cd "$(dirname "$0")/.."
    env \
      API_PORT="${port}" \
      AI_USER_TIER_OVERRIDE="${tier}" \
      AGENT_PROVIDER=disabled \
      AI_EXTERNAL_ACCESS=false \
      pnpm dev > "${log_file}" 2>&1 &
    echo $!
  )
}

assert_eq() {
  local label="$1"
  local expected="$2"
  local actual="$3"
  if [[ "${expected}" != "${actual}" ]]; then
    echo "FAIL: ${label}: expected ${expected}, got ${actual}" >&2
    exit 1
  fi
  echo "ok: ${label} -> ${actual}"
}

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "missing required env: ${name}" >&2
    exit 1
  fi
}

require_env SUPABASE_URL
require_env SUPABASE_PUBLISHABLE_KEY

FREE_PID="$(start_replica "${FREE_PORT}" "free")"
PAID_PID="$(start_replica "${PAID_PORT}" "paid")"

if ! wait_for_http "${BASE_URL_FREE}"; then
  echo "free-tier replica never became ready" >&2
  exit 1
fi
if ! wait_for_http "${BASE_URL_PAID}"; then
  echo "paid-tier replica never became ready" >&2
  exit 1
fi

echo "obtaining access token for disposable user ${DISPOSABLE_EMAIL}"
TOKEN_JSON="$(curl -fsS -X POST \
  "${SUPABASE_URL}/auth/v1/token?grant_type=password" \
  -H "apikey: ${SUPABASE_PUBLISHABLE_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${DISPOSABLE_EMAIL}\",\"password\":\"${DISPOSABLE_PASSWORD}\"}")"
ACCESS_TOKEN="$(printf '%s' "${TOKEN_JSON}" | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')"
if [[ -z "${ACCESS_TOKEN}" ]]; then
  echo "failed to obtain access token; ensure the disposable user exists" >&2
  exit 1
fi

create_conversation() {
  local base_url="$1"
  curl -fsS -X POST "${base_url}/v1/coach/conversations" \
    -H "authorization: Bearer ${ACCESS_TOKEN}" \
    -H "Content-Type: application/json" \
    -d '{"title":"AI-OPS-001 smoke"}' \
  | sed -n 's/.*"id":"\([^"]*\)".*/\1/p'
}

send_message() {
  local base_url="$1"
  local conversation_id="$2"
  local idempotency_key="$3"
  local message="$4"
  curl -s -o /dev/null -w "%{http_code}\n" \
    -X POST "${base_url}/v1/coach/conversations/${conversation_id}/messages" \
    -H "authorization: Bearer ${ACCESS_TOKEN}" \
    -H "idempotency-key: ${idempotency_key}" \
    -H "Content-Type: application/json" \
    -d "{\"text\":\"${message}\"}"
}

FREE_CONV="$(create_conversation "${BASE_URL_FREE}")"
PAID_CONV="$(create_conversation "${BASE_URL_PAID}")"

# Free tier: 3 grounded Coach requests succeed, the 4th is rate-limited.
assert_eq "free-tier 1" "200" "$(send_message "${BASE_URL_FREE}" "${FREE_CONV}" "free-smoke-001" "What is one sensible next step today?")"
assert_eq "free-tier 2" "200" "$(send_message "${BASE_URL_FREE}" "${FREE_CONV}" "free-smoke-002" "What is one sensible next step today?")"
assert_eq "free-tier 3" "200" "$(send_message "${BASE_URL_FREE}" "${FREE_CONV}" "free-smoke-003" "What is one sensible next step today?")"
assert_eq "free-tier 4 (limited)" "429" "$(send_message "${BASE_URL_FREE}" "${FREE_CONV}" "free-smoke-004" "What is one sensible next step today?")"

# Paid tier: 4 grounded Coach requests succeed (would have been limited
# under the free-tier override but is allowed by the paid cap of 6/min).
assert_eq "paid-tier 1" "200" "$(send_message "${BASE_URL_PAID}" "${PAID_CONV}" "paid-smoke-001" "What is one sensible next step today?")"
assert_eq "paid-tier 2" "200" "$(send_message "${BASE_URL_PAID}" "${PAID_CONV}" "paid-smoke-002" "What is one sensible next step today?")"
assert_eq "paid-tier 3" "200" "$(send_message "${BASE_URL_PAID}" "${PAID_CONV}" "paid-smoke-003" "What is one sensible next step today?")"
assert_eq "paid-tier 4" "200" "$(send_message "${BASE_URL_PAID}" "${PAID_CONV}" "paid-smoke-004" "What is one sensible next step today?")"

echo "AI-OPS-001 smoke passed: free tier limited at 4th, paid tier allowed 4."
