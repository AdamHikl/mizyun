# ADR-0023: Local native release builds and direct store signing (no EAS cloud dependency)

- Status: accepted
- Date: 2026-09-09
- Deciders: Adam (Founder) & Mizyun Engineering
- Consulted: AGENTS.md, docs/tutorials/DEV_PRODUCTION_PI_GUIDE.md, docs/QUALITY_GATES.md

## Context

Prior documentation and remediation plans referenced Expo Application Services (EAS Build and EAS Submit) for building release candidates and submitting binaries to Apple App Store Connect and Google Play Console.

However:

1. Mizyun's development and operational environment is fully localized on the founder's Apple Silicon Mac and Raspberry Pi 5.
2. Relying on EAS introduces an unnecessary external cloud dependency, remote queue wait times, remote credential management on Expo servers, and third-party SaaS subscription requirements.
3. The founder Mac is equipped with Xcode, the Apple Developer account (`PP89XZBW4U`), Java 17, and the Android SDK, capable of compiling, archiving, signing, and exporting native `.ipa` and `.aab` artifacts locally without external build services.
4. Expo's Continuous Native Generation (`expo prebuild`) produces standard native iOS and Android projects that can be compiled and signed directly with standard platform tools (`xcodebuild` / Xcode Organizer and Gradle).

## Decision

Mizyun **will not use EAS cloud services** (EAS Build or EAS Submit) for release artifacts or store distribution. All mobile building, signing, and packaging will remain **100% local**:

1. **iOS Release Pipeline**:
   - Continuous Native Generation: `expo prebuild --clean --platform ios` generates the Xcode workspace.
   - Local Signing & Archiving: Standard Xcode automatic or manual signing using the paid Apple Developer Team (`PP89XZBW4U`).
   - Store Distribution: Archives are created locally via `xcodebuild -workspace ... -scheme Mizyun archive` or Xcode IDE, and uploaded directly to App Store Connect / TestFlight via Xcode Organizer or `xcrun altool`.
   - Physical Testing: Sideloaded directly via USB using `scripts/mobile-founder-*-ios.sh`.

2. **Android Release Pipeline**:
   - Continuous Native Generation: `expo prebuild --clean --platform android`.
   - Local Release Keystore: A dedicated release keystore (`mizyun-release.keystore`) generated locally with `keytool`, referenced via local environment variables or Gradle properties (`MIZYUN_RELEASE_KEYSTORE`, etc.).
   - Artifact Compilation: Built locally via `./gradlew :app:bundleRelease` (producing `.aab` for Google Play) and `./gradlew :app:assembleRelease` (producing `.apk` for physical device sideloading).
   - Store Distribution: The signed `.aab` is uploaded directly to the Google Play Console web dashboard.
   - Physical Testing: Sideloaded directly via USB / `adb` using `scripts/mobile-founder-*-android.sh`.

3. **EAS Scope**:
   - `eas.json` is retained solely for local profile definitions if helpful, but no cloud builds (`eas build`) or cloud credential storage are required or expected.
   - Build matrix tests and quality gates validate local profile evaluation, native bundle IDs, and local Gradle/Xcode guardrails without requiring remote EAS project IDs or cloud credentials.

## Consequences

- **Independence & Sovereignty**: No dependencies on Expo cloud queues, cloud credentials, or paid EAS subscriptions.
- **Security**: Private signing keys and release keystores remain strictly on local developer hardware and are never uploaded to third-party build clouds.
- **Simplicity**: Review agents and future sessions will not block release readiness on missing remote EAS project IDs, EAS remote secrets, or EAS submit CLI automation.
- **Audit Requirement**: Gate R3 and Block 2 verification requires locally reproducible signed release artifacts (`.aab` and Xcode archive) and physical cable installation on real devices.
