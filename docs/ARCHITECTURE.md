# Architecture

Mizyun begins as a modular monolith: one repository and one deployable API, with strict internal boundaries. This keeps early operations simple while preserving replaceable components.

## Dependency direction

```text
mobile UI ----------------------> contracts
API routes --------------------> contracts
API composition root ----------> feature modules + concrete adapters
feature modules ---------------> core + ports
agent runtime -----------------> AgentProvider + MemoryStore ports
provider/database adapters ----> ports

core --------------------------> nothing platform-specific
```

Dependencies point inward. A provider adapter knows about the `AgentProvider` interface; the interface never knows about the provider.

## Plug-in seams

### Model providers

`AgentProvider` accepts a normalized request and returns a normalized response. OpenAI, Anthropic, local models, or a test double can implement it. Provider-specific conversation IDs and usage details stay in an opaque metadata field.

### Memory

`MemoryStore` exposes durable operations. Retrieval strategy, embeddings, vector indexes, summarization, and consolidation stay behind that port. The agent orchestrator requests relevant memory but does not know how it was found.

### Identity and storage

Supabase is the initial deployment target, not a domain dependency. Database migrations enforce ownership with Row Level Security. Future repositories translate database rows to domain objects.

### Health platforms

HealthKit and Health Connect will be device adapters in the mobile app. They normalize records into shared contracts before synchronization.

## Package responsibilities

- `packages/core`: pure domain calculations (TDEE, BMR, weight EMA trends, workout volumes). Zero dependencies on frameworks, databases, or model vendors.
- `packages/contracts`: shared versioned schemas and DTOs across processes (Fastify API and Expo mobile).
- `packages/agent-runtime`: provider-neutral AI orchestration, evaluation corpus, and ports (`AgentProvider`, `VisionDraftProvider`, `ContentModerator`). Never depends on vendor SDKs.
- `packages/memory`: memory policies and interfaces. Independent of specific vector databases.
- `packages/providers/<vendor>`: concrete model vendor adapters (`packages/providers/gemini`).
- `packages/adapters/<technology>`: infrastructure adapters (`supabase-server`, `supabase-mobile`, `ses`).
- `packages/api-client`: typed HTTP API client with automatic bearer token injection.
- `packages/config`: runtime environment schema validation and build matrix profiles.
- `packages/identity`: user identity types and session abstraction.
- `packages/observability`: privacy-first local analytics event logging and error classification.
- `apps/api`: Fastify server composition root (`apps/api/src/app.ts`). Wires concrete adapters, registers route plugins, and exposes HTTP endpoints.
- `apps/mobile`: Expo mobile application (`apps/mobile/src/`). Presentation, gestures, camera/media pickers, and SecureStore session handling.

## Composition roots

1. **Server (`apps/api/src/app.ts`)**: instantiates database adapters, selects AI provider (Gemini default, Mistral fallback), configures logging, and mounts `/v1/*` routes.
2. **Mobile (`apps/mobile/src/app/`)**: Expo Router file-based layout, initializes React Query, authenticated API client, and local state controllers.

## Feature navigation

Concrete mappings from features to their contracts, domain logic, routes, mobile UI, database tables, and tests are maintained machine-readably in [`docs/feature-map.json`](feature-map.json).

Use developer tooling to inspect feature contexts directly:

```bash
pnpm context <feature-id>  # e.g., pnpm context meal-logging
pnpm context --list        # list all mapped features
```
