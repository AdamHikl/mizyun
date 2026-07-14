# ADR 0001: Modular monolith with ports and adapters

- Status: accepted
- Date: 2026-07-14

## Context

Mizyun needs mobile, API, storage, health-platform, memory, and model-provider integrations. Those technologies will change at different speeds. A distributed service architecture would add operational cost before the product boundaries are proven.

## Decision

Use a pnpm TypeScript monorepo and a modular monolith. Pure domain packages define ports. Replaceable providers and infrastructure implement those ports and are selected in application composition roots.

Use Expo's supported workspace layout for the Android/iOS app and Fastify's encapsulated plug-in model for API route modules. Use PostgreSQL Row Level Security and private object storage for defense-in-depth user isolation.

## Sources consulted

- Expo monorepos: https://docs.expo.dev/guides/monorepos/
- Fastify plug-ins: https://fastify.dev/docs/latest/Reference/Plugins/
- Fastify encapsulation: https://fastify.dev/docs/latest/Reference/Encapsulation/
- Supabase Row Level Security: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase private buckets: https://supabase.com/docs/guides/storage/buckets/fundamentals

## Consequences

- Feature and provider boundaries are testable without network services.
- A model or memory provider can be replaced at the API composition root.
- Workspace tooling is more complex than a single application repository.
- Modules must resist importing each other's internals or the separation will erode.
