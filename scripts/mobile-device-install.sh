#!/usr/bin/env bash
set -Eeuo pipefail

# CocoaPods fails with Encoding::CompatibilityError under a non-UTF-8 locale.
export LANG="${LANG:-en_US.UTF-8}"
export LC_ALL="${LC_ALL:-$LANG}"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  cat <<'EOF'
Usage: bash scripts/mobile-device-install.sh <ios|android> <dev|production> [options]

Platforms:
  ios         Build and install for Apple iOS device
  android     Build and install for Android device

Variants:
  dev         Development build (com.mizyun.development / com.mizyun.dev)
  production  Production build  (com.mizyun.app / com.mizyun.app)

Options:
  --device <id>       Specify device UDID / CoreDevice ID (iOS) or Serial (Android)
  --no-launch         Skip launching the app after installation
  --clean             Force a clean expo prebuild before compiling
  --renew-profile     Force automatic provisioning profile renewal (iOS)
  --dry-run           Perform preflight checks and device detection without building/installing
  -h, --help          Show this help message

Examples:
  bash scripts/mobile-device-install.sh ios dev
  bash scripts/mobile-device-install.sh ios production
  bash scripts/mobile-device-install.sh android dev
  bash scripts/mobile-device-install.sh android production
  bash scripts/mobile-device-install.sh ios dev --dry-run
EOF
}

if [[ $# -lt 2 ]]; then
  usage
  exit 2
fi

platform="${1:-}"
variant="${2:-}"
shift 2

# Normalize variant
case "$variant" in
  dev|development)
    variant="dev"
    ;;
  prod|production)
    variant="production"
    ;;
  *)
    echo "ERROR: Invalid variant '$variant'. Must be 'dev' or 'production'." >&2
    usage
    exit 2
    ;;
esac

# Parse options
target_device=""
flag_no_launch=0
flag_clean=0
flag_renew_profile=0
flag_dry_run=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --device)
      target_device="${2:-}"
      if [[ -z "$target_device" ]]; then
        echo "ERROR: --device requires an identifier argument." >&2
        exit 2
      fi
      shift 2
      ;;
    --no-launch)
      flag_no_launch=1
      shift
      ;;
    --clean)
      flag_clean=1
      shift
      ;;
    --renew-profile)
      flag_renew_profile=1
      shift
      ;;
    --dry-run)
      flag_dry_run=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "ERROR: Unknown option '$1'." >&2
      usage
      exit 2
      ;;
  esac
done

# -----------------------------------------------------------------------------
# 1. Environment & Config Validation
# -----------------------------------------------------------------------------
if [[ "$variant" == "dev" ]]; then
  env_file="$repo_root/apps/mobile/.env.dev"
  expected_api="https://mizyun-api-dev.phiskel.com"
  expected_supabase="https://mizyun-supabase-dev.phiskel.com"
  expected_auth="mizyun-dev://auth/callback"
  ios_bundle_id="com.mizyun.development"
  android_package="com.mizyun.dev"
  app_name="Mizyun Dev"
else
  env_file="$repo_root/apps/mobile/.env.production"
  expected_api="https://mizyun-api.phiskel.com"
  expected_supabase="https://mizyun-supabase.phiskel.com"
  expected_auth="mizyun://auth/callback"
  ios_bundle_id="com.mizyun.app"
  android_package="com.mizyun.app"
  app_name="Mizyun"
fi

if [[ ! -r "$env_file" ]]; then
  echo "ERROR: Cannot read environment file $env_file" >&2
  exit 2
fi

set -a
# shellcheck disable=SC1090
source "$env_file"
set +a

: "${EXPO_PUBLIC_API_URL:?missing API URL in $env_file}"
: "${EXPO_PUBLIC_SUPABASE_URL:?missing Supabase URL in $env_file}"
: "${EXPO_PUBLIC_AUTH_REDIRECT_URI:?missing Auth redirect URI in $env_file}"

if [[ "$EXPO_PUBLIC_API_URL" != "$expected_api" ]]; then
  echo "ERROR: Refusing build with unexpected API URL '$EXPO_PUBLIC_API_URL' (expected '$expected_api')" >&2
  exit 2
fi
if [[ "$EXPO_PUBLIC_SUPABASE_URL" != "$expected_supabase" ]]; then
  echo "ERROR: Refusing build with unexpected Supabase URL '$EXPO_PUBLIC_SUPABASE_URL' (expected '$expected_supabase')" >&2
  exit 2
