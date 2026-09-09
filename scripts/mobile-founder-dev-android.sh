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

# Founder Mac: Android SDK + Java are installed but not exported in the shell.
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$ANDROID_HOME}"
if [[ -z "${JAVA_HOME:-}" ]]; then
  if [[ -x "$HOME/.gradle/jdks/eclipse_adoptium-17-aarch64-os_x.2/jdk-17.0.19+10/Contents/Home/bin/java" ]]; then
    export JAVA_HOME="$HOME/.gradle/jdks/eclipse_adoptium-17-aarch64-os_x.2/jdk-17.0.19+10/Contents/Home"
  elif [[ -x /Applications/Android\ Studio.app/Contents/jbr/Contents/Home/bin/java ]]; then
    export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
  elif [[ -x /opt/homebrew/opt/openjdk@17/bin/java ]]; then
    export JAVA_HOME=/opt/homebrew/opt/openjdk@17
  elif [[ -x /opt/homebrew/opt/openjdk/bin/java ]]; then
    export JAVA_HOME=/opt/homebrew/opt/openjdk
  fi
fi
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"

check_dev_app_id() {
  if [[ -d "$repo_root/apps/mobile/android" ]]; then
    current_app_id="$(grep "applicationId" "$repo_root/apps/mobile/android/app/build.gradle" | head -n 1 | awk '{print $2}' | tr -d "'\"" || true)"
    if [[ -z "$current_app_id" || "$current_app_id" != "com.mizyun.dev" ]]; then
      echo "ERROR: Native Android directory has invalid or mismatched application ID '$current_app_id' (expected 'com.mizyun.dev'). Run prebuild first: pnpm mobile:founder-dev:android:prebuild" >&2
      exit 1
    fi
  fi
}

cd "$repo_root"
case "$action" in
  prebuild)
    shift
    exec pnpm --filter @mizyun/mobile exec expo prebuild --clean --platform android "$@"
    ;;
  assembleRelease)
    shift
    check_dev_app_id
    exec "$repo_root/apps/mobile/android/gradlew" \
      --project-dir "$repo_root/apps/mobile/android" \
      :app:assembleRelease "$@"
    ;;
  assembleDebug)
    shift
    check_dev_app_id
    exec "$repo_root/apps/mobile/android/gradlew" \
      --project-dir "$repo_root/apps/mobile/android" \
      :app:assembleDebug "$@"
    ;;
  run)
    shift
    check_dev_app_id
    exec pnpm --filter @mizyun/mobile exec expo run:android "$@"
    ;;
  *)
    echo "Usage: $0 <prebuild|assembleRelease|assembleDebug|run> [Arguments...]" >&2
    exit 2
    ;;
esac
