# ADR-0019: Gemini provider support and app-wide dynamic provider switching

- Status: accepted
- Date: 2026-08-24

## Context

Mizyun previously utilized Mistral as its sole AI backend across Coach text chat, tool calling, and multimodal nutrition photo drafting. To support high-speed and cost-efficient multimodal reasoning (including Gemini 3.7 / 2.5 Flash via Google AI Studio) while preserving Mistral, users need the ability to dynamically choose their active AI provider across the entire application with a single toggle in Settings.

Domain calculations (Mifflin-St Jeor daily targets, training prescription, progressive overload, rate limits) remain deterministic in `@mizyun/core` and cannot be coupled to any model vendor.

## Decision

1. **Provider Isolation**:
   - Implement `@mizyun/provider-gemini` adhering strictly to `@mizyun/agent-runtime` ports (`AgentProvider`, `VisionDraftProvider`, `ContentModerator`).
   - Use Google AI Studio HTTP APIs with `generateContent`, `systemInstruction`, function declarations, and structured JSON output schemas (`responseMimeType: "application/json"`).

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
