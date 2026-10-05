# Production build 9 release evidence — 2026-10-05

User requests both signed packages as1.0.9/iOS build9/Android code9. Baselinec88f7342b78690a988973271ad6bb257eca6c181 retains corrected Community630e764d83e78a0496c063f3de7485b2dc09e219. Runtime diff is exactly three release-number values in app.json; app.config and Community source remain identical. Unrelated dirty usability/UI work is excluded from the isolated candidate.

Independent GPT-6.1 Sol High numbering review approved the exact tuple diff; generic build-matrix assertions require no test changes. Fresh native generation, focused/full checks and signed-package verification PASS as recorded below. Prior build8 artifacts and installed iPhone build8 remain historical evidence; build9 device/native/16KB runtime/Store acceptance remains open. No upload, backend deployment or device installation is requested by this numbering task. Manual Transporter/Play upload follows acceptance.

## Exact source and automated verification

Release source `dd5b435385b379d8c0df1b69813f8d8fdd3d985a` committed/pushed to main and remote SHA confirmed. Fresh native generation and focused `pnpm test:build-matrix` PASS. Fresh isolated `pnpm check` PASS, inputSHA256`1db5286deb4e8592f35697dc2f0618b81e2572ddcfa7a8986fe07a798a014c04`, log`/private/tmp/mizyun-build9-check.log`. Mobile132files/1,421tests PASS; API60files/852tests PASS,3E2Efiles/15tests intentionally skipped pending their configured live integration gates. No skipped checks are accepted as passed. Independent High review approved the actual isolated diff and generated main/widget/Android tuple; no unrelated UI source copied. Build8 iPhone installation is recorded separately in the Community evidence document.

## Signed iOS package

Canonical `pnpm mobile:founder-production:ios:ipa --sha dd5b435385b379d8c0df1b69813f8d8fdd3d985a --build-number 9` PASS: fresh locked dependencies/native generation, full gate(inputSHA256`0e27c3edc1bff8fbe3911308389690737a7f82af3a651d1b7a1d1f27db4e38b4`), archive/export and actual identity/signing/configuration guards. Log`/private/tmp/mizyun-build9-ios.log`.

IPA: `/Users/adam/Documents/mizyun/apps/mobile/dist/releases/ios/app-store/packages/1.0.9-9-dd5b435385b379d8c0df1b69813f8d8fdd3d985a-20261005T184908Z/Mizyun-1.0.9-9-dd5b435385b379d8c0df1b69813f8d8fdd3d985a-20261005T184908Z.ipa`; 27,905,405bytes; SHA256`95c3cecfd144fb8cac3794423801583c7e3b36e015cd9b15413654d89efbbb24`. Retained archive: `/Users/adam/Documents/mizyun/apps/mobile/dist/releases/ios/app-store/archives/Mizyun-1.0.9-9-dd5b435385b379d8c0df1b69813f8d8fdd3d985a-20261005T184908Z.xcarchive`. Adjacent immutable manifest/distribution summary plus artifact/dSYM verification preserve provenance. Main/widget actual1.0.9/9, Production identifiers/teamLQJNDVBL43/app group; Apple Distribution signatures and strict/deep verificationPASS, Production APNs/Apple Sign In/HealthKit preserved, debugger disabled. Actual embedded Expo config selects canonical Production API/Supabase/callback; photos disabled. Compiled bundle contains exact coming-soon heading/private copy; SHA256`ab106f5ceeac09b01fc01fe55476f58b4d32572414ccf9cd44ab0e53985e3c51`.

Main UUID`F67924BA-4758-3DB7-887A-2C3136510D5B`, widget UUID`75120957-97B6-3F99-A646-B0C76E0D9BE0` independently match corresponding retained dSYMs. Independent GPT-6.1 Sol High non-author actual IPA reviewPASS with no findings: metadata/signatures/trusted certificate/capabilities/config/copy/checksum/manifest/tool hashes/dSYMs checked. Package verification does not accept native journeys or Store release.

## Signed Android package

The source-matched clean isolated candidate built681tasks/681executed in4m8s. Existing enrolled Keychain-backed upload key preserved; canonical staged signer verified jarsigner/certificateSHA1`A3:37:60:CF:83:BB:54:87:FC:71:F0:38:D4:6B:97:21:CA:A0:70:4D` with no debug fallback. Logs`/private/tmp/mizyun-build9-android.log` and`/private/tmp/mizyun-build9-android-signing.log`.

AAB: `/Users/adam/Documents/mizyun/apps/mobile/dist/releases/android/google-play/Mizyun-1.0.9-code9-dd5b435385b379d8c0df1b69813f8d8fdd3d985a.aab`; 79,817,234bytes; SHA256`db2e370b34d4e199b459329e47e8422ca65a006228c49ad55c2ca7857ebb9fec`. Adjacent `.aab.build.json` retains source/inputSHA256`0a44d65591d1709d9d0a172d2fca6f21011c0f1e45f86381462a7537f0dc689f`; `.aab.manifest.json` records the final checksum/certificate/quality fingerprint and actual verification. All2,441non-signature entries byte-match the generated input.

Bundletool1.18.3 validation and actual manifestPASS: com.mizyun.app1.0.9/code9, targetSDK36, debugger disabled. Embedded Expo Production profile/variant selects canonical API/Supabase/callback with photos disabled. Actual compiled Community heading/private copy verified; bundleSHA256`e8f2788145d0beeecd4c91b29a721e170c1cb046336fba54135fdf1a3c873bb9`. All50arm64-v8a/x86_64native ELFs have >=16KBPT_LOAD alignment and matching offset/address congruence; bundle configPAGE_ALIGNMENT_16K. Static checks do not accept16KB runtime behavior. Durable artifact manifest includes assertions; local dumps`/private/tmp/mizyun-build9-bundletool-{manifest,config,validate}.log` and`/private/tmp/mizyun-build9-android-verification.json`.

Independent GPT-6.1 Sol High non-author actual AAB reviewPASS with no findings: signature/certificate/manifest/config/Community copy/checksum/input provenance, all2,441payload entries and all50native64-bit LOAD alignments independently checked.

## Remaining acceptance and next action

Use only these version9 packages for the next manual release. Prior build8 packages remain immutable history. The installed iPhone Production app is still1.0.8/build8 from the previous requested installation; version9 has not been installed or device accepted. Native workout/Community/theme/large-text journeys, Android16KB runtime and Store upload/approval remain open under#27/#32. Backend9b0c41a unchanged. No backend deployment or Store upload occurred. Provider integrations and credential-gated E2E checks remain outside this package evidence.

Final evidence-only updates passed owned formatting, navigation(0errors,18advisory warnings) and `git diff --check`; unchanged runtime remains covered by both fresh full gates above. Unrelated mobile diff fingerprint preserved; corrected historical build8 IPA/AAB checksums unchanged. [Release issue handoff](https://github.com/AdamHikl/mizyun/issues/27#issuecomment-6001045943).
