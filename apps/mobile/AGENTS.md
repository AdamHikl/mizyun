# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

## Store release versioning

Treat `apps/mobile/app.json` as the local source of truth for both stores. Mizyun intentionally uses one synchronized release tuple: root `version` is `1.0.N`, `ios.buildNumber` is `N`, and `android.versionCode` is `N`. Increment all three together before creating the next Production store artifact. Build 6 is version `1.0.6`; the next build is build 7 and version `1.0.7`. `app.config.js` and the build-matrix gate fail closed when these values diverge. Never infer successful store upload or acceptance from a local increment.
