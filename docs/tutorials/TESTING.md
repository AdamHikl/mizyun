# Testing workflows

Choose the smallest gate that proves the change, then run the full required gate before committing.

## Test ladder

| Gate                | Command                                     | Use it when                                        |
| ------------------- | ------------------------------------------- | -------------------------------------------------- |
| Focused unit/module | `pnpm --filter <workspace> test <file>`     | Iterating on one behavior                          |
| Mobile typecheck    | `pnpm --filter @mizyun/mobile typecheck`    | Changing mobile TypeScript/UI                      |
| Mobile bundle       | `pnpm --filter @mizyun/mobile bundle:check` | Changing mobile imports/config/native-facing JS    |
| Standard repository | `pnpm check`                                | Before every implementation commit                 |
| Database            | `pnpm db:verify`                            | Changing migrations, grants, RLS, Storage policies |
| Auth e2e            | See below                                   | Changing real Supabase Auth/API composition        |
| Persistence e2e     | See below                                   | Changing Supabase repositories or private Storage  |
| Native smoke        | Platform Release build/install/launch       | Changing native modules, plugins, env, or startup  |
| Native journey      | Maestro/manual acceptance                   | Changing a customer workflow or platform behavior  |

[`docs/QUALITY_GATES.md`](../QUALITY_GATES.md) remains the definition of done.

## Focused examples

```bash
pnpm --filter @mizyun/mobile test src/features/log-meal/meal-form.test.ts
pnpm --filter @mizyun/api test src/modules/food-entries/routes.test.ts
pnpm --filter @mizyun/core test src/energy.test.ts
```

Vitest paths are relative to the selected workspace.

## Standard gate

```bash
pnpm check
```

It runs:

1. Prettier check;
2. every workspace TypeScript check;
3. a real iOS Expo/Metro/Hermes export;
4. every normal Vitest suite.

Last proven result on 2026-07-22: formatting and all typechecks passed, the mobile export bundled 1,673 modules into a 4.7 MB Hermes bundle, 694 tests passed, and 13 opt-in local-Supabase tests skipped by design.

Run `git diff --check` as a separate final whitespace check.

## Database gate

Start Docker and Supabase, then:

```bash
pnpm db:verify
```

This is destructive to local database rows. It must pass for schema, grants, RLS, policies, or Storage changes. See [Local backend](./LOCAL_BACKEND.md).

## Opt-in Auth and persistence e2e

Create and populate the ignored file once:

```bash
cp apps/api/.env.test.example apps/api/.env.test
```

With the local stack running:

```bash
pnpm --filter @mizyun/api test src/auth.e2e.test.ts
```

For persistence:

```bash
set -a
source apps/api/.env.test
set +a
SUPABASE_E2E_URL="$SUPABASE_URL" \
SUPABASE_E2E_PUBLISHABLE="$SUPABASE_PUBLISHABLE_KEY" \
SUPABASE_E2E_SERVICE="$SUPABASE_SERVICE_ROLE_KEY" \
pnpm --filter @mizyun/api test src/persistence.e2e.test.ts
```

Do not put literal keys in the command or a committed script.

## Native smoke versus native acceptance

A bundle export proves Metro can resolve the app. It does not prove the native binary launches.

Native smoke requires:

1. generated native project;
2. Release compilation;
3. install on simulator/emulator;
4. cold launch without Metro;
5. no native crash before sign-in.

Native journey acceptance additionally proves persisted behavior through real UI and backend boundaries. Follow the [iOS](./IOS_SIMULATOR.md) and [Android](./ANDROID_EMULATOR.md) Release sections.

## Maestro flow conventions

Maestro operates through the accessibility UI layer. Prefer this selector order:

1. stable `testID` / `id`;
2. unique accessibility label;
3. unique visible text;
4. explicit index only when duplicate text is intentional;
5. coordinates only as a temporary diagnostic.

Reusable flow skeleton:

```yaml
appId: com.mizyun.app
---
- launchApp:
    clearState: true
- assertVisible: "Welcome back"
```

Rules:

- Keep credentials and keys outside YAML.
- Create a disposable confirmed user before the flow and delete it in an `EXIT`/interrupt cleanup trap.
- Use synthetic measurements and repository-owned synthetic images.
- Assert exact stored values after saves and again after `stopApp` / `launchApp`.
- For Android numeric keyboards, use `hideKeyboard`; do not swipe across keys.
- Wait for network-backed state, not merely a completed tap command.
- Save logs/screenshots only when they contain no secrets or real health information.

The last combined MOB acceptance asserted:

- meal: `650 kcal`, `40P / 70C / 20F`;
- body: `81 kg`, chest `101 cm`, waist `82 cm`;
- workout: Back squat, 5 reps at 100 kg;
- previous performance: 100 kg best, 500 kg previous volume, one set;
- session and stored-record restoration after app restart;
- two private synthetic photo uploads, same-day comparison, deletion of both, empty timeline.

## Manual Auth verification

Use [`docs/AUTH_VERIFICATION.md`](../AUTH_VERIFICATION.md) for sign-up, Mailpit confirmation, sign-in, SecureStore restoration, sign-out, and password recovery. That document complements the automated Auth e2e test.

## Evidence to record

At handoff, record:

- exact command and pass/fail result;
- meaningful test counts, without treating counts as permanent contracts;
- simulator/emulator model and OS/API;
- Debug/development versus standalone Release;
- whether Metro was required;
- whether database tests used a clean reset;
- any skipped opt-in tests and why;
- cleanup of synthetic users/media and shutdown of local services.
