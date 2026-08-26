# ADR-0019: Gemini provider support and app-wide dynamic provider switching

- Status: accepted
- Date: 2026-08-24

## Context

Mizyun previously utilized Mistral as its sole AI backend across Coach text chat, tool calling, and multimodal nutrition photo drafting. To support high-speed and cost-efficient multimodal reasoning (using pinned `gemini-3.7-flash` and `gemini-3.6-flash` models via Google AI Studio) while preserving Mistral, users need the ability to dynamically choose their active AI provider across the entire application with a single toggle in Settings.

Domain calculations (Mifflin-St Jeor daily targets, training prescription, progressive overload, rate limits) remain deterministic in `@mizyun/core` and cannot be coupled to any model vendor.

## Decision

1. **Provider Isolation & Pinned Models**:
   - Implement `@mizyun/provider-gemini` adhering strictly to `@mizyun/agent-runtime` ports (`AgentProvider`, `VisionDraftProvider`, `ContentModerator`).
   - Strictly pin model usage to **`gemini-3.7-flash`** (primary vision drafting with `thinkingBudget: 0`) and **`gemini-3.6-flash`** (Coach agent conversation and automatic high-demand vision fallback). No other models are permitted.
   - Use Google AI Studio HTTP REST APIs (`generativelanguage.googleapis.com/v1beta`) with `generateContent`, `systemInstruction`, function declarations, and structured JSON output schemas (`responseMimeType: "application/json"`).
   - Secret governance: `GEMINI_API_KEY` lives exclusively in backend environment variables/secret stores for the `smartiqi-team` Google Cloud project (under an enforced EUR 50/month spend cap with Gemini API-only restriction).

2. **Persistence & Schema**:
   - Add `ai_provider text not null default 'mistral' check (ai_provider in ('mistral', 'gemini'))` column to `public.profiles`.
   - Update `@mizyun/core` and `@mizyun/contracts` with `AI_PROVIDERS = ["mistral", "gemini"]` and `aiProviderSchema`.

3. **Dynamic Composition & Routing**:
   - The API server initializes both Mistral and Gemini adapters when their corresponding configuration/API keys (`MISTRAL_API_KEY`, `GEMINI_API_KEY`) are present.
   - Route handlers (`/v1/coach/conversations/:id/messages`, `/v1/food-entries/draft`, `/v1/food-entries/draft/text`, `/v1/food-entries/draft/refine`) resolve the active user's `profile.aiProvider` and dynamically select the matching provider instance.
   - If an unconfigured provider is selected, the server gracefully falls back to the configured provider or returns an explicit `503 AI_CONFIGURATION_ERROR`.

4. **Mobile Presentation**:
   - Add `AiProviderCard` to `apps/mobile/src/features/settings/settings-screen.tsx`.
   - Switching the provider sends `PUT /v1/profile` with `{ aiProvider: "mistral" | "gemini" }` and immediately refreshes the user's active session profile.

## Consequences

- The user can switch between Mistral and Gemini models at any time for the entire app.
- System prompt safety rules, input screening, medical fallbacks, and deterministic calculations remain identical regardless of the selected provider.
- Mobile bundles contain zero vendor SDKs or API keys.
- Model usage is strictly bounded to `gemini-3.7-flash` and `gemini-3.6-flash`.
