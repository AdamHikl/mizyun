import { describe, expect, it, vi } from "vitest";

import {
  FakeRecipeAssistantProvider,
  StubVisionProvider,
  VisionProviderError,
  type AgentProvider,
  type VisionDraftProvider,
} from "@mizyun/agent-runtime";
import {
  AI_CONSENT_VERSION_TWO_PROVIDERS,
  CURRENT_AI_CONSENT_VERSION,
  LEGACY_AI_CONSENT_VERSION_GEMINI_ONLY,
} from "@mizyun/contracts";
import type { StoredAiConsent, UserId } from "@mizyun/core";

import {
  anthropicAllowedForCurrentRequest,
  consentGatedAgentProvider,
  consentGatedRecipeAssistantProvider,
  consentGatedVisionDraftProvider,
  runWithAiConsent,
} from "./ai-consent-routing.js";

const at = new Date("2026-10-21T12:00:00Z");
const consent = (
  consentVersion: string,
  overrides: Partial<StoredAiConsent> = {},
): StoredAiConsent => ({
  userId: "00000000-0000-4000-8000-000000000001" as UserId,
  granted: true,
  confirmedAdult: true,
  consentVersion,
  consentedAt: at,
  revokedAt: null,
  createdAt: at,
  updatedAt: at,
  ...overrides,
});

const agent = (provider: string) => {
  const respond = vi.fn<AgentProvider["respond"]>(async () => ({
    message: { role: "assistant", text: `from ${provider}` },
    provider,
    evidence: [],
  }));
  const value: AgentProvider = {
    status: async () => ({ ready: true, provider, externalAccess: true }),
    respond,
  };
  return { value, respond };
};

const request = {
  userId: "00000000-0000-4000-8000-000000000001" as UserId,
  conversationId: "c" as never,
  messages: [{ role: "user" as const, text: "hi" }],
  grounding: [],
  memories: [],
  systemPolicy: "",
  promptVersion: "test",
};

