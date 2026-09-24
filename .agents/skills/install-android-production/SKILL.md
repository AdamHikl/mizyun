---
name: install-android-production
description: >-
  Build, install, and launch Mizyun Production (com.mizyun.app) on a connected physical Android device. Use for pre-release device acceptance (Gate R8) and verifying standalone production backend connectivity without Metro.
---

# Mizyun Android Production Device Installation Skill

Use this skill to build, sign, install, and launch the **Mizyun Production** Android app on a connected physical Android device without running Metro or dealing with interactive prompts.

## 1. Quick Reference & Core Rules

- **Package Name**: `com.mizyun.app` (display name: `Mizyun`).
- **Target Backend**: Hetzner Production API (`https://mizyun-api.phiskel.com`).
- **Auth Callback**: `mizyun://auth/callback`.
- **Coexistence**: Installs side-by-side with `Mizyun Dev` without overwriting it.
- **Primary Tooling**: Gradle `assembleRelease` + ADB (bypasses `expo run:android` to prevent Metro hangs).
- **Signing**: Uses local test sideload signing override (`MIZYUN_ALLOW_DEBUG_KEYSTORE_IN_RELEASE=true`) unless a custom `MIZYUN_RELEASE_KEYSTORE` is set.
- **Java / SDK**: Auto-selects JDK 17 (rejects JDK 26 due to AGP incompatibility).

---

## 2. Instant Preflight Check (<1s)

Test device detection and build configuration without modifying state:

```bash
pnpm mobile:install:android:production --dry-run
```

---

## 3. Execution (1-Step Install & Launch)

Run the automated device installation command:

```bash
pnpm mobile:install:android:production
```

_(Or use shorthand `pnpm mobile:install:android:prod`)_

### Options & Overrides:

- **Target specific device**: `pnpm mobile:install:android:production --device <SERIAL>`
- **Skip automatic launch**: `pnpm mobile:install:android:production --no-launch`
- **Force clean prebuild**: `pnpm mobile:install:android:production --clean`

### What the command executes automatically:

1. Validates `.env.production` endpoint guardrails.
2. Checks `apps/mobile/android` package ID. If missing or previously set to `dev`, runs `expo prebuild --clean` automatically.
3. Resolves the connected physical Android device via `adb devices -l`.
4. Compiles standalone Release APK (`app-release.apk`) using Gradle `assembleRelease`.
5. Installs the APK onto the device via `adb install -r`.
6. Terminates any rogue Metro instance on port 8081.
7. Launches `com.mizyun.app/.MainActivity` on the phone and captures the process PID.
8. Emits a formatted Markdown evidence summary for `status.md`.

---

## 4. Troubleshooting

- **Device Unauthorized**: Unlock the Android device and tap **"Allow USB debugging"** on the screen.
- **No Devices Found**: Verify the USB cable and ensure **USB Debugging** is enabled in Developer Options (_Settings -> Developer options -> USB debugging_). Run `adb devices -l` to check status.
