# Mizyun

Mizyun is a modular fitness and nutrition application designed for Android and iOS. The foundation intentionally separates domain rules, memory, AI orchestration, infrastructure, and UI so any one of them can evolve without forcing changes through the others.

## Project navigation

Start here in a new development session:

1. [`AGENTS.md`](AGENTS.md) — mandatory engineering and safety rules
2. [`goals.md`](goals.md) — product mission, MVP, non-goals, and principles
3. [`plan.md`](plan.md) — ordered phases, dependencies, and exit criteria
4. [`status.md`](status.md) — current implementation snapshot and next exact action
5. [`backlog.md`](backlog.md) — executable work items and dependencies

Supporting sources of truth:

- [`docs/PRODUCT_REQUIREMENTS.md`](docs/PRODUCT_REQUIREMENTS.md) — stable behavioral requirement IDs
- [`docs/QUALITY_GATES.md`](docs/QUALITY_GATES.md) — definition of done and release gates
- [`docs/SESSION_GUIDE.md`](docs/SESSION_GUIDE.md) — start/research/handoff workflow
- [`docs/RESEARCH_LOG.md`](docs/RESEARCH_LOG.md) — primary sources reviewed by segment
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and [`docs/adr/`](docs/adr/) — module boundaries and durable decisions
- [`docs/BEFORE_TESTING.md`](docs/BEFORE_TESTING.md) — mandatory gate before enabling AI

## Repository layout

```text
apps/
  api/                 HTTP composition root
  mobile/              Expo React Native application
packages/
  core/                Pure domain primitives and calculations
  contracts/           Shared, versioned request/response schemas
  identity/            Provider-neutral authentication ports
  memory/              Provider-neutral memory policy and storage ports
  agent-runtime/       Provider-neutral orchestration and agent ports
  providers/           Future model-provider plug-ins
  adapters/            Supabase and future infrastructure adapters
supabase/
  migrations/          Database, RLS, and private-storage definitions
docs/
  adr/                 Architecture decision records
  PRODUCT_REQUIREMENTS.md  Stable behavioral requirements
  QUALITY_GATES.md     Definition of done and release criteria
  RESEARCH_LOG.md      Dated primary-source research
  SESSION_GUIDE.md     Cross-session continuity procedure
```

## Local setup

1. Install Node.js 22.13 or newer, pnpm 10, and a running Docker-compatible container runtime.
2. Run `pnpm install`.
3. Start the local backend with `pnpm db:start`.
4. Copy `.env.example` to `.env`, copy the local publishable key shown by `pnpm db:status`, and keep `AGENT_PROVIDER=disabled`.
5. Verify migrations and ownership policies with `pnpm db:verify`.
6. Start the API with `pnpm dev:api`.
7. Start the mobile app with `pnpm dev:mobile`.

Local Supabase Studio is available at `http://127.0.0.1:54323` and confirmation messages at `http://127.0.0.1:54324` while the stack is running. The current CLI/Docker Desktop combination publishes local ports on all host interfaces despite its localhost URLs, so use only on a trusted network and run `pnpm db:stop` when finished. Do not expose the stack to a public network.

Authentication is intentionally inactive until the Supabase URL and publishable key are set in `.env`. Native sessions are encrypted with SecureStore; user-owned database records are isolated with row-level security.

The application must not call an AI service yet. Complete [the pre-testing checklist](docs/BEFORE_TESTING.md) before enabling an agent provider.

## Core rule

Applications depend on interfaces. Model vendors, memory databases, Supabase, HealthKit, and Health Connect are replaceable adapters selected only by a composition root.
