# ADR 0071 — Conversational cooking assistant for "What can I cook?"

- Date: 2026-10-18
- Status: accepted for local engineering; Dev deploy, live-provider and device acceptance open
- Package: #241 follow-up (Adam, 2026-10-18 iPhone Dev feedback)

## Context

After #295 fixed photo upload, Adam's fridge photo produced an "ingredient matching" step: every recognized item (for example "multivitamin juice" or "jam") had to be mapped by hand to one of 30 pinned catalog foods with an exact preparation state before any of 8 deterministic templates could be considered. A real fridge rarely matches, so the screen showed long food lists with no clear purpose. Adam asked for: upload a photo, get a few options, and continue in a chat to shape the meal.

## Decision

Replace the screen with a conversational assistant. ADR0058/0061's deterministic catalog/template path stays in the API (older app builds still call it) but the new screen no longer uses it.

- **One endpoint.** `POST /v1/meal-recipes/assistant` takes multipart with one strict `turn` JSON field (`meal-recipe-assistant-v1`: request UUID, up to 40 ingredient names, up to 3 current ideas, up to 12 messages, 24 KiB) and zero to `maximumImages` photos. A photo turn reads the photo and suggests ideas in one model call, so there is no separate analyze step and no recognize→suggest per-minute collision (#263).
- **Same admission and budgets.** It reuses `authorize` (deletion fence, consent, adult eligibility), the environment switch, provider status, and the durable recipe ledger from ADR0059: photo turns reserve as `recognize`, text turns as `suggest`. Each turn is a new request identity; a replayed identity never repeats the provider call. No migration, budget or tier change. The server adds the owner's positive macro gaps and focus (only when the context is `ready`) and saved profile diets; the client never supplies targets.
- **Stateless server, memory-only client.** The client holds the conversation and resends a bounded window each turn. It is kept in memory only (never SecureStore or export), retained up to 3 hours so leaving to log a meal keeps the chat, and erased by Start over, account change/erasure and AI retirement (existing ingredient-review retirement hook). Photos remain transient cache files released after the turn (ADR0060).
- **Advisory AI nutrition.** Ideas carry per-serving AI estimates, labelled as estimates. "I ate this" stages an ordinary editable meal draft through `stageRecipeMealDraft` with a note to check amounts; only Save records intake. This deliberately trades ADR0058's catalog-verified macros for usefulness on real kitchens; AGENTS' rule that photo-derived nutrition needs user confirmation is met by the editable form.
- **Prompt safety.** One shared policy (`RECIPE_ASSISTANT_POLICY`) for Gemini and Anthropic treats photos, ingredient names and messages as data inside a JSON block (no vendor roles from user text), asks for undercooking warnings and exclusion of conflicting allergens/diets, and forbids medical claims. Output is bounded, re-validated server-side and never logged.

## Consequences and limits

- Token reservations stay conservative (UTF-8 bytes as tokens + 4,096 output + per-image bound): about 10.2k for a typical photo turn and 14k for a long text turn. The free tier's 10k daily token budget therefore cannot admit a photo turn; free users see the daily-allowance message. Paid/approved accounts get roughly 7–10 turns per day. Changing this is a separate budget decision (#263 family) requiring review.
- Gemini thinking tokens share the 4,096 output cap; truncated replies fail as malformed output. Watch on Dev.
- Allergen and food-safety handling is model advice, not verification; idea cards say so.
- The old ingredient-review/recipe-session modules remain wired into export, erasure and startup pruning for data already stored; removing them is a follow-up.
- Source tests and mocked providers do not prove live model quality, Keychain/picker behavior, accessibility or Store readiness.
