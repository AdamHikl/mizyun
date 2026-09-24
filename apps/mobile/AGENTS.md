# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

## Store release versioning

Treat `apps/mobile/app.json` as the local source of truth for both stores. Mizyun intentionally uses one synchronized release tuple: root `version` is `1.0.N`, `ios.buildNumber` is `N`, and `android.versionCode` is `N`. Increment all three together before creating the next Production store artifact. Build 6 is version `1.0.6`; the next build is build 7 and version `1.0.7`. `app.config.js` and the build-matrix gate fail closed when these values diverge. Never infer successful store upload or acceptance from a local increment.

## Preserved mobile release artifacts

Keep upload/install candidates under `apps/mobile/dist/releases/`: Google Play AABs in `android/google-play/`, standalone APKs in `android/device/`, retained Xcode archives in `ios/app-store/archives/`, and exported IPA packages in `ios/app-store/packages/`. Run `pnpm mobile:release-artifacts:list` to inventory them. Native generated outputs under `apps/mobile/android/app/build/` and `apps/mobile/ios/build/` are build intermediates, not the durable artifact library. The Android bundle build records exact clean-commit provenance, the signer stages rather than mutates that output, and the iOS IPA builder preserves both the verified package and its Xcode archive. These scripts publish into the canonical structure automatically. Do not rename an artifact to imply a different embedded version or build number, and never upload a raw native-build output directly.
