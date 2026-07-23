# Before testing AI features

> **AI integration is intentionally disabled for real-user data.** Provider-neutral code and fake-adapter tests may proceed without a key. Complete the synthetic-provider gate below before sending synthetic fixtures to a live model, and complete the entire checklist before real-user AI testing or external access.

The current business preference is to evaluate Mistral first because Mizyun is pursuing an EU-first provider and privacy position. This is a provider hypothesis, not permission to connect an API: current commercial terms, EU processing/retention, DPA and deletion behavior, model quality, latency, vision capability, and measured unit economics must pass this checklist before selection.

## Model provider

- [x] Research current official provider documentation and data-retention terms. (2026-07-23; see `docs/RESEARCH_LOG.md`.)
- [x] Select Mistral `mistral-medium-latest` as the candidate text model for synthetic evaluation; this is not production promotion.
- [ ] Promote the initial text/vision provider and models using measured cost, latency, privacy, safety, and quality results.
- [x] Create `packages/providers/mistral` and implement the provider-neutral `AgentProvider` interface; vendor SDK code remains inside that package.
- [x] Keep API keys in validated server-only configuration; mobile public configuration contains no Mistral secret.
- [x] Select the Mistral adapter only in the API composition root and retain `DisabledAgentProvider` as the default.
- [x] Add strict structured-output validation, fixed refusal paths, post-output checks, and normalized provider errors.
- [ ] Add rate limits, timeouts, retries with jitter, and usage budgets.

### Synthetic-provider gate

Before the first live Mistral request:

- [ ] Every model-provider item required for the candidate text adapter is complete except final production promotion.
- [x] The offline evaluation corpus is versioned and contains only synthetic English/Slovak fixtures with no real user health data, photos, identifiers, or secrets.
- [x] A dedicated low-budget development key/workspace and spend cap are active. (Developer attestation, 2026-07-23.)
- [x] Input/output logging is disabled or demonstrably redacted; the adapter emits only bounded metadata and the live synthetic run printed no key.
- [x] The applicable retention/training setting is recorded for the development account. (Developer attestation, 2026-07-23.)

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

- [ ] Run the complete AI unit, contract, RLS, live-synthetic integration, and native end-to-end matrix.
- [x] Verify signed media access expires and cross-user access fails. (Existing private-media persistence/native evidence; see `status.md`.)
- [x] Confirm the API reports the configured provider as ready. (`mistral-medium-latest`, external development access enabled; 2026-07-23.)
- [x] Update this document and the relevant ADR with the selected adapters.
