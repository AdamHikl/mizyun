---
name: install-android-dev
description: >-
  Build, install, and launch Mizyun Dev (com.mizyun.dev) on a connected physical Android device. Use when testing development features on Android hardware without Metro.
---

# Mizyun Android Dev Device Installation Skill

Use this skill to build, sign, install, and launch the **Mizyun Dev** Android app on a connected physical Android device without running Metro or dealing with interactive prompts.

## 1. Quick Reference & Core Rules

- **Package Name**: `com.mizyun.dev` (display name: `Mizyun Dev`).
- **Target Backend**: Hetzner Dev API (`https://mizyun-api-dev.phiskel.com`).
- **Auth Callback**: `mizyun-dev://auth/callback`.
- **Primary Tooling**: Gradle `assembleRelease` + ADB (bypasses `expo run:android` to prevent Metro hangs).
- **Signing**: Uses local debug keystore test override (`MIZYUN_ALLOW_DEBUG_KEYSTORE_IN_RELEASE=true`).
- **Java / SDK**: Auto-selects JDK 17 (rejects JDK 26 due to AGP incompatibility).

---

## 2. Instant Preflight Check (<1s)

Test device detection and build configuration without modifying state:

```bash
pnpm mobile:install:android:dev --dry-run
```

---

## 3. Execution (1-Step Install & Launch)

Run the automated device installation command:

```bash
pnpm mobile:install:android:dev
```

### Options & Overrides:

- **Target specific device**: `pnpm mobile:install:android:dev --device <SERIAL>`
- **Skip automatic launch**: `pnpm mobile:install:android:dev --no-launch`
- **Force clean prebuild**: `pnpm mobile:install:android:dev --clean`

### What the command executes automatically:

1. Validates `.env.dev` endpoint guardrails.
2. Checks `apps/mobile/android` package ID. If missing or previously set to `production`, runs `expo prebuild --clean` automatically.
3. Resolves the connected physical Android device via `adb devices -l`.
4. Compiles standalone Release APK (`app-release.apk`) using Gradle `assembleRelease`.
5. Installs the APK onto the device via `adb install -r`.
6. Terminates any rogue Metro instance on port 8081.
7. Launches `com.mizyun.dev/.MainActivity` on the phone and captures the process PID.
8. Emits a formatted Markdown evidence summary for `status.md`.

---

## 4. Troubleshooting

- **Device Unauthorized**: Unlock the Android device and tap **"Allow USB debugging"** on the screen.
- **No Devices Found**: Verify the USB cable and ensure **USB Debugging** is enabled in Developer Options (_Settings -> Developer options -> USB debugging_). Run `adb devices -l` to check status.
