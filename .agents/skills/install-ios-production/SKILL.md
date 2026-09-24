---
name: install-ios-production
description: >-
  Build, install, and launch Mizyun Production (com.mizyun.app) on a connected physical iPhone. Use for pre-release device acceptance (Gate R8) and verifying standalone production backend connectivity without Metro.
---

# Mizyun iOS Production Device Installation Skill

Use this skill to build, sign, install, and launch the **Mizyun Production** iOS app on a connected physical iPhone without running Metro or dealing with interactive prompts.

## 1. Quick Reference & Core Rules

- **Bundle ID**: `com.mizyun.app` (display name: `Mizyun`).
- **Apple Developer Account**: `LQJNDVBL43` (`itinn s.r.o.`).
- **Target Backend**: Hetzner Production API (`https://mizyun-api.phiskel.com`).
- **Auth Callback**: `mizyun://auth/callback`.
- **Coexistence**: Installs side-by-side with `Mizyun Dev` without overwriting it.
- **Primary Tooling**: `xcodebuild` + `xcrun devicectl` (bypasses `expo run:ios` to prevent Metro hangs).
- **Physical Device**: Auto-detects the connected paired iPhone (e.g. `Adam's Iphone 😋`).

---

## 2. Instant Preflight Check (<1s)

Test device detection and build configuration without modifying state:

```bash
pnpm mobile:install:ios:production --dry-run
```

---

## 3. Execution (1-Step Install & Launch)

Run the automated device installation command:

```bash
pnpm mobile:install:ios:production
```

_(Or use shorthand `pnpm mobile:install:ios:prod`)_

### Options & Overrides:

- **Target specific device**: `pnpm mobile:install:ios:production --device <UDID>`
- **Skip automatic launch**: `pnpm mobile:install:ios:production --no-launch`
- **Force clean prebuild**: `pnpm mobile:install:ios:production --clean`

### What the command executes automatically:

1. Validates `.env.production` endpoint guardrails.
2. Checks `apps/mobile/ios` bundle ID. If missing or previously set to `dev`, runs `expo prebuild --clean` automatically.
3. Resolves the connected physical iPhone via `xcrun devicectl`.
4. Compiles standalone Release binary with `xcodebuild` using team `LQJNDVBL43` (`itinn s.r.o.`) and `-allowProvisioningUpdates`.
5. Installs the `.app` onto the iPhone via `xcrun devicectl device install app`.
6. Terminates any rogue Metro instance on port 8081.
7. Launches `com.mizyun.app` on the iPhone and captures the process PID.
8. Emits a formatted Markdown evidence summary for `status.md`.

---

## 4. Troubleshooting

- **iPhone Locked**: If `devicectl` reports the device is locked, unlock your iPhone with your passcode.
- **Developer Mode**: Ensure **Developer Mode** is enabled on iOS: _Settings -> Privacy & Security -> Developer Mode -> On_.
- **No devices listed**: Verify the USB connection or ensure WiFi pairing is recognized in Xcode (`Window -> Devices and Simulators`). Run `xcrun devicectl list devices` to inspect.
