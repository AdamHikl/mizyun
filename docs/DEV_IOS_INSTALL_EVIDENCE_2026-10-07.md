# Dev iPhone installation — 2026-10-07

Installed the current dirty working copy requested by Adam. This records build,
signature, installation and process launch; signed-in feature acceptance remains open.

- Base commit: `3984c35fe922f3ebd16abff850dc1302550da9e8` plus pre-existing local changes, including Home workout and first-meal shortcuts and Health preview/export modules.
- Source manifest: 788 tracked/untracked non-ignored files under `apps/mobile`, `packages`, root package/lock files and installer; SHA256 `9adc093263f5e6cdaa34ff3415e83f2450606859f735f67b43b0b4fef29f1d1d`. No manifest file changed during the build.
- Command: `CI=1 pnpm mobile:install:ios:dev --clean --device 00008140-001114501A86801C`; exit 0, `BUILD SUCCEEDED`.
- Clean Expo iOS prebuild registered `MizyunHealthConnectionsModule` and `MizyunHealthExportModule` in the generated module provider.
- Configuration guards passed for Dev API/Supabase endpoints and `mizyun-dev://auth/callback`; signed Apple auth verification passed in the installer.
- Artifact: `apps/mobile/ios/build/Build/Products/Release-iphoneos/MizyunDev.app` (generated intermediate).
- Embedded identity: `Mizyun Dev`, `com.mizyun.development`, version `1.0.9`, build `9`, team `LQJNDVBL43`.
- Embedded `main.jsbundle` SHA256: `8240b176e2bfb585f1d4d4be61aa99a797e64bea4f4e4f06849788571d87e311`.
- `codesign --verify --deep --strict --verbose=2` passed: valid on disk and satisfies its Designated Requirement.
- Target: Adam's iPhone 16 Pro, UDID `00008140-001114501A86801C`.
- Installed and launched at `2026-10-07T08:06:02Z` (10:06 Bratislava).
- Independent `xcrun devicectl device info processes --device … --search MizyunDev` confirmed app PID `11222` and widget PID `11212` in the newly installed container `EEF00010-99F9-4690-9747-3561491BFFC5`.

No implementation, backend deployment, commit, Store operation or full quality gate
was performed in this install-only session. Existing local work was preserved.
Delegation was inapplicable to this routine sequential native installation.

Next: accept Home start/add/finish/resume and earliest-meal Copy to Today/empty-yesterday
on the installed candidate, followed by the existing Health and meal-photo native gates.
Installation and launch do not close those feature issues.
