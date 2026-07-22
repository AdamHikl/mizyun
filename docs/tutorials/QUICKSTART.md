# Daily development quickstart

Use this for a normal coding session after the one-time platform setup is complete.

## 1. Enter the repository and inspect state

```bash
cd /Users/adam/Documents/mizyun
git status --short --branch
git log --oneline --decorate -10
node --version
pnpm --version
```

Preserve any pre-existing changes. Read the continuity files required by [`AGENTS.md`](../../AGENTS.md) before editing.

## 2. Install dependencies when needed

Run this after a fresh clone or a lockfile/package change:

```bash
pnpm install
```

Do not substitute `npm install`; the workspace and lockfile use pnpm.

## 3. Start local services

Docker Desktop must be running.

Terminal A:

```bash
pnpm db:start
pnpm db:status
```

Terminal B:

```bash
pnpm dev:api
```

Expected API address: `http://127.0.0.1:4000`.

If `.env` is missing or stale, stop and follow [Local backend](./LOCAL_BACKEND.md). Do not paste keys into chat, logs, or committed files.

## 4. Start one mobile workflow

### iOS development loop

```bash
pnpm dev:mobile
```

Press `i` in Expo CLI, or follow [iOS Simulator](./IOS_SIMULATOR.md) to select a specific simulator or build a standalone Release app.

### Android development loop

Boot the AVD first, then:

```bash
pnpm dev:mobile
```

Press `a` in Expo CLI. Follow [Android emulator](./ANDROID_EMULATOR.md) for the AVD command, Android-specific URLs, and standalone Release builds.

Do not run both platform configurations from one stale `apps/mobile/.env.local`. iOS uses host loopback; Android uses the emulator host alias. The platform runbooks show the correct values.

## 5. Run the appropriate gate

During implementation, run the smallest focused tests that cover the change. Before a commit:

```bash
pnpm check
git diff --check
```

Database, opt-in Supabase, and native acceptance gates are separate. Use [Testing](./TESTING.md) to decide when each is required.

## 6. End the session cleanly

Stop Metro and the API with `Ctrl+C` in their terminals, then:

```bash
pnpm db:stop
```

iOS:

```bash
xcrun simctl shutdown booted
```

Android:

```bash
/Users/adam/Library/Android/sdk/platform-tools/adb emu kill
```

Final checks:

```bash
git status --short --branch
```

Update `status.md` with evidence and the next exact action. Push only when explicitly authorized.
