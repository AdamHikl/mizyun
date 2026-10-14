# Before testing AI features

> Admission policy update 2026-09-10: [ADR-0024](adr/0024-self-service-ai-consent-access.md) replaces manual AI email enrollment with self-service consent for authenticated adult-eligible accounts. Older allowlist requirements are superseded only in that respect. Provider evaluation, privacy, budgets and release evidence remain separate gates. Local implementation does not change a deployed host.

> **Broader real-user AI acceptance remains blocked.** The explicitly approved founder/testing-partner Dev exception is recorded in AGENTS.md; do not infer that the live Dev service is disabled. Provider-neutral code and fake-adapter tests may proceed without a key. Complete the synthetic-provider gate before new live evaluation, and the entire checklist before broader external access.

The active external model provider candidate is Google Gemini (`gemini-3.8-flash` / `packages/providers/gemini`) for both text coaching and multimodal meal nutrition drafting. Current terms research is recorded in `docs/RESEARCH_LOG.md`; actual project settings, lifecycle/privacy acceptance, consent behavior and spend enforcement remain subject to the round-2 findings.

> **2026-09-08 round-2 correction:** [review](IMPLEMENTATION_REVIEW_2026-09-08_ROUND_2.md) found that offline fixture/screener checks were misrepresented as measured provider acceptance. The approved founder/testing-partner Dev exception (shared Gemini project and enabled AI) remains in effect; it does not close this broader release gate. Generic provider terms do not establish actual project settings.

> **Dev availability update, Adam 2026-10-14:** Keep implemented features, including live recipe recognition/generation, enabled for founder/testing-partner Dev trials. This overrides earlier default-off or prerequisite-check wording for those trials. Track unfinished evidence without withholding Dev access; preserve authentication, consent, adult eligibility and usage/spending controls. Broader external and Production acceptance remains separate. [Enablement proof](DEV_RECIPES_ENABLED_2026-10-14.md).

## Model provider

- [x] Research current official provider documentation and data-retention terms. (See `docs/RESEARCH_LOG.md`.)
- [x] Select Google Gemini `gemini-3.8-flash` as the candidate provider for text coaching and vision drafts.
- [ ] Promote the initial text/vision provider and models using measured cost, latency, privacy, safety, and quality results.
- [x] Create `packages/providers/gemini` and implement provider-neutral `AgentProvider` and `VisionDraftProvider` interfaces; vendor SDK code remains inside that package.
- [x] Keep API keys in validated server-only configuration (`GEMINI_API_KEY`); mobile public configuration contains no model secrets.
- [x] Retain `DisabledAgentProvider` as the fallback when unconfigured.
- [x] Add strict structured-output validation, fixed refusal paths, post-output checks, and normalized provider errors.
- [ ] Enforce durable token/spend limits across all provider attempts, aggregate environment cost caps, and per-minute rate limits; prove concurrency and restart behavior.
- [x] Enforce adult eligibility (18+) server-side (`AI_AGE_RESTRICTED`) and explicit third-party AI sharing consent on mobile (`AiConsentModal`).

### Synthetic-provider gate

Before running live Gemini requests:

- [ ] Every model-provider item required for the candidate adapter is complete.
- [x] The offline evaluation corpus is versioned and contains only synthetic fixtures with no real user health data, photos, identifiers, or secrets.
- [ ] Evidence actual Dev provider credentials/project settings and enforced spend quota/billing alerts under the approved shared-project exception; do not claim a dedicated key is active without evidence.
- [x] Input/output logging is disabled or demonstrably redacted; adapter emits only bounded metadata and no API key.
- [ ] Explicit user consent dialogs and adult eligibility confirmation are verified on mobile clients.

## Memory

- [x] Choose the first `MemoryStore` adapter: PostgreSQL lexical search.
- [x] Record that embeddings are intentionally excluded from the first memory slice; an ADR and re-embedding plan are required before adding them.
- [x] Test verified-principal isolation for save, list, search, update, and deletion.
- [x] Add user-visible memory review, correction, export, and deletion controls.
- [x] Ensure memory candidates include provenance, confidence, and expiry rules; the runtime never creates inferred memories.

## Product and safety evaluation

- [x] Build a consent-based test dataset containing no real user health data. (`gemini-eval-v1-2026-09-08` in `packages/agent-runtime/src/evaluation-corpus.ts`.)
- [ ] Evaluate food-photo estimates against weighed meals and always show editable ranges.
- [ ] Evaluate training recommendations for contraindications, unsafe volume, and aggressive calorie targets.
- [ ] Confirm that body photos are not used for diagnosis or presented as precise body-fat measurements.
- [ ] Test prompt injection through user text, image text, retrieved memories, and tool results.
- [ ] Complete privacy, deletion, retention, and incident-response reviews.

## Release gate

- [ ] Run the complete AI unit, contract, RLS, live-synthetic integration, and native end-to-end matrix.
- [x] Verify signed media access expires and cross-user access fails. (Existing private-media persistence/native evidence; see `status.md`.)
- [x] Confirm the API reports the configured provider as ready. (`gemini-3.8-flash`, candidate active on Dev with explicit server-side `authorizeAiAccess` gate.)
- [x] Update this document and the relevant ADR with the selected adapters. (Google Gemini `gemini-3.8-flash` with `gemini-3.6-flash` fallback.)