fi
if [[ "$EXPO_PUBLIC_AUTH_REDIRECT_URI" != "$expected_auth" ]]; then
  echo "ERROR: Refusing build with unexpected Auth redirect URI '$EXPO_PUBLIC_AUTH_REDIRECT_URI' (expected '$expected_auth')" >&2
  exit 2
fi

export EXPO_NO_DOTENV=1
export MIZYUN_APP_VARIANT="$variant"
export MIZYUN_IOS_DISABLE_PUSH="${MIZYUN_IOS_DISABLE_PUSH:-0}"
export MIZYUN_ENABLE_APPLE_AUTH="${MIZYUN_ENABLE_APPLE_AUTH:-1}"

# Paid Apple Developer Team (itinn s.r.o.)
export APPLE_DEVELOPMENT_TEAM="LQJNDVBL43"

# -----------------------------------------------------------------------------
# 2. Platform Specific Implementations
# -----------------------------------------------------------------------------

install_ios() {
  echo "=== [iOS] Installing $app_name ($variant) ==="

  # Check Xcode toolchain
  if ! command -v xcrun &>/dev/null; then
    echo "ERROR: xcrun not found. Ensure Xcode command-line tools are installed." >&2
    exit 1
  fi

  # Auto-detect connected iOS device if not specified
  device_id="$target_device"
  device_name="Selected Device"

  # A trailing-X template works with both BSD and GNU mktemp.
  # Keep this variable in script scope so EXIT can clean up after a return too.
  tmp_json=""
  cleanup_ios_device_json() {
    if [[ -n "$tmp_json" ]]; then
      rm -f -- "$tmp_json"
      tmp_json=""
    fi
  }
  trap cleanup_ios_device_json EXIT
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM
  tmp_json="$(mktemp "${TMPDIR:-/tmp}/mizyun-devicectl.XXXXXX")"
  # devicectl output
  xcrun devicectl list devices --json-output "$tmp_json" >/dev/null 2>&1 || true

  if [[ -n "$device_id" && -s "$tmp_json" ]]; then
    # Verify specified iOS device exists and is available
    device_info="$(node -e '
      try {
        const fs = require("fs");
        const json = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
        const devices = json?.result?.devices || [];
        const match = devices.find(d =>
          d.hardwareProperties?.udid === process.argv[2] ||
          d.properties?.hardware?.udid === process.argv[2] ||
          d.identifier === process.argv[2] ||
          d.deviceProperties?.name === process.argv[2] ||
          d.properties?.state?.name === process.argv[2]
        );
        if (match) {
          const name = match.deviceProperties?.name || match.properties?.state?.name || "Specified iPhone";
          const udid = match.hardwareProperties?.udid || match.properties?.hardware?.udid || match.identifier;
          console.log(`${udid}\t${name}`);
        }
      } catch (e) {}
    ' "$tmp_json" "$device_id")"
    if [[ -z "$device_info" ]]; then
      echo "ERROR: Specified iOS device '$device_id' not found or not connected." >&2
      exit 1
    fi
    device_id="$(echo "$device_info" | cut -f1)"
    device_name="$(echo "$device_info" | cut -f2)"
  elif [[ -z "$device_id" && -s "$tmp_json" ]]; then
    # Find paired physical iOS device
    device_info="$(node -e '
      try {
        const fs = require("fs");
        const json = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
        const devices = json?.result?.devices || [];
        const physical = devices.filter(d =>
          (d.hardwareProperties?.reality === "physical" || d.properties?.hardware?.reality === "physical") &&
          (d.properties?.connection?.pairingState === "paired" || d.connectionProperties?.pairingState === "paired")
        );
        if (physical.length > 0) {
          const d = physical[0];
          const name = d.deviceProperties?.name || d.properties?.state?.name || "Unknown iPhone";
          const udid = d.hardwareProperties?.udid || d.properties?.hardware?.udid || d.identifier;
          console.log(`${udid}\t${name}`);
        }
      } catch (e) {}
    ' "$tmp_json")"

    if [[ -n "$device_info" ]]; then
      device_id="$(echo "$device_info" | cut -f1)"
      device_name="$(echo "$device_info" | cut -f2)"
    fi
  fi
  cleanup_ios_device_json

  if [[ -z "$device_id" ]]; then
    echo "ERROR: No physical iOS device found paired and available." >&2
    echo "Troubleshooting:" >&2
    echo "  1. Connect your iPhone via USB cable or ensure local network pairing is active." >&2
    echo "  2. Unlock your iPhone with your passcode." >&2
    echo "  3. Verify Developer Mode is enabled: Settings -> Privacy & Security -> Developer Mode -> On." >&2
    echo "  4. Check paired devices with: xcrun devicectl list devices" >&2
    echo "  5. Or specify explicit identifier: --device <UDID>" >&2
    exit 1
  fi

  echo "Target Device: $device_name ($device_id)"
  echo "Target Bundle ID: $ios_bundle_id"

  # Check native project drift
  ios_dir="$repo_root/apps/mobile/ios"
  need_prebuild=$flag_clean

  if [[ ! -d "$ios_dir" ]]; then
    echo "Native iOS directory missing. Triggering clean prebuild..."
    need_prebuild=1
  else
    project_file="$(find "$ios_dir" -maxdepth 2 -path '*/Mizyun*/project.pbxproj' 2>/dev/null | head -n1 || true)"
    if [[ -z "$project_file" || ! -r "$project_file" ]]; then
      echo "Cannot find project.pbxproj in $ios_dir. Triggering clean prebuild..."
      need_prebuild=1
    else
      current_bundle_id="$(grep -m1 'PRODUCT_BUNDLE_IDENTIFIER =' "$project_file" 2>/dev/null | tr -d ';\t ' | cut -d= -f2 || true)"
      if [[ "$current_bundle_id" != "$ios_bundle_id" ]]; then
        echo "Native iOS bundle ID is '$current_bundle_id', but target variant '$variant' requires '$ios_bundle_id'."
        echo "Automatically synchronizing native iOS project with clean prebuild..."
        need_prebuild=1
      fi
    fi
  fi

  # A same-bundle native project may have been generated with Apple auth disabled.
  if [[ "$variant" == "dev" && "$MIZYUN_ENABLE_APPLE_AUTH" == "1" && $need_prebuild -eq 0 ]]; then
    if ! node "$repo_root/scripts/verify-ios-apple-auth.mjs" "$ios_dir/MizyunDev/MizyunDev.entitlements"; then
      echo "Dev native Apple sign-in capability missing. Synchronizing with clean prebuild..."
      need_prebuild=1
    fi
  fi

  if [[ $need_prebuild -eq 1 ]]; then
    echo "Running: pnpm --filter @mizyun/mobile exec expo prebuild --clean --platform ios"
    if [[ $flag_dry_run -eq 0 ]]; then
      cd "$repo_root"
      pnpm --filter @mizyun/mobile exec expo prebuild --clean --platform ios
    fi
  fi

  # Discover workspace & scheme
  workspace_file="$(find "$repo_root/apps/mobile/ios" -maxdepth 1 -name 'Mizyun*.xcworkspace' 2>/dev/null | head -n1 || true)"
  if [[ -z "$workspace_file" ]]; then
    echo "ERROR: Mizyun.xcworkspace not found in apps/mobile/ios after prebuild." >&2
    exit 1
  fi
  scheme_name="$(basename "$workspace_file" .xcworkspace)"
  derived_data="$repo_root/apps/mobile/ios/build"

  echo "Xcode Workspace: $workspace_file"
  echo "Xcode Scheme: $scheme_name"
  echo "Development Team: $APPLE_DEVELOPMENT_TEAM (itinn s.r.o.)"

  if [[ $flag_dry_run -eq 1 ]]; then
    echo "[DRY RUN] Would execute:"
    echo "  1. xcodebuild -workspace '$workspace_file' -scheme '$scheme_name' -configuration Release -destination 'generic/platform=iOS' -allowProvisioningUpdates CODE_SIGN_STYLE=Automatic DEVELOPMENT_TEAM=$APPLE_DEVELOPMENT_TEAM -derivedDataPath '$derived_data' build"
    echo "  2. xcrun devicectl device install app --device '$device_id' '$derived_data/Build/Products/Release-iphoneos/$scheme_name.app'"
    if [[ $flag_no_launch -eq 0 ]]; then
      echo "  3. xcrun devicectl device process launch --device '$device_id' --terminate-existing '$ios_bundle_id'"
    fi
    echo "[DRY RUN] Preflight completed successfully."
    exit 0
  fi

  # Build standalone release .app
  echo "Building standalone Release binary via xcodebuild..."
  xcodebuild \
    -workspace "$workspace_file" \
    -scheme "$scheme_name" \
    -configuration Release \
    -destination "generic/platform=iOS" \
    -allowProvisioningUpdates \
    CODE_SIGN_STYLE=Automatic \
    DEVELOPMENT_TEAM="$APPLE_DEVELOPMENT_TEAM" \
    -derivedDataPath "$derived_data" \
    build

  app_bundle_path="$derived_data/Build/Products/Release-iphoneos/$scheme_name.app"
  if [[ ! -d "$app_bundle_path" ]]; then
    echo "ERROR: Built application bundle not found at $app_bundle_path" >&2
    exit 1
  fi

  if [[ "$variant" == "dev" && "$MIZYUN_ENABLE_APPLE_AUTH" == "1" ]]; then
    node "$repo_root/scripts/verify-ios-apple-auth.mjs" --signed "$app_bundle_path"
  fi

  echo "Installing application onto $device_name ($device_id)..."
  if ! xcrun devicectl device install app --device "$device_id" "$app_bundle_path"; then
    echo "ERROR: Installation failed. Ensure your iPhone is unlocked and Developer Mode is enabled." >&2
    exit 1
  fi
  echo "Installation successful."

  # Terminate rogue Metro on 8081 if running to guarantee Mac-off verification
  lsof -ti :8081 | xargs kill -9 2>/dev/null || true

  launched_pid=""
  if [[ $flag_no_launch -eq 0 ]]; then
    echo "Launching application on device ($ios_bundle_id)..."
    launch_output="$(xcrun devicectl device process launch --device "$device_id" --terminate-existing "$ios_bundle_id" 2>&1 || true)"
    echo "$launch_output"
    launched_pid="$(echo "$launch_output" | grep -Eo 'PID: [0-9]+' | cut -d' ' -f2 || true)"
  fi

  # Output markdown evidence block
  echo ""
  echo "================================================================="
  echo "### Mobile Device Acceptance Evidence (iOS)"
  echo "- **Platform / Variant**: iOS / $variant ($app_name)"
  echo "- **Bundle ID**: \`$ios_bundle_id\`"
  echo "- **Device**: $device_name (\`$device_id\`)"
  echo "- **Team**: \`$APPLE_DEVELOPMENT_TEAM\` (itinn s.r.o.)"
  echo "- **Artifact**: \`$app_bundle_path\`"
  if [[ -n "$launched_pid" ]]; then
    echo "- **Launch Verification**: Launched successfully (PID \`$launched_pid\`) without Metro bundler."
  else
    echo "- **Install Verification**: Installed successfully."
  fi
  echo "- **Timestamp**: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo "================================================================="
}

