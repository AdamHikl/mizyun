#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dev_env="$repo_root/apps/mobile/.env.dev"
action="${1:-}"

if [[ ! -r "$dev_env" ]]; then
  echo "Cannot read $dev_env." >&2
  exit 2
fi

set -a
# shellcheck disable=SC1090
source "$dev_env"
set +a

: "${EXPO_PUBLIC_API_URL:?missing dev API URL}"
: "${EXPO_PUBLIC_SUPABASE_URL:?missing dev Supabase URL}"
: "${EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY:?missing dev Supabase publishable key}"
: "${EXPO_PUBLIC_AUTH_REDIRECT_URI:?missing dev Auth redirect URI}"

if [[ "$EXPO_PUBLIC_API_URL" != "https://mizyun-api-dev.phiskel.com" ]]; then
  echo "Refusing founder-dev build with unexpected API URL: $EXPO_PUBLIC_API_URL" >&2
  exit 2
fi
if [[ "$EXPO_PUBLIC_SUPABASE_URL" != "https://mizyun-supabase-dev.phiskel.com" ]]; then
  echo "Refusing founder-dev build with unexpected Supabase URL: $EXPO_PUBLIC_SUPABASE_URL" >&2
  exit 2
fi
if [[ "$EXPO_PUBLIC_AUTH_REDIRECT_URI" != "mizyun-dev://auth/callback" ]]; then
  echo "Refusing founder-dev build with unexpected Auth redirect URI: $EXPO_PUBLIC_AUTH_REDIRECT_URI" >&2
  exit 2
fi

# Expo documents standard dotenv precedence, where `.env.local` overrides
# environment-specific files. Disable automatic dotenv loading after exporting
# the reviewed dev file so the Mac development endpoints cannot win.
export EXPO_NO_DOTENV=1
export MIZYUN_APP_VARIANT=dev
export MIZYUN_IOS_DISABLE_PUSH=1

cd "$repo_root"
case "$action" in
  prebuild)
    shift
    exec pnpm --filter @mizyun/mobile exec expo prebuild --clean --platform ios "$@"
    ;;
  run)
    shift
    if [[ "${1:-}" == "--renew-profile" ]]; then
      shift
      xcodebuild_args=(
        -workspace "$repo_root/apps/mobile/ios/Mizyun.xcworkspace"
        -scheme Mizyun
        -configuration Release
        -destination "generic/platform=iOS"
        -allowProvisioningUpdates
        CODE_SIGN_STYLE=Automatic
        DEVELOPMENT_TEAM=PP89XZBW4U
        build
      )
      exec xcodebuild "${xcodebuild_args[@]}"
    fi
    exec pnpm --filter @mizyun/mobile exec expo run:ios --configuration Release "$@"
    ;;
  *)
    echo "Usage: $0 <prebuild|run> [Expo arguments...]" >&2
    exit 2
    ;;
esac
