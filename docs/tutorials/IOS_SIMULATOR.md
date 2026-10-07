# iOS Simulator workflow

For **Hetzner Dev feature testing**, use [test-ios-simulator](../../.agents/skills/test-ios-simulator/SKILL.md) and `pnpm mobile:simulator:ios doctor`. That workflow pins Dev endpoints, a simulator UUID and a task-owned Metro port; it preserves existing dotenv files.

The local-backend and Production examples below are separate workflows. They are not shortcuts for testing a synthetic Hetzner Dev account. This page also covers the standalone Release path used for native MOB acceptance.

## One-time host setup

1. Install Xcode from Apple.
2. In Xcode Settings, select the current Command Line Tools.
3. In Xcode Settings > Components, install an iOS Simulator runtime.
4. Accept any requested Xcode license or first-launch components.

Verify:

```bash
xcodebuild -version
xcode-select -p
xcrun simctl list runtimes
xcrun simctl list devices available
```

Last proven host: Xcode 26.6, iOS 26.5 runtime, iPhone 17 Pro simulator.

## Boot a simulator

Using the existing device name:

```bash
xcrun simctl boot "iPhone 17 Pro"
open -a Simulator
```

If more than one device has the same name, copy its UUID from `xcrun simctl list devices available` and boot that UUID instead.

Wait until the home screen is usable before starting UI automation.

## Configure mobile URLs for iOS

Create or update the ignored `apps/mobile/.env.local` with public values only:

```dotenv
EXPO_PUBLIC_API_URL=http://127.0.0.1:4000
EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<local publishable key>
```

Never add `SUPABASE_SECRET_KEY` to this file. Expo public variables are embedded in the client bundle.

## Fast development loop

Start Supabase and the API first, then:

```bash
pnpm dev:mobile
```

Press `i` to open the current simulator or `Shift+i` to select one. This is the quick JavaScript/React Native loop; it is not standalone Release evidence.

If a native dependency or `app.json` plugin changed, rebuild native code instead of relying on a stale Expo Go/development binary.

## Generate the native project

Mizyun uses Expo Continuous Native Generation. The generated directory is ignored:

```bash
pnpm --filter @mizyun/mobile exec expo prebuild --platform ios
git status --short
```

`git status` should not show `apps/mobile/ios/`. Durable native changes belong in `apps/mobile/app.json` or a config plugin, not hand-edited generated files.

The installed Expo SDK 57 CLI cleans generated native output by default. Its opt-out flag is `--no-clean`; do not use that for a reproducibility build unless you deliberately need to layer changes. Keep no irreplaceable edits in the generated directory.

## Build and install a standalone Release app

With the target simulator already booted:

```bash
pnpm --filter @mizyun/mobile exec expo run:ios \
  --configuration Release \
  --device "iPhone 17 Pro" \
  --no-bundler
```

This compiles and installs `com.mizyun.app` with the JavaScript bundle embedded. Metro is not required after a successful Release build.

Confirm standalone behavior:

```bash
xcrun simctl terminate booted com.mizyun.app
xcrun simctl launch booted com.mizyun.app
```

The app should relaunch without a Metro terminal and restore a valid native session when one exists.

## Useful diagnostics

List installed app metadata:

```bash
xcrun simctl get_app_container booted com.mizyun.app app
```

Stream app logs:

```bash
xcrun simctl spawn booted log stream \
  --level debug \
  --predicate 'process == "Mizyun"'
```

Erase only the app and reinstall:

```bash
xcrun simctl uninstall booted com.mizyun.app
```

Erase the entire simulator only when explicitly intended:

```bash
xcrun simctl shutdown booted
xcrun simctl erase "iPhone 17 Pro"
```

The erase command destroys all simulator state.

## Maestro acceptance

Maestro drives the installed app through accessibility; it does not require an SDK in Mizyun.

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home
export PATH=/opt/homebrew/opt/openjdk/bin:$PATH
export MAESTRO_CLI_NO_ANALYTICS=1
export MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED=true
maestro test <flow.yaml>
```

Use `appId: com.mizyun.app`, synthetic credentials, and a cleanup trap that deletes the disposable local Auth user. Never commit a literal flow containing a real password or key.

The last native proof covered onboarding, exact meal/body/workout/dashboard values, stop/relaunch restoration, previous performance, two private photo uploads, comparison, and permanent deletion.

## Shut down

```bash
xcrun simctl shutdown booted
```

Also stop Metro, the API, and local Supabase when the session ends.
