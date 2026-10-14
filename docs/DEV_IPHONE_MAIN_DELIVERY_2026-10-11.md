# Dev iPhone installation — 2026-10-11

Installed the latest merged `main`, exact source `0135228778059dc25c1a4925738f0b6934ed4f0c`, on Adam’s iPhone (`00008140-001114501A86801C`). The app is `com.mizyun.development`, version1.0.9(9), signed by team `LQJNDVBL43`.

`CI=1 pnpm mobile:install:ios:dev --clean --device 00008140-001114501A86801C` completed clean Expo prebuild, Release build, signature guard and installation. Installation time:2026-10-11T17:27:01Z. Independent `devicectl device info processes` identified the installed container’s main app PID29460 and widget PID29458. Port8081 had no listener before or after; the Release app includes its8,486,027-byte JavaScript bundle. Deep strict signature verification passed. Apple sign-in and HealthKit entitlements are present, and embedded Watch/widget versions and signing teams match the phone app. Watch installation/paired acceptance was not performed.

All941 snapshotted tracked source files matched before/after the build; the working tree remained clean before this receipt. The candidate’s final full `pnpm check` already passed during the main integration; this installation did not repeat unit/integration suites. [Integration verification](ALL_LOCAL_MAIN_INTEGRATION_2026-10-11.md).

[Native receipt and artifact hashes](evidence/dev-iphone-main-2026-10-11/native-delivery.json) and [source manifest](evidence/dev-iphone-main-2026-10-11/source-manifest.json). Preserved standalone app: `apps/mobile/dist/releases/ios/device/2026-10-11-main-0135228-dev-1.0.9-9/MizyunDev.app`. Detailed private build log: `/private/tmp/mizyun-iphone-dev-install-20261011.log`.

The embedded bundle contains the canonical Dev API, Supabase and callback addresses. No backend deployment, migration, remote configuration or Production change was performed. The recorded Dev backend remains `2596a69b3fe4d20920a173de91fb4dc533b9bd4a`; the newer Community lifecycle migration `20261011120000` remains undeployed. Installation/process evidence does not establish signed-in feature, accessibility, provider or paired-watch acceptance. Next: use the installed Dev app; deploy a separately verified/authorized backend candidate if testing server changes newer than the recorded Dev release.

An independent read-only installer review verified Dev routing/signing/watch guards and the need to verify launch separately. The installer’s port8081 termination had no target. No application source, dependencies or version tuple changed.

Subsequent separately authorized backend deployment on2026-10-11 completed: the Dev API now runs the same `0135228778059dc25c1a4925738f0b6934ed4f0c`, with migration20261011120000 applied and fresh dependency readiness. [Deployment receipt](DEV_BACKEND_MAIN_DEPLOYMENT_2026-10-11.md). This supersedes the earlier backend next action without adding feature-acceptance claims.
