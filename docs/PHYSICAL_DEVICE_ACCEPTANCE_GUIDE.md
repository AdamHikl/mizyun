# Physical Device Acceptance & Release Signing Guide (Gate R3 / Gate R8)

> **Governed by ADR-0023**: Mizyun uses **100% local native release builds and direct store signing** on founder macOS hardware via Xcode and Android Gradle. No Expo Application Services (EAS) cloud accounts or services are required.

This guide provides the operational procedures for building, signing, installing, and accepting both app variants (`Mizyun Dev` and `Mizyun`) on real physical devices.

---

## 1. Prerequisites & Environment

### Hardware & Accounts

- **Mac**: Apple Silicon macOS with Xcode 16+ and command-line tools.
- **Apple Developer Account**: Team ID `LQJNDVBL43` (`itinn s.r.o.`, registered in Xcode under Settings -> Accounts).
- **iOS Device**: iPhone with **Developer Mode** enabled (Settings -> Privacy & Security -> Developer Mode -> On).
- **Android Device**: Android phone with **USB Debugging** enabled (Settings -> Developer options -> USB debugging).
- **Network**: Hetzner backend connectivity via public endpoints (`phiskel.com`).

---

## 2. Streamlined 1-Step Installation Engine (Recommended)

Mizyun provides dedicated, non-interactive installation scripts that resolve device IDs, auto-prebuild across variants, build standalone Release binaries without Metro, and launch the app directly:

| Target Platform & Variant                 | 1-Step Command                           | Dry Run / Preflight                                | Agent Skill                  |
| :---------------------------------------- | :--------------------------------------- | :------------------------------------------------- | :--------------------------- |
| **iOS Dev** (`com.mizyun.development`)    | `pnpm mobile:install:ios:dev`            | `pnpm mobile:install:ios:dev --dry-run`            | `install-ios-dev`            |
| **iOS Production** (`com.mizyun.app`)     | `pnpm mobile:install:ios:production`     | `pnpm mobile:install:ios:production --dry-run`     | `install-ios-production`     |
| **Android Dev** (`com.mizyun.dev`)        | `pnpm mobile:install:android:dev`        | `pnpm mobile:install:android:dev --dry-run`        | `install-android-dev`        |
| **Android Production** (`com.mizyun.app`) | `pnpm mobile:install:android:production` | `pnpm mobile:install:android:production --dry-run` | `install-android-production` |

---

## 3. Native Build & Manual Procedures (Reference)

### 3.1 iOS Builds (Local via Xcode / `scripts/`)

#### A. Mizyun Dev (`com.mizyun.development`)

Points to Hetzner Dev (`https://mizyun-api-dev.phiskel.com` / `mizyun-dev://auth/callback`):

```bash
# 1. Generate clean native iOS project for Dev variant
pnpm mobile:founder-dev:ios:prebuild

# 2. Compile and install Release build directly to connected iPhone
pnpm mobile:founder-dev:ios
```

#### B. Mizyun Production (`com.mizyun.app`)

Points to Hetzner Production (`https://mizyun-api.phiskel.com` / `mizyun://auth/callback`):

```bash
# 1. Generate clean native iOS project for Production variant
pnpm mobile:founder-production:ios:prebuild

# 2. Compile and install Release build directly to connected iPhone
pnpm mobile:founder-production:ios

# If the Apple Developer Team provisioning profile needs refresh:
pnpm mobile:founder-production:ios --renew-profile
```

#### C. App Store / TestFlight Archive (Direct via Xcode)

1. Open `apps/mobile/ios/Mizyun.xcworkspace` in Xcode.
2. Select target `Mizyun` and generic destination `Any iOS Device (arm64)`.
3. Menu: **Product -> Archive**.
4. In the Xcode Organizer window, select the archive and click **Distribute App** -> **App Store Connect** -> **Upload**.
5. Xcode signs with your Apple Distribution Certificate and uploads directly to TestFlight without EAS.

---

### 2.2 Android Builds (Local via Gradle / `scripts/`)

#### A. Mizyun Dev (`com.mizyun.dev`)

Points to Hetzner Dev (`https://mizyun-api-dev.phiskel.com`):

```bash
# 1. Clean prebuild for Dev variant
pnpm mobile:founder-dev:android:prebuild

# 2. Build local debug-signed test APK
pnpm mobile:founder-dev:android:assembleRelease

# 3. Or install directly to connected Android phone
pnpm mobile:founder-dev:android
```

