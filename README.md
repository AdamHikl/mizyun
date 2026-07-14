# Mizyun

Mizyun is a modular fitness and nutrition application designed for Android and iOS. The foundation intentionally separates domain rules, memory, AI orchestration, infrastructure, and UI so any one of them can evolve without forcing changes through the others.

## Repository layout

```text
apps/
  api/                 HTTP composition root
  mobile/              Expo React Native application
packages/
  core/                Pure domain primitives and calculations
  contracts/           Shared, versioned request/response schemas
  memory/              Provider-neutral memory policy and storage ports
  agent-runtime/       Provider-neutral orchestration and agent ports
  providers/           Future model-provider plug-ins
  adapters/            Future database, storage, and device adapters
supabase/
  migrations/          Database, RLS, and private-storage definitions
docs/
  adr/                 Architecture decision records
```

## Local setup

1. Install Node.js 22.11 or newer and pnpm 10.
2. Run `pnpm install`.
3. Copy `.env.example` to `.env` and keep `AGENT_PROVIDER=disabled`.
4. Start the API with `pnpm dev:api`.
5. Start the mobile app with `pnpm dev:mobile`.

The application must not call an AI service yet. Complete [the pre-testing checklist](docs/BEFORE_TESTING.md) before enabling an agent provider.

## Core rule

Applications depend on interfaces. Model vendors, memory databases, Supabase, HealthKit, and Health Connect are replaceable adapters selected only by a composition root.
