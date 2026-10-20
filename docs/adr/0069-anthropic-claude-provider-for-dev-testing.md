# ADR-0069: Anthropic Claude provider for Dev testing

Date: 2026-10-17. Status: accepted by Adam on 2026-10-17 for Dev testing ("test out the Claude Haiku 5.5 for everything"). Production use is not approved by this ADR.

## Context

Mizyun has used Gemini as its only AI vendor since 2026-09-03. Model research ([AI_MODEL_SELECTION_RESEARCH_2026-10-17.md](../AI_MODEL_SELECTION_RESEARCH_2026-10-17.md)) found that Claude Haiku 5.5 costs $0.10 / $0.50 per million input/output tokens, against $0.75 / $3.75 for Gemini 3.8 Flash (rising to $1.50 / $7.50 on 2027-01-01). Adam wants to test Haiku 5.5 for every AI feature on Dev.

## Decision

1. **Provider package.** `packages/providers/anthropic` implements the existing ports: `AgentProvider` (Coach), `ContentModerator` (the same local heuristic), `VisionDraftProvider` (photo, text and refine drafts), `RecipeGenerationProvider` and `IngredientRecognitionProvider`. It uses the official `@anthropic-ai/sdk`, pinned to 0.131.0, which was more than two weeks old when adopted.
2. **Selection.** Three settings together route Coach, drafts, recipes and ingredient recognition to Claude: `AGENT_PROVIDER=anthropic`, a non-empty `ANTHROPIC_API_KEY` and `ANTHROPIC_DEV_TESTING=true`.
   - Dev and Production both run `NODE_ENV=production`. Config therefore fails to load if the acknowledgement is missing, so a copied env file cannot silently switch Production.
   - `ANTHROPIC_MODEL` accepts only `claude-haiku-5-5`.
   - If the key is missing, the API logs a warning and keeps using Gemini.
   - Meal illustrations stay on Gemini, because Claude does not generate images. Gemini code and configuration are unchanged.
   - Adam chose on 2026-10-17 to route all Dev accounts, including the testing partner, and to tell the partner before enabling it. There is no per-user allowlist.
3. **Model controls.**
   - The default model is `claude-haiku-5-5`, with effort `low` and thinking disabled, matching the zero-thinking-budget latency target on the Gemini path.
   - No `temperature` is sent; Haiku 5.5 rejects non-default sampling values.
   - Coach replies are plain text, with no `{answer}` JSON envelope.
   - Structured drafts use `output_config.format`, reduced to the JSON Schema subset Claude supports, and are still re-validated with Zod.
   - `stop_reason: "refusal"` maps to a refused error. Haiku 5.5 has no server-side fallback.
4. **Search.** Brand and restaurant text drafts use Anthropic's server web search tool (`web_search_20250305`, at most 3 searches) in place of Google Search grounding. `ANTHROPIC_WEB_SEARCH=false` turns it off. Searches cost $10 per 1,000.
5. **Unchanged.** Authentication, adult eligibility, consent, the `AI_EXTERNAL_ACCESS` switch, tier quotas and the durable usage ledger all apply as before. No migration was added. The profile `ai_provider` preference stays `gemini`; the server environment chooses the vendor.

## Consequences

- **Privacy.** Health text and meal photos go to Anthropic when this is enabled. Anthropic deletes API inputs and outputs within 30 days by default and keeps flagged content for up to 2 years. Inference runs only in the `global` or `us` geography, and no EU option exists. The consent copy, the privacy policy and `ai-eligibility.ts` still name Google Gemini. They must be updated, and a DPA reviewed, before Production or any wider testing group. On Dev, Adam informs the testing partner directly.
- **Gates.** Live accuracy, latency and cost on Mizyun prompts are unmeasured (#29). Haiku 5.5 web search support, and whether the text, refine, activity and recipe structured-output schemas compile, are unverified until the first keyed Dev run. The photo draft schemas were verified live on 2026-10-20 (#313): single- and multi-photo, each with and without advanced nutrients and Coach advice. The original multi-photo schema did not compile, although it met the documented limits, so multi-photo requests now use a flattened `meals` schema; [research log](../RESEARCH_LOG.md). The `nutrition-photo-v5`/`coach-photo-v1` provenance labels were kept, because no Claude multi-photo draft had succeeded before.
- **Cost estimates.** The usage ledger counts tokens per provider response. Haiku 5.5's tokenizer counts about 30% more tokens for the same text than Haiku 4.5, so daily token quotas run out somewhat sooner.

## Sources

Checked 2026-10-17:

- [Claude models overview](https://platform.claude.com/docs/en/about-claude/models/overview)
- [Claude pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- [Structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
- [Web search tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool)
- [Data residency](https://platform.claude.com/docs/en/manage-claude/data-residency)
- [Anthropic data retention](https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data)

See also the [research log](../RESEARCH_LOG.md).
