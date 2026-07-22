# Troubleshooting known failures

Start from the symptom. Confirm the checkpoint before applying a workaround.

## Native project or build

### Generated `ios/` or `android/` differs or behaves strangely

Mizyun uses Expo Continuous Native Generation. Regenerate instead of preserving manual drift:

```bash
pnpm --filter @mizyun/mobile exec expo prebuild --platform ios
# or
pnpm --filter @mizyun/mobile exec expo prebuild --platform android
```

Both directories are ignored. Durable changes belong in `app.json` or a config plugin.

### A native module compiles but the iOS app crashes at launch

Known example: ImagePicker/ImageManipulator `57.0.5` resolved under a compatible range but did not match ExpoModulesCore `57.0.3`; dyld reported a missing `AnyModule._decorateModule` symbol.

Correction already committed: `expo-image-picker` and `expo-image-manipulator` are pinned to `57.0.2`. Do not casually widen these versions. After a native package change:

1. inspect `pnpm-lock.yaml` for the resolved version;
2. regenerate with `expo prebuild` (SDK 57 cleans by default);
3. rebuild Release;
4. install and cold-launch without Metro.

### Android Gradle says `JAVA_HOME` is missing or uses the wrong JDK

Use Android Studio's bundled JBR for Gradle:

```bash
JAVA_HOME='/Applications/Android Studio.app/Contents/jbr/Contents/Home' \
ANDROID_HOME=/Users/adam/Library/Android/sdk \
./gradlew app:assembleRelease
```

Maestro may use the Homebrew OpenJDK path instead; do not assume the Java selected for one tool is visible to the other.

### Android Gradle warns about JVM Metaspace

The first Release build previously completed successfully despite a 512 MiB Metaspace warning and then stopped the daemon. Treat it as a warning unless the build actually exits non-zero. If it becomes a repeated failure, adjust project Gradle JVM settings deliberately and document the measured need; do not change global Gradle settings blindly.

### Expo config warns that `NODE_ENV` is not set

Set it for standalone builds:

```bash
NODE_ENV=production ./gradlew app:assembleRelease
```

Also verify the expected `EXPO_PUBLIC_*` platform values were present when the bundle was created.

## Emulator and simulator

### `adb devices` is empty

1. Confirm the AVD process is running.
2. Use the SDK's exact ADB path to avoid multiple-client version conflicts.
3. Run `adb wait-for-device`.
4. Check `adb shell getprop sys.boot_completed`; wait for `1`.

Exact ADB path on the proven host:

```text
/Users/adam/Library/Android/sdk/platform-tools/adb
```

### Multiple ADB versions disagree

Compare:

```bash
command -v adb
adb version
/Users/adam/Library/Android/sdk/platform-tools/adb version
```

Use the Platform Tools copy consistently. Avoid copying binaries into system directories as a first response.

### `avdmanager` reports a device-definition error

The CLI once printed a `devices.xml` error after it had already created a usable AVD. Before recreating or deleting anything, run:

```bash
/Users/adam/Library/Android/sdk/emulator/emulator -list-avds
```

If the AVD appears, boot and verify it. Prefer Android Studio Device Manager for repair or recreation.

### iOS Simulator service is unavailable in a restricted shell

Run `xcrun simctl list devices available` from a normal macOS terminal or an approved host context. CoreSimulator needs access to macOS user services and log directories; a sandbox failure is not evidence that the installed runtime is broken.

## Networking and configuration

### iOS works but Android cannot reach the API

Do not use host `127.0.0.1` as the Android bundle's API/Supabase entry URL. Use:

```text
http://10.0.2.2:4000
http://10.0.2.2:54321
```

Then verify the generated Release manifest permits local HTTP only for the acceptance build.

### Android sign-in works but photo upload fails on `127.0.0.1:54321`

This is the local signed-URL topology, not necessarily an upload-code defect. Add:

```bash
/Users/adam/Library/Android/sdk/platform-tools/adb reverse tcp:54321 tcp:54321
```

Confirm with `adb reverse --list`, retry, and inspect the rendered error before editing code.

### The app renders a configuration-required screen

Check that:

- Supabase and the API are running;
- `apps/mobile/.env.local` has the correct platform URLs;
- the publishable key is present;
- no service-role key is present;
- the native/Expo process was restarted after changing env values.

Expo statically embeds `EXPO_PUBLIC_*` variables. A previously built Release binary does not learn new values when a shell env changes; rebuild it.

### Supabase local ports are exposed beyond loopback

This was measured with the current Docker Desktop setup. Do not attempt to make the development stack production-safe. Use a trusted network, avoid real data, and run `pnpm db:stop` after testing.

## Mobile UI automation

### Android numeric values become concatenated or corrupted

A Maestro swipe across the numeric keyboard can press keys. Use:

```yaml
- hideKeyboard
```

Use `eraseText` before typing when a field may contain a stale value.

### A Maestro tap completes but the wrong control changed

Visible text may occur in a button and an input. Prefer a stable ID:

```yaml
- tapOn:
    id: "workout-load-input"
```

If duplicate text is intentional, use an explicit index and verify the resulting state.

### A save tap completes but the next screen never appears

“Tap completed” proves only that Maestro sent the input. Inspect:

1. rendered validation/network error text;
2. current accessibility hierarchy;
3. native logs;
4. the API terminal.

Wait for an authoritative result such as a new timeline row or exact stored total.

### iOS form fields are hidden behind the keyboard

The committed forms use keyboard-aware scroll insets and drag dismissal. If this regresses, verify the actual Release screen at narrow width. Do not work around it only in Maestro; covered inputs are a product accessibility defect.

## Progress-photo transport

### Local `file://` upload fails with ArrayBuffer/Blob conversion

Do not reintroduce `fetch(fileUri).blob()` for native normalized files. Mizyun uses Expo FileSystem `File.exists`/`File.size` and sends the native `File` through `expo/fetch`. This was the verified cross-platform correction.

### Upload metadata exists but bytes did not land

The upload flow creates metadata before the direct signed PUT. On transfer failure, the client performs best-effort cleanup. Check the rendered error, Storage object state, and cleanup result; never treat the metadata row alone as upload success.

## Maestro itself

### Maestro says it cannot find a Java runtime

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home
export PATH=/opt/homebrew/opt/openjdk/bin:$PATH
maestro --version
```

Last proven Maestro version: 2.7.0.

### Maestro emits final-field or `Unsafe` Java warnings

Maestro 2.7.0 emitted these warnings while successful flows continued. Treat them as tool warnings unless the process exits non-zero or stops driving the device.

### Maestro iOS logs `Supported platforms ... is empty`

This warning appeared in successful XCTest-driver sessions. Judge the run by the flow result and driver connectivity, not the warning alone.

## When to add a new entry

Add a failure here only after its cause and safe correction are known. Unresolved defects belong in `status.md`/`backlog.md`, with evidence, rather than being disguised as a tutorial workaround.
