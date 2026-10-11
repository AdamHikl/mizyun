---
name: test-android-simulator
description: >-
  Test Mizyun features in an Android Dev emulator with a compatible signed Debug
  APK, an owned Metro server and synthetic Dev accounts. Use for native UI/IA,
  two-account correctness and emulator acceptance. Physical-device installation
  and Production/Store releases use their separate workflows.
---

# Test Mizyun in an Android simulator

Use the canonical Dev build wrapper for setup and `mcp__cua_repl` for native UI input. Pin one AVD and serial; record source/native/Metro identities separately. Run from the repository root. Follow root AGENTS and relevant mobile instructions; preserve concurrent source edits, native builds and other sessions. Use the user-selected model/effort for simulator control. One controller owns all native input.

## Establish the candidate and control surface

1. Inspect `git -c core.fsmonitor=false status --short`, source SHA, relevant feature context and acceptance criteria. Capture changed-source hashes and a native-input inventory including tracked and untracked config, dependencies, plugins and modules. Check native-build ownership before prebuild. Never reuse an APK based on its filename alone.
2. Resolve the configured Android SDK/JDK from `scripts/mobile-founder-dev-android.sh`. Inventory AVDs and connected devices. Historical session AVD `Mizyun_Pixel_9_API_36` and serial `emulator-5556` are examples to verify, not defaults to assume. Never target a physical device or Production package. Record initial boot state, theme/font size, existing app/session and network mappings.
3. Bind a supported native app/window through CUA and inspect the test device before installation/relaunch. Close owned drafts normally and preserve existing records. Standalone Qt emulator binaries may not be CUA-selectable macOS apps. Android Studio's embedded **Running Devices** view is the preferred fallback; select the observed AVD, not an invented window. If the Welcome screen’s Virtual Device Manager is disabled, one bounded normal Open of the existing `apps/mobile/android` project can be attempted to expose Running Devices. Do not accept SDK/plugin upgrades, licenses or downloads as an implicit testing requirement. Once the project is open, the observed Running Devices → Add → existing Virtual Devices row can launch the selected AVD. A release-keystore Gradle sync failure does not require retrying sync to use an already verified Debug APK. Preserve import/build ownership. If neither surface is exposed, record UI acceptance BLOCKED and continue other authorized work. APK builds, screenshots and API fixtures do not substitute for native UI execution.
4. If CUA reports a locked Mac, ask for manual unlock and keep dependent input blocked. A task-owned temporary `caffeinate -d -i -u -t 3600` process can keep the display awake without changing saved settings; record its session and stop it during cleanup. It cannot unlock the Mac or override security. Never change lock settings or enter an OS password. Bound a stalled app binding; a coordinator can interrupt the helper if it does not return.
5. Read CUA documentation on first invocation; after compaction call `await cua.rewriteDocumentation()`. Get fresh AX state after every action; only use coordinates from a current CUA window screenshot. No `adb shell input`, UI scripts, AppleScript, gRPC input bridge or hidden input workaround.

## Build and attach Dev Debug

Use `pnpm mobile:founder-dev:android:prebuild` only when native input changed or provenance is missing. This uses the shared ignored Android project; serialize against other prebuild/build owners. Build Debug through the canonical wrapper, preserving `.env.dev`, Dev variant and `EXPO_NO_DOTENV=1`; never use `.env.local` to override routing.

```sh
pnpm mobile:founder-dev:android:prebuild
bash scripts/mobile-founder-dev-android.sh assembleDebug \
  -PreactNativeDevServerPort=8085 -PreactNativeArchitectures=arm64-v8a
```

Choose a free owned Metro port and ABI matching the selected AVD; 8085/arm64-v8a are examples. If the existing release-signing configuration stops this **Debug** build because no release keystore exists, a process-scoped `MIZYUN_ALLOW_DEBUG_KEYSTORE_IN_RELEASE=true` prefix is the repository's local-testing escape hatch. Use it only with explicit `assembleDebug`, never Release or Production, and record it. Do not weaken the plugin or persist the environment variable.

Require `BUILD SUCCESSFUL`, native inventory/hash equality after build and exact artifact path. Inspect `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk` with installed `aapt`, `apksigner` and its `assets/app.config`: `com.mizyun.dev`, correct version/ABI, Debug signature and canonical Dev API/Supabase/auth redirect. Stop before credentials if any endpoint or identity is wrong. Set the wrapper's configured JAVA_HOME for apksigner if the shell cannot resolve Java.

Inspect the APK resource `integer/react_native_dev_server_port` with `aapt dump resources` and decode its hexadecimal value before choosing Metro. The generic native error mentioning8081 may differ from the compiled port; do not rebuild or switch ports based on that text alone.

Start one owned canonical Dev Metro server on that compiled port, retaining its session/port. The existing iOS simulator `serve` helper can provide the same Dev Metro when an explicitly verified iOS simulator is also in scope. For Android alone, use the existing canonical environment resolver without modifying global env files:

