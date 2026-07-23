# Mizyun development memory wiki

> Reusable, repository-specific runbooks for setup, builds, tests, simulators, emulators, and recurring failures. Start here when a new coding session needs to run the app instead of reconstructing commands from chat history.

## Pick the workflow you need

| Goal                                             | Runbook                                           |
| ------------------------------------------------ | ------------------------------------------------- |
| Start a normal coding session                    | [Daily quickstart](./QUICKSTART.md)               |
| Configure or diagnose local Supabase and the API | [Local backend](./LOCAL_BACKEND.md)               |
| Run or build the app in an iOS Simulator         | [iOS Simulator](./IOS_SIMULATOR.md)               |
| Run or build the app in an Android emulator      | [Android emulator](./ANDROID_EMULATOR.md)         |
| Configure and test the development AI provider   | [Mistral AI testing](./AI_DEVELOPMENT_TESTING.md) |
| Choose and execute the right test gate           | [Testing](./TESTING.md)                           |
| Recover from a known setup/build/runtime failure | [Troubleshooting](./TROUBLESHOOTING.md)           |

The normal path is:

1. [Daily quickstart](./QUICKSTART.md)
2. The relevant platform runbook
3. [Testing](./TESTING.md)
4. [Troubleshooting](./TROUBLESHOOTING.md) only if the expected checkpoint fails

## What this wiki is—and is not

This directory owns operational memory: commands, checkpoints, teardown, and symptoms that have already cost time. It does not replace:

- [`AGENTS.md`](../../AGENTS.md) for mandatory engineering rules;
- [`docs/SESSION_GUIDE.md`](../SESSION_GUIDE.md) for session continuity;
- [`docs/QUALITY_GATES.md`](../QUALITY_GATES.md) for definitions of done;
- [`docs/RESEARCH_LOG.md`](../RESEARCH_LOG.md) for dated primary-source findings;
- [`docs/adr/`](../adr/) for durable architecture decisions;
- [`status.md`](../../status.md) for the current project state.

If a runbook disagrees with one of those sources, follow the higher source and repair this wiki in the same session.

## Last proven local toolchain

This is evidence, not a requirement to pin every host tool forever. Re-check official compatibility guidance before upgrading a native toolchain.

| Component           | Last proven value          | Notes                               |
| ------------------- | -------------------------- | ----------------------------------- |
| Host                | macOS on Apple Silicon     | iOS builds require macOS            |
| Node.js             | 25.3.0                     | Repository minimum is 22.13.0       |
| pnpm                | 10.33.0                    | Pinned in root `package.json`       |
| Expo / React Native | SDK 57.0.4 / RN 0.86.0     | See `apps/mobile/package.json`      |
| Xcode               | 26.6                       | iOS 26.5 Simulator runtime          |
| Android Studio      | Quail 2, 2026.1.2          | Build AI-261.25134.95.2612.15822958 |
| Android SDK         | API 36, Build Tools 36     | Platform Tools 37.0.0               |
| Android emulator    | 36.6.11                    | AVD `Mizyun_Pixel_9_API_36`         |
| Android JDK         | Android Studio JBR 21.0.10 | Preferred for Gradle builds         |
| Maestro             | 2.7.0                      | Requires a working `JAVA_HOME`      |
| Supabase CLI        | 2.109.1                    | Pinned development dependency       |
| Docker              | 29.2.0                     | Local Supabase runtime              |

Last full native proof: 2026-07-22. Standalone Release apps passed the stored MOB journey on an iPhone 17 Pro simulator and a Pixel 9 API 36 emulator.

## Safety rules for every runbook

- Never put `SUPABASE_SECRET_KEY`, a service-role key, or a model key in an `EXPO_PUBLIC_*` variable.
- Never commit `.env`, `.env.*`, `apps/api/.env.test`, or `apps/mobile/.env.local`.
- Use synthetic accounts and synthetic images only. Delete disposable auth users after acceptance runs.
- Treat `apps/mobile/ios/` and `apps/mobile/android/` as generated Expo CNG output. They are ignored and may be regenerated; durable native configuration belongs in `app.json` or a config plugin.
- The local Supabase stack is development-only and is not hardened for public exposure. Use it on a trusted network and stop it when finished.
- Store commands and placeholders here, not real credentials, tokens, user data, or screenshots containing sensitive values.

## How to maintain this memory

Update the narrowest runbook whenever a command, required version, output path, or recurring workaround changes. Add:

1. the symptom;
2. the quickest safe diagnosis;
3. the verified correction;
4. whether the correction is local-only or belongs in committed configuration;
5. the date and primary source in [`docs/RESEARCH_LOG.md`](../RESEARCH_LOG.md).

Do not copy status prose into this directory. Runbooks should remain useful after the current backlog item changes.
