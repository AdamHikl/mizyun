import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AgentOrchestrator,
  DisabledAgentProvider,
  DisabledIngredientRecognitionProvider,
  VisionProviderError,
} from "@mizyun/agent-runtime";
import type { UserId } from "@mizyun/core";
import type { AccessTokenVerifier } from "@mizyun/identity";
import { InMemoryMemoryStore } from "@mizyun/memory";
import {
  CURRENT_AI_CONSENT_VERSION,
  LEGACY_AI_CONSENT_VERSION_GEMINI_ONLY,
} from "@mizyun/contracts";
import {
  AnthropicAgentProvider,
  AnthropicRecipeGenerationProvider,
  AnthropicVisionProvider,
} from "@mizyun/provider-anthropic";
import {
  GeminiAgentProvider,
  GeminiIngredientRecognitionProvider,
  GeminiRecipeAssistantProvider,
  GeminiRecipeGenerationProvider,
  GeminiVisionProvider,
} from "@mizyun/provider-gemini";

import { InMemoryAiConsentRepository } from "./ai-consent-repository.js";
import { runWithAiConsent } from "./ai-consent-routing.js";
import {
  buildApp,
  selectConsentGatedRecipeProviders,
  selectRecipeProviders,
} from "./app.js";

const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("API foundation", () => {
  it("reports API health independently from optional providers", async () => {
    const app = buildApp();
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/v1/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "ok",
      service: "mizyun-api",
    });
  });

  it("reports the intentionally disabled agent provider", async () => {
    const app = buildApp();
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/v1/coach/status",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ready: false,
      provider: "disabled",
    });
  });

  it("rejects access to protected routes without a bearer token", async () => {
    const app = buildApp();
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/v1/me" });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: { code: "AUTHENTICATION_REQUIRED" },
    });
  });

  it("exposes the verified principal to protected routes", async () => {
    const tokenVerifier: AccessTokenVerifier = {
      verify: async (token) =>
        token === "valid-token"
          ? {
              userId: "00000000-0000-4000-8000-000000000001" as UserId,
              email: "person@example.com",
              accessToken: "test-token",
            }
          : null,
    };
    const app = buildApp({
      tokenVerifier,
      agent: new AgentOrchestrator({
        provider: new DisabledAgentProvider(),
        memories: new InMemoryMemoryStore(),
      }),
    });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: "Bearer valid-token" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      user: {
        userId: "00000000-0000-4000-8000-000000000001",
        email: "person@example.com",
      },
    });
  });

  it("/v1/me response body is validated by meResponseSchema (rejects non-UUID principals)", async () => {
    // This test exercises the server-side contract enforcement added in
    // API-001: the `/v1/me` route parses its output through `meResponseSchema`,
    // so a verifier that returns a non-UUID principal should cause a parse
    // failure rather than a successful response with garbage data.
    const tokenVerifier: AccessTokenVerifier = {
      verify: async () => ({
        userId: "not-a-uuid" as unknown as UserId,
        accessToken: "test-token",
      }),
    };
    const app = buildApp({
      tokenVerifier,
      agent: new AgentOrchestrator({
        provider: new DisabledAgentProvider(),
        memories: new InMemoryMemoryStore(),
      }),
    });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: "Bearer any-token" },
    });

    // The schema parse throws; the global error handler returns 500 with
    // a normalised `apiErrorSchema` body — the contract surface is
    // intentional even on this internal-violation path.
    expect(response.statusCode).toBe(500);
    const body = response.json();
    expect(body.error?.code).toBe("INTERNAL_ERROR");
  });

  it("reports an unavailable token verifier as 503, not an invalid token", async () => {
    // Clients sign out on 401. An auth outage must not end valid sessions.
    const tokenVerifier: AccessTokenVerifier = {
      verify: async () => {
        throw new Error("Access token verification is unavailable.");
      },
    };
    const app = buildApp({
      tokenVerifier,
      agent: new AgentOrchestrator({
        provider: new DisabledAgentProvider(),
        memories: new InMemoryMemoryStore(),
      }),
    });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: "Bearer any-token" },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json().error?.code).toBe("AUTHENTICATION_UNAVAILABLE");
  });
});