```sh
node --input-type=module - <<'NODE'
import { spawn } from 'node:child_process';
import { devEnvironment } from './scripts/ios-simulator-dev.mjs';
const metro = spawn('pnpm', [
  '--filter', '@mizyun/mobile', 'exec', 'expo', 'start',
  '--dev-client', '--port', '8085',
], { env: devEnvironment(process.cwd()), stdio: 'inherit' });
process.on('SIGINT', () => metro.kill('SIGINT'));
metro.on('exit', code => process.exit(code ?? 1));
NODE
```

Check both IPv4 and IPv6 listeners before starting (`lsof -nP -iTCP:<port> -sTCP:LISTEN`). A localhost Metro may listen only on `::1`; an IPv4-only probe can incorrectly report a free port. Verify process command, cwd and start time, then its actual `/status` address. The stock emulator host alias `10.0.2.2` reaches the host IPv4 loopback, so verify Metro responds over IPv4; an iOS helper listening only on `::1` cannot serve that route. Use the canonical environment resolver above without `--localhost` when an owned IPv4-capable listener is needed. Never stop or reuse an unidentified listener. If a wrapper exits but its verified owned child survives, record that child and clean up only that exact process. With fresh draft clearance, use scoped setup:

```sh
adb -s emulator-5556 install -r /absolute/path/to/app-debug.apk
adb -s emulator-5556 reverse tcp:8085 tcp:8085
adb -s emulator-5556 shell am start -n com.mizyun.dev/.MainActivity
```

These are lifecycle/network setup commands, not UI interaction. Preserve existing mappings and remove only mappings created here. Use CUA for the Dev launcher connection if needed. Require a fresh **Android Bundled** request in the owned Metro log and a rendered native screen before attributing current JavaScript behavior. Record installed package/version, device/API/ABI, APK hash/signature, native-input hashes, Metro receipt and actual candidate-source hashes.

## Exercise only relevant journeys

Use existing authorized synthetic Dev fixtures where possible. Keep credentials in a mode0600 private temporary file; do not print passwords/tokens or preserve secure-field screenshots. Use normal native sign-in; decline optional password storage. If a system password-storage prompt has no supported AX controls and native coordinate input fails, request only manual Not Now dismissal; do not save credentials or bypass the prompt. Record this control limitation separately from app behavior. Creating/enabling exactly scoped test accounts or harmless own private diary fixtures does not prove native enrollment, consent or sharing.

When host type/paste calls return without visibly populating the native field, verify focus and one harmless key before entering credentials or submitting. Use the observed on-screen keyboard as a normal fallback when available. Take a fresh snapshot after focusing the field before tapping a key: focus can reflow a full keyboard into handwriting controls, invalidating earlier coordinates. A successful driver return alone is not text-entry or sign-in evidence. Avoid repeated blind credential attempts.

Build one deduplicated scenario matrix mapped to selected issues. Prioritize UI hierarchy, clear labels/back routes, task completion, keyboard/scroll, safe areas, text scaling, dark/light appearance, errors and correct persistence. For social features use two distinct active Community identities: directional request/approval, explicit preview/private-field omission, publication/recipient data, reactions/comments, messaging mutual opt-ins, groups/challenges, routine import and removal/block/withdrawal revocation. Keep relationships/content needed by later scenarios; destructive revocation goes last. Do not enable provider delivery, staff grants, Production or broader cohorts as a testing shortcut.

Community intent authority expires after ten seconds. Batch fresh-read → fresh AX → action → fresh AX → confirmation in one bounded CUA call for the normal success path. Separately test one intentional delayed confirmation and its recovery guidance; do not relax the deadline. Native UI, API setup and source tests remain separate evidence.

Record PASS/FAIL/BLOCKED/NOT TESTED per scenario and platform, exact visible result, redacted screenshots and unresolved gate. Simulators do not certify physical push, actual screen-reader interaction, named MFA moderation, legal/Store approval, independent backup durability/restore or pilot results. Stop only an action needing current user approval and continue independent authorized cases.

## Finish

Finish all edits/helper writes before relevant final source tests and required quality gates. Avoid repeating unaffected suites. Restore task-changed font/theme settings through CUA, save/close owned drafts and return to Home/Hub. Stop only the recorded Metro session; remove only owned reverse mappings. Stop only an emulator booted by this task and leave an initially running emulator alone. Never erase/wipe an AVD or delete fixtures as routine cleanup. Update evidence/status/issues with exact outcomes and limitations; do not close issues whose stated exit criteria remain open.

## Primary references

- [Expo SDK57](https://docs.expo.dev/versions/v57.0.0/) and [local development](https://docs.expo.dev/guides/local-app-development/)
- [Android emulator command line](https://developer.android.com/studio/run/emulator-commandline)
- [ADB](https://developer.android.com/tools/adb)
- [Emulator network addresses](https://developer.android.com/studio/run/emulator-networking-address)
- [Launch without an app](https://developer.android.com/studio/run/emulator-launch-without-app)
- [Embedded/separate windows](https://developer.android.com/studio/run/emulator-launch-separate-window)

Refresh materially affected official documentation for later sessions; these workflow details were researched 2026-10-10.
