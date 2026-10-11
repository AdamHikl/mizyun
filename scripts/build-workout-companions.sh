#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${1:-ios}"
if [[ "${MIZYUN_APP_VARIANT:-dev}" != "dev" || "${MIZYUN_BUILD_PROFILE:-development}" != "development" || "${APP_VARIANT:-development}" != "development" || "${EAS_BUILD_PROFILE:-development}" != "development" ]]; then
  echo "Workout companions are Dev-only. Production is excluded." >&2
  exit 1
fi
case "$TARGET" in
  ios)
    exec xcodebuild -project "$ROOT/apps/watch-ios/MizyunWorkoutWatchDev.xcodeproj" -scheme MizyunWorkoutWatchDev -configuration Debug -sdk watchsimulator -destination 'generic/platform=watchOS Simulator' -derivedDataPath "${MIZYUN_WATCH_BUILD_DIR:-/private/tmp/mizyun-watch-ios-build}" CODE_SIGNING_ALLOWED=NO build
    ;;
  android)
    [[ -f "$ROOT/apps/mobile/android/app/debug.keystore" ]] || { echo "Existing Dev phone debug key required." >&2; exit 1; }
    cd "$ROOT/apps/watch-android"
    exec ./gradlew :app:assembleDebug :app:testDebugUnitTest --console=plain
    ;;
  *) echo "Usage: $0 ios|android (Dev only; no install/signing/release)" >&2; exit 1 ;;
esac
