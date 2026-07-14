# Model providers

Each child package implements the provider-neutral `AgentProvider` interface from `@mizyun/agent-runtime`.

Vendor SDKs, request formats, response IDs, retries, and model names must remain inside their provider package. Enabling a provider should require only dependency injection in `apps/api`.

Do not add a provider until the checklist in `docs/BEFORE_TESTING.md` is complete.
