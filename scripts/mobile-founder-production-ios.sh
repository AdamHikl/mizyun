#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
production_env="$repo_root/apps/mobile/.env.production"
action="${1:-}"

if [[ ! -r "$production_env" ]]; then
  echo "Cannot read $production_env." >&2
  exit 2
fi

set -a
# shellcheck disable=SC1090
source "$production_env"
set +a

: "${EXPO_PUBLIC_API_URL:?missing production API URL}"
: "${EXPO_PUBLIC_SUPABASE_URL:?missing production Supabase URL}"
: "${EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY:?missing production Supabase publishable key}"
: "${EXPO_PUBLIC_AUTH_REDIRECT_URI:?missing production Auth redirect URI}"

if [[ "$EXPO_PUBLIC_API_URL" != "https://mizyun-api.phiskel.com" ]]; then
  echo "Refusing founder-production build with unexpected API URL." >&2
  exit 2
fi
if [[ "$EXPO_PUBLIC_SUPABASE_URL" != "https://mizyun-supabase.phiskel.com" ]]; then
  echo "Refusing founder-production build with unexpected Supabase URL." >&2
  exit 2
fi
if [[ "$EXPO_PUBLIC_AUTH_REDIRECT_URI" != "mizyun://auth/callback" ]]; then
  echo "Refusing founder-production build with unexpected Auth redirect URI." >&2
  exit 2
fi

# Expo documents standard dotenv precedence, where `.env.local` overrides
# environment-specific files. Disable automatic dotenv loading after exporting
# the reviewed production file so the Mac development endpoints cannot win.
export EXPO_NO_DOTENV=1
export MIZYUN_APP_VARIANT=production
export MIZYUN_IOS_DISABLE_PUSH=1

cd "$repo_root"
case "$action" in
  prebuild)
    shift
    exec pnpm --filter @mizyun/mobile exec expo prebuild --clean --platform ios "$@"
    ;;
  run)
    shift
    exec pnpm --filter @mizyun/mobile exec expo run:ios --configuration Release "$@"
    ;;
  *)
    echo "Usage: $0 <prebuild|run> [Expo arguments...]" >&2
    exit 2
    ;;
esac
