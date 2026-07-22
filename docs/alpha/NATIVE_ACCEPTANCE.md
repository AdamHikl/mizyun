# Native ALPHA-001 acceptance

This checklist proves the OBS-001 user boundary in standalone Release builds. It does not count as a founder day or design partner.

## Required synthetic journey

For each platform:

1. Install/launch the standalone Release app without Metro.
2. Use a disposable confirmed account and synthetic values only.
3. At onboarding, leave analytics untouched and confirm Continue still works.
4. In Account, confirm analytics reads Off; enable it explicitly.
5. Visit Dashboard, nutrition history, body history, progress photos, and Account.
6. Complete one synthetic meal, body-measurement, and workout flow, including one harmless validation failure and retry.
7. Force-stop/relaunch and confirm the event count persists and increases for the new session.
8. Export and confirm the native system share sheet opens with a schema-v1 JSON payload containing only cataloged fields.
9. Cancel the share sheet, choose Clear, and confirm the count reaches zero while consent remains enabled.
10. Produce another event, choose Disable and clear, and confirm Off/zero events.
11. Sign out and confirm auth/session behavior still succeeds even if analytics is already disabled.
12. Delete the disposable auth identity and synthetic records/media; stop local services.

## Evidence

| Platform | Device/runtime                     | Build                       | Consent/default-off | Core events | Restart persistence | Share sheet/schema | Clear   | Disable | Cleanup | Result  |
| -------- | ---------------------------------- | --------------------------- | ------------------- | ----------- | ------------------- | ------------------ | ------- | ------- | ------- | ------- |
| iOS      | iPhone 17 Pro simulator / iOS 26.5 | Release build/launch passed | pending             | pending     | pending             | pending            | pending | pending | pending | partial |
| Android  | Pixel 9 AVD / API 36               | standalone Release APK      | pending             | pending     | pending             | pending            | pending | pending | pending | pending |

Record exact failures in [`ISSUE_LOG.md`](./ISSUE_LOG.md). Do not store screenshots or exports containing participant data in the repository.

### 2026-07-22 iOS checkpoint

- Expo/Xcode produced and installed the standalone Release app with an embedded 1,677-module bundle.
- A direct `xcrun simctl launch` worked without Metro and rendered the expected authentication screen against the local configuration.
- Expo's post-install attempt to focus the Simulator GUI failed because host AppleScript automation was denied; this did not affect the successful build, install, or direct launch.
- No consent, event, restart, share-sheet, clear, disable, or cleanup cell is accepted from this checkpoint. Continue with a disposable synthetic account.
