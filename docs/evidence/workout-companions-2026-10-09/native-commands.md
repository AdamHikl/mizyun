# Native compilation receipt — 2026-10-09

No physical installation, paired-device acceptance or full phone application native build occurred. The author built the native projects; the coordinator inspected build completions/artifacts and reran the Swift state assertions. Generated phone projects lived in `/private/tmp/mizyun-companion-native`.

## Verified commands

```bash
scripts/build-workout-companions.sh ios
JAVA_HOME='/Applications/Android Studio.app/Contents/jbr/Contents/Home' \
ANDROID_HOME='/Users/adam/Library/Android/sdk' \
scripts/build-workout-companions.sh android

node --test apps/mobile/modules/mizyun-workout-companion/tests/plugin.test.cjs

swiftc -module-cache-path /private/tmp/mizyun-watch-state-cache \
  apps/watch-ios/Sources/CompanionState.swift \
  apps/watch-ios/Tests/main.swift -o /private/tmp/mizyun-watch-state-test
/private/tmp/mizyun-watch-state-test
```

In the isolated generated Android phone project:

```bash
EXPO_NO_DOTENV=1 MIZYUN_APP_VARIANT=dev MIZYUN_BUILD_PROFILE=development \
MIZYUN_ALLOW_DEBUG_KEYSTORE_IN_RELEASE=true \
JAVA_HOME='/Applications/Android Studio.app/Contents/jbr/Contents/Home' \
ANDROID_HOME='/Users/adam/Library/Android/sdk' \
./gradlew :mizyun-workout-companion:compileDebugKotlin --console=plain
```

In the isolated generated iOS phone project:

```bash
xcodebuild -project Pods/Pods.xcodeproj -target MizyunWorkoutCompanion \
  -configuration Debug -sdk iphonesimulator \
  SYMROOT=/private/tmp/mizyun-companion-phone-ios-products \
  OBJROOT=/private/tmp/mizyun-companion-phone-ios-objects \
  CODE_SIGNING_ALLOWED=NO build
```

Dev Expo iOS/Android prebuilds and the plugin-created watch target also passed; completion markers and original log hashes are in `native-receipts.json`. Both Apple native compiles covered arm64 and x86_64 simulators. Standalone watch bundle is `com.mizyun.development.watchkitapp`/0.1.0(1); the phone plugin generated version1.0.9(9) with companion bundle `com.mizyun.development`. Wear APK is `com.mizyun.dev`/0.1.0-dev(1), compile/targetSDK36/min30. Its SHA256 signing certificate matches the existing Dev phone debug key: `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`.

Toolchain: Xcode27, ExpoModulesCore57.0.18, Gradle9.3.1, AGP8.12.0, Kotlin2.1.20, Wearable20.0.1. Existing team settings are inherited; no credentials or signing configuration changed. Wear release tasks are disabled. Production configuration rejects/excludes the companion target and runtime authority.
