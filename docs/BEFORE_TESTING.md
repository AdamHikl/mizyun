# Before testing AI features

> **AI integration is intentionally disabled.** Complete this checklist before testing any chatbot, image analysis, recommendation, or automatic-memory workflow.

The current business preference is to evaluate Mistral first because Mizyun is pursuing an EU-first provider and privacy position. This is a provider hypothesis, not permission to connect an API: current commercial terms, EU processing/retention, DPA and deletion behavior, model quality, latency, vision capability, and measured unit economics must pass this checklist before selection.

## Model provider

- [ ] Research current official provider documentation and data-retention terms.
- [ ] Choose the initial text/vision model provider and models using measured cost, latency, privacy, and evaluation results.
- [ ] Create `packages/providers/<provider>` and implement the `AgentProvider` interface without modifying `packages/core`, `packages/memory`, or feature modules.
- [ ] Keep API keys in server-side secrets; never use an `EXPO_PUBLIC_` variable for a secret.
- [ ] Replace `DisabledAgentProvider` only in the API composition root.
- [ ] Add strict input/output schemas and refusal/error handling.
- [ ] Add rate limits, timeouts, retries with jitter, and usage budgets.

## Memory

- [ ] Choose the first `MemoryStore` adapter: PostgreSQL search, pgvector, or an external vector store.
- [ ] Define embedding model, dimensions, migration strategy, and re-embedding procedure inside that adapter.
- [ ] Test user isolation for save, list, search, update, and deletion.
- [ ] Add user-visible memory review, correction, export, and deletion controls.
- [ ] Ensure inferred memories include provenance, confidence, and expiry rules.

## Product and safety evaluation

- [ ] Build a consent-based test dataset containing no real user health data.
- [ ] Evaluate food-photo estimates against weighed meals and always show editable ranges.
- [ ] Evaluate training recommendations for contraindications, unsafe volume, and aggressive calorie targets.
- [ ] Confirm that body photos are not used for diagnosis or presented as precise body-fat measurements.
- [ ] Test prompt injection through user text, image text, retrieved memories, and tool results.
- [ ] Complete privacy, deletion, retention, and incident-response reviews.

## Release gate

- [ ] Run unit, contract, RLS, integration, and end-to-end tests.
- [ ] Verify signed media access expires and cross-user access fails.
- [ ] Confirm the API reports the configured provider as ready.
- [ ] Update this document and the relevant ADR with the selected adapters.
