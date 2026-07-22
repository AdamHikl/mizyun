# Android emulator workflow

This page captures the API 36 Pixel 9 AVD and standalone Release APK path used for Android MOB acceptance.

## One-time host setup

Install Android Studio, then use its SDK Manager to install:

- Android SDK Platform 36;
- Android SDK Build-Tools 36;
- Android SDK Platform-Tools;
- Android Emulator;
- an Android 36 Google APIs arm64-v8a system image;
- CMake 3.22.1 and NDK 27.1.12297006 when Gradle requests them.

Last proven machine paths:

```text
Android Studio: /Applications/Android Studio.app
Android SDK:    /Users/adam/Library/Android/sdk
Gradle JDK:     /Applications/Android Studio.app/Contents/jbr/Contents/Home
```

Verify:

```bash
/Users/adam/Library/Android/sdk/platform-tools/adb version
/Users/adam/Library/Android/sdk/emulator/emulator -version
/Users/adam/Library/Android/sdk/emulator/emulator -list-avds
'/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/java' -version
```

The existing AVD is `Mizyun_Pixel_9_API_36`. If it is absent, create a Pixel 9 / API 36 Google APIs arm64 device in Android Studio Device Manager. Prefer the UI for first-time SDK/AVD installation; it handles licenses and component downloads more reliably than reconstructing an old `avdmanager` command.

## Boot the AVD

Normal windowed cold boot:

```bash
/Users/adam/Library/Android/sdk/emulator/emulator \
  @Mizyun_Pixel_9_API_36 \
  -no-snapshot-load
```

Headless acceptance boot:

```bash
/Users/adam/Library/Android/sdk/emulator/emulator \
  @Mizyun_Pixel_9_API_36 \
  -no-window \
  -no-audio \
  -no-boot-anim \
  -no-snapshot \
  -gpu swiftshader_indirect
```

In another terminal, wait for the device and confirm Android finished booting:

```bash
/Users/adam/Library/Android/sdk/platform-tools/adb wait-for-device
/Users/adam/Library/Android/sdk/platform-tools/adb devices -l
/Users/adam/Library/Android/sdk/platform-tools/adb shell getprop sys.boot_completed
```

Expected final value: `1`.

## Configure mobile URLs for Android

Android emulator `127.0.0.1` is the emulator itself. Use the emulator's host alias in the ignored `apps/mobile/.env.local`:

```dotenv
EXPO_PUBLIC_API_URL=http://10.0.2.2:4000
EXPO_PUBLIC_SUPABASE_URL=http://10.0.2.2:54321
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<local publishable key>
```

This file must contain public client values only.

Supabase local signed Storage URLs still contain `127.0.0.1`. Add reverse tunnels before testing private uploads:

```bash
/Users/adam/Library/Android/sdk/platform-tools/adb reverse tcp:54321 tcp:54321
/Users/adam/Library/Android/sdk/platform-tools/adb reverse tcp:4000 tcp:4000
/Users/adam/Library/Android/sdk/platform-tools/adb reverse --list
```

The Storage tunnel is required for local signed photo PUT/download URLs. These tunnels are local test plumbing, not application production logic.

## Fast development loop

Start Supabase and the API first, boot the emulator, then:

```bash
pnpm dev:mobile
```

Press `a` in Expo CLI. If Expo targets the wrong device, verify `adb devices -l` and shut down extra emulators.

## Generate the native project

```bash
pnpm --filter @mizyun/mobile exec expo prebuild --platform android
git status --short
```

`apps/mobile/android/` is ignored generated output. Never commit it.

### Local HTTP exception for standalone Release acceptance

Android Release builds may reject the development stack's plain HTTP URLs. For local acceptance only, add this attribute to the generated and ignored `<application>` element in:

`apps/mobile/android/app/src/main/AndroidManifest.xml`

```xml
android:usesCleartextTraffic="true"
```

Do not move this exception into production configuration. Regenerating the native directory removes it.

## Build a standalone Release APK

```bash
cd /Users/adam/Documents/mizyun/apps/mobile/android
NODE_ENV=production \
JAVA_HOME='/Applications/Android Studio.app/Contents/jbr/Contents/Home' \
ANDROID_HOME=/Users/adam/Library/Android/sdk \
./gradlew app:assembleRelease
```

The first native build can take many minutes because Gradle downloads tools and compiles all ABIs. A `BUILD SUCCESSFUL` result should produce:

```text
apps/mobile/android/app/build/outputs/apk/release/app-release.apk
```

Install and launch the exact APK:

```bash
/Users/adam/Library/Android/sdk/platform-tools/adb install -r \
  /Users/adam/Documents/mizyun/apps/mobile/android/app/build/outputs/apk/release/app-release.apk

/Users/adam/Library/Android/sdk/platform-tools/adb shell am start \
  -n com.mizyun.app/.MainActivity
```

The Release app must work without Metro.

## Photo-picker fixture

Use only a synthetic repository asset:

```bash
/Users/adam/Library/Android/sdk/platform-tools/adb push \
  apps/mobile/assets/images/expo-logo.png \
  /sdcard/Pictures/mizyun-acceptance.png

/Users/adam/Library/Android/sdk/platform-tools/adb shell am broadcast \
  -a android.intent.action.MEDIA_SCANNER_SCAN_FILE \
  -d file:///sdcard/Pictures/mizyun-acceptance.png
```

The Android system Photo Picker should then expose the image. Never use a real body or health photo as a fixture.

## Useful diagnostics

Focused app logs:

```bash
/Users/adam/Library/Android/sdk/platform-tools/adb logcat \
  ReactNativeJS:V AndroidRuntime:E ExpoModules:E '*:S'
```

Current activity:

```bash
/Users/adam/Library/Android/sdk/platform-tools/adb shell dumpsys window \
  | rg 'mCurrentFocus|mFocusedApp'
```

Accessibility hierarchy:

```bash
/Users/adam/Library/Android/sdk/platform-tools/adb shell uiautomator dump \
  /sdcard/mizyun-ui.xml
/Users/adam/Library/Android/sdk/platform-tools/adb pull \
  /sdcard/mizyun-ui.xml /private/tmp/mizyun-ui.xml
```

Clear only Mizyun app data:

```bash
/Users/adam/Library/Android/sdk/platform-tools/adb shell pm clear com.mizyun.app
```

This removes the app's local session/state from the emulator. It does not delete server-side rows or the Auth user.

## Maestro acceptance notes

- Use `appId: com.mizyun.app`.
- Use `hideKeyboard` after Android numeric input. A swipe across the on-screen numeric keyboard can type digits instead of dismissing it.
- When text occurs in both a button and an input, select by stable `id`, accessibility label, or explicit index.
- Wait for an uploaded timeline entry before starting the second photo selection; otherwise a failed upload can look like a picker problem.
- On upload failure, inspect rendered error text and `adb logcat` before changing application code.

## Shut down

```bash
/Users/adam/Library/Android/sdk/platform-tools/adb emu kill
```

Then stop the API and local Supabase. ADB reverse mappings disappear with the emulator.
