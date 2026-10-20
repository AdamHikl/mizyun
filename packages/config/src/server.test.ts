import { describe, expect, it } from "vitest";

import {
  AI_FEATURE_PROVIDER_ENV_KEYS,
  SERVER_ENV_KEYS,
  loadServerConfig,
  type ServerAiRouting,
  type ServerConfig,
} from "./server.js";

const baseSnapshot = {
  [SERVER_ENV_KEYS.host]: "127.0.0.1",
  [SERVER_ENV_KEYS.port]: "4000",
  [SERVER_ENV_KEYS.env]: "development",
};

const expectOk = (value: ServerConfig) => {
  expect(value.host).toBe("127.0.0.1");
  expect(value.port).toBe(4000);
  expect(value.env).toBe("development");
};

describe("loadServerConfig — defaults and ranges", () => {
  it("applies 127.0.0.1 / 4000 / development defaults when nothing is set", () => {
    const result = loadServerConfig({ env: {} });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expectOk(result.value);
  });

  it("accepts NODE_ENV=test and NODE_ENV=production", () => {
    const result = loadServerConfig({
      env: { ...baseSnapshot, [SERVER_ENV_KEYS.env]: "test" },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.env).toBe("test");
  });

  it("rejects an unrecognised NODE_ENV with kind:malformed", () => {
    const result = loadServerConfig({
      env: { ...baseSnapshot, [SERVER_ENV_KEYS.env]: "staging" },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error[0]?.kind).toBe("malformed");
  });

  it("parses a valid API_PORT string into an integer", () => {
    const result = loadServerConfig({
      env: { ...baseSnapshot, [SERVER_ENV_KEYS.port]: "5000" },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.port).toBe(5000);
  });

  it("rejects a non-integer API_PORT with kind:out_of_range", () => {
    const result = loadServerConfig({
      env: { ...baseSnapshot, [SERVER_ENV_KEYS.port]: "not-a-number" },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const first = result.error[0];
    expect(first?.kind).toBe("out_of_range");
    if (first?.kind === "out_of_range") {
      expect(first.key).toBe(SERVER_ENV_KEYS.port);
    }
  });

  it("rejects API_PORT outside 1..65535 with kind:out_of_range", () => {
    const tooHigh = loadServerConfig({
      env: { ...baseSnapshot, [SERVER_ENV_KEYS.port]: "70000" },
    });
    const tooLow = loadServerConfig({
      env: { ...baseSnapshot, [SERVER_ENV_KEYS.port]: "0" },
    });

    expect(tooHigh.ok).toBe(false);
    if (!tooHigh.ok) {
      expect(tooHigh.error[0]?.kind).toBe("out_of_range");
    }
    expect(tooLow.ok).toBe(false);
    if (!tooLow.ok) {
      expect(tooLow.error[0]?.kind).toBe("out_of_range");
    }
  });

  it("treats an empty API_HOST the same as missing (uses default)", () => {
    // Default-having fields treat empty strings as absent so a partially
    // configured `.env` does not silently disable the server. The
    // Supabase pair (no default) behaves differently — empty values there
    // are filtered to "missing" so the asymmetry check still works.
    const result = loadServerConfig({
      env: { ...baseSnapshot, [SERVER_ENV_KEYS.host]: "" },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.host).toBe("127.0.0.1");
  });
});

describe("loadServerConfig — optional supabase", () => {
  it("returns supabase.configured:true when both keys are valid", () => {
    const result = loadServerConfig({
      env: {
        ...baseSnapshot,
        [SERVER_ENV_KEYS.supabaseUrl]: "http://127.0.0.1:54321",
        [SERVER_ENV_KEYS.supabasePublishableKey]: "publishable-key",
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.supabase).toEqual({
      configured: true,
      provider: "supabase",
    });
  });

  it("returns supabase.configured:false with reason when both are absent", () => {
    const result = loadServerConfig({ env: baseSnapshot });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.supabase.configured).toBe(false);
    if (result.value.supabase.configured === false) {
      expect(result.value.supabase.provider).toBe("supabase");
      expect(result.value.supabase.reason).toMatch(/has not been provided/);
    }
  });

  it("treats empty strings the same as missing keys", () => {
    const result = loadServerConfig({
      env: {
        ...baseSnapshot,
        [SERVER_ENV_KEYS.supabaseUrl]: "",
        [SERVER_ENV_KEYS.supabasePublishableKey]: "",
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.supabase.configured).toBe(false);
  });

  it("accepts a long SUPABASE_SERVICE_ROLE_KEY alongside the pair", () => {
    const result = loadServerConfig({
      env: {
        ...baseSnapshot,
        [SERVER_ENV_KEYS.supabaseUrl]: "http://127.0.0.1:54321",
        [SERVER_ENV_KEYS.supabasePublishableKey]: "publishable-key",
        [SERVER_ENV_KEYS.supabaseServiceRoleKey]:
          "service-role-key-that-is-long-enough",
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.supabaseConfig?.serviceRoleKey).toBe(
      "service-role-key-that-is-long-enough",
    );
  });

  it("leaves serviceRoleKey undefined when omitted", () => {
    const result = loadServerConfig({
      env: {
        ...baseSnapshot,
        [SERVER_ENV_KEYS.supabaseUrl]: "http://127.0.0.1:54321",
        [SERVER_ENV_KEYS.supabasePublishableKey]: "publishable-key",
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.supabaseConfig?.serviceRoleKey).toBeUndefined();
  });

  it("rejects a too-short SUPABASE_SERVICE_ROLE_KEY with kind:out_of_range", () => {
    const result = loadServerConfig({
      env: {
        ...baseSnapshot,
        [SERVER_ENV_KEYS.supabaseUrl]: "http://127.0.0.1:54321",
        [SERVER_ENV_KEYS.supabasePublishableKey]: "publishable-key",
        [SERVER_ENV_KEYS.supabaseServiceRoleKey]: "short",
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const first = result.error[0];
    expect(first?.kind).toBe("out_of_range");
    if (first?.kind === "out_of_range") {
      expect(first.key).toBe(SERVER_ENV_KEYS.supabaseServiceRoleKey);
    }
  });

  it("rejects when only one of URL/key is set (asymmetry)", () => {
    const onlyUrl = loadServerConfig({
      env: {
        ...baseSnapshot,
        [SERVER_ENV_KEYS.supabaseUrl]: "http://127.0.0.1:54321",
      },
    });
    const onlyKey = loadServerConfig({
      env: {
        ...baseSnapshot,
        [SERVER_ENV_KEYS.supabasePublishableKey]: "publishable-key",
      },
    });

    expect(onlyUrl.ok).toBe(false);
    if (!onlyUrl.ok) {
      expect(onlyUrl.error[0]?.kind).toBe("malformed");
      if (onlyUrl.error[0]?.kind === "malformed") {
        expect(onlyUrl.error[0].reason).toMatch(/must be set together/);
      }
    }
    expect(onlyKey.ok).toBe(false);
  });

  it("rejects a malformed SUPABASE_URL with kind:malformed", () => {
    const result = loadServerConfig({
      env: {
        ...baseSnapshot,
        [SERVER_ENV_KEYS.supabaseUrl]: "not-a-url",
        [SERVER_ENV_KEYS.supabasePublishableKey]: "publishable-key",
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const first = result.error[0];
    expect(first?.kind).toBe("malformed");
    if (first?.kind === "malformed") {
      expect(first.key).toBe(SERVER_ENV_KEYS.supabaseUrl);
    }
  });

  it("rejects an empty SUPABASE_PUBLISHABLE_KEY with kind:malformed", () => {
    const result = loadServerConfig({
      env: {
        ...baseSnapshot,
        [SERVER_ENV_KEYS.supabaseUrl]: "http://127.0.0.1:54321",
        [SERVER_ENV_KEYS.supabasePublishableKey]: "",
      },
    });

    // Empty key is filtered out by `readString`, leaving only URL — asymmetry.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const first = result.error[0];
    expect(first?.kind).toBe("malformed");
    if (first?.kind === "malformed") {
      expect(first.reason).toMatch(/must be set together/);
    }
  });
});

describe("loadServerConfig — production isolation", () => {
  it("fails closed when production would use in-memory persistence", () => {
    const result = loadServerConfig({
      env: {
        ...baseSnapshot,
        [SERVER_ENV_KEYS.env]: "production",
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContainEqual({
      kind: "missing",
      keys: [
        SERVER_ENV_KEYS.supabaseUrl,
        SERVER_ENV_KEYS.supabasePublishableKey,
      ],
    });
    expect(result.error).toContainEqual({
      kind: "missing",
      keys: [SERVER_ENV_KEYS.supabaseServiceRoleKey],
    });
  });

  it("accepts production only with durable Supabase configuration", () => {
    const result = loadServerConfig({
      env: {
        ...baseSnapshot,
        [SERVER_ENV_KEYS.env]: "production",
        [SERVER_ENV_KEYS.supabaseUrl]: "http://127.0.0.1:8000",
        [SERVER_ENV_KEYS.supabasePublishableKey]: "publishable-key",
        [SERVER_ENV_KEYS.supabaseServiceRoleKey]:
          "service-role-key-that-is-long-enough",
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.env).toBe("production");
    expect(result.value.supabase.configured).toBe(true);
  });

  it("forbids the deterministic vision stub in production", () => {
    const result = loadServerConfig({
      env: {
        ...baseSnapshot,
        [SERVER_ENV_KEYS.env]: "production",
        [SERVER_ENV_KEYS.supabaseUrl]: "http://127.0.0.1:8000",
        [SERVER_ENV_KEYS.supabasePublishableKey]: "publishable-key",
        [SERVER_ENV_KEYS.supabaseServiceRoleKey]:
          "service-role-key-that-is-long-enough",
        [SERVER_ENV_KEYS.visionProvider]: "stub",
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContainEqual({
      kind: "malformed",
      key: SERVER_ENV_KEYS.visionProvider,
      reason: "VISION_PROVIDER=stub is forbidden when NODE_ENV=production.",
    });
  });
});

describe("loadServerConfig — closed-world", () => {
  it("ignores unrelated env vars (e.g. PATH) without producing an error", () => {
    const result = loadServerConfig({
      env: {
        ...baseSnapshot,
        PATH: "/usr/bin",
        HOME: "/Users/example",
        NODE_PATH: "/usr/lib/node_modules",
      },
    });

    expect(result.ok).toBe(true);
  });

  it("reports multiple issues at once (malformed port + missing supabase pair)", () => {
    const result = loadServerConfig({
      env: {
        [SERVER_ENV_KEYS.host]: "127.0.0.1",
        [SERVER_ENV_KEYS.port]: "not-a-number",
        [SERVER_ENV_KEYS.supabaseUrl]: "http://127.0.0.1:54321",
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Port is reported as out_of_range; supabase asymmetry is reported as
    // malformed. Both should be present in the same envelope.
    const kinds = result.error.map((issue) => issue.kind).sort();
    expect(kinds).toEqual(["malformed", "out_of_range"]);
  });

  it("defaults agentProvider to 'disabled' when AGENT_PROVIDER is absent", () => {
    const result = loadServerConfig({ env: baseSnapshot });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.agentProvider).toBe("disabled");
  });

  it("rejects an unrecognised AGENT_PROVIDER with kind:malformed", () => {
    const result = loadServerConfig({
      env: {
        ...baseSnapshot,
        [SERVER_ENV_KEYS.agentProvider]: "openai",
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const first = result.error[0];
    expect(first?.kind).toBe("malformed");
    if (first?.kind === "malformed") {
      expect(first.key).toBe(SERVER_ENV_KEYS.agentProvider);
    }
  });

  it("builds Anthropic config only when AGENT_PROVIDER=anthropic and the key is set", () => {
    const selected = loadServerConfig({
      env: {
        ...baseSnapshot,
        [SERVER_ENV_KEYS.agentProvider]: "anthropic",
        [SERVER_ENV_KEYS.anthropicApiKey]: "test-anthropic-key-12345",
        [SERVER_ENV_KEYS.anthropicDevTesting]: "true",
      },
    });
    expect(selected.ok).toBe(true);
    if (selected.ok) {
      expect(selected.value.anthropicConfig).toEqual({
        apiKey: "test-anthropic-key-12345",
        model: "claude-haiku-5-5",
        effort: "low",
        timeoutMs: 30_000,
        visionTimeoutMs: 45_000,
        maxOutputTokens: 8_192,
        webSearch: true,
      });
    }

    const keyOnly = loadServerConfig({
      env: {
        ...baseSnapshot,
        [SERVER_ENV_KEYS.agentProvider]: "gemini",
        [SERVER_ENV_KEYS.geminiApiKey]: "test-gemini-key-12345",
        [SERVER_ENV_KEYS.anthropicApiKey]: "test-anthropic-key-12345",
      },
    });
    expect(keyOnly.ok && keyOnly.value.anthropicConfig).toBeNull();
  });

  it("keeps AGENT_PROVIDER=anthropic loadable before the key is pasted", () => {
    const pending = loadServerConfig({
      env: {
        ...baseSnapshot,
        [SERVER_ENV_KEYS.agentProvider]: "anthropic",
        [SERVER_ENV_KEYS.geminiApiKey]: "test-gemini-key-12345",
      },
    });
    expect(pending.ok).toBe(true);
    if (pending.ok) {
      expect(pending.value.anthropicConfig).toBeNull();
      expect(pending.value.geminiConfig).not.toBeNull();
    }
  });

  it("rejects an unsupported ANTHROPIC_EFFORT", () => {
    const result = loadServerConfig({
      env: {
        ...baseSnapshot,
        [SERVER_ENV_KEYS.agentProvider]: "anthropic",
        [SERVER_ENV_KEYS.anthropicApiKey]: "test-anthropic-key-12345",
        [SERVER_ENV_KEYS.anthropicDevTesting]: "true",
        [SERVER_ENV_KEYS.anthropicEffort]: "max",
      },
    });
    expect(result.ok).toBe(false);
  });

  it("refuses Anthropic without the Dev-testing acknowledgement", () => {
    const result = loadServerConfig({
      env: {
        ...baseSnapshot,
        [SERVER_ENV_KEYS.agentProvider]: "anthropic",
        [SERVER_ENV_KEYS.anthropicApiKey]: "test-anthropic-key-12345",
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContainEqual(
      expect.objectContaining({ key: SERVER_ENV_KEYS.anthropicDevTesting }),
    );
  });

  it("only accepts claude-haiku-5-5 as ANTHROPIC_MODEL", () => {
    const result = loadServerConfig({
      env: {
        ...baseSnapshot,
        [SERVER_ENV_KEYS.agentProvider]: "anthropic",
        [SERVER_ENV_KEYS.anthropicApiKey]: "test-anthropic-key-12345",
        [SERVER_ENV_KEYS.anthropicDevTesting]: "true",
        [SERVER_ENV_KEYS.anthropicModel]: "claude-opus-5-5",
      },
    });
    expect(result.ok).toBe(false);
  });

  it("validates bounded per-user AI request controls", () => {
    const configured = loadServerConfig({
      env: {
        ...baseSnapshot,
        [SERVER_ENV_KEYS.agentProvider]: "gemini",
        [SERVER_ENV_KEYS.geminiApiKey]: "test-gemini-key-12345",
        [SERVER_ENV_KEYS.aiUserRequestsPerMinute]: "12",
        [SERVER_ENV_KEYS.aiUserMaxConcurrentRequests]: "1",
      },
    });
    expect(configured.ok).toBe(true);
    if (configured.ok) {
      expect(configured.value.geminiConfig).toMatchObject({
        userRequestsPerMinute: 12,
        userMaxConcurrentRequests: 1,
      });
    }

    const invalid = loadServerConfig({
      env: {
        ...baseSnapshot,
        [SERVER_ENV_KEYS.aiUserRequestsPerMinute]: "0",
        [SERVER_ENV_KEYS.aiUserMaxConcurrentRequests]: "2",
      },
    });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.error).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "out_of_range",
            key: SERVER_ENV_KEYS.aiUserRequestsPerMinute,
          }),
          expect.objectContaining({
            kind: "out_of_range",
            key: SERVER_ENV_KEYS.aiUserMaxConcurrentRequests,
          }),
        ]),
      );
    }
  });

  it("builds a bounded Gemini configuration with external access default-off", () => {
    const result = loadServerConfig({
      env: {
        ...baseSnapshot,
        [SERVER_ENV_KEYS.agentProvider]: "gemini",
        [SERVER_ENV_KEYS.geminiApiKey]: "test-gemini-key-12345",
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      agentProvider: "gemini",
      aiExternalAccess: false,
      geminiConfig: {
        apiKey: "test-gemini-key-12345",
        model: "gemini-3.8-flash",
        fallbackModel: "gemini-3.6-flash",
        thinkingBudget: 0,
        timeoutMs: 30_000,
        maxOutputTokens: 8_192,
      },
      geminiVisionConfig: {
        apiKey: "test-gemini-key-12345",
        model: "gemini-3.8-flash",
        fallbackModel: "gemini-3.6-flash",
        thinkingBudget: 0,
        searchGrounding: true,
      },
    });
  });

  it("respects custom Gemini vision model, fallback model, and thinking budget", () => {
    const result = loadServerConfig({
      env: {
        ...baseSnapshot,
        [SERVER_ENV_KEYS.agentProvider]: "gemini",
        [SERVER_ENV_KEYS.geminiApiKey]: "test-gemini-key-12345",
        [SERVER_ENV_KEYS.geminiVisionModel]: "gemini-3.7-flash",
        [SERVER_ENV_KEYS.geminiVisionFallbackModel]: "gemini-3.6-flash",
        [SERVER_ENV_KEYS.geminiVisionThinkingBudget]: "512",
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.geminiVisionConfig).toMatchObject({
      model: "gemini-3.7-flash",
      fallbackModel: "gemini-3.6-flash",
      thinkingBudget: 512,
    });
  });

  it("requires GEMINI_API_KEY when AGENT_PROVIDER=gemini", () => {
    const result = loadServerConfig({
      env: {
        ...baseSnapshot,
        [SERVER_ENV_KEYS.agentProvider]: "gemini",
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error[0]?.kind).toBe("missing");
  });
});

describe("loadServerConfig — per-feature AI routing", () => {
  const GEMINI_KEY = "test-gemini-key-12345";
  const ANTHROPIC_KEY = "test-anthropic-key-12345";
  const allRoutedTo = (vendor: "gemini" | "anthropic"): ServerAiRouting => ({
    coach: vendor,
    mealText: vendor,
    mealPhoto: vendor,
    activityDraft: vendor,
    recipeIdeas: vendor,
    ingredientPhotos: vendor,
    cookingAssistant: vendor,
    stretchPlan: vendor,
  });
  // Adam's 2026-10-20 benchmark decision for Dev.
  const benchmarkEnv = {
    [SERVER_ENV_KEYS.coachProvider]: "anthropic",
    [SERVER_ENV_KEYS.mealTextProvider]: "anthropic",
    [SERVER_ENV_KEYS.mealPhotoProvider]: "gemini",
    [SERVER_ENV_KEYS.activityDraftProvider]: "anthropic",
    [SERVER_ENV_KEYS.recipeIdeasProvider]: "anthropic",
    [SERVER_ENV_KEYS.ingredientPhotoProvider]: "gemini",
    [SERVER_ENV_KEYS.cookingAssistantProvider]: "gemini",
  };

  it("names one env key per routed feature", () => {
    expect(AI_FEATURE_PROVIDER_ENV_KEYS).toEqual({
      coach: "COACH_PROVIDER",
      mealText: "MEAL_TEXT_PROVIDER",
      mealPhoto: "MEAL_PHOTO_PROVIDER",
      activityDraft: "ACTIVITY_DRAFT_PROVIDER",
      recipeIdeas: "RECIPE_IDEAS_PROVIDER",
      ingredientPhotos: "INGREDIENT_PHOTO_PROVIDER",
      cookingAssistant: "COOKING_ASSISTANT_PROVIDER",
      stretchPlan: "STRETCH_PLAN_PROVIDER",
    });
  });

  it("inherits AGENT_PROVIDER for every feature when no override is set", () => {
    const disabled = loadServerConfig({ env: baseSnapshot });
    expect(disabled.ok && disabled.value.aiRouting).toEqual(
      allRoutedTo("gemini"),
    );

    const gemini = loadServerConfig({
      env: {
        ...baseSnapshot,
        [SERVER_ENV_KEYS.agentProvider]: "gemini",
        [SERVER_ENV_KEYS.geminiApiKey]: GEMINI_KEY,
        [SERVER_ENV_KEYS.anthropicApiKey]: ANTHROPIC_KEY,
      },
    });
    expect(gemini.ok && gemini.value.aiRouting).toEqual(allRoutedTo("gemini"));
    expect(gemini.ok && gemini.value.anthropicConfig).toBeNull();

    const anthropic = loadServerConfig({
      env: {
        ...baseSnapshot,
        [SERVER_ENV_KEYS.agentProvider]: "anthropic",
        [SERVER_ENV_KEYS.anthropicApiKey]: ANTHROPIC_KEY,
        [SERVER_ENV_KEYS.anthropicDevTesting]: "true",
      },
    });
    expect(anthropic.ok && anthropic.value.aiRouting).toEqual(
      allRoutedTo("anthropic"),
    );
  });

  it("keeps the legacy Gemini fallback when AGENT_PROVIDER=anthropic has no key", () => {
    const pending = loadServerConfig({
      env: {
        ...baseSnapshot,
        [SERVER_ENV_KEYS.agentProvider]: "anthropic",
        [SERVER_ENV_KEYS.geminiApiKey]: GEMINI_KEY,
      },
    });
    expect(pending.ok).toBe(true);
    if (!pending.ok) return;
    expect(pending.value.aiRouting).toEqual(allRoutedTo("gemini"));
    expect(pending.value.anthropicConfig).toBeNull();
  });

  it("applies the benchmark table on a Gemini default", () => {
    const result = loadServerConfig({
      env: {
        ...baseSnapshot,
        ...benchmarkEnv,
        [SERVER_ENV_KEYS.agentProvider]: "gemini",
        [SERVER_ENV_KEYS.geminiApiKey]: GEMINI_KEY,
        [SERVER_ENV_KEYS.anthropicApiKey]: ANTHROPIC_KEY,
        [SERVER_ENV_KEYS.anthropicDevTesting]: "true",
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.aiRouting).toEqual({
      coach: "anthropic",
      mealText: "anthropic",
      mealPhoto: "gemini",
      activityDraft: "anthropic",
      recipeIdeas: "anthropic",
      ingredientPhotos: "gemini",
      cookingAssistant: "gemini",
      stretchPlan: "gemini",
    });
    expect(result.value.anthropicConfig?.apiKey).toBe(ANTHROPIC_KEY);
    expect(result.value.geminiConfig?.apiKey).toBe(GEMINI_KEY);
    expect(result.value.geminiVisionConfig?.apiKey).toBe(GEMINI_KEY);
  });

  it("lets a feature leave an Anthropic default for Gemini", () => {
    const result = loadServerConfig({
      env: {
        ...baseSnapshot,
        [SERVER_ENV_KEYS.agentProvider]: "anthropic",
        [SERVER_ENV_KEYS.mealPhotoProvider]: "gemini",
        [SERVER_ENV_KEYS.geminiApiKey]: GEMINI_KEY,
        [SERVER_ENV_KEYS.anthropicApiKey]: ANTHROPIC_KEY,
        [SERVER_ENV_KEYS.anthropicDevTesting]: "true",
      },
    });
    expect(result.ok && result.value.aiRouting).toEqual({
      ...allRoutedTo("anthropic"),
      mealPhoto: "gemini",
    });
  });

  it("fails clearly when a feature is routed to Anthropic without its key", () => {
    const result = loadServerConfig({
      env: {
        ...baseSnapshot,
        [SERVER_ENV_KEYS.agentProvider]: "gemini",
        [SERVER_ENV_KEYS.geminiApiKey]: GEMINI_KEY,
        [SERVER_ENV_KEYS.coachProvider]: "anthropic",
        [SERVER_ENV_KEYS.anthropicDevTesting]: "true",
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual([
      {
        kind: "malformed",
        key: "COACH_PROVIDER",
        reason: "COACH_PROVIDER=anthropic requires ANTHROPIC_API_KEY.",
      },
    ]);
  });

  it("fails clearly when a feature is routed to Gemini without a Gemini key", () => {
    const result = loadServerConfig({
      env: {
        ...baseSnapshot,
        [SERVER_ENV_KEYS.agentProvider]: "anthropic",
        [SERVER_ENV_KEYS.anthropicApiKey]: ANTHROPIC_KEY,
        [SERVER_ENV_KEYS.anthropicDevTesting]: "true",
        [SERVER_ENV_KEYS.ingredientPhotoProvider]: "gemini",
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual([
      {
        kind: "malformed",
        key: "INGREDIENT_PHOTO_PROVIDER",
        reason: "INGREDIENT_PHOTO_PROVIDER=gemini requires GEMINI_API_KEY.",
      },
    ]);

    const visionKeyOnly = loadServerConfig({
      env: {
        ...baseSnapshot,
        [SERVER_ENV_KEYS.mealPhotoProvider]: "gemini",
        [SERVER_ENV_KEYS.geminiVisionApiKey]: GEMINI_KEY,
      },
    });
    expect(visionKeyOnly.ok).toBe(true);
  });

  it("requires the Dev-testing acknowledgement for any Anthropic feature", () => {
    const result = loadServerConfig({
      env: {
        ...baseSnapshot,
        [SERVER_ENV_KEYS.agentProvider]: "gemini",
        [SERVER_ENV_KEYS.geminiApiKey]: GEMINI_KEY,
        [SERVER_ENV_KEYS.anthropicApiKey]: ANTHROPIC_KEY,
        [SERVER_ENV_KEYS.recipeIdeasProvider]: "anthropic",
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual([
      expect.objectContaining({
        kind: "malformed",
        key: SERVER_ENV_KEYS.anthropicDevTesting,
      }),
    ]);
  });

  it("rejects an unknown per-feature vendor", () => {
    const result = loadServerConfig({
      env: { ...baseSnapshot, [SERVER_ENV_KEYS.mealTextProvider]: "openai" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual([
      {
        kind: "malformed",
        key: "MEAL_TEXT_PROVIDER",
        reason: "MEAL_TEXT_PROVIDER must be gemini or anthropic",
      },
    ]);
  });
});

describe("loadServerConfig — SES email configuration", () => {
  it("defaults sesConfig to null when SES keys are omitted", () => {
    const result = loadServerConfig({ env: baseSnapshot });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sesConfig).toBeNull();
  });

  it("parses valid SES configuration with defaults", () => {
    const result = loadServerConfig({
      env: {
        ...baseSnapshot,
        [SERVER_ENV_KEYS.sesAccessKeyId]: "AKIAIOSFODNN7EXAMPLE",
        [SERVER_ENV_KEYS.sesSecretAccessKey]:
          "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sesConfig).toEqual({
      region: "eu-west-1",
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      fromEmail: "no-reply@mizyun.phiskel.com",
    });
  });

  it("accepts PHISKEL_SES_AWS_* alias environment variables and custom settings", () => {
    const result = loadServerConfig({
      env: {
        ...baseSnapshot,
        PHISKEL_SES_AWS_ACCESS_KEY_ID: "AKIAIOSFODNN7EXAMPLE",
        PHISKEL_SES_AWS_SECRET_ACCESS_KEY:
          "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        SES_REGION: "eu-central-1",
        SES_FROM_EMAIL: "custom-sender@mizyun.phiskel.com",
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sesConfig).toEqual({
      region: "eu-central-1",
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      fromEmail: "custom-sender@mizyun.phiskel.com",
    });
  });

  it("fails if only one of SES key ID or secret is provided", () => {
    const result = loadServerConfig({
      env: {
        ...baseSnapshot,
        [SERVER_ENV_KEYS.sesAccessKeyId]: "AKIAIOSFODNN7EXAMPLE",
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const issue = result.error[0];
    expect(issue?.kind).toBe("malformed");
    if (issue?.kind === "malformed") {
      expect(issue.key).toBe(SERVER_ENV_KEYS.sesAccessKeyId);
    }
  });

  describe("AI_ALLOWED_EMAILS parsing", () => {
    it("allows enabled external AI without manual email enrollment", () => {
      const result = loadServerConfig({
        env: { ...baseSnapshot, AI_EXTERNAL_ACCESS: "true" },
      });
      expect(result.ok).toBe(true);
    });
    it("defaults to empty array when unset", () => {
      const result = loadServerConfig({ env: {} });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.aiAllowedEmails).toEqual([]);
    });

    it("parses comma-separated emails, trims whitespace, and lowercases them", () => {
      const result = loadServerConfig({
        env: {
          ...baseSnapshot,
          [SERVER_ENV_KEYS.aiAllowedEmails]:
            " Founder@Example.com, partner@mizyun.com , , TEST@OTHER.ORG ",
        },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.aiAllowedEmails).toEqual([
        "founder@example.com",
        "partner@mizyun.com",
        "test@other.org",
      ]);
    });
  });

  describe("SUPABASE_PUBLIC_URL resolution", () => {
    it("uses explicitly provided SUPABASE_PUBLIC_URL", () => {
      const result = loadServerConfig({
        env: {
          ...baseSnapshot,
          [SERVER_ENV_KEYS.supabaseUrl]: "http://127.0.0.1:8100",
          [SERVER_ENV_KEYS.supabasePublishableKey]: "valid-publishable-key",
          [SERVER_ENV_KEYS.supabasePublicUrl]:
            "https://custom-supabase.example.com",
        },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.supabaseConfig?.publicUrl).toBe(
        "https://custom-supabase.example.com",
      );
    });

    it("infers dev public URL when port is 8100 and public URL is unset", () => {
      const result = loadServerConfig({
        env: {
          ...baseSnapshot,
          [SERVER_ENV_KEYS.supabaseUrl]: "http://127.0.0.1:8100",
          [SERVER_ENV_KEYS.supabasePublishableKey]: "valid-publishable-key",
        },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.supabaseConfig?.publicUrl).toBe(
        "https://mizyun-supabase-dev.phiskel.com",
      );
    });

    it("infers production public URL when port is 8000 and public URL is unset", () => {
      const result = loadServerConfig({
        env: {
          ...baseSnapshot,
          [SERVER_ENV_KEYS.supabaseUrl]: "http://127.0.0.1:8000",
          [SERVER_ENV_KEYS.supabasePublishableKey]: "valid-publishable-key",
        },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.supabaseConfig?.publicUrl).toBe(
        "https://mizyun-supabase.phiskel.com",
      );
    });

    it("leaves publicUrl undefined when port is non-standard (e.g. 54321)", () => {
      const result = loadServerConfig({
        env: {
          ...baseSnapshot,
          [SERVER_ENV_KEYS.supabaseUrl]: "http://127.0.0.1:54321",
          [SERVER_ENV_KEYS.supabasePublishableKey]: "valid-publishable-key",
        },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.supabaseConfig?.publicUrl).toBeUndefined();
    });

    it("rejects invalid SUPABASE_PUBLIC_URL", () => {
      const result = loadServerConfig({
        env: {
          ...baseSnapshot,
          [SERVER_ENV_KEYS.supabaseUrl]: "http://127.0.0.1:8100",
          [SERVER_ENV_KEYS.supabasePublishableKey]: "valid-publishable-key",
          [SERVER_ENV_KEYS.supabasePublicUrl]: "not-a-url",
        },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      const first = result.error[0];
      expect(first?.kind).toBe("malformed");
      if (first?.kind === "malformed") {
        expect(first.key).toBe(SERVER_ENV_KEYS.supabasePublicUrl);
      }
    });
  });

  describe("appleAuthConfig", () => {
    it("accepts a separate 32-byte base64 revocation key", () => {
      const key = Buffer.alloc(32, 7).toString("base64");
      const result = loadServerConfig({
        env: {
          ...baseSnapshot,
          [SERVER_ENV_KEYS.appleRevocationEncryptionKey]: key,
        },
      });
      expect(result.ok).toBe(true);
      if (result.ok)
        expect(result.value.appleRevocationEncryptionKey).toBe(key);
    });

    it("rejects malformed revocation keys without returning their value", () => {
      const key = "synthetic-invalid-key";
      const result = loadServerConfig({
        env: {
          ...baseSnapshot,
          [SERVER_ENV_KEYS.appleRevocationEncryptionKey]: key,
        },
      });
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain(key);
    });
    it("returns null when Apple auth credentials are not provided", () => {
      const result = loadServerConfig({ env: baseSnapshot });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.appleAuthConfig).toBeNull();
    });

    it("parses appleAuthConfig when teamId, keyId, and privateKey are provided", () => {
      const result = loadServerConfig({
        env: {
          ...baseSnapshot,
          [SERVER_ENV_KEYS.appleTeamId]: "LQJNDVBL43",
          [SERVER_ENV_KEYS.appleKeyId]: "2X9J497DK2",
          [SERVER_ENV_KEYS.applePrivateKey]: "test-private-key-pem",
        },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.appleAuthConfig).toEqual({
        teamId: "LQJNDVBL43",
        keyId: "2X9J497DK2",
        privateKey: "test-private-key-pem",
        clientId: "com.mizyun.development",
      });
    });

    it("uses com.mizyun.app as default clientId in production", () => {
      const result = loadServerConfig({
        env: {
          ...baseSnapshot,
          [SERVER_ENV_KEYS.env]: "production",
          [SERVER_ENV_KEYS.supabaseUrl]: "http://127.0.0.1:8000",
          [SERVER_ENV_KEYS.supabasePublishableKey]: "valid-prod-key",
          [SERVER_ENV_KEYS.supabaseServiceRoleKey]:
            "service-role-key-that-is-long-enough",
          [SERVER_ENV_KEYS.appleTeamId]: "LQJNDVBL43",
          [SERVER_ENV_KEYS.appleKeyId]: "2X9J497DK2",
          [SERVER_ENV_KEYS.applePrivateKey]: "test-private-key-pem",
        },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.appleAuthConfig?.clientId).toBe("com.mizyun.app");
    });
  });
});

describe("loadServerConfig — AI_CONSENT_ACCEPTED_VERSIONS", () => {
  const load = (value?: string) =>
    loadServerConfig({
      env:
        value === undefined
          ? baseSnapshot
          : {
              ...baseSnapshot,
              [SERVER_ENV_KEYS.aiConsentAcceptedVersions]: value,
            },
    });

  it("is null when unset so the API applies its default accepted set", () => {
    const result = load();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.aiConsentAcceptedVersions).toBeNull();
    expect(SERVER_ENV_KEYS.aiConsentAcceptedVersions).toBe(
      "AI_CONSENT_ACCEPTED_VERSIONS",
    );
  });

  it("parses a Dev-style single current version", () => {
    const result = load("2026-10-20");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.aiConsentAcceptedVersions).toEqual(["2026-10-20"]);
  });

  it("trims, drops empty entries and de-duplicates a list", () => {
    const result = load(" 2026-09-08 , 2026-10-20,,2026-10-20 ");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.aiConsentAcceptedVersions).toEqual([
      "2026-09-08",
      "2026-10-20",
    ]);
  });

  it.each([",", " , ", "v1", "2026-10-20,latest", "20261020"])(
    "fails closed on malformed value %j",
    (value) => {
      const result = load(value);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toEqual([
        expect.objectContaining({
          kind: "malformed",
          key: "AI_CONSENT_ACCEPTED_VERSIONS",
        }),
      ]);
    },
  );
});
