# Mizyun current status

> Fast-changing session handoff. Update this file at the end of every development session. Last updated: **2026-07-15**.

## Snapshot

- **Roadmap phase:** Phase 1 — backend environment and authenticated data boundary
- **Active work package:** P1.1 Supabase development project
- **Branch:** `main`
- **Latest verified executable-code commit:** `1914505` (`fix: verify Expo workspace bundling`)
- **Remote:** `https://github.com/AdamHikl/mizyun`
- **AI provider:** intentionally disabled
- **Backend credentials:** not configured
- **iOS simulator:** working; currently renders the intentional “Mizyun is ready / Supabase public configuration has not been provided” state
- **Android emulator/device:** not yet configured or verified
- **Local Supabase:** CLI/config/test scaffolding added; execution blocked because installed Docker Desktop cannot be launched from the Codex sandbox
- **Repository state at this handoff:** Supabase development changes in progress

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
- Supabase CLI 2.109.1, local configuration, and initial pgTAP schema/isolation suites are present.

## What is intentionally not working yet

- Account creation and sign-in cannot reach a real backend until a Supabase development project is configured.
- Database migrations have not been applied to a verified development Supabase environment.
- The database pgTAP suites have not executed because Docker Desktop is installed but its engine is not running and sandbox launch attempts fail.
- The mobile app has no authenticated API client or feature repositories yet.
- Profile onboarding, goals, food logging, workout tracking, progress uploads, and activity sync are not implemented.
- Persistent memory and conversations are not wired to PostgreSQL.
- No model API or image analysis is enabled.
- Android has not completed an emulator bundle/runtime pass.

## Verification baseline

Current standard verification after the local-backend scaffolding:

```text
pnpm check
  formatting: passed
  workspace type checks: passed
  iOS Metro/Hermes bundle: passed (1,562 modules)
  tests: passed (15 total)
```

After changing code or executable configuration, run `pnpm check` again and replace this baseline with the new evidence.

Database verification remains pending: `pnpm db:start` reaches the Docker-engine check, but `pnpm db:verify` cannot run until Docker Desktop is started outside the Codex sandbox.

## Next work package

### P1.1 — Supabase development environment

1. Start the installed Docker Desktop application outside the Codex sandbox.
2. Run `pnpm db:start`, then `pnpm db:verify`.
3. Fix every migration, lint, or pgTAP failure; do not weaken isolation assertions.
4. Copy the local publishable key from `pnpm db:status` into the untracked `.env`.
5. Exercise sign-up, confirmation, sign-in, restoration, `/v1/me`, and sign-out in the simulator.
6. Create/link a separate hosted development project only when physical-device or real-email integration needs it.

Do not enable an AI provider during this work package.

## Known constraints and risks

- Docker Desktop and its CLI are installed, but Launch Services/direct launch fail from the Codex sandbox; the user must open Docker Desktop once.
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
pnpm db:start
pnpm db:verify
pnpm dev:api
pnpm dev:mobile
```

If Metro cache behavior is suspicious:

```bash
pnpm --filter @mizyun/mobile exec expo start --clear
```

The local `.env` should be created from `.env.example` and must not be committed.

## Recent decisions and commits

- ADR-0003 — local-first Supabase development with migration and pgTAP gates.
- `089150e` — established the project roadmap and session-continuity system.
- `1914505` — fixed Metro workspace source resolution and added iOS bundle verification.
- `759fe1c` — added provider-neutral authentication and Supabase adapters.
- `4d527f9` — established the modular monolith, schemas, and disabled AI foundation.
- ADR-0002 — provider-neutral identity boundary.
- ADR-0001 — modular monolith with ports and adapters.

## Open decisions

- Hosted development project creation and the eventual CI environment-promotion implementation.
- Whether direct client-to-Supabase repositories or API-only repositories should own each data operation; sensitive/AI operations will remain server-side.
- First deterministic energy formula and versioning strategy.
- Workout draft/offline synchronization strategy.
- HealthKit/Health Connect scope and source-deduplication design.
- Initial model and memory provider selection, deferred until the AI checklist is complete.

## Handoff note

The next session should begin with `AGENTS.md`, `goals.md`, `plan.md`, and this file, then inspect the working tree. Follow `docs/SESSION_GUIDE.md` and resume P1.1 at the Docker/database verification step.
