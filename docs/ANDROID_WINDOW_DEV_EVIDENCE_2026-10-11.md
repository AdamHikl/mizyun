# Android window Dev verification — 2026-10-11

Scope: [issue235](https://github.com/AdamHikl/mizyun/issues/235). User authorized source changes, builds and testing on Dev only. Removes Android orientation restriction and enables resizing; Material1.14.0 guards API35+ system-bar migration. Existing R8 fix retained. Production builds/uploads, backend changes and version bumps are outside scope.

## Source and independent review

Source HEAD `0d9da8a46197f20b12f00d643851a84866368998` with preserved concurrent working-tree overlays. No commit or push performed. Private source inventory contains1987files, aggregate SHA256 `5b28bc6618c50302269f8e7bacb60c42f804768f2c351f783b16d4dec636c17e`. Final comparison found no drift in inventoried apps/packages/scripts/root package/lock inputs.

The new Expo config plugin removes MainActivity's Android `screenOrientation`, sets `resizeableActivity=true`, enables `edgeToEdgeEnabled=true`, and applies an exact Material1.14.0 dependency constraint. Android-only changes preserve iOS orientation and the existing signing/R8 guards. Unsupported or conflicting Gradle templates fail closed; repeated generation is idempotent. Source registration covers the build matrix; this session generates and tests only Dev artifacts.

GPT-6.1Sol/High helper authored the plugin and regression script. A separate GPT-6.1Sol/High reviewer checked installed Expo ordering, manifest/property transforms, Gradle constraint composition and guard cases; no actionable findings remained. Coordinator inspected the actual source and ran focused `pnpm test:android-window-support`, `pnpm test:android-release-optimization`, and `pnpm test:build-matrix`: PASS. Research and dated official sources: [RESEARCH_LOG.md](RESEARCH_LOG.md#android-adaptive-windows-and-edge-to-edge-235--2026-10-11).

## Exact Dev build

`pnpm mobile:founder-dev:android:prebuild --no-install`: PASS. Generated manifest has no MainActivity orientation restriction and explicitly enables resizing; generated Gradle properties enable edge-to-edge. Build command:

```sh
MIZYUN_ALLOW_DEBUG_KEYSTORE_IN_RELEASE=true bash scripts/mobile-founder-dev-android.sh assembleRelease :app:bundleRelease -PreactNativeArchitectures=arm64-v8a --console=plain
```

Gradle PASS in5m1s,743tasks (720executed/23up-to-date), including R8 minification, APK and AAB. Process-scoped local test signing only; no global signing override or Production key. APK signature PASS, test certificate SHA256 `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`. This Dev AAB is not a Play upload candidate.

Actual APK: `com.mizyun.dev`,1.0.9/code9, target36, arm64-v8a, non-debuggable. APK manifest inspection confirms unrestricted/resizable MainActivity. Embedded `assets/app.config` identifies Dev/development and canonical Dev API/Supabase plus `mizyun-dev://auth/callback`. Dependency insight on `releaseRuntimeClasspath` confirms Material1.14.0 selected by the strict constraint over original1.13.0 requests from Router/screens/logbox. Inspection did not change the APK hash.

Preserved stem: `apps/mobile/dist/releases/android/device/MizyunDev-1.0.9-code9-window-20261011-5b28bc6618c5`, including APK/AAB and exact mapping/configuration/usage/seeds/R8/provenance companions. APK43,476,655bytes SHA256 `5135b768c7f671a1173a57be7fe60a93ec38d1ad87a233851e77dbb70fe1057a`; AAB38,546,393bytes SHA256 `9d40bcf82ce11893882e2d8fce2a749b55a947cdb93bcaf73911c6dd52b5abdc`. Embedded AAB mapping is byte-identical to preserved mapping, SHA256 `6e7daa7ded5f0eea90b4ed131b7437b3387af3743c5c81693e98c52b8579232e`.

R8version8.12.14 metadata complements yield **obfuscation81.67%, optimization81.19%, shrinking81.76%**. These are local Dev artifact statistics; Google Play has not evaluated this candidate. [Artifact inspection](evidence/android-window-dev-2026-10-11/artifact-inspection.json), [raw R8 metadata](evidence/android-window-dev-2026-10-11/r8.json).

## Deprecated API qualification

Actual optimized DEX inspection and exact mapping confirm Material BottomSheetDialog/EdgeToEdgeUtils bar setters skip API35+ using SDK checks. App startup enables the RN edge-to-edge flag, and statusBarHide/Show use the WindowInsetsControllerCompat path when enabled. Both observed app windows report `layoutInDisplayCutoutMode=always` and `EDGE_TO_EDGE_ENFORCED`.

Deprecated compatibility references remain packaged. RN's `enableEdgeToEdge` itself still contains bar-color setters; the flag-false status methods retain SHORT_EDGES/DEFAULT helpers. Material retains guarded legacy calls. This implementation does **not** establish that every deprecated call is absent or that Play's static warning will clear. No vendor patch or R8 assumption hides these references. [Exact DEX excerpts](evidence/android-window-dev-2026-10-11/dex-window-paths.txt). Issue235 remains open for upstream/static-warning and acceptance follow-up.

## Native layout smoke

Installed the exact preserved APK successfully on two API36/arm64 emulators. No physical Android device connected. UI actions/capture used Android Studio through CUA; ADB was limited to lifecycle, installation and read-only logs/configuration. Unknown existing Metro8087 preserved; standalone Release builds do not use Metro. Studio's automatic project sync failed closed on absent release credentials; the separately verified Dev wrapper build owns compilation.

| Device                                 | Observed result                                                                                                                                                                                                                 | Boundary                                                                                                             |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Existing Pixel9 API36, emulator-5554   | Signed-in synthetic Dev accountA Home in portrait and landscape; cutout padding and navigation visible. Meal form rotates and scrolls to lower Save in both orientations. Cold restart573ms/PID5967 returns authenticated Home. | Physical1080x2424 has an existing1080x1920 override,420dpi; actual portrait411x731dp. No meal Save/provider request. |
| Task Pixel Tablet API36, emulator-5556 | App Preview Meals renders in landscape1280x800dp and portrait800x1280dp; bounded content, search and bottom navigation. Launch890ms/PID3705.                                                                                    | Signed-out preview only; authenticated tablet data/journeys unrun.                                                   |

Phone's initial PID5617 and restarted PID5967, and tablet PID3705 retained process logs show zero fatal/missing-class/missing-method/native-link/JNI markers. This is bounded emulator smoke, not comprehensive runtime acceptance.

Input testing encountered Android's stylus tutorial. Cancel dismissed it in portrait; floating keyboard and app header/field rendered, but docked IME resizing was not accepted. Portrait and landscape form scroll were independently observed with keyboard dismissed. An unexpected camera permission prompt was denied; no capture or permission grant. Tablet notification permission denied. No account creation, sharing, deletion or Production traffic. Phone returned to portrait Home without submitting a meal. Stopped only the two task-started emulators; preserved profiles and unrelated Metro8087.

[Native receipt](evidence/android-window-dev-2026-10-11/native-smoke.json), [phone portrait](evidence/android-window-dev-2026-10-11/phone-portrait.png), [phone landscape](evidence/android-window-dev-2026-10-11/phone-landscape.png), [portrait form](evidence/android-window-dev-2026-10-11/phone-form-portrait.png), [landscape form](evidence/android-window-dev-2026-10-11/phone-form-landscape.png), [tablet landscape](evidence/android-window-dev-2026-10-11/tablet-landscape.png), [tablet portrait](evidence/android-window-dev-2026-10-11/tablet-portrait.png).

## Full gate and next actions

Stable candidate `/private/tmp/mizyun-window-verified-candidate-20261011` has the same HEAD and build inputs. Nine concurrently changing documentation files retained their earlier snapshot versions; exact excluded paths are in the [gate receipt](evidence/android-window-dev-2026-10-11/quality-gate.json). Shared checkout edits were preserved. Own dependency tree, no shared-module symlinks.

Fresh **`pnpm check` PASS**, input SHA256 `3328fe41412f059231e8c16f2c4a28978bba7aa728b457b6be6dd53327fbc04d`: navigation/format/typecheck/iOS+Android bundles,2128mobile/979API/196Supabase-server tests and tooling/operations/evals, including final window/R8/build-matrix regressions. Fifteen API E2E tests remain skipped under existing integration gates. Copied the newly generated iOS Hermes output into the existing purity test's obsolete expected cache path and reran `pnpm --filter @mizyun/config exec vitest run src/mobile-public.test.ts`: **6PASS/0skips**, actual fresh `.hbc` verified. Outcome documentation after the gate is separately formatted and navigation checked.

Only API36 images were already installed; API35/34 and below were not downloaded or tested. Remaining: older Android compatibility, physical device, authenticated tablet, docked keyboard/all forms, multi-window/fold postures, three-button navigation, dark/large-text/accessibility and eventual Play evaluation. The source manifest enables resizing, but split-screen usability is not proven by rotation. Existing Coach issue200 remains open; this window session does not claim Coach acceptance.

Final official dependency check found no verified supported Expo57/RN update that removes these references; RN0.86.3,0.86-stable and main retain them. Keep the compatible implementation. Next: complete older-API/IME/multi-window Dev acceptance and evaluate a future Expo-supported RN release once upstream source removes the references, followed by exact-artifact inspection. Play warning clearance remains an upstream dependency and Store acceptance gate. Production build/upload and Console evaluation require their separate release milestone. No backend deployment, Production build/upload, version bump, commit or push performed.
