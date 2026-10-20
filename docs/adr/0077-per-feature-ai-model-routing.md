# ADR 0077 — Per-feature AI model routing

- Date: 2026-10-20
- Status: accepted for Dev; Production unchanged
- Package: per-feature model choice from the AI eval benchmark (Adam, 2026-10-20: "never use sonnet, otherwise I approve of your table, implement it on dev"). Amends ADR-0069, which put every feature on one provider.

## Context

The AI eval suite (`AdamHikl/mizyun-ai-eval`) ran every Mizyun AI feature on Gemini 3.8 Flash, Claude Haiku 5.5 (effort none/low/medium/high), Claude Sonnet 5.5 and Apple Foundation Models. It uses Mizyun's real provider code, about 80 cases and a judged rubric for open-ended answers. Overall scores at the Dev settings were Gemini 88.9 ($0.23 per run), Haiku 80.4 ($0.05) and on-device 67.4 (free), with Sonnet 87.3 ($0.93) at effort low. The models differed most per feature:

- Haiku matched or beat Gemini on Coach (90.0 vs 87.8), typed meals (98.2 vs 100), labels (95.9–100 vs 100), activity drafts (97.9 each) and catalog recipe ideas (100 each) at about a quarter of Gemini's cost.
- Gemini was clearly better on meal photos (69.7 vs Haiku 39.4), ingredient photos (73.0 vs 57.2) and the cooking assistant (95.0 vs 87.5). A separate cooking-assistant-only run on 2026-10-20 gave Gemini 92.5, Haiku 82.5 and on-device 65.0.
- On-device was good only for Log activity naming (92.5 at 0.75 s on the Mac).

Feature sets are small (5–17 cases), so gaps under about 3 points are ties.

## Decision

- **Routing on Dev.** Each feature has its own provider key. A key that is unset inherits `AGENT_PROVIDER`, so environments without the new keys behave exactly as before.

  | Feature                                                              | Key                          | Dev                |
  | -------------------------------------------------------------------- | ---------------------------- | ------------------ |
  | Coach chat                                                           | `COACH_PROVIDER`             | anthropic          |
  | Typed meal estimates and draft changes                               | `MEAL_TEXT_PROVIDER`         | anthropic          |
  | Every photo draft: meal and label photos, Coach photos               | `MEAL_PHOTO_PROVIDER`        | gemini             |
  | Log activity descriptions on devices without Apple Intelligence      | `ACTIVITY_DRAFT_PROVIDER`    | anthropic          |
  | Catalog recipe ideas (`/v1/meal-recipes/suggest`, older builds only) | `RECIPE_IDEAS_PROVIDER`      | anthropic          |
  | Ingredient photos                                                    | `INGREDIENT_PHOTO_PROVIDER`  | gemini             |
  | Cooking assistant                                                    | `COOKING_ASSISTANT_PROVIDER` | gemini             |
  | AI-tailored evening stretch (ADR-0076, not benchmarked)              | `STRETCH_PLAN_PROVIDER`      | gemini (inherited) |
  | Meal illustrations                                                   | —                            | gemini (unchanged) |

  Sonnet is never used. Haiku runs at `ANTHROPIC_EFFORT` (low) with thinking off, so the fixed draft token estimates stay valid.

- **Label photos stay on Gemini.** Nothing in the request marks a label photo, and detecting one would need an app change. Gemini scored the same 100, and Haiku would save only about $0.002 per label.
- **On-device.** Log activity keeps ADR-0074: on Apple Intelligence iPhones it never falls back to a provider, and other devices use Haiku. On-device recipe ideas were not built. The benchmark's "recipe ideas" is the catalog flow that ADR-0071 replaced with the cooking assistant, so the current app no longer calls it. The cooking assistant stays on Gemini, because on-device scored 65 there.
- **Composition.** `ServerConfig.aiRouting` resolves the vendor for each feature. `createRoutingVisionDraftProvider` sends photo drafts, text drafts and refinements, activity drafts and stretch refinements to their routed providers, and returns the single provider unchanged when all routes agree. Coach status reports the agent that actually serves Coach. A recipe slot without its vendor's configuration is disabled; it never falls back to the other vendor.
- **Guards.** A feature routed to a vendor whose API key is missing fails config validation. Any route to Anthropic still requires `ANTHROPIC_DEV_TESTING=true` (ADR-0069), so Production cannot route to Anthropic by copying an env file. `AI_EXTERNAL_ACCESS`, consent, adult eligibility, per-user limits and the shared daily token ledger apply to both vendors unchanged.
- **Coach fixes required for Haiku.**
  - #309: an `{"answer": …}` envelope that follows a preface after tool rounds is unwrapped instead of being shown as raw JSON.
  - #310: logged meal times in Coach grounding are sent as local time with the UTC offset instead of UTC.
- **Consent.** The AI consent screen and Account › Data now name Anthropic (Claude) and Google (Gemini API), list which features use each and give both retention summaries. New builds save consent version `2026-10-20`. The server accepts the versions in `AI_CONSENT_ACCEPTED_VERSIONS`:
  - The default accepts `2026-09-08` and `2026-10-20`, so installed Store builds keep working.
  - Dev accepts only `2026-10-20`, so Dev testers confirm the new wording.

## Consequences and limits

- **Mixed provenance.** Drafts and Coach messages record the provider that served them, so the vendor labels differ by feature.
- **Faster quota use.** Haiku's tokenizer counts about 30% more tokens for the same text (ADR-0069), so Anthropic-routed features use up the daily token budget faster.
- **Older Dev builds lose AI after this Dev deploy until updated.** Their saved `2026-09-08` consent is no longer accepted.
- **Release gate: no Store build carries this wording until Production routes the same way.** The wording names Anthropic for Coach chat, typed meals, draft changes and Log activity. It is true only where the server routes as in the table, and Production still sends everything to Gemini. Before such a build ships, all of these are needed:
  - a separate decision to route Production by this table, lifting the Dev-only guard;
  - `docs/PRIVACY_POLICY.md` and `docs/STORE_LISTING_DISCLOSURES.md` listing Anthropic as a processor;
  - updated Store privacy labels.
- **Dev must set every feature key explicitly.** It sets all eight provider keys, including `STRETCH_PLAN_PROVIDER=gemini`, so a later change to `AGENT_PROVIDER` cannot move a feature away from the provider the wording names.
- **Not benchmarked:** the evening stretch refinement. The eval figures are a Mac and API benchmark, not device acceptance.
