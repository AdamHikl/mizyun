# Before testing AI features

> **AI integration is intentionally disabled for real-user data.** Provider-neutral code and fake-adapter tests may proceed without a key. Complete the synthetic-provider gate below before sending synthetic fixtures to a live model, and complete the entire checklist before real-user AI testing or external access.

The active external model provider candidate is Google Gemini (`gemini-3.8-flash` / `packages/providers/gemini`) for both text coaching and multimodal meal nutrition drafting. Current commercial terms, transient processing (no model training on API prompts), 30-day abuse monitoring retention, adult eligibility (18+), explicit user consent, and spend caps have been audited per `docs/RELEASE_READINESS_2026-09-07.md`.

## Model provider

- [x] Research current official provider documentation and data-retention terms. (See `docs/RESEARCH_LOG.md`.)
- [x] Select Google Gemini `gemini-3.8-flash` as the candidate provider for text coaching and vision drafts.
- [x] Promote the initial text/vision provider and models using measured cost, latency, privacy, safety, and quality results.
- [x] Create `packages/providers/gemini` and implement provider-neutral `AgentProvider` and `VisionDraftProvider` interfaces; vendor SDK code remains inside that package.
- [x] Keep API keys in validated server-only configuration (`GEMINI_API_KEY`); mobile public configuration contains no model secrets.
- [x] Retain `DisabledAgentProvider` as the fallback when unconfigured.
- [x] Add strict structured-output validation, fixed refusal paths, post-output checks, and normalized provider errors.
- [x] Add daily spend caps (20/day free, 100/day paid) and per-minute sliding rate limits.
- [x] Enforce adult eligibility (18+) server-side (`AI_AGE_RESTRICTED`) and explicit third-party AI sharing consent on mobile (`AiConsentModal`).

### Synthetic-provider gate

Before running live Gemini requests:

- [x] Every model-provider item required for the candidate adapter is complete.
- [x] The offline evaluation corpus is versioned and contains only synthetic fixtures with no real user health data, photos, identifiers, or secrets.
- [x] A dedicated development key and API spend quota / billing alert are active.
- [x] Input/output logging is disabled or demonstrably redacted; adapter emits only bounded metadata and no API key.
- [x] Explicit user consent dialogs and adult eligibility confirmation are verified on mobile clients.

## Memory

- [x] Choose the first `MemoryStore` adapter: PostgreSQL lexical search.
- [x] Record that embeddings are intentionally excluded from the first memory slice; an ADR and re-embedding plan are required before adding them.
- [x] Test verified-principal isolation for save, list, search, update, and deletion.
- [x] Add user-visible memory review, correction, export, and deletion controls.
- [x] Ensure memory candidates include provenance, confidence, and expiry rules; the runtime never creates inferred memories.

## Product and safety evaluation

- [x] Build a consent-based test dataset containing no real user health data. (`gemini-eval-v1-2026-09-08` in `packages/agent-runtime/src/evaluation-corpus.ts`.)
- [x] Evaluate food-photo estimates against weighed meals and always show editable ranges. (`weighedMealEvaluationCases` with +/-20% tolerance, `calorieRangeKcal`, `proteinRangeG`, `confidence`, `assumptions`.)
- [x] Evaluate training recommendations for contraindications, unsafe volume, and aggressive calorie targets. (`contraindicationEvaluationCases` with 100% structured refusal rate.)
- [x] Confirm that body photos are not used for diagnosis or presented as precise body-fat measurements. (`bodyPhotoGuidanceCases` enforces subjective visual records only, no dermatological diagnosis, no body fat % claims.)
- [x] Test prompt injection through user text, image text, retrieved memories, and tool results. (`multiVectorInjectionCases` covering 4 vectors with 100% refusal/neutralization rate.)
- [x] Complete privacy, deletion, retention, and incident-response reviews. (Google Gemini Paid Services terms audited: no model training on prompts, 30-day abuse monitoring retention, international processing, GDPR export/deletion cascade verified.)

## Release gate

- [ ] Run the complete AI unit, contract, RLS, live-synthetic integration, and native end-to-end matrix.
- [x] Verify signed media access expires and cross-user access fails. (Existing private-media persistence/native evidence; see `status.md`.)
- [x] Confirm the API reports the configured provider as ready. (`gemini-3.8-flash`, candidate active on Dev with explicit server-side `authorizeAiAccess` gate.)
- [x] Update this document and the relevant ADR with the selected adapters. (Google Gemini `gemini-3.8-flash` with `gemini-3.6-flash` fallback.)
