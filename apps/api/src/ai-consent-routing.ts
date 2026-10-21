import { AsyncLocalStorage } from "node:async_hooks";

import {
  type AgentProvider,
  type AgentProviderStatus,
  type ContentModerator,
  type IngredientRecognitionProvider,
  type RecipeAssistantProvider,
  type RecipeGenerationProvider,
  type VisionDraftProvider,
  VisionProviderError,
} from "@mizyun/agent-runtime";
import {
  aiConsentDisclosesAnthropicFor,
  type AiRoutedFeature,
} from "@mizyun/contracts";
import type { StoredAiConsent } from "@mizyun/core";

/**
 * Consent-gated AI vendor routing (Adam, 2026-10-21; ADR-0077).
 *
 * A request may be served by Anthropic only when the requesting user's
 * stored AI consent disclosed Anthropic for that feature
 * (`aiConsentDisclosesAnthropicFor`: Coach, typed meals and draft changes,
 * Log activity).
 * Installed Store builds saved the Gemini-only `2026-09-08` disclosure, so
 * their requests must stay on Gemini even when the server routes the
 * feature to Anthropic.
 *
 * Each route that has authorized AI access runs its provider call inside
 * `runWithAiConsent(consent, …)`. The consent-gated providers below read
 * that context on every call and use the Anthropic-capable provider only
 * when it is present and discloses Anthropic. Any call made outside a
 * context, with a legacy or unknown version, or with a consent that is not
 * granted fails closed to the Gemini provider (or that feature's disabled
 * provider when Gemini is not configured), never to Anthropic.
 */
interface AiConsentRoutingContext {
  readonly consentVersion: string | null;
}

const storage = new AsyncLocalStorage<AiConsentRoutingContext>();

/** The stored version of a granted, adult-confirmed, unrevoked consent. */
export const routingConsentVersion = (
  consent: StoredAiConsent | null | undefined,
): string | null =>
  consent !== null &&
  consent !== undefined &&
  consent.granted &&
  consent.confirmedAdult &&
  consent.revokedAt === null
    ? consent.consentVersion
    : null;

/**
 * Run `fn` with the user's stored AI consent as the routing context. Call
 * it only after `authorizeAiAccess` admitted the request with this consent.
 */
export const runWithAiConsent = <T>(
  consent: StoredAiConsent | null | undefined,
  fn: () => T,
): T => storage.run({ consentVersion: routingConsentVersion(consent) }, fn);

/** Whether the current request's consent allows Anthropic for `feature`. */
export const anthropicAllowedForCurrentRequest = (
  feature: AiRoutedFeature,
): boolean =>
  aiConsentDisclosesAnthropicFor(storage.getStore()?.consentVersion, feature);

/** Which of the two providers serves the current request for `feature`. */
const select = <T>(
  gate: { readonly consented: T; readonly fallback: T },
  feature: AiRoutedFeature,
): T =>
  anthropicAllowedForCurrentRequest(feature) ? gate.consented : gate.fallback;

/**
 * Coach agent provider. `consented` is the routed (Anthropic) provider;
 * `fallback` is the Gemini provider or a disabled provider.
 */
export const consentGatedAgentProvider = (gate: {
  readonly consented: AgentProvider;
  readonly fallback: AgentProvider;
}): AgentProvider =>
  gate.consented === gate.fallback
    ? gate.fallback
    : {
        status: (): Promise<AgentProviderStatus> =>
          select(gate, "coach").status(),
        respond: (request) => select(gate, "coach").respond(request),
      };

export const consentGatedContentModerator = (gate: {
  readonly consented: ContentModerator;
  readonly fallback: ContentModerator;
}): ContentModerator =>
  gate.consented === gate.fallback
    ? gate.fallback
    : { moderateText: (input) => select(gate, "coach").moderateText(input) };

const notConfigured = (operation: string): VisionProviderError =>
  new VisionProviderError(
    "not_configured",
    `${operation} are not configured on this server.`,
    false,
  );

/**
 * Photo, text, refine, activity and stretch drafts. `consented` is the
 * per-feature routed provider (`createRoutingVisionDraftProvider`);
 * `fallback` is the Gemini provider or the disabled provider. An optional
 * operation exists when either side implements it; when the selected side
 * lacks it the call fails as "not configured" (503), as before.
 */
export const consentGatedVisionDraftProvider = (gate: {
  readonly consented: VisionDraftProvider;
  readonly fallback: VisionDraftProvider;
}): VisionDraftProvider => {
  const { consented, fallback } = gate;
  if (consented === fallback) return fallback;
  const either = (key: keyof VisionDraftProvider): boolean =>
    consented[key] !== undefined || fallback[key] !== undefined;
  return {
    status: () => select(gate, "mealPhoto").status(),
    generateDraft: (request) =>
      select(gate, "mealPhoto").generateDraft(request),
    ...(either("generateTextDraft")
      ? {
          generateTextDraft: (request) => {
            const provider = select(gate, "mealText");
            if (provider.generateTextDraft === undefined)
              return Promise.reject(notConfigured("Text nutrition drafts"));
            return provider.generateTextDraft(request);
          },
        }
      : {}),
    ...(either("refineDraft")
      ? {
          refineDraft: (request) => {
            const provider = select(gate, "mealText");
            if (provider.refineDraft === undefined)
              return Promise.reject(notConfigured("Draft refinements"));
            return provider.refineDraft(request);
          },
        }
      : {}),
    ...(either("generateActivityDraft")
      ? {
          generateActivityDraft: (request) => {
            const provider = select(gate, "activityDraft");
            if (provider.generateActivityDraft === undefined)
              return Promise.reject(notConfigured("AI activity drafts"));
            return provider.generateActivityDraft(request);
          },
        }
      : {}),
    ...(either("refineStretchPlan")
      ? {
          refineStretchPlan: (request) => {
            const provider = select(gate, "stretchPlan");
            if (provider.refineStretchPlan === undefined)
              return Promise.reject(notConfigured("AI stretch refinements"));
            return provider.refineStretchPlan(request);
          },
        }
      : {}),
  };
};

export const consentGatedRecipeGenerationProvider = (gate: {
  readonly consented: RecipeGenerationProvider;
  readonly fallback: RecipeGenerationProvider;
}): RecipeGenerationProvider =>
  gate.consented === gate.fallback
    ? gate.fallback
    : {
        status: () => select(gate, "recipeIdeas").status(),
        estimateTokens: (request) =>
          select(gate, "recipeIdeas").estimateTokens(request),
        generate: (request) => select(gate, "recipeIdeas").generate(request),
      };

export const consentGatedIngredientRecognitionProvider = (gate: {
  readonly consented: IngredientRecognitionProvider;
  readonly fallback: IngredientRecognitionProvider;
}): IngredientRecognitionProvider =>
  gate.consented === gate.fallback
    ? gate.fallback
    : {
        status: () => select(gate, "ingredientPhoto").status(),
        estimateTokens: (request) =>
          select(gate, "ingredientPhoto").estimateTokens(request),
        recognize: (request) =>
          select(gate, "ingredientPhoto").recognize(request),
      };

export const consentGatedRecipeAssistantProvider = (gate: {
  readonly consented: RecipeAssistantProvider;
  readonly fallback: RecipeAssistantProvider;
}): RecipeAssistantProvider =>
  gate.consented === gate.fallback
    ? gate.fallback
    : {
        status: () => select(gate, "cookingAssistant").status(),
        estimateTokens: (request) =>
          select(gate, "cookingAssistant").estimateTokens(request),
        assist: (request) => select(gate, "cookingAssistant").assist(request),
      };
