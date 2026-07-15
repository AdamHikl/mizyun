# ADR 0003: Local-first Supabase development

- Status: Accepted
- Date: 2026-07-15

## Context

Mizyun has committed database migrations and Supabase adapters but no reproducible backend runtime or integration-test workflow. The schema contains sensitive health, conversation, memory, and photo metadata, so development must prove ownership policies before feature repositories are added. Hosted-only development would make clean resets and isolated policy tests slower and would encourage dashboard changes outside migration history.

## Decision

Use the pinned Supabase CLI and a Docker-compatible local stack as the canonical development and database-test environment.

- Commit `supabase/config.toml`, migrations, and pgTAP tests.
- Apply schema changes through forward migration files and verify them with a clean local `db reset`.
- Keep normal fixtures synthetic and local.
- Use a separate hosted development project only for integration that genuinely requires a reachable service, such as physical-device and real-email redirect testing.
- Never edit hosted schemas directly through the Dashboard once linked; deploy committed migrations.
- Add staging/production deployment through CI before external beta. Remote access tokens and database passwords will live in encrypted CI secrets, not repository files.
- Keep AI disabled throughout backend/authentication setup.

Local Auth requires email confirmation and permits the registered `mizyun://` application scheme. Local wildcard redirects are limited to development; hosted production configuration will use exact redirect paths.

## Sources consulted

- Supabase local development: https://supabase.com/docs/guides/local-development
- Supabase CLI: https://supabase.com/docs/guides/local-development/cli/getting-started
- Schema migrations: https://supabase.com/docs/guides/local-development/overview
- Managing environments: https://supabase.com/docs/guides/deployment/managing-environments
- Database testing: https://supabase.com/docs/guides/local-development/testing/overview
- Native mobile deep links: https://supabase.com/docs/guides/auth/native-mobile-deep-linking
- Redirect URLs: https://supabase.com/docs/guides/auth/redirect-urls
- Storage access control: https://supabase.com/docs/guides/storage/security/access-control

## Consequences

- Docker or another compatible container runtime is required for backend development.
- A clean reset becomes the primary evidence that migrations are reproducible.
- RLS and Storage policy tests can run locally and later in CI without a shared database.
- Physical-device integration may still need a hosted development project or explicit LAN/tunnel configuration.
- Local confirmation emails are inspected through the local SMTP viewer rather than delivered externally.