describe("AI vendor selection (ADR-0069)", () => {
  const stubAiEnv = (values: Record<string, string>) => {
    for (const key of [
      "AGENT_PROVIDER",
      "AI_EXTERNAL_ACCESS",
      "GEMINI_API_KEY",
      "GEMINI_VISION_API_KEY",
      "ANTHROPIC_API_KEY",
      "ANTHROPIC_DEV_TESTING",
      "ANTHROPIC_ENABLED",
      "COACH_PROVIDER",
      "MEAL_TEXT_PROVIDER",
      "MEAL_PHOTO_PROVIDER",
      "ACTIVITY_DRAFT_PROVIDER",
      "RECIPE_IDEAS_PROVIDER",
      "INGREDIENT_PHOTO_PROVIDER",
      "COOKING_ASSISTANT_PROVIDER",
      "STRETCH_PLAN_PROVIDER",
      "VISION_PROVIDER",
      "SUPABASE_URL",
      "SUPABASE_PUBLISHABLE_KEY",
    ]) {
      vi.stubEnv(key, values[key] ?? "");
    }
  };

  // A signed-in caller whose stored consent (the in-memory default, the
  // current disclosure) names Anthropic; status then reports that caller's
  // Coach provider under consent-gated routing.
  const consentedVerifier: AccessTokenVerifier = {
    verify: async (token) =>
      token === "valid"
        ? {
            userId: "00000000-0000-4000-8000-000000000001" as UserId,
            accessToken: "test-access-token",
          }
        : null,
  };
  const coachStatus = async (signedIn = true) => {
    const app = buildApp({ tokenVerifier: consentedVerifier });
    apps.push(app);
    const response = await app.inject({
      method: "GET",
      url: "/v1/coach/status",
      ...(signedIn ? { headers: { authorization: "Bearer valid" } } : {}),
    });
    expect(response.statusCode).toBe(200);
    return response.json() as { provider: string; model?: string };
  };

  it("serves Coach from Claude Haiku 5.5 when selected with a key", async () => {
    stubAiEnv({
      AGENT_PROVIDER: "anthropic",
      AI_EXTERNAL_ACCESS: "true",
      GEMINI_API_KEY: "test-gemini-key-12345",
      ANTHROPIC_API_KEY: "test-anthropic-key-12345",
      ANTHROPIC_DEV_TESTING: "true",
    });
    await expect(coachStatus()).resolves.toMatchObject({
      ready: true,
      provider: "anthropic",
      model: "claude-haiku-5-5",
    });
  });

  it("keeps Gemini until the Anthropic key is pasted", async () => {
    stubAiEnv({
      AGENT_PROVIDER: "anthropic",
      AI_EXTERNAL_ACCESS: "true",
      GEMINI_API_KEY: "test-gemini-key-12345",
      ANTHROPIC_DEV_TESTING: "true",
    });
    await expect(coachStatus()).resolves.toMatchObject({
      provider: "gemini",
    });
  });

  // Adam's 2026-10-20 benchmark decision for Dev.
  const benchmarkEnv = {
    AGENT_PROVIDER: "gemini",
    AI_EXTERNAL_ACCESS: "true",
    GEMINI_API_KEY: "test-gemini-key-12345",
    ANTHROPIC_API_KEY: "test-anthropic-key-12345",
    ANTHROPIC_DEV_TESTING: "true",
    COACH_PROVIDER: "anthropic",
    MEAL_TEXT_PROVIDER: "anthropic",
    MEAL_PHOTO_PROVIDER: "gemini",
    ACTIVITY_DRAFT_PROVIDER: "anthropic",
    RECIPE_IDEAS_PROVIDER: "anthropic",
    INGREDIENT_PHOTO_PROVIDER: "gemini",
    COOKING_ASSISTANT_PROVIDER: "gemini",
  };

  it("serves Coach from Claude under the Dev benchmark routing", async () => {
    stubAiEnv(benchmarkEnv);
    await expect(coachStatus()).resolves.toMatchObject({
      ready: true,
      provider: "anthropic",
      model: "claude-haiku-5-5",
    });
  });

  it("serves Coach from Gemini when COACH_PROVIDER overrides an Anthropic default", async () => {
    stubAiEnv({
      AGENT_PROVIDER: "anthropic",
      AI_EXTERNAL_ACCESS: "true",
      GEMINI_API_KEY: "test-gemini-key-12345",
      ANTHROPIC_API_KEY: "test-anthropic-key-12345",
      ANTHROPIC_DEV_TESTING: "true",
      COACH_PROVIDER: "gemini",
    });
    await expect(coachStatus()).resolves.toMatchObject({
      ready: true,
      provider: "gemini",
    });
  });

  it("routes photo drafts to Gemini and text/activity drafts to Claude", async () => {
    stubAiEnv(benchmarkEnv);
    const unavailable = () => {
      throw new VisionProviderError("unavailable", "test stop", false);
    };
    const geminiPhoto = vi
      .spyOn(GeminiVisionProvider.prototype, "generateDraft")
      .mockImplementation(unavailable);
    const geminiText = vi
      .spyOn(GeminiVisionProvider.prototype, "generateTextDraft")
      .mockImplementation(unavailable);
    const geminiActivity = vi
      .spyOn(GeminiVisionProvider.prototype, "generateActivityDraft")
      .mockImplementation(unavailable);
    const claudePhoto = vi
      .spyOn(AnthropicVisionProvider.prototype, "generateDraft")
      .mockImplementation(unavailable);
    const claudeText = vi
      .spyOn(AnthropicVisionProvider.prototype, "generateTextDraft")
      .mockImplementation(unavailable);
    const claudeActivity = vi
      .spyOn(AnthropicVisionProvider.prototype, "generateActivityDraft")
      .mockImplementation(unavailable);
    const verifier: AccessTokenVerifier = {
      verify: async (token) =>
        token === "valid"
          ? {
              userId: "00000000-0000-4000-8000-000000000001" as UserId,
              accessToken: "test-access-token",
            }
          : null,
    };
    // A fresh app per request keeps the per-minute draft limiter out of the way.
    const freshApp = () => {
      const app = buildApp({ tokenVerifier: verifier });
      apps.push(app);
      return app;
    };
    const auth = { authorization: "Bearer valid" };

    await freshApp().inject({
      method: "POST",
      url: "/v1/food-entries/draft/text",
      headers: { ...auth, "content-type": "application/json" },
      payload: { description: "Two eggs and one slice of toast" },
    });
    await freshApp().inject({
      method: "POST",
      url: "/v1/activity-drafts/text",
      headers: { ...auth, "content-type": "application/json" },
      payload: {
        description: "Ran 5 km this morning",
        localDate: "2026-10-20",
        localTime: "08:30",
      },
    });
    const boundary = "----MizyunRoutingTest";
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
      0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
      0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
      0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]);
    await freshApp().inject({
      method: "POST",
      url: "/v1/food-entries/draft",
      headers: {
        ...auth,
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload: Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="label.png"\r\nContent-Type: image/png\r\n\r\n`,
        ),
        png,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]),
    });

    expect(claudeText).toHaveBeenCalledTimes(1);
    expect(claudeActivity).toHaveBeenCalledTimes(1);
    expect(geminiPhoto).toHaveBeenCalledTimes(1);
    expect(geminiText).not.toHaveBeenCalled();
    expect(geminiActivity).not.toHaveBeenCalled();
    expect(claudePhoto).not.toHaveBeenCalled();
  });

  it("selects each recipe provider by its own route", () => {
    const anthropic = {
      apiKey: "test-anthropic-key-12345",
      model: "claude-haiku-5-5",
      externalAccess: true,
    };
    const gemini = {
      apiKey: "test-gemini-key-12345",
      model: "gemini-3.8-flash",
      externalAccess: true,
    };
    const benchmark = selectRecipeProviders({
      routing: {
        recipeIdeas: "anthropic",
        ingredientPhotos: "gemini",
        cookingAssistant: "gemini",
      },
      anthropic,
      gemini,
    });
    expect(benchmark.generation).toBeInstanceOf(
      AnthropicRecipeGenerationProvider,
    );
    expect(benchmark.recognition).toBeInstanceOf(
      GeminiIngredientRecognitionProvider,
    );
    expect(benchmark.assistant).toBeInstanceOf(GeminiRecipeAssistantProvider);

    // A route never falls back to the other vendor.
    const noAnthropic = selectRecipeProviders({
      routing: {
        recipeIdeas: "gemini",
        ingredientPhotos: "anthropic",
        cookingAssistant: "gemini",
      },
      anthropic: null,
      gemini,
    });
    expect(noAnthropic.recognition).toBeInstanceOf(
      DisabledIngredientRecognitionProvider,
    );
  });

  // #317: before the fix a Gemini key served Coach regardless.
  it("reports Coach disabled when AGENT_PROVIDER=disabled with a Gemini key", async () => {
    stubAiEnv({
      AGENT_PROVIDER: "disabled",
      AI_EXTERNAL_ACCESS: "true",
      GEMINI_API_KEY: "test-gemini-key-12345",
    });
    await expect(coachStatus()).resolves.toMatchObject({
      ready: false,
      provider: "disabled",
    });
    await expect(coachStatus(false)).resolves.toMatchObject({
      ready: false,
      provider: "disabled",
    });
  });

  // #317: the kill switch needs an explicit value; AGENT_PROVIDER parses as
  // "disabled" when unset, and that must keep serving Coach.
  it.each([
    ["unset", ""],
    ["gemini", "gemini"],
  ])(
    "keeps Coach on Gemini when AGENT_PROVIDER is %s with a Gemini key",
    async (_label, agentProvider) => {
      stubAiEnv({
        AGENT_PROVIDER: agentProvider,
        AI_EXTERNAL_ACCESS: "true",
        GEMINI_API_KEY: "test-gemini-key-12345",
      });
      await expect(coachStatus()).resolves.toMatchObject({
        ready: true,
        provider: "gemini",
      });
      await expect(coachStatus(false)).resolves.toMatchObject({
        ready: true,
        provider: "gemini",
      });
    },
  );

  it("reports Coach disabled when AGENT_PROVIDER=disabled overrides COACH_PROVIDER", async () => {
    stubAiEnv({
      AGENT_PROVIDER: "disabled",
      AI_EXTERNAL_ACCESS: "true",
      GEMINI_API_KEY: "test-gemini-key-12345",
      ANTHROPIC_API_KEY: "test-anthropic-key-12345",
      ANTHROPIC_DEV_TESTING: "true",
      COACH_PROVIDER: "anthropic",
    });
    await expect(coachStatus()).resolves.toMatchObject({
      ready: false,
      provider: "disabled",
    });
  });

  it("reports Claude as not ready while external AI access is off", async () => {
    stubAiEnv({
      AGENT_PROVIDER: "anthropic",
      AI_EXTERNAL_ACCESS: "false",
      ANTHROPIC_API_KEY: "test-anthropic-key-12345",
      ANTHROPIC_DEV_TESTING: "true",
    });
    await expect(coachStatus()).resolves.toMatchObject({
      ready: false,
      provider: "anthropic",
    });
    // Without a consent context the request fails closed to Gemini, which
    // is not configured here, so Coach reports its disabled provider.
    await expect(coachStatus(false)).resolves.toMatchObject({
      ready: false,
      provider: "disabled",
    });
  });
});

describe("Consent-gated AI routing (Production, 2026-10-21)", () => {
  // Production routing per ADR-0077, acknowledged with ANTHROPIC_ENABLED and
  // no Dev flag. The stretch is routed to Anthropic too, so every vision
  // operation proves the gate.
  const productionEnv: Record<string, string> = {
    AGENT_PROVIDER: "gemini",
    AI_EXTERNAL_ACCESS: "true",
    GEMINI_API_KEY: "test-gemini-key-12345",
    ANTHROPIC_API_KEY: "test-anthropic-key-12345",
    ANTHROPIC_ENABLED: "true",
    COACH_PROVIDER: "anthropic",
    MEAL_TEXT_PROVIDER: "anthropic",
    MEAL_PHOTO_PROVIDER: "gemini",
    ACTIVITY_DRAFT_PROVIDER: "anthropic",
    RECIPE_IDEAS_PROVIDER: "anthropic",
    INGREDIENT_PHOTO_PROVIDER: "gemini",
    COOKING_ASSISTANT_PROVIDER: "gemini",
    STRETCH_PLAN_PROVIDER: "anthropic",
  };
  const stubEnv = (overrides: Record<string, string> = {}) => {
    const env = { ...productionEnv, ...overrides };
    for (const key of [
      "ANTHROPIC_DEV_TESTING",
      "GEMINI_VISION_API_KEY",
      "VISION_PROVIDER",
      "SUPABASE_URL",
      "SUPABASE_PUBLISHABLE_KEY",
      ...Object.keys(env),
    ]) {
      vi.stubEnv(key, env[key] ?? "");
    }
  };
  const users = {
    legacy: "00000000-0000-4000-8000-0000000000a1" as UserId,
    current: "00000000-0000-4000-8000-0000000000a2" as UserId,
  };
  const verifier: AccessTokenVerifier = {
    verify: async (token) =>
      token === "legacy" || token === "current"
        ? { userId: users[token], accessToken: `access-${token}` }
        : null,
  };
  const consents = async () => {
    const repository = new InMemoryAiConsentRepository();
    for (const [token, consentVersion] of [
      ["legacy", LEGACY_AI_CONSENT_VERSION_GEMINI_ONLY],
      ["current", CURRENT_AI_CONSENT_VERSION],
    ] as const) {
      await repository.saveConsent(users[token], {
        granted: true,
        confirmedAdult: true,
        consentVersion,
      });
    }
    return repository;
  };
  const draft = (provider: string) => ({
    name: "Grilled chicken",
    caloriesKcal: 300,
    proteinG: 50,
    carbohydrateG: 0,
    fatG: 10,
    calorieRangeKcal: { low: 240, high: 360 },
    proteinRangeG: { low: 40, high: 60 },
    carbohydrateRangeG: { low: 0, high: 5 },
    fatRangeG: { low: 7, high: 14 },
    confidence: 0.7,
    warnings: [],
    assumptions: ["Assumes 100g chicken breast."],
    provenance: {
      inputKind: "text" as const,
      provider,
      model: `${provider}-model`,
      promptVersion: "nutrition-draft-v2",
    },
  });
  const spyVendors = () => {
    const stop = () => {
      throw new VisionProviderError("unavailable", "test stop", false);
    };
    const agentReply = (provider: string) => async () => ({
      message: { role: "assistant" as const, text: `Answer from ${provider}.` },
      provider,
      evidence: [],
      providerMetadata: { totalTokens: 10 },
    });
    return {
      gemini: {
        coach: vi
          .spyOn(GeminiAgentProvider.prototype, "respond")
          .mockImplementation(agentReply("gemini")),
        text: vi
          .spyOn(GeminiVisionProvider.prototype, "generateTextDraft")
          .mockImplementation(async () => draft("gemini")),
        refine: vi
          .spyOn(GeminiVisionProvider.prototype, "refineDraft")
          .mockImplementation(stop),
        activity: vi
          .spyOn(GeminiVisionProvider.prototype, "generateActivityDraft")
          .mockImplementation(stop),
        stretch: vi
          .spyOn(GeminiVisionProvider.prototype, "refineStretchPlan")
          .mockImplementation(stop),
      },
      anthropic: {
        coach: vi
          .spyOn(AnthropicAgentProvider.prototype, "respond")
          .mockImplementation(agentReply("anthropic")),
        text: vi
          .spyOn(AnthropicVisionProvider.prototype, "generateTextDraft")
          .mockImplementation(async () => draft("anthropic")),
        refine: vi
          .spyOn(AnthropicVisionProvider.prototype, "refineDraft")
          .mockImplementation(stop),
        activity: vi
          .spyOn(AnthropicVisionProvider.prototype, "generateActivityDraft")
          .mockImplementation(stop),
        stretch: vi
          .spyOn(AnthropicVisionProvider.prototype, "refineStretchPlan")
          .mockImplementation(stop),
      },
    };
  };

  /** Exercises every vision and Coach entry point as one user. */
  const exercise = async (token: "legacy" | "current") => {
    const aiConsentRepository = await consents();
    // A fresh app per request keeps the per-minute draft limiter out of the way.
    const freshApp = () => {
      const app = buildApp({
        tokenVerifier: verifier,
        aiConsentRepository,
        stretchAiEnabled: true,
      });
      apps.push(app);
      return app;
    };
    const headers = {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    };
    const status = await freshApp().inject({
      method: "GET",
      url: "/v1/coach/status",
      headers: { authorization: `Bearer ${token}` },
    });
    const coachApp = freshApp();
    const conversation = await coachApp.inject({
      method: "POST",
      url: "/v1/coach/conversations",
      headers,
      payload: { title: "Check-in" },
    });
    expect(conversation.statusCode).toBe(201);
    const conversationId = conversation.json().conversation.id as string;
    const coach = await coachApp.inject({
      method: "POST",
      url: `/v1/coach/conversations/${conversationId}/messages`,
      headers: { ...headers, "idempotency-key": `${token}-coach` },
      payload: { text: "What is one sensible next step today?" },
    });
    const coachMeal = await coachApp.inject({
      method: "POST",
      url: `/v1/coach/conversations/${conversationId}/messages`,
      headers: { ...headers, "idempotency-key": `${token}-meal` },
      payload: { text: "I ate two eggs and toast" },
    });
    const text = await freshApp().inject({
      method: "POST",
      url: "/v1/food-entries/draft/text",
      headers,
      payload: { description: "Two eggs and one slice of toast" },
    });
    await freshApp().inject({
      method: "POST",
      url: "/v1/food-entries/draft/refine",
      headers,
      payload: { currentDraft: draft("stub"), instruction: "double it" },
    });
    await freshApp().inject({
      method: "POST",
      url: "/v1/activity-drafts/text",
      headers,
      payload: {
        description: "Ran 5 km this morning",
        localDate: "2026-10-21",
        localTime: "08:30",
      },
    });
    await freshApp().inject({
      method: "POST",
      url: "/v1/stretch-plans/refine",
      headers,
      payload: {
        exercises: [{ name: "Bench Press", setCount: 4 }],
        activities: ["running"],
      },
    });
    return { status, coach, coachMeal, text };
  };

  it("keeps a legacy Gemini-only consent on Gemini at every routed entry point", async () => {
    stubEnv();
    const spies = spyVendors();
    const result = await exercise("legacy");

    expect(result.status.json()).toMatchObject({ provider: "gemini" });
    expect(result.coach.statusCode).toBe(200);
    expect(result.coach.json().assistantMessage.provider).toBe("gemini");
    expect(result.coachMeal.statusCode).toBe(200);
    expect(result.coachMeal.json().assistantMessage.provider).toBe("gemini");
    expect(result.text.statusCode).toBe(200);
    expect(result.text.json().draft.provenance.provider).toBe("gemini");
    for (const spy of Object.values(spies.gemini)) {
      expect(spy).toHaveBeenCalled();
    }
    expect(spies.gemini.text).toHaveBeenCalledTimes(2);
    for (const spy of Object.values(spies.anthropic)) {
      expect(spy).not.toHaveBeenCalled();
    }
  });

  it("serves a 2026-10-21 consent with the routed Anthropic vendor", async () => {
    stubEnv();
    const spies = spyVendors();
    const result = await exercise("current");

    expect(result.status.json()).toMatchObject({
      provider: "anthropic",
      model: "claude-haiku-5-5",
    });
    expect(result.coach.json().assistantMessage.provider).toBe("anthropic");
    expect(result.coachMeal.json().assistantMessage.provider).toBe("anthropic");
    expect(result.text.json().draft.provenance.provider).toBe("anthropic");
    const { stretch: anthropicStretch, ...disclosed } = spies.anthropic;
    for (const spy of Object.values(disclosed)) {
      expect(spy).toHaveBeenCalled();
    }
    // Stretch was disclosed for Google only, so it stays on Gemini even when
    // the server routes it to Anthropic.
    expect(anthropicStretch).not.toHaveBeenCalled();
    expect(spies.gemini.stretch).toHaveBeenCalledTimes(1);
    const { stretch: _geminiStretch, ...geminiOthers } = spies.gemini;
    for (const spy of Object.values(geminiOthers)) {
      expect(spy).not.toHaveBeenCalled();
    }
  });

  // #317: AGENT_PROVIDER=disabled is a Coach kill switch even with Gemini and
  // Anthropic keys and COACH_PROVIDER set.
  it("serves no Coach model turn when AGENT_PROVIDER=disabled", async () => {
    stubEnv({ AGENT_PROVIDER: "disabled" });
    const spies = spyVendors();
    const result = await exercise("current");

    expect(result.status.json()).toMatchObject({
      ready: false,
      provider: "disabled",
    });
    expect(result.coach.statusCode).toBe(503);
    expect(result.coach.json().error?.code).toBe("AI_UNAVAILABLE");
    expect(spies.gemini.coach).not.toHaveBeenCalled();
    expect(spies.anthropic.coach).not.toHaveBeenCalled();
    // A meal-logging Coach message would draft through the vision provider;
    // the only text draft left is the non-Coach /v1/food-entries/draft/text.
    expect(result.coachMeal.statusCode).toBe(503);
    expect(result.coachMeal.json().error?.code).toBe("AI_CONFIGURATION_ERROR");
    expect(
      spies.gemini.text.mock.calls.length +
        spies.anthropic.text.mock.calls.length,
    ).toBe(1);
    expect(result.text.statusCode).toBe(200);
  });

  it("serves Coach turns and Coach meal drafts when AGENT_PROVIDER is unset", async () => {
    stubEnv({ AGENT_PROVIDER: "" });
    const spies = spyVendors();
    const result = await exercise("current");

    expect(result.status.json()).toMatchObject({ provider: "anthropic" });
    expect(result.coach.statusCode).toBe(200);
    expect(result.coach.json().assistantMessage.provider).toBe("anthropic");
    expect(result.coachMeal.statusCode).toBe(200);
    expect(spies.anthropic.coach).toHaveBeenCalled();
    expect(spies.anthropic.text).toHaveBeenCalledTimes(2);
  });

  it("drafts no Coach meal photo when AGENT_PROVIDER=disabled", async () => {
    stubEnv({ AGENT_PROVIDER: "disabled" });
    const photoSpies = [GeminiVisionProvider, AnthropicVisionProvider].map(
      (provider) =>
        vi.spyOn(provider.prototype, "generateDraft").mockImplementation(() => {
          throw new VisionProviderError("unavailable", "test stop", false);
        }),
    );
    const app = buildApp({
      tokenVerifier: verifier,
      aiConsentRepository: await consents(),
    });
    apps.push(app);
    const conversation = await app.inject({
      method: "POST",
      url: "/v1/coach/conversations",
      headers: {
        authorization: "Bearer current",
        "content-type": "application/json",
      },
      payload: { title: "Meal photo" },
    });
    const conversationId = conversation.json().conversation.id as string;
    const boundary = "----MizyunKillSwitch";
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="meal.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`,
      ),
      Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const photo = await app.inject({
      method: "POST",
      url: `/v1/coach/conversations/${conversationId}/nutrition-photo`,
      headers: {
        authorization: "Bearer current",
        "content-type": `multipart/form-data; boundary=${boundary}`,
        "content-length": String(body.length),
        "idempotency-key": "kill-switch-photo",
      },
      payload: body,
    });

    expect(photo.statusCode).toBe(503);
    expect(photo.json().error?.code).toBe("AI_CONFIGURATION_ERROR");
    for (const spy of photoSpies) expect(spy).not.toHaveBeenCalled();
  });

  it("reports Gemini Coach status to a caller without a consent context", async () => {
    stubEnv();
    const app = buildApp({ tokenVerifier: verifier });
    apps.push(app);
    const anonymous = await app.inject({
      method: "GET",
      url: "/v1/coach/status",
    });
    expect(anonymous.json()).toMatchObject({ ready: true, provider: "gemini" });
    const unknownToken = await app.inject({
      method: "GET",
      url: "/v1/coach/status",
      headers: { authorization: "Bearer unknown" },
    });
    expect(unknownToken.json()).toMatchObject({ provider: "gemini" });
  });

  it("keeps recipe ideas routed to Anthropic on Gemini for every consent", async () => {
    const providers = selectConsentGatedRecipeProviders({
      routing: {
        recipeIdeas: "anthropic",
        ingredientPhotos: "gemini",
        cookingAssistant: "gemini",
      },
      anthropic: {
        apiKey: "test-anthropic-key-12345",
        model: "claude-haiku-5-5",
        externalAccess: true,
      },
      gemini: {
        apiKey: "test-gemini-key-12345",
        model: "gemini-3.8-flash",
        externalAccess: true,
      },
    });
    expect(providers.recognition).toBeInstanceOf(
      GeminiIngredientRecognitionProvider,
    );
    expect(providers.assistant).toBeInstanceOf(GeminiRecipeAssistantProvider);
    const anthropicStatus = vi.spyOn(
      AnthropicRecipeGenerationProvider.prototype,
      "status",
    );
    const geminiStatus = vi.spyOn(
      GeminiRecipeGenerationProvider.prototype,
      "status",
    );
    const consent = (consentVersion: string) => ({
      userId: users.legacy,
      granted: true,
      confirmedAdult: true,
      consentVersion,
      consentedAt: new Date(),
      revokedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await providers.generation.status();
    await runWithAiConsent(consent(LEGACY_AI_CONSENT_VERSION_GEMINI_ONLY), () =>
      providers.generation.status(),
    );
    expect(geminiStatus).toHaveBeenCalledTimes(2);
    expect(anthropicStatus).not.toHaveBeenCalled();
    // Recipe ideas were never disclosed for Anthropic, so even the current
    // consent keeps them on Gemini when the server routes them to Anthropic.
    await runWithAiConsent(consent(CURRENT_AI_CONSENT_VERSION), () =>
      providers.generation.status(),
    );
    expect(geminiStatus).toHaveBeenCalledTimes(3);
    expect(anthropicStatus).not.toHaveBeenCalled();
  });
});
