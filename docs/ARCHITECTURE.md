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

## Module anatomy

Each feature should expose only an `index.ts` and normally contain:

```text
domain/          entities and rules
application/     use cases
ports/           required capabilities
adapters/        optional feature-local implementations
transport/       route or UI mapping
```

Small modules may collapse folders, but must preserve the dependency direction.
