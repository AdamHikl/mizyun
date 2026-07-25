#!/usr/bin/env bash
#
# VISION-001 — Photo draft smoke test.
#
# Boots the local Supabase stack + API, signs up a disposable
# user, and exercises POST /v1/food-entries/draft. Run via
# `pnpm vision:smoke`.
#
# Pre-requisites:
#   - pnpm db:start (local Supabase on :54321)
#   - pnpm dev:api (Fastify on :4000 with AGENT_PROVIDER=vision-dev
#     for a deterministic StubVisionProvider)
#
# Disposable user is created on the Auth API; the auth trigger
# auto-creates the profile row. Per AI-MOB-001 conventions:
# no real user data lands here.

set -euo pipefail

API_BASE="${API_BASE:-http://127.0.0.1:4000}"
SUPABASE_URL="${SUPABASE_URL:-http://127.0.0.1:54321}"
ANON_KEY="${SUPABASE_PUBLISHABLE_KEY:?set SUPABASE_PUBLISHABLE_KEY}"
EMAIL="vision-smoke@mizyun.test"
PASSWORD="Sm0kePasswordOnly"

GREEN='\033[0;32m'
RED='\033[0;31m'
RESET='\033[0m'

ok() { printf "${GREEN}ok${RESET}  %s\n" "$*"; }
fail() { printf "${RED}FAIL${RESET} %s\n" "$*"; exit 1; }

cleanup() {
  # Best-effort: delete the disposable user.
  curl -sS -X DELETE "$SUPABASE_URL/auth/v1/admin/users/$USER_ID" \
    -H "apikey: $SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
    > /dev/null 2>&1 || true
}
trap cleanup EXIT

# Service-role key for the admin delete. Read from the local
# Supabase output.
SERVICE_ROLE_KEY=$(pnpm supabase status 2>/dev/null \
  | sed -n 's/^.*"SERVICE_ROLE_KEY": "\([^"]*\)".*/\1/p' | head -1)
[[ -n "$SERVICE_ROLE_KEY" ]] || fail "could not resolve service-role key"

printf "%b\n" "${GREEN}# VISION-001 smoke${RESET}"

# Sign up the disposable user.
printf "  - signing up %s...\n" "$EMAIL"
curl -sS -X POST "$SUPABASE_URL/auth/v1/signup" \
  -H "apikey: $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" \
  > /dev/null || true

# Confirm via admin and resolve the user id.
USER_ID=$(curl -sS "$SUPABASE_URL/auth/v1/admin/users?email=$EMAIL" \
  -H "apikey: $SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  | sed -n 's/.*"id":"\([0-9a-f-]*\)","aud":"authenticated","role":"authenticated","email":"'$EMAIL'".*/\1/p' | head -1)
[[ -n "$USER_ID" ]] || fail "disposable user not found"
curl -sS -X PUT "$SUPABASE_URL/auth/v1/admin/users/$USER_ID" \
  -H "apikey: $SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email_confirm":true}' > /dev/null
ok "user $USER_ID created + confirmed"

# Sign in.
TOKEN=$(curl -sS -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" \
  | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')
[[ -n "$TOKEN" ]] || fail "could not obtain access token"
ok "access token acquired (${#TOKEN} bytes)"

AUTH="authorization: Bearer $TOKEN"

# Build a 1x1 PNG and a multipart body.
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"; cleanup' EXIT
BOUNDARY="----MizyunSmoke$(date +%s)"
# Minimal 1x1 PNG.
printf '\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xf8\xff\xff?\x00\x05\xfe\x02\xfe\xa35\x81\x84\x00\x00\x00\x00IEND\xaeB`\x82' \
  > "$WORK/meal.png"
{
  printf -- "--%s\r\n" "$BOUNDARY"
  printf 'Content-Disposition: form-data; name="textHint"\r\n\r\n'
  printf 'Grilled chicken with rice\r\n'
  printf -- "--%s\r\n" "$BOUNDARY"
  printf 'Content-Disposition: form-data; name="image"; filename="meal.png"\r\n'
  printf 'Content-Type: image/png\r\n\r\n'
  cat "$WORK/meal.png"
  printf '\r\n--%s--\r\n' "$BOUNDARY"
} > "$WORK/draft.bin"

# First draft call → expect 200 + StubVisionProvider candidate.
echo "First call:"
RESP=$(curl -sS -X POST "$API_BASE/v1/food-entries/draft" \
  -H "$AUTH" \
  -H "Content-Type: multipart/form-data; boundary=$BOUNDARY" \
  --data-binary @"$WORK/draft.bin")
echo "$RESP" | head -1
echo "$RESP" | grep -q '"name":"Grilled chicken with rice"' \
  || fail "draft did not return the StubVisionProvider name"
echo "$RESP" | grep -q '"caloriesKcal":350' || fail "draft calories missing"
ok "draft returns the StubVisionProvider candidate"

# Second call → expect 429 (free tier 1/min).
echo "Second call (rate-limited) → expect 429:"
STATUS=$(curl -sS -o /dev/null -w "%{http_code}" -X POST "$API_BASE/v1/food-entries/draft" \
  -H "$AUTH" \
  -H "Content-Type: multipart/form-data; boundary=$BOUNDARY" \
  --data-binary @"$WORK/draft.bin")
[[ "$STATUS" == "429" ]] || fail "second call should be 429, got $STATUS"
ok "second call returns 429 (free tier 1/min)"

# The rate limit fires before validation, so a follow-up
# call with no image is also 429. The "no image → 422" path is
# covered by the route's unit test (apps/api/src/modules/food-entries/draft-route.test.ts).

printf "%b\n" "${GREEN}# VISION-001 smoke passed${RESET}"