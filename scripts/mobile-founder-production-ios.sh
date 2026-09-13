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
export MIZYUN_IOS_DISABLE_PUSH="${MIZYUN_IOS_DISABLE_PUSH:-0}"
export MIZYUN_ENABLE_APPLE_AUTH="${MIZYUN_ENABLE_APPLE_AUTH:-1}"

cd "$repo_root"
case "$action" in
  prebuild)
    shift
    exec pnpm --filter @mizyun/mobile exec expo prebuild --clean --platform ios "$@"
    ;;
  run)
    shift
    if [[ -d "$repo_root/apps/mobile/ios" ]]; then
      current_bundle_id="$(grep -m1 'PRODUCT_BUNDLE_IDENTIFIER =' "$repo_root/apps/mobile/ios/Mizyun.xcodeproj/project.pbxproj" | tr -d ';\t ' | cut -d= -f2 || true)"
      if [[ -z "$current_bundle_id" || "$current_bundle_id" != "com.mizyun.app" ]]; then
        echo "ERROR: Native iOS directory has invalid or mismatched bundle ID '$current_bundle_id', but requested variant is '$MIZYUN_APP_VARIANT' (expected 'com.mizyun.app'). Run prebuild first: pnpm mobile:founder-production:ios:prebuild" >&2
        exit 1
      fi
    fi
    # AI-ACT-006 era: Apple's Personal Team provisioning profiles
    # expire after 7 days, so `expo run:ios` (which does not pass
    # `-allowProvisioningUpdates` to xcodebuild) fails on the
    # second week with "No profiles for 'com.mizyun.app' were found".
    # When the new-build flag is passed (or when CI/daily-job uses
    # it), fall back to a direct xcodebuild invocation that lets
    # Xcode refresh the profile and the device install. The Expo
    # happy path is still used for greenfield builds where the
    # profile is fresh.
    if [[ "${1:-}" == "--renew-profile" ]]; then
      shift
      xcodebuild_args=(
        -workspace "$repo_root/apps/mobile/ios/Mizyun.xcworkspace"
        -scheme Mizyun
        -configuration Release
        -destination "generic/platform=iOS"
        -allowProvisioningUpdates
        CODE_SIGN_STYLE=Automatic
        DEVELOPMENT_TEAM=LQJNDVBL43
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
