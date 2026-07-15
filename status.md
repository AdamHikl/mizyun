# Mizyun current status

> Fast-changing session handoff. Update this file at the end of every development session. Last updated: **2026-07-15**.

## Snapshot

- **Roadmap phase:** Phase 1 — backend environment and authenticated data boundary
- **Next work package:** P1.1 Supabase development project
- **Branch:** `main`
- **Latest verified executable-code commit:** `1914505` (`fix: verify Expo workspace bundling`)
- **Remote:** `https://github.com/AdamHikl/mizyun`
- **AI provider:** intentionally disabled
- **Backend credentials:** not configured
- **iOS simulator:** working; currently renders the intentional “Mizyun is ready / Supabase public configuration has not been provided” state
- **Android emulator/device:** not yet configured or verified
- **Repository state at this handoff:** intended clean after the project-documentation commit; verify with `git status --short`

## What works

- Expo SDK 57 application starts in the iOS simulator.
- Metro exports a complete iOS Hermes bundle from the pnpm workspace.
- Mobile auth composition safely detects missing provider configuration.
- Supabase auth adapters exist behind provider-neutral interfaces.
- Native session storage uses chunked Expo SecureStore values.
- Fastify supports protected bearer-token routes and `/v1/me`.
- Database migrations define profiles, goals, body measurements, food entries, exercises, workouts, sets, conversations, messages, memories, and private media.
- All current user-owned tables have Row Level Security policies and user indexes.
- AI orchestration and memory ports exist, with deliberately disabled and in-memory implementations only.
- `pnpm check` runs formatting, all type checks, the real iOS bundle smoke test, and unit/API tests.

## What is intentionally not working yet

- Account creation and sign-in cannot reach a real backend until a Supabase development project is configured.
- Database migrations have not been applied to a verified development Supabase environment.
- The mobile app has no authenticated API client or feature repositories yet.
- Profile onboarding, goals, food logging, workout tracking, progress uploads, and activity sync are not implemented.
- Persistent memory and conversations are not wired to PostgreSQL.
- No model API or image analysis is enabled.
- Android has not completed an emulator bundle/runtime pass.

## Verification baseline

Last full verification before these documentation changes:

```text
pnpm check
  formatting: passed
  workspace type checks: passed
  iOS Metro/Hermes bundle: passed (1,562 modules)
  tests: passed (15 total)
```

After changing code or executable configuration, run `pnpm check` again and replace this baseline with the new evidence.

## Next work package

### P1.1 — Supabase development environment

1. Research current official Supabase CLI, local development, Auth redirect, migration, RLS test, and Storage guidance.
2. Decide whether the first workflow uses local Supabase, a hosted development project, or both.
3. Record that durable workflow in a new ADR.
4. Install/configure only the required tooling and keep secrets out of Git.
5. Apply every migration from a clean database.
6. Create two test users and prove row/storage isolation.
7. Populate the public mobile URL/key and server URL/public key locally.
8. Exercise sign-up, confirmation, sign-in, restoration, `/v1/me`, and sign-out in the simulator.

Do not enable an AI provider during this work package.

## Known constraints and risks

- The Codex sandbox may not be able to control Apple's CoreSimulator service even when Simulator works when launched by the user.
- Model-provider privacy and retention terms are intentionally unevaluated; AI must remain disabled.
- Schema existence is not evidence that migrations or RLS policies work against a real Supabase environment; integration tests are still required.
- Energy expenditure, body-change advice, and photo interpretation require careful safety/evaluation work before implementation.
- The active Node runtime observed during setup was newer than the minimum supported version; CI should eventually pin and test the supported version explicitly.

## Local commands

```bash
cd /Users/adam/Documents/mizyun
pnpm install
pnpm check
pnpm dev:api
pnpm dev:mobile
```

If Metro cache behavior is suspicious:

```bash
pnpm --filter @mizyun/mobile exec expo start --clear
```

The local `.env` should be created from `.env.example` and must not be committed.

## Recent decisions and commits

- `1914505` — fixed Metro workspace source resolution and added iOS bundle verification.
- `759fe1c` — added provider-neutral authentication and Supabase adapters.
- `4d527f9` — established the modular monolith, schemas, and disabled AI foundation.
- ADR-0002 — provider-neutral identity boundary.
- ADR-0001 — modular monolith with ports and adapters.

## Open decisions

- Local Supabase versus hosted development workflow and how CI applies/tests migrations.
- Whether direct client-to-Supabase repositories or API-only repositories should own each data operation; sensitive/AI operations will remain server-side.
- First deterministic energy formula and versioning strategy.
- Workout draft/offline synchronization strategy.
- HealthKit/Health Connect scope and source-deduplication design.
- Initial model and memory provider selection, deferred until the AI checklist is complete.

## Handoff note

The next session should begin with `AGENTS.md`, `goals.md`, `plan.md`, and this file, then inspect the working tree. Follow `docs/SESSION_GUIDE.md` before starting P1.1.
