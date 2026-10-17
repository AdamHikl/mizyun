# AI model selection research — 2026-10-17

Research only. No provider, model, config or deployment change was made. Prices are
USD per 1M tokens from vendor pages fetched 2026-10-17; per-call costs are estimates
from assumed token counts, not measured Mizyun usage. Live accuracy, latency and cost
on Mizyun prompts remain unmeasured (issue #29).

## Current use (source survey)

Gemini (AI Studio REST, paid tier) is the only live vendor. `GEMINI_MODEL` and
`GEMINI_VISION_MODEL` default to `gemini-3.8-flash`, falling back to
`gemini-3.6-flash` on 429/503. Thinking budget is 0, temperature 0.2.

| Use case                                                        | Input → output                                    | Latency need                  |
| --------------------------------------------------------------- | ------------------------------------------------- | ----------------------------- |
| Coach chat (function calling, ≤5 tool round trips)              | text (+≤3 photos Pro) → text                      | interactive                   |
| Photo meal draft (`nutrition-draft-v4`)                         | image → strict JSON                               | interactive, 45 s timeout     |
| Text meal draft (brand/restaurant via `googleSearch` grounding) | text → JSON (two calls)                           | interactive                   |
| Draft refine                                                    | text + draft → JSON                               | interactive                   |
| Recipe suggest (pick ≤3 ids from server list)                   | text → JSON                                       | interactive, p95 ≤15 s target |
| Ingredient recognition                                          | 1–3 photos → JSON                                 | interactive                   |
| Meal illustration                                               | dish name → image (`gemini-3.1-flash-lite-image`) | background                    |

## Current models and prices

| Model                               | Input         | Output        | Notes                                                 |
| ----------------------------------- | ------------- | ------------- | ----------------------------------------------------- |
| Gemini 3.8 Flash (current)          | $0.75 → $1.50 | $3.75 → $7.50 | Price doubles 2027-01-01                              |
| Gemini 3.6 Flash (current fallback) | $0.75 → $1.50 | $3.75 → $7.50 | Same price change                                     |
| Gemini 3.5 Flash-Lite               | $0.30         | $2.50         | Google's recommended new-project pick with 3.8 Flash  |
| Gemini 3.1 Flash-Lite               | $0.25         | $1.50         | Shutdown 2027-05-07                                   |
| Gemini 4 Argon                      | $2 → $4       | $10 → $20     | Frontier; availability reports conflict               |
| Claude Haiku 5.5                    | $0.10         | $0.50         | ≤100k-token prompts; released 2026-10-07; image input |
| Claude Sonnet 5.5                   | $2            | $10           |                                                       |
| Claude Opus 5.5                     | $4            | $20           |                                                       |
| OpenAI gpt-6-luna                   | $0.10         | $0.50         |                                                       |
| OpenAI gpt-5.6-terra                | $2            | $12           |                                                       |

Artificial Analysis (third-party, reasoning "High" settings): Gemini 3.8 Flash index 41,
~147 tok/s; Claude Haiku 5.5 index 38 (43 at max effort), ~188 tok/s. AA-Omniscience
hallucination rate: Haiku 5.5 40%, Gemini 3.8 Flash 55%, Luna 77%.

Food photo evidence: a 2026 bioRxiv preprint (Nutrition5k, 3,229 images, ten models)
ranked Gemini 3.0 Flash best for calories (MAE 80.7 kcal) and Gemini 3.1 Flash-Lite
nearly as good at the lowest cost. It did not test Gemini 3.8 Flash, 3.5 Flash-Lite or
Claude Haiku 5.5. No other peer-reviewed comparison was found.

## Estimated cost per call

Assumptions: photo draft ≈3.3k input / 1k output tokens; Coach turn with two tool
round trips ≈15k input / 0.6k output; no caching.

| Model                             | Photo draft | Coach turn |
| --------------------------------- | ----------- | ---------- |
| Gemini 3.8 Flash, now             | $0.006      | $0.014     |
| Gemini 3.8 Flash, from 2027-01-01 | $0.012      | $0.027     |
| Gemini 3.5 Flash-Lite             | $0.0035     | $0.006     |
| Claude Haiku 5.5                  | $0.0008     | $0.002     |
| Claude Sonnet 5.5                 | $0.017      | $0.036     |

## Privacy consequences

- Gemini paid tier: no training on prompts/responses; abuse logging for a limited
  period (privacy policy states 55 days); EEA/UK users require paid services; Search
  grounding stores data 30 days. Terms last modified 2026-04-28.
- Anthropic API: inputs/outputs deleted within 30 days by default; flagged content up
  to 2 years; ZDR by agreement. Inference geo is only `global` or `us` (1.1×) and
  workspace storage is US-only, with no EU option.
- Adding a second vendor requires a provider package under `packages/providers/`, a
  DPA review, privacy policy and consent copy updates, and an independent review
  (AI access/budgets). Google Search grounding has no direct Claude equivalent here.

## Recommendation

1. Keep Gemini 3.8 Flash for photo and text meal drafts. It has the best food-vision
   evidence and existing grounding support.
2. Before 2027-01-01, evaluate Gemini 3.5 Flash-Lite against 3.8 Flash on meal photos
   and Coach. If accuracy holds, move Coach, recipes, refine and ingredient recognition
   to 3.5 Flash-Lite, and make it the fallback instead of 3.6 Flash (same price as the
   primary, no saving).
3. Treat Claude Haiku 5.5 as the strongest cost/speed candidate for Coach chat
   (about 7–15× cheaper per turn, faster output, lower hallucination rate), but only
   after the live evaluation and the second-vendor privacy work above. It is ten days
   old and has a reported over-refusal bug.
4. Do not use Sonnet/Opus/Fable, Gemini 3.1 Pro or Gemini 4 Argon for interactive
   features: higher cost and latency with no measured need.
5. Keep `gemini-3.1-flash-lite-image` for illustrations.

## Sources

- [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing) (updated 2026-10-16)
- [Gemini models](https://ai.google.dev/gemini-api/docs/models) and [deprecations](https://ai.google.dev/gemini-api/docs/deprecations)
- [Gemini API additional terms](https://ai.google.dev/gemini-api/terms)
- [Claude pricing](https://platform.claude.com/docs/en/about-claude/pricing), [models overview](https://platform.claude.com/docs/en/about-claude/models/overview), [data residency](https://platform.claude.com/docs/en/manage-claude/data-residency)
- [Anthropic data retention](https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data)
- [OpenAI API pricing](https://developers.openai.com/api/docs/pricing)
- [Artificial Analysis: Haiku 5.5 vs Gemini 3.8 Flash](https://artificialanalysis.ai/models/comparisons/claude-haiku-5-5-high-vs-gemini-3-8-flash)
- [Latent Space AINews on Haiku 5.5](https://www.latent.space/p/ainews-claude-haiku-55-better-than)
- [bioRxiv VLM dietary assessment benchmark](https://www.biorxiv.org/content/10.64898/2026.07.26.740845v1)
