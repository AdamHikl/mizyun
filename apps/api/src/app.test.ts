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
  AnthropicRecipeGenerationProvider,
  AnthropicVisionProvider,
} from "@mizyun/provider-anthropic";
import {
  GeminiIngredientRecognitionProvider,
  GeminiRecipeAssistantProvider,
  GeminiVisionProvider,
} from "@mizyun/provider-gemini";

import { buildApp, selectRecipeProviders } from "./app.js";

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

  const coachStatus = async () => {
    const app = buildApp();
    apps.push(app);
    const response = await app.inject({
      method: "GET",
      url: "/v1/coach/status",
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
  });
});
