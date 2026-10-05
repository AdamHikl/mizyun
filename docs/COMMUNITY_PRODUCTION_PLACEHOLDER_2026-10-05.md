# Production Community placeholder — 2026-10-05

Issue: [#212](https://github.com/AdamHikl/mizyun/issues/212). User explicitly requested fixing the Production Community screen while retaining1.0.8 / iOS build8 / Android code8.

Version8 package records below are historical; the current requested release is [version9](BUILD_9_RELEASE_EVIDENCE_2026-10-05.md).

## Cause and implementation

The previous enrollment gate disabled Join but did not gate the tab. Failed membership/session reads mounted the settings recovery screen; coming-soon existed only inside the successful, adult-eligible form. Help was unconditional and Leave appeared on errors without confirming enrollment.

`FeedScreen` now selects the closed placeholder before mounting auth, membership or feed components. It shows the exact visible heading “Community is coming soon”, the shared header, private-tracking copy and a48-point Home action. Scrollable themed text, header and bottom-tab insets support narrow/large-text layouts. Canonical configured Dev keeps its existing Community flow. Standalone account settings/withdrawal routes and server admission remain unchanged. No native permissions, backend or migrations changed.

## Verification and provenance

Base: `cf2462acb3626d0fad7c8cde5d773223b30237d5`. Owned source: `apps/mobile/src/features/community/feed/feed-screen.tsx` and its test. Unrelated dirty usability/UI edits are excluded from the isolated release candidate and preserved in the primary checkout. App configuration has no diff and retains1.0.8/8/8.

Four new closed-state regressions (signed-out, error, loading, stale-enrolled) failed against the original source;35feed tests pass after the fix. They assert exact visible coming-soon text, shared header/private navigation, no membership/feed/auth mounting or reads and no recovery/join/leave controls. Fresh full Community plus admission suite:40files /405tests PASS. Independent GPT-6.1 Sol High non-author review approved the implementation; its visible-text assertion suggestion was incorporated and included in the final405test run.

Fresh isolated `pnpm check` PASS (inputSHA256`bb5061965833ffb1f484cc2f2f9210a8d79360b8e9b4c8ac4a1344fc4b98d6a7`; log`/private/tmp/mizyun-community-build8-check.log`). Source commit`630e764d83e78a0496c063f3de7485b2dc09e219` was committed/pushed to main; remote source confirmed. Corrected signed artifacts and package inspections PASS; manual upload and physical-device acceptance remain open. Prior3384b3f build8 artifacts remain immutable history and do not contain this fix; they must not be used as the corrected candidate. Native-device/Store acceptance and existing Community launch gates remain open.

## Research

Current [Expo57](https://docs.expo.dev/versions/v57.0.0/), [Router57](https://docs.expo.dev/versions/v57.0.0/sdk/router/) and [React effects](https://react.dev/reference/react/useEffect) reviewed; consequences recorded in `RESEARCH_LOG.md`. Static component selection avoids mounting Community effects when closed. No new durable architecture decision or dependency upgrade.

## Next action

Use the superseding [version9 packages](BUILD_9_RELEASE_EVIDENCE_2026-10-05.md) for the next manual release. Accept the Community placeholder on physical devices in light/dark and large text, including offline/signed-in startup. Keep native workout/16KB runtime/Store exits under#27/#32 open. No Store upload or backend deployment is part of this session.

## Corrected iOS package

Canonical `pnpm mobile:founder-production:ios:ipa --sha 630e764d83e78a0496c063f3de7485b2dc09e219 --build-number 8` completed fresh isolated native generation, full `pnpm check` PASS (inputSHA256`e8fc4e0d1d14c65af3266d85b73f8f188d3cf5aa9ca0ee29d305f12db09f472a`), Xcode archive/export and signing/configuration guards. Actual main/widget versions are1.0.8/8, teamLQJNDVBL43 and matching signed app group; Production push/Apple Sign In/HealthKit and false debugger entitlement remain. Independent elevated `codesign` trust/signature checks PASS; sandbox-only trust evaluation was unavailable and was not counted as verification. Actual embedded Expo config is Production, and the main Hermes bundle contains the exact heading plus the unique new private-tracking copy.

IPA: `apps/mobile/dist/releases/ios/app-store/packages/1.0.8-8-630e764d83e78a0496c063f3de7485b2dc09e219-20261005T170642Z/Mizyun-1.0.8-8-630e764d83e78a0496c063f3de7485b2dc09e219-20261005T170642Z.ipa`;27,905,415bytes; SHA256`c988c100e98836f4575af78763f12aea823a2e977b992f2ed1c5d64c091988f4`. Adjacent immutable manifest/distribution summary and supplemental artifact-verification JSON retain provenance. Archive: `apps/mobile/dist/releases/ios/app-store/archives/Mizyun-1.0.8-8-630e764d83e78a0496c063f3de7485b2dc09e219-20261005T170642Z.xcarchive`. Log: `/private/tmp/mizyun-community-build8-ios.log`. No upload/install/device acceptance occurred.

Main/widget exported binary UUIDs match retained dSYMs: main`DBDAA24C-F3E9-3555-B967-8233ECE9B232`, widget`D95B7966-FA75-3C7E-8F0E-EC8E338CAD88`; adjacent `dsym-verification.json` records the check.

## Corrected Android package

The clean source-matched isolated candidate built681tasks (653executed/28up-to-date) in4m5s. The first attempt stopped before compilation because Gradle signing env was absent; retry used the existing enrolled key securely from Keychain, with no debug fallback. Canonical staged signing verified certificateSHA1`A3:37:60:CF:83:BB:54:87:FC:71:F0:38:D4:6B:97:21:CA:A0:70:4D`, jarsigner verification and immutable artifact preservation.

AAB: `apps/mobile/dist/releases/android/google-play/Mizyun-1.0.8-code8-630e764d83e78a0496c063f3de7485b2dc09e219.aab`;79,817,207bytes; SHA256`9c9f8ab2bd3d0ac0b207c98461e08f1da396f8de11cd972f0ac544c64c830471`. Adjacent `.aab.build.json` retains source/input checksum; `.aab.manifest.json` records final checksum/certificate/source-check fingerprint and verification.

Bundletool1.18.3 validation and manifest dump PASS: actual `com.mizyun.app`,1.0.8/code8, targetSDK36 and debugger disabled. Embedded Expo config is Production profile/variant with canonical API/Supabase/callback and progress photos disabled. Actual Hermes bundle contains the new heading and unique private-tracking copy. All50arm64-v8a/x86_64ELFs have >=16KBPT_LOAD alignment and matching offset/address congruence; bundle config is PAGE_ALIGNMENT_16K. Static checks do not establish16KB runtime acceptance. Logs: `/private/tmp/mizyun-community-build8-android.log`, `...-android-signing.log`, `...-android-verification.json`, `...-bundletool-validation.log`; initial safety-stop log`...-android-initial.log`.

No backend deployment, Store upload or physical installation occurred. Prior3384b3f packages remain unchanged historical artifacts; use only corrected630e764 packages for this handoff.

Independent GPT-6.1 Sol High AAB review PASS with no findings: actual signature/certificate/manifest/config/copy verified; all2,441non-signature ZIP entries byte-match the generated build input. Actual inputSHA256`cda9f928b6c0543113fba9608b6b8cdd2993b9d4632a06293bce3d249f085197` matches its source630e764 build provenance. Exported iOS and signed Android checks are package evidence only. Final continuity updates passed formatting/navigation and `git diff --check`; unchanged runtime source remains qualified by both full gates above.

## Production iPhone test installation — 2026-10-05

At Adam’s explicit request, installed the existing standalone Release app from the retained630e764 archive on iPhone16Pro `00008140-001114501A86801C`. Reused exact compiled source rather than rebuilding concurrent UI work. Both main/widget profiles contain this device; independent High strict/deep signatures and Production-config/tuple/runtime/UUID checks PASS. Runtime bundle SHA256`1d587ac11a52a4aa291252102acbd6370c1299df9d179a41244efbfa3530714d` and main/widget UUIDs exactly match the exported Store IPA.

Fresh `xcrun devicectl device install app` PASS; installed app inventory confirms `com.mizyun.app`1.0.8/build8. Explicit process launch PASS and separate process inventory confirms PID6786. Uses Production API/Supabase/callback with bundled JS and no Metro. The archive is Apple Development signed (development APNs/get-task-allow true); this installation tests the Production runtime and does not accept Store signing or Production-push behavior. Store-export IPA remains unchanged.

Redacted durable evidence: adjacent package `device-install-verification.json`; raw local install/launch/apps/process evidence under `/private/tmp/mizyun-production-build8-*.json`. Other paired devices were excluded. Next: Adam opens Community and confirms the coming-soon screen, then exercises signed-in/core/native workout journeys before manual upload. Installation and process evidence do not close those feature/device/Store gates. No upload or backend deployment occurred.
