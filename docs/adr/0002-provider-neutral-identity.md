# ADR 0002: Provider-neutral identity boundary

- Status: Accepted
- Date: 2026-07-14

## Context

The mobile app needs durable sessions and the API needs verified user identity, but authentication infrastructure must remain replaceable. User-owned fitness data, photos, conversations, and memories must always be scoped by a verified user ID.

## Decision

Define authentication client and access-token verification ports in `@mizyun/identity`. Supabase implementations live in separate mobile and server adapter packages and are selected only in application composition roots.

The mobile adapter stores native sessions in Expo SecureStore through a chunking layer and uses browser storage on web. The API accepts bearer tokens and exposes the resulting provider-neutral principal to protected routes. PostgreSQL creates one profile for each new auth user; row-level security remains the final per-user data boundary.

When provider configuration is absent, mobile renders a setup state and the API rejects protected requests. There is no mock identity fallback in production composition.

## Consequences

- Authentication providers can be replaced without changing features or domain packages.
- Mobile UI never imports a provider SDK.
- Large session payloads do not depend on a single SecureStore value.
- Every future private route must use the API authentication guard, and every user-owned table must retain row-level security.