describe("consent-gated AI routing", () => {
  it.each([
    ["no consent context", undefined],
    ["the legacy Gemini-only consent", LEGACY_AI_CONSENT_VERSION_GEMINI_ONLY],
    ["an unknown consent version", "2099-01-01"],
  ])("serves %s with the Gemini fallback", async (_label, version) => {
    const anthropic = agent("anthropic");
    const gemini = agent("gemini");
    const gated = consentGatedAgentProvider({
      consented: anthropic.value,
      fallback: gemini.value,
    });
    const response =
      version === undefined
        ? await gated.respond(request)
        : await runWithAiConsent(consent(version), () =>
            gated.respond(request),
          );
    expect(response.provider).toBe("gemini");
    expect(gemini.respond).toHaveBeenCalledTimes(1);
    expect(anthropic.respond).not.toHaveBeenCalled();
    expect(
      (
        await (version === undefined
          ? gated.status()
          : runWithAiConsent(consent(version), () => gated.status()))
      ).provider,
    ).toBe("gemini");
  });

  it.each([AI_CONSENT_VERSION_TWO_PROVIDERS, CURRENT_AI_CONSENT_VERSION])(
    "serves the %s disclosure with the routed Anthropic provider",
    async (version) => {
      const anthropic = agent("anthropic");
      const gemini = agent("gemini");
      const gated = consentGatedAgentProvider({
        consented: anthropic.value,
        fallback: gemini.value,
      });
      const response = await runWithAiConsent(consent(version), () =>
        gated.respond(request),
      );
      expect(response.provider).toBe("anthropic");
      expect(anthropic.respond).toHaveBeenCalledTimes(1);
      expect(gemini.respond).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["revoked", { revokedAt: at }],
    ["not granted", { granted: false }],
    ["not adult-confirmed", { confirmedAdult: false }],
  ])("fails closed to Gemini for a %s current consent", async (_l, change) => {
    await runWithAiConsent(consent(CURRENT_AI_CONSENT_VERSION, change), () =>
      expect(anthropicAllowedForCurrentRequest("coach")).toBe(false),
    );
    await runWithAiConsent(null, () =>
      expect(anthropicAllowedForCurrentRequest("coach")).toBe(false),
    );
  });

  it("keeps concurrent requests' consent contexts isolated", async () => {
    const seen: Record<string, boolean[]> = { legacy: [], current: [] };
    const run = (label: "legacy" | "current", version: string) =>
      runWithAiConsent(consent(version), async () => {
        for (let step = 0; step < 5; step += 1) {
          await new Promise((resolve) => setTimeout(resolve, 1));
          seen[label]!.push(anthropicAllowedForCurrentRequest("coach"));
        }
      });
    await Promise.all([
      run("legacy", LEGACY_AI_CONSENT_VERSION_GEMINI_ONLY),
      run("current", CURRENT_AI_CONSENT_VERSION),
    ]);
    expect(seen.legacy).toEqual([false, false, false, false, false]);
    expect(seen.current).toEqual([true, true, true, true, true]);
    expect(anthropicAllowedForCurrentRequest("coach")).toBe(false);
  });

  it("returns the fallback unchanged when both sides are the same provider", () => {
    const gemini = agent("gemini");
    expect(
      consentGatedAgentProvider({
        consented: gemini.value,
        fallback: gemini.value,
      }),
    ).toBe(gemini.value);
  });

  it("returns the serving provider's own candidate and provenance", async () => {
    const stub = new StubVisionProvider();
    const gemini: VisionDraftProvider = {
      status: async () => ({ ready: true, provider: "gemini" }),
      generateDraft: (input) => stub.generateDraft(input),
    };
    const claudeText = vi.fn(async () => {
      throw new VisionProviderError("unavailable", "not expected", false);
    });
    const anthropic: VisionDraftProvider = {
      status: async () => ({ ready: true, provider: "anthropic" }),
      generateDraft: claudeText,
      generateTextDraft: claudeText,
    };
    const gated = consentGatedVisionDraftProvider({
      consented: anthropic,
      fallback: gemini,
    });
    // The optional text operation exists because one side implements it, but
    // a legacy request lands on Gemini, which lacks it: 503 not_configured.
    expect(gated.generateTextDraft).toBeDefined();
    await expect(
      runWithAiConsent(consent(LEGACY_AI_CONSENT_VERSION_GEMINI_ONLY), () =>
        gated.generateTextDraft!({
          userId: request.userId,
          description: "two eggs",
          requestId: "r",
        }),
      ),
    ).rejects.toMatchObject({ kind: "not_configured" });
    expect(claudeText).not.toHaveBeenCalled();
    await expect(gated.status()).resolves.toMatchObject({
      provider: "gemini",
    });
  });

  it("estimates recipe tokens with the same vendor that answers", async () => {
    const anthropic = new FakeRecipeAssistantProvider();
    const gemini = new FakeRecipeAssistantProvider();
    const anthropicEstimate = vi
      .spyOn(anthropic, "estimateTokens")
      .mockReturnValue(1_300);
    const geminiEstimate = vi
      .spyOn(gemini, "estimateTokens")
      .mockReturnValue(1_000);
    const gated = consentGatedRecipeAssistantProvider({
      consented: anthropic,
      fallback: gemini,
    });
    const projected = {} as Parameters<typeof gated.estimateTokens>[0];
    expect(gated.estimateTokens(projected)).toBe(1_000);
    // The cooking assistant was disclosed for Google only, so even the
    // current consent keeps it (and its estimate) on Gemini.
    expect(
      runWithAiConsent(consent(CURRENT_AI_CONSENT_VERSION), () =>
        gated.estimateTokens(projected),
      ),
    ).toBe(1_000);
    expect(anthropicEstimate).not.toHaveBeenCalled();
    expect(geminiEstimate).toHaveBeenCalledTimes(2);
  });

  it("keeps photo drafts and stretch on Gemini for the current consent even when routed to Anthropic", async () => {
    type Draft = Awaited<ReturnType<VisionDraftProvider["generateDraft"]>>;
    type Stretch = Awaited<
      ReturnType<NonNullable<VisionDraftProvider["refineStretchPlan"]>>
    >;
    const served = (vendor: string) => ({ vendor }) as unknown as Draft;
    const anthropic = {
      status: async () => ({ ready: true, provider: "anthropic" }),
      generateDraft: vi.fn(async () => served("anthropic")),
      generateTextDraft: vi.fn(async () => served("anthropic")),
      refineStretchPlan: vi.fn(
        async () => ({ vendor: "anthropic" }) as unknown as Stretch,
      ),
    } satisfies VisionDraftProvider;
    const gemini = {
      status: async () => ({ ready: true, provider: "gemini" }),
      generateDraft: vi.fn(async () => served("gemini")),
      generateTextDraft: vi.fn(async () => served("gemini")),
      refineStretchPlan: vi.fn(
        async () => ({ vendor: "gemini" }) as unknown as Stretch,
      ),
    } satisfies VisionDraftProvider;
    const gated = consentGatedVisionDraftProvider({
      consented: anthropic,
      fallback: gemini,
    });
    const photo = {} as Parameters<VisionDraftProvider["generateDraft"]>[0];
    const stretch = {} as Parameters<
      NonNullable<VisionDraftProvider["refineStretchPlan"]>
    >[0];
    const text = {} as Parameters<
      NonNullable<VisionDraftProvider["generateTextDraft"]>
    >[0];
    await runWithAiConsent(consent(CURRENT_AI_CONSENT_VERSION), async () => {
      await expect(gated.generateDraft(photo)).resolves.toEqual({
        vendor: "gemini",
      });
      await expect(gated.refineStretchPlan!(stretch)).resolves.toEqual({
        vendor: "gemini",
      });
      // Typed meals were disclosed for Anthropic, so they still route there.
      await expect(gated.generateTextDraft!(text)).resolves.toEqual({
        vendor: "anthropic",
      });
    });
    expect(anthropic.generateDraft).not.toHaveBeenCalled();
    expect(anthropic.refineStretchPlan).not.toHaveBeenCalled();
    expect(gemini.generateDraft).toHaveBeenCalledTimes(1);
    expect(gemini.refineStretchPlan).toHaveBeenCalledTimes(1);
  });

  it("admits Anthropic only for the features the disclosure names", async () => {
    const allowed = await runWithAiConsent(
      consent(CURRENT_AI_CONSENT_VERSION),
      async () =>
        (
          [
            "coach",
            "mealText",
            "mealPhoto",
            "activityDraft",
            "recipeIdeas",
            "ingredientPhoto",
            "cookingAssistant",
            "stretchPlan",
          ] as const
        ).filter((feature) => anthropicAllowedForCurrentRequest(feature)),
    );
    expect(allowed).toEqual(["coach", "mealText", "activityDraft"]);
  });
});
