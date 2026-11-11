# Mizyun

Mizyun is a modular fitness and nutrition application designed for Android and iOS. The foundation intentionally separates domain rules, memory, AI orchestration, infrastructure, and UI so any one of them can evolve without forcing changes through the others.

**Who it's for:** busy intermediate gym-goers who want food, workouts, measurements and coaching context in one private place, without tracking feeling like a second job. See [`goals.md`](goals.md).

**Built with:** TypeScript in a pnpm monorepo; an Expo / React Native app (Expo Router); a Fastify API; Supabase (Postgres with row-level security, Auth, Storage); server-side AI providers behind provider-neutral ports.

**Roadmap:** [`ROADMAP.md`](ROADMAP.md) summarizes the work ahead; [GitHub Issues](https://github.com/AdamHikl/mizyun/issues) holds the detailed list.

All data in this repository (fixtures, seeds, screenshots, evidence) is synthetic. No real user data is stored here.

## Project navigation

Start here in a new development session:

1. [`AGENTS.md`](AGENTS.md) — mandatory engineering and safety rules
2. [`goals.md`](goals.md) — product mission, MVP, non-goals, and principles
3. [`docs/BUSINESS_ALIGNMENT.md`](docs/BUSINESS_ALIGNMENT.md) — target customer, launch wedge, business model, validation ladder, and audited product gaps
4. [`plan.md`](plan.md) — ordered phases, dependencies, and exit criteria
5. [`status.md`](status.md) — current implementation snapshot and next exact action
6. [GitHub Issues](https://github.com/AdamHikl/mizyun/issues) (redirected from [`backlog.md`](backlog.md)) — executable work items, task tracking, and dependencies

Supporting sources of truth:

- [`docs/PRODUCT_REQUIREMENTS.md`](docs/PRODUCT_REQUIREMENTS.md) — stable behavioral requirement IDs
- [`docs/BUSINESS_ALIGNMENT.md`](docs/BUSINESS_ALIGNMENT.md) — bridge between product strategy and engineering priorities
- [`docs/QUALITY_GATES.md`](docs/QUALITY_GATES.md) — definition of done and release gates
- [`docs/OBSERVABILITY.md`](docs/OBSERVABILITY.md) — reviewed product-analytics events, properties, consent, retention, and export boundary
- [`docs/AI_IMPLEMENTATION_PLAN.md`](docs/AI_IMPLEMENTATION_PLAN.md) — default-off Mistral implementation, evaluation, safety, and release sequence
- [`docs/INFRASTRUCTURE_EVOLUTION_PLAN.md`](docs/INFRASTRUCTURE_EVOLUTION_PLAN.md) — managed-EU hosting now and gated migration to Mizyun-operated infrastructure
- [`docs/alpha/README.md`](docs/alpha/README.md) — founder dogfood, design-partner, native acceptance, issue, and aggregate-results evidence
- [`docs/SESSION_GUIDE.md`](docs/SESSION_GUIDE.md) — start/research/handoff workflow
- [`docs/tutorials/README.md`](docs/tutorials/README.md) — reusable setup, build, test, simulator, emulator, and troubleshooting runbooks
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
  tutorials/           Operational memory wiki and proven runbooks
  alpha/               ALPHA-001 validation workflow and evidence ledger
  BUSINESS_ALIGNMENT.md  Customer, business, and validation alignment
  PRODUCT_REQUIREMENTS.md  Stable behavioral requirements
  OBSERVABILITY.md       Privacy-safe product analytics event catalog
  QUALITY_GATES.md     Definition of done and release criteria
  RESEARCH_LOG.md      Dated primary-source research
  SESSION_GUIDE.md     Cross-session continuity procedure
```

## Local setup

For the maintained, platform-specific workflow—including standalone Release builds and known failures—start with the [development memory wiki](docs/tutorials/README.md). The abbreviated setup is:

1. Install Node.js 22.13 or newer, pnpm 10, and a running Docker-compatible container runtime.
2. Run `pnpm install`.
3. Start the local backend with `pnpm db:start`.
4. Copy `.env.example` to `.env`, copy the local publishable key shown by `pnpm db:status`, and follow [`FOUNDER_TESTING_MODE.md`](docs/FOUNDER_TESTING_MODE.md) for the enabled development configuration.
5. Verify migrations and ownership policies with `pnpm db:verify`.
6. Start the API with `pnpm dev:api`.
7. Start the mobile app with `pnpm dev:mobile`.

Local Supabase Studio is available at `http://127.0.0.1:54323` and confirmation messages at `http://127.0.0.1:54324` while the stack is running. The current CLI/Docker Desktop combination publishes local ports on all host interfaces despite its localhost URLs, so use only on a trusted network and run `pnpm db:stop` when finished. Do not expose the stack to a public network.

Authentication is intentionally inactive until the Supabase URL and publishable key are set in `.env`. Native sessions are encrypted with SecureStore; user-owned database records are isolated with row-level security.

Founder testing mode may call the configured server-side AI provider for Adam's
own testing. Complete [the pre-testing checklist](docs/BEFORE_TESTING.md)
before enabling the app for any other person or external beta.

## Core rule

Applications depend on interfaces. Model vendors, memory databases, Supabase, HealthKit, and Health Connect are replaceable adapters selected only by a composition root.

## License

Copyright (c) 2026 Adam Hikl. Licensed under the GNU Affero General Public License v3.0; see [`LICENSE`](LICENSE). Anyone who runs a modified version, including as a network service, must make its complete source available under the same license. The Mizyun name and logo are not licensed for use by forks or derived apps.
