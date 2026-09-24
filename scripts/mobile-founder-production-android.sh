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

# Founder Mac: Android SDK + Java are installed but not exported in the shell.
# Point Gradle at them so the build doesn't fail on a missing tool.
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$ANDROID_HOME}"
if [[ -z "${JAVA_HOME:-}" ]]; then
  # AGP 8 / React Native 0.86 are happiest on JDK 17. Prefer a Temurin 17
  # that Gradle auto-downloads; fall back to Android Studio's JBR (21) and
  # then to Homebrew openjdk. JDK 26 (Homebrew `openjdk`) is intentionally
  # avoided — its jlink transform breaks `JdkImageTransform` in AGP.
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

cd "$repo_root"
case "$action" in
  prebuild)
    shift
    exec pnpm --filter @mizyun/mobile exec expo prebuild --clean --platform android "$@"
    ;;
  assembleRelease)
    shift
    if [[ -d "$repo_root/apps/mobile/android" ]]; then
      current_app_id="$(grep "applicationId" "$repo_root/apps/mobile/android/app/build.gradle" | head -n 1 | awk '{print $2}' | tr -d "'\"" || true)"
      if [[ -z "$current_app_id" || "$current_app_id" != "com.mizyun.app" ]]; then
        echo "ERROR: Native Android directory has invalid or mismatched application ID '$current_app_id' (expected 'com.mizyun.app'). Run prebuild first." >&2
        exit 1
      fi
    fi
    # Direct gradle invocation: this is the iOS analogue of
    # `expo run:ios --configuration Release` but without requiring a
    # connected device. The release variant bakes the production JS
    # bundle into the APK (via `expo export:embed` from
    # app/build.gradle) and signs it with the debug keystore that
    # `expo prebuild` materialised in android/app/debug.keystore.
    # That is the same model the founder iOS build uses on Adam's
    # personal team — it is fine for a single-founder sideload to
    # Adam's own device, not a Play Store release.
    exec "$repo_root/apps/mobile/android/gradlew" \
      --project-dir "$repo_root/apps/mobile/android" \
      :app:assembleRelease "$@"
    ;;
  bundleRelease)
    shift
    if [[ -n "$(git -C "$repo_root" status --porcelain --untracked-files=normal)" ]]; then
      echo "ERROR: Production App Bundle builds require a clean committed working tree." >&2
      exit 1
    fi
    read -r expected_version_name expected_version_code < <(
      node -e '
        const { expo } = require(process.argv[1]);
        process.stdout.write(`${expo.version} ${expo.android.versionCode}\n`);
      ' "$repo_root/apps/mobile/app.json"
    )
    if [[ -d "$repo_root/apps/mobile/android" ]]; then
      current_app_id="$(grep "applicationId" "$repo_root/apps/mobile/android/app/build.gradle" | head -n 1 | awk '{print $2}' | tr -d "'\"" || true)"
      if [[ -z "$current_app_id" || "$current_app_id" != "com.mizyun.app" ]]; then
        echo "ERROR: Native Android directory has invalid or mismatched application ID '$current_app_id' (expected 'com.mizyun.app'). Run prebuild first." >&2
        exit 1
      fi
      current_version_code="$(awk '/^[[:space:]]*versionCode[[:space:]]/ { print $2; exit }' "$repo_root/apps/mobile/android/app/build.gradle" | tr -d "'\"" || true)"
      current_version_name="$(awk '/^[[:space:]]*versionName[[:space:]]/ { print $2; exit }' "$repo_root/apps/mobile/android/app/build.gradle" | tr -d "'\"" || true)"
      if [[ "$current_version_name" != "$expected_version_name" || "$current_version_code" != "$expected_version_code" ]]; then
        echo "ERROR: Native Android version tuple is ${current_version_name:-missing}/${current_version_code:-missing}; expected $expected_version_name/$expected_version_code. Run prebuild first." >&2
        exit 1
      fi
    fi
    "$repo_root/apps/mobile/android/gradlew" \
      --project-dir "$repo_root/apps/mobile/android" \
      :app:bundleRelease "$@"
    aab_path="$repo_root/apps/mobile/android/app/build/outputs/bundle/release/app-release.aab"
    metadata_path="$aab_path.build.json"
    if [[ ! -f "$aab_path" ]]; then
      echo "ERROR: Gradle completed without producing $aab_path" >&2
      exit 1
    fi
    source_sha="$(git -C "$repo_root" rev-parse HEAD)"
    aab_sha256="$(shasum -a 256 "$aab_path" | awk '{print $1}')"
    metadata_staging="$metadata_path.tmp.$$"
    node -e '
      const { readFileSync, writeFileSync } = require("node:fs");
      const [appJsonPath, outputPath, sourceCommit, inputSha256] = process.argv.slice(1);
      const { expo } = JSON.parse(readFileSync(appJsonPath, "utf8"));
      writeFileSync(outputPath, JSON.stringify({
        sourceCommit,
        bundleIdentifier: expo.android.package,
        version: expo.version,
        versionCode: expo.android.versionCode,
        inputSha256,
      }, null, 2) + "\n");
    ' "$repo_root/apps/mobile/app.json" "$metadata_staging" "$source_sha" "$aab_sha256"
    mv "$metadata_staging" "$metadata_path"
    echo "Build provenance: $metadata_path"
    ;;
  *)
    echo "Usage: $0 <prebuild|assembleRelease|bundleRelease> [Gradle arguments...]" >&2
    exit 2
    ;;
esac
