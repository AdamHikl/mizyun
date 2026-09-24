---
name: install-ios-dev
description: >-
  Build, install, and launch Mizyun Dev (com.mizyun.development) on a connected physical iPhone. Use when testing development features or verifying bug fixes on physical iOS hardware without Metro.
---

# Mizyun iOS Dev Device Installation Skill

Use this skill to build, sign, install, and launch the **Mizyun Dev** iOS app on a connected physical iPhone without running Metro or dealing with interactive prompts.

## 1. Quick Reference & Core Rules

- **Bundle ID**: `com.mizyun.development` (display name: `Mizyun Dev`).
- **Apple Developer Account**: `LQJNDVBL43` (`itinn s.r.o.`).
- **Target Backend**: Hetzner Dev API (`https://mizyun-api-dev.phiskel.com`).
- **Auth Callback**: `mizyun-dev://auth/callback`.
- **Primary Tooling**: `xcodebuild` + `xcrun devicectl` (bypasses `expo run:ios` to prevent Metro hangs).
- **Physical Device**: Auto-detects the connected paired iPhone (e.g. `Adam's Iphone 😋`).

---

## 2. Instant Preflight Check (<1s)

Test device detection and build configuration without modifying state:

```bash
pnpm mobile:install:ios:dev --dry-run
```

---

## 3. Execution (1-Step Install & Launch)

Run the automated device installation command:

```bash
pnpm mobile:install:ios:dev
```

### Options & Overrides:

- **Target specific device**: `pnpm mobile:install:ios:dev --device <UDID>`
- **Skip automatic launch**: `pnpm mobile:install:ios:dev --no-launch`
- **Force clean prebuild**: `pnpm mobile:install:ios:dev --clean`

### What the command executes automatically:

1. Validates `.env.dev` endpoint guardrails.
2. Checks `apps/mobile/ios` bundle ID. If missing or previously set to `production`, runs `expo prebuild --clean` automatically.
3. Resolves the connected physical iPhone via `xcrun devicectl`.
4. Compiles standalone Release binary with `xcodebuild` using team `LQJNDVBL43` (`itinn s.r.o.`) and `-allowProvisioningUpdates`.
5. Installs the `.app` onto the iPhone via `xcrun devicectl device install app`.
6. Terminates any rogue Metro instance on port 8081.
7. Launches `com.mizyun.development` on the iPhone and captures the process PID.
8. Emits a formatted Markdown evidence summary for `status.md`.

---

## 4. Troubleshooting

- **iPhone Locked**: If `devicectl` reports the device is locked, unlock your iPhone with your passcode.
- **Developer Mode**: Ensure **Developer Mode** is enabled on iOS: _Settings -> Privacy & Security -> Developer Mode -> On_.
- **No devices listed**: Verify the USB connection or ensure WiFi pairing is recognized in Xcode (`Window -> Devices and Simulators`). Run `xcrun devicectl list devices` to inspect.
