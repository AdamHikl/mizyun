# Android R8 Dev verification — 2026-10-11

Scope: [issue234](https://github.com/AdamHikl/mizyun/issues/234), INFRA-DUAL-004/REL-AUD-003. User authorized source changes, optimized builds and testing, restricted to Dev. Production backend, original build9 artifact, Store uploads and release version tuple are outside this session. No backend change is required for the build-only fix.

## Source and review

HEAD `0d9da8a46197f20b12f00d643851a84866368998` with the existing shared working-tree overlays preserved. The APK/AAB candidate uses the combined local source, not a new clean commit. Private build-source inventory includes1962files with aggregate SHA256 `9cf257a86d4e044f1a116aedefc5f50007d328e7a1a856e60d059e8e3320f8cb`; private per-file hashes are outside Git. No commit/push was requested or performed.

The project-owned Expo config plugin enables release minification/resource shrinking and changes only the release default to `proguard-android-optimize.txt`. It preserves debug/signing/custom and dependency keep rules, survives clean prebuild and fails closed on an unsupported template. Plugin registration applies to the source build matrix; only Dev native artifacts are created/tested here. Future Production artifacts require their separate release authorization and acceptance.

Helper GPT-6.1Sol/High authored only the plugin and regression script. Independent GPT-6.1Sol/High review reproduced a conflicting-assignment guard defect, then verified the corrected active-line/property-declaration guards and expanded regressions; no remaining actionable findings. Coordinator inspected the actual source and ran the focused gates. No local Qwen was used.

Fresh `pnpm test:android-release-optimization` PASS (installed Expo57 template, disabled baseline, release-only transformation, idempotence, stale-property deduplication, signing composition, retained custom rules/comments/CRLF, conflicting assignments/comment-only variables and unsupported-template rejections). Fresh `pnpm test:build-matrix` PASS, including source profile identity/environment isolation and required plugin registration. `pnpm navigation:check` PASS (0errors/34existing warnings). Owned formatting and workspace diff whitespace checks PASS. Research is recorded in [RESEARCH_LOG.md](RESEARCH_LOG.md#android-release-r8-optimization--2026-10-11).

## Build and artifact inspection

Final Dev prebuild: `pnpm mobile:founder-dev:android:prebuild --no-install` PASS. Generated properties bothtrue and default rules optimizing. Build command: `MIZYUN_ALLOW_DEBUG_KEYSTORE_IN_RELEASE=true bash scripts/mobile-founder-dev-android.sh assembleRelease :app:bundleRelease -PreactNativeArchitectures=arm64-v8a --console=plain`. The existing process-scoped test signing override applies only to this Dev build; no global signing/configuration change or Production key use.

Gradle PASS: `:app:minifyReleaseWithR8`, assembleRelease and bundleRelease completed in5m8s (743tasks;720executed/23up-to-date). R8version8.12.14, full mode, shrinking/optimization/obfuscation all enabled. No missing-class/R8 warnings were found in the build log.

Embedded R8 metadata reports complementary enabled percentages: **obfuscation81.65%, optimization81.17%, shrinking81.75%**. These are locally inspected Dev artifact statistics, not a Google Play Console verdict. [Raw R8 metadata](evidence/android-r8-dev-2026-10-11/r8.json) and [artifact inspection](evidence/android-r8-dev-2026-10-11/artifact-inspection.json) retain the exact values.

Preserved artifact stem: `apps/mobile/dist/releases/android/device/MizyunDev-1.0.9-code9-r8-20261011-9cf257a86d4e`, with APK/AAB, exact mapping/configuration/usage/seeds, R8 metadata and provenance manifest. APK43,281,406bytes, SHA256 `abd17a6a24a4c469b2e22a1d8080dfd08779d871aed422a56303b30a0a047715`; AAB38,392,131bytes, SHA256 `3d37898ff6c4d43ff5637c108afafd2ffb5d4f9a648f793d67933802fd34ac98`. DEX11,551,940bytes. Existing Production build9 uses different source/environment, so the comparison is not a controlled size benchmark.

Verified actual package `com.mizyun.dev`,1.0.9/code9, target36/arm64-v8a, non-debuggable release. Embedded config routes only to canonical Dev API/Supabase and `mizyun-dev://auth/callback`. APK signature validation PASS with existing test certificate SHA256 `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`. This test-signed Dev AAB is not a Play upload candidate. AAB includes R8 metadata and `proguard.map`, byte-identical to preserved exact-build mapping. No Production artifact was modified.

## Native Dev test matrix

Task booted existing `Mizyun_Pixel_9_API_36` through Android Studio Running Devices. Verified `emulator-5554`, API36/arm64-v8a; no physical Android device connected. Initial state: existing Dev Debug sign-in screen, no submitted draft, no ADB reverse mappings. Unknown pre-existing Metro8087 is preserved; Release testing does not depend on it. Android Studio's automatic project import failed closed on absent release credentials; the Dev wrapper's separate explicit test signing build owns native compilation.

Installed preserved APK via `adb install -r`: Success. Launch PASS (PID4863). Native UI signed into existing synthetic Dev accountA; authenticated Home, Workouts, Meals, Community and Settings rendered. Coach initially displayed a false expired-session error; Check again rendered Coach successfully without reauthentication. This repeats on cold restart and matches existing open [issue200](https://github.com/AdamHikl/mizyun/issues/200); its native acceptance remains open, with no attribution to R8 established.

Force-stop/cold-launch PASS: Android launch receipt602ms, new PID5295, signed-in Home persisted. Coach retry again recovered. Notification permission was denied; the prompt recurred on restart. No fatal crash, missing-class/method, native-link or JNI error markers in either process's retained logs. Source hashes for mobile/packages/root package/lock remained unchanged since build capture.

[Native receipt](evidence/android-r8-dev-2026-10-11/native-smoke.json) and screenshots record observed outcomes. Existing synthetic Dev accounts only; credentials remain private. No account creation, provider request, sharing, deletion or Production traffic. Host text entry was ineffective; observed on-screen keyboard entry completed sign-in. Restored the temporary Hardware Input toggle, returned to Home, and shut down only the emulator booted by this task. Preserved unrelated Metro8087. This is emulator smoke evidence, not physical-device acceptance.

## Full verification

Live shared-tree gate rejected as stale and stopped at formatting of later concurrent `docs/evidence/community-simulators-2026-10-10/identity-native-2026-10-11.md`; that file was left untouched. Created stable `/private/tmp/mizyun-r8-verified-candidate-20261011`: same HEAD and all original build inventory overlays, updated R8 continuity/evidence, excluding that later concurrent file. Verified zero differences for mobile/package/root package/lock build inputs. Own lockfile-pinned dependencies installed; no shared module symlinks.

Fresh full **`pnpm check` PASS**, input SHA256 `c77d439b5de6c9e3778f054362fe25c2cb6ea1a0ea28bd1af9a59d06cb0845e4`. Includes final R8 regression and build matrix, navigation/format/typecheck/iOS+Android bundling,2128mobile/979API/196Supabase-server tests, analytics/deployment/operations/backup/signing/AI-eval/Community/tooling checks. Fifteen API end-to-end tests skipped under existing integration gates. Three existing config purity tests skipped due to obsolete output path; copied the fresh generated iOS Hermes bundle only into their legacy expected cache folder and ran `pnpm --filter @mizyun/config exec vitest run src/mobile-public.test.ts`: **6PASS/0skips**, actual `.hbc` present. This supplements the full gate without changing source. Final evidence/status edits describe outcomes only; checked formatting/whitespace separately.

[Gate receipt](evidence/android-r8-dev-2026-10-11/quality-gate.json). Build/native logs and source inventory remain private in `/private/tmp`; no credentials included in durable evidence. Engineering scope#234 complete; existing#200 native acceptance remains open. No backend deployment, physical install, Production build/upload, commit or push performed.

## Remaining gates

Native Dev smoke completed with issue200 still open. Exact Play percentages/threshold acceptance require a future authorized optimized Production AAB and Console evaluation. Physical device, push/background, camera/Health/watch, all JNI/reflection paths and Store acceptance are not implied by a build or emulator smoke pass. The original Production build9 is not optimized retrospectively.
