# Build8 release evidence — 2026-10-05

> Superseded for the current upload handoff by the Community placeholder correction [#212](https://github.com/AdamHikl/mizyun/issues/212). These immutable3384b3f packages do not contain the corrected Production placeholder. The “Community keeps coming soon” statement below described nested copy, not the actual error path; see [correction evidence](COMMUNITY_PRODUCTION_PLACEHOLDER_2026-10-05.md). Keep these packages as history.

Adam requested both shipping packages as version1.0.8/build8/versionCode8. This renumbers the previously locked release; it does not include concurrent Dev usability work or open Community enrollment. Tracking: [#27](https://github.com/AdamHikl/mizyun/issues/27)/[#32](https://github.com/AdamHikl/mizyun/issues/32). The workout promotion’s implementation and build7 history remain in [Production workout status evidence](PRODUCTION_WORKOUT_STATUS_EVIDENCE_2026-10-05.md).

## Exact source and scope

Functional base: `c09ee7a1229e455a7899b9d2a5662020af63582a`. Package source: `3384b3fc70fbb7fc55456ee3b7b6c1b67d93f313`, committed/pushed on main. The only runtime/config difference is apps/mobile/app.json’s synchronized1.0.8/8/8 tuple; independent High review confirmed exactly three replacements. Packaging/config/signing tools remain identical. Community keeps “Community is coming soon”; progress photos and App Preview remain Dev-only. No backend/schema/configuration deployment is included; accepted backend authority remains `9b0c41acbb7e4ee70592cab40b6148fc76a393ed` and historical build6 compatibility evidence remains separate.

A direct build8 override on c09ee7a was correctly rejected before native compilation because the committed tuple remained1.0.7/7/7. The new numbering commit resolves that invariant. Fresh isolated CNG generated both platforms, then complete `pnpm check` passed(inputSHA256`0f82d05b789a5e3ab8e4b277a0e57461fbff908dad51b0cdbd743964cab21f5f`). Concurrent Dev source/status/research changes were excluded. The disposable checkout was reconciled to the actual committed SHA and verified clean before bundleRelease. Source check log: `/private/tmp/mizyun-build8-source-check.log`.

## Package preparation

Android and iOS native builds run sequentially against the exact package source. Signed-package checks must inspect actual embedded numbering, identities, Production config/endpoints, signatures/certificates and checksum; metadata alone is insufficient. iOS also requires main/widget app-group signing, HealthKit purposes, Live Activities and matching dSYM UUIDs. Android requires promoted-notification permissions and64-bit16KB native alignment. New artifacts preserve build7 packages as history.

## Remaining acceptance

Adam manually uploads the IPA through Transporter and AAB through Play Console. Native workout Live Activity/Live Updates lifecycle, rest hint/expiry, deep links, opt-out, dismissal, finish/discard/logout/reopen and Store-delivered installation remain separate gates under #27/#32. Package preparation performs no upload, submission, backend promotion or physical-device acceptance.

## Verified Android package

Fresh native bundleRelease completed681tasks/681executed in5m12s, then canonical staged signing passed the enrolled upload certificate check. Actual bundletool1.18.3 validation and manifest dump confirm `com.mizyun.app`, version1.0.8/code8, targetSDK36, debugging disabled and POST_NOTIFICATIONS/POST_PROMOTED_NOTIFICATIONS. Public configuration and actual Hermes bundle retain Production API/Supabase/callback; progress photos remain disabled. All50arm64-v8a/x86_64ELFs have PT_LOAD alignment>=16KB; bundle config uses PAGE_ALIGNMENT_16K. jarsigner and public certificate match enrolled aliasmizyun-upload/SHA1`A3:37:60:CF:83:BB:54:87:FC:71:F0:38:D4:6B:97:21:CA:A0:70:4D`.

Artifact: `apps/mobile/dist/releases/android/google-play/Mizyun-1.0.8-code8-3384b3fc70fbb7fc55456ee3b7b6c1b67d93f313.aab`;79,816,230bytes; SHA256`1ba8ded15a9a86f5f14c592f0cc062e8454d3eeb3166cf424eb7cf602ea9f920`. Immutable `.manifest.json` records exact source, functional base, original build provenance, signing and verification. Build log `/private/tmp/mizyun-build8-android.log`; actual-package log `/private/tmp/mizyun-build8-android-verification.log`. Build7 AAB is preserved unchanged.

## Verified iOS package

Canonical builder completed fresh isolated CNG and complete `pnpm check`(inputSHA256`b32ac5a9b9364380655b6b63d3db755e4c7f3027234caed07c64dc60e2b9c9c0`), then archive/export and native publication guards passed. Exported main `com.mizyun.app` and widget `com.mizyun.app.ExpoWidgetsTarget` both have1.0.8/build8, valid signatures from teamLQJNDVBL43, exact signed `group.com.mizyun.app` and debugging disabled. Main retains both nonblank HealthKit purpose strings, HealthKit entitlement, Production push/Apple Sign In and Live Activities. Exported public config/runtime endpoints are Production; progress photos remain disabled.

IPA: `apps/mobile/dist/releases/ios/app-store/packages/1.0.8-8-3384b3fc70fbb7fc55456ee3b7b6c1b67d93f313-20261005T160253Z/Mizyun-1.0.8-8-3384b3fc70fbb7fc55456ee3b7b6c1b67d93f313-20261005T160253Z.ipa`;27,904,452bytes; SHA256`f196cce9e87edfa2e0b28d7a63490ff46a45c45b7b70acf8c212500b8ab749a7`. Canonical manifest/distribution summary and supplemental actual-package verification are beside it. Retained archive: `apps/mobile/dist/releases/ios/app-store/archives/Mizyun-1.0.8-8-3384b3fc70fbb7fc55456ee3b7b6c1b67d93f313-20261005T160253Z.xcarchive`. Exported main/widget executable UUIDs match archive and dSYMs: mainarm64`8239558E-D489-34A8-A57C-9B6C1C5DB40B`; widgetarm64`842223A2-9CF4-33A6-AA8A-2BD7914CAE92`. Build log `/private/tmp/mizyun-build8-ios.log`; actual-package log `/private/tmp/mizyun-build8-ios-verification.log`. Build7 IPA/archive remain unchanged; use this new1.0.8/build8 package for the current handoff.

## Additional Android layout review

Independent High actual-AAB review confirms source/checksum/tuple/signature/configuration, unchanged permissions and signed-payload equivalence to the checksum-bound generated input. A raw GNU_RELRO end-address formula flags43/50libraries, also present in build7. LLVM plus full LOAD/section layout inspection found zero writable data overlaps with rounded16KB protection ranges; the coordinator independently reproduced43raw modulo warnings and zero writable-section overlaps across all50libraries. This does not demonstrate the documented overlapping-page crash and does not justify changing the locked dependencies. Android16’s linker rounds RELRO protection and considers the containing LOAD. Static PT_LOAD/bundle alignment passes; actual16KB runtime is still untested. No explicit16KB system image is installed; the standard API36AVD’s guest page size was not checked.

Primary sources: [Android page-size guidance](https://developer.android.com/guide/practices/page-sizes#relro), [Android16 bionic linker](https://android.googlesource.com/platform/bionic/+/android16-release/linker/linker_phdr.cpp). Coordinator layout report `/private/tmp/mizyun-build8-android-relro-layout.json`; independent reports `/private/tmp/mizyun-independent-aab8.nVsDlc/elf-layout-build8.json` and `elf-layout-build7.json`. Treat alignment arithmetic and physical runtime acceptance as separate evidence, with no blanket compatibility claim from these static checks.