#### B. Mizyun Production Sideload (`com.mizyun.app`)

```bash
# 1. Clean prebuild for Production variant
pnpm mobile:founder-production:android:prebuild

# 2. Sideload test APK (with explicit local debug bypass flag):
MIZYUN_ALLOW_DEBUG_KEYSTORE_IN_RELEASE=true pnpm mobile:founder-production:android:assembleRelease
```

#### C. Google Play Store Release Bundle (`.aab`)

1. Generate your production release keystore once (if not already created):
   ```bash
   bash scripts/generate-android-release-keystore.sh
   ```
2. Build the signed production App Bundle:
   ```bash
   export MIZYUN_RELEASE_KEYSTORE="$HOME/Documents/mizyun/mizyun-release.keystore"
   export MIZYUN_RELEASE_KEY_ALIAS="mizyun"
   export MIZYUN_RELEASE_STORE_PASSWORD="<your-password>"
   export MIZYUN_RELEASE_KEY_PASSWORD="<your-password>"

   pnpm mobile:founder-production:android:bundleRelease
   ```
   The signed bundle is output to:
   `apps/mobile/android/app/build/outputs/bundle/release/app-release.aab`
3. Upload `app-release.aab` directly into Google Play Console (Internal Testing or Production track).

---

## 3. Physical Device Acceptance Test Matrix (Gate R8)

Perform these journeys on the physical device to verify release readiness:

| Journey ID                 | Test Description                                                     | Acceptance Criteria                                                                                                                           |
| :------------------------- | :------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------- |
| **J1: Coexistence**        | Install both `Mizyun Dev` and `Mizyun` on the same phone.            | Both app icons appear side-by-side with distinct names (`Mizyun Dev` vs `Mizyun`). Neither overwrites the other.                              |
| **J2: Mac-Off Operation**  | Turn off Mac / kill Metro bundler. Launch both apps from cold start. | Both apps launch instantly from their embedded JavaScript bundles without connecting to Metro or Mac.                                         |
| **J3: Dev Auth Flow**      | In `Mizyun Dev`, trigger magic link sign-in. Tap the email link.     | Intercepted by `mizyun-dev://auth/callback`. Session created in isolated Hetzner Dev (`5433`). Production remains untouched.                  |
| **J4: Prod Auth Flow**     | In `Mizyun`, sign in with a production account.                      | Intercepted by `mizyun://auth/callback`. Session created in isolated Hetzner Production (`5432`).                                             |
| **J5: Token Rejection**    | Attempt cross-environment token exchange.                            | Dev tokens rejected by Production API; Production tokens rejected by Dev API.                                                                 |
| **J6: Camera Permissions** | Navigate to meal photo draft or progress photos.                     | Prompts native OS camera/library permissions with accurate purpose strings. Allows photo capture; handles denial gracefully without crashing. |
| **J7: Network Resilience** | Enable Airplane mode while using app, then disable.                  | Shows appropriate offline feedback; does not crash; syncs successfully upon reconnection.                                                     |

---

## 4. Acceptance Evidence Register Template

Record the outcomes in `docs/REMEDIATION_EVIDENCE_CHECKLIST.md` and `status.md`:

```markdown
### Block 2 Physical Device Acceptance (Date: YYYY-MM-DD)

- **Source Commit SHA**: `<git-commit-sha>`
- **iOS Candidate**:
  - Bundle ID: `com.mizyun.app` (Prod) / `com.mizyun.dev` (Dev)
  - Build Version: `1.0.0` (Build 1)
  - Device: iPhone 15 Pro, iOS 18.x
  - Signing Identity: Apple Development / Apple Distribution (PP89XZBW4U)
  - Mac-off Standalone Verification: PASSED
  - Auth Callback: PASSED (`mizyun://auth/callback` & `mizyun-dev://auth/callback`)
- **Android Candidate**:
  - Application ID: `com.mizyun.app` (Prod) / `com.mizyun.dev` (Dev)
  - Release Keystore: Verified RSA 4096 / SHA-256
  - Device: Pixel 8, Android 15
  - Fail-closed Release Check: Verified (GradleException thrown without keystore)
  - Bundle Output: `app-release.aab` verified
  - Standalone Verification: PASSED
- **Result**: Gate R3 Part B and Gate R8 verified for physical device candidate.
```