install_android() {
  echo "=== [Android] Installing $app_name ($variant) ==="

  # Setup Android SDK and Java 17
  export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
  export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$ANDROID_HOME}"
  adb_bin="$ANDROID_HOME/platform-tools/adb"

  if ! command -v "$adb_bin" &>/dev/null; then
    echo "ERROR: adb not found at $adb_bin. Ensure Android SDK platform-tools are installed." >&2
    exit 1
  fi

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

  # Auto-detect connected Android device
  device_serial="$target_device"
  device_model="Selected Device"

  if [[ -n "$device_serial" ]]; then
    if ! "$adb_bin" devices | grep -E "^${device_serial}[[:space:]]+device$" >/dev/null; then
      echo "ERROR: Specified Android device '$device_serial' not found or not authorized via ADB." >&2
      exit 1
    fi
  else
    # Parse adb devices -l
    device_line="$("$adb_bin" devices -l | awk '$2=="device" {print $0; exit}')"
    if [[ -n "$device_line" ]]; then
      device_serial="$(echo "$device_line" | awk '{print $1}')"
      device_model="$(echo "$device_line" | grep -Eo 'model:[^ ]+' | cut -d: -f2 || echo "$device_serial")"
    else
      # Check if any unauthorized devices exist
      unauth="$("$adb_bin" devices | awk '$2=="unauthorized" {print $1; exit}')"
      if [[ -n "$unauth" ]]; then
        echo "ERROR: Android device '$unauth' is connected but unauthorized." >&2
        echo "Please unlock the device and tap 'Allow USB debugging' on the screen." >&2
        exit 1
      fi
    fi
  fi

  if [[ -z "$device_serial" ]]; then
    echo "ERROR: No authorized Android device found via ADB." >&2
    echo "Troubleshooting:" >&2
    echo "  1. Connect your Android phone via USB cable." >&2
    echo "  2. Ensure USB Debugging is enabled: Settings -> Developer Options -> USB debugging." >&2
    echo "  3. Unlock phone and approve the 'Allow USB debugging' RSA authorization dialog." >&2
    echo "  4. Check attached devices with: adb devices -l" >&2
    echo "  5. Or specify explicit serial: --device <SERIAL>" >&2
    exit 1
  fi

  echo "Target Device: $device_model ($device_serial)"
  echo "Target Package: $android_package"

  # Check native project drift
  android_dir="$repo_root/apps/mobile/android"
  need_prebuild=$flag_clean

  if [[ ! -d "$android_dir" ]]; then
    echo "Native Android directory missing. Triggering clean prebuild..."
    need_prebuild=1
  else
    build_gradle="$android_dir/app/build.gradle"
    if [[ ! -r "$build_gradle" ]]; then
      echo "Cannot find $build_gradle. Triggering clean prebuild..."
      need_prebuild=1
    else
      current_app_id="$(grep "applicationId" "$build_gradle" 2>/dev/null | head -n 1 | awk '{print $2}' | tr -d "'\"" || true)"
      if [[ "$current_app_id" != "$android_package" ]]; then
        echo "Native Android applicationId is '$current_app_id', but target variant '$variant' requires '$android_package'."
        echo "Automatically synchronizing native Android project with clean prebuild..."
        need_prebuild=1
      fi
    fi
  fi

  if [[ $need_prebuild -eq 1 ]]; then
    echo "Running: pnpm --filter @mizyun/mobile exec expo prebuild --clean --platform android"
    if [[ $flag_dry_run -eq 0 ]]; then
      cd "$repo_root"
      pnpm --filter @mizyun/mobile exec expo prebuild --clean --platform android
    fi
  fi

  apk_path="$repo_root/apps/mobile/android/app/build/outputs/apk/release/app-release.apk"

  if [[ $flag_dry_run -eq 1 ]]; then
    echo "[DRY RUN] Would execute:"
    echo "  1. MIZYUN_ALLOW_DEBUG_KEYSTORE_IN_RELEASE=true ./gradlew :app:assembleRelease"
    echo "  2. adb -s '$device_serial' install -r '$apk_path'"
    if [[ $flag_no_launch -eq 0 ]]; then
      echo "  3. adb -s '$device_serial' shell am start -S -n '$android_package/.MainActivity'"
      echo "  4. adb -s '$device_serial' shell pidof '$android_package'"
    fi
    echo "[DRY RUN] Preflight completed successfully."
    exit 0
  fi

  # Build standalone release APK
  echo "Building standalone Release APK via Gradle assembleRelease..."
  export MIZYUN_ALLOW_DEBUG_KEYSTORE_IN_RELEASE=true
  "$repo_root/apps/mobile/android/gradlew" \
    --project-dir "$repo_root/apps/mobile/android" \
    :app:assembleRelease

  if [[ ! -f "$apk_path" ]]; then
    echo "ERROR: Built APK not found at $apk_path" >&2
    exit 1
  fi

  echo "Installing APK onto $device_model ($device_serial)..."
  if ! "$adb_bin" -s "$device_serial" install -r "$apk_path"; then
    echo "ERROR: Installation failed via ADB." >&2
    exit 1
  fi
  echo "Installation successful."

  # Terminate rogue Metro on 8081 if running to guarantee Mac-off verification
  lsof -ti :8081 | xargs kill -9 2>/dev/null || true

  launched_pid=""
  if [[ $flag_no_launch -eq 0 ]]; then
    echo "Launching application on device ($android_package)..."
    "$adb_bin" -s "$device_serial" shell am start -S -n "$android_package/.MainActivity"
    sleep 1
    launched_pid="$("$adb_bin" -s "$device_serial" shell pidof "$android_package" 2>/dev/null | tr -d '\r\n' || true)"
  fi

  # Output markdown evidence block
  echo ""
  echo "================================================================="
  echo "### Mobile Device Acceptance Evidence (Android)"
  echo "- **Platform / Variant**: Android / $variant ($app_name)"
  echo "- **Package Name**: \`$android_package\`"
  echo "- **Device**: $device_model (\`$device_serial\`)"
  echo "- **Artifact**: \`$apk_path\`"
  if [[ -n "$launched_pid" ]]; then
    echo "- **Launch Verification**: Launched successfully (PID \`$launched_pid\`) without Metro bundler."
  else
    echo "- **Install Verification**: Installed successfully."
  fi
  echo "- **Timestamp**: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo "================================================================="
}

case "$platform" in
  ios)
    install_ios
    ;;
  android)
    install_android
    ;;
  *)
    echo "ERROR: Unknown platform '$platform'. Must be 'ios' or 'android'." >&2
    usage
    exit 2
    ;;
esac
