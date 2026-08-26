import { describe, expect, it, vi } from "vitest";
import type {
  RefineFoodDraftRequest,
  VisionDraftRequest,
} from "@mizyun/agent-runtime";
import { GeminiVisionProvider, type GeminiVisionClient } from "./vision.js";

const request: VisionDraftRequest = {
  userId:
    "00000000-0000-4000-8000-000000000001" as VisionDraftRequest["userId"],
  photo: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
  mimeType: "image/jpeg" as const,
  textHint: "chicken and rice",
  requestId: "vision-test",
};

const candidateOutput = {
  name: "Chicken and rice",
  caloriesKcal: 420,
  proteinG: 38,
  carbohydrateG: 45,
  fatG: 9,
  calorieRangeKcal: { low: 380, high: 500 },
  proteinRangeG: { low: 32, high: 44 },
  carbohydrateRangeG: { low: 38, high: 55 },
  fatRangeG: { low: 6, high: 13 },
  confidence: 0.82,
  warnings: ["Confirm the portion size."],
  assumptions: ["Assumes one ordinary plate."],
};

describe("GeminiVisionProvider", () => {
  it("stays disabled when external access is false", async () => {
    const provider = new GeminiVisionProvider({
      apiKey: "test-key",
      model: "gemini-2.5-flash",
      timeoutMs: 5_000,
      maxOutputTokens: 500,
      externalAccess: false,
      client: { generateContent: vi.fn() },
    });
    await expect(provider.status()).resolves.toMatchObject({
      ready: false,
      provider: "gemini-vision",
    });
    await expect(provider.generateDraft(request)).rejects.toMatchObject({
      kind: "external_access_disabled",
    });
  });

  it("generates a photo draft and validates structured JSON output", async () => {
    const generateContent = vi.fn<GeminiVisionClient["generateContent"]>(
      async () => ({
        modelVersion: "gemini-2.5-flash",
        candidates: [
          {
            content: {
              role: "model",
              parts: [{ text: JSON.stringify(candidateOutput) }],
            },
          },
        ],
      }),
    );
    const provider = new GeminiVisionProvider({
      apiKey: "test-key",
      model: "gemini-2.5-flash",
      timeoutMs: 5_000,
      maxOutputTokens: 500,
      externalAccess: true,
      client: { generateContent },
    });

    const result = await provider.generateDraft(request);
    expect(result.name).toBe("Chicken and rice");
    expect(result.caloriesKcal).toBe(420);
    expect(result.proteinG).toBe(38);
    expect(result.provenance.provider).toBe("gemini");
    expect(result.provenance.inputKind).toBe("photo");

    // Check payload passed to Gemini
    const callArgs = generateContent.mock.calls[0]?.[0];
    expect(callArgs?.contents[0]?.parts[1]).toMatchObject({
      inlineData: {
        mimeType: "image/jpeg",
      },
    });
  });

  it("generates a text-only meal draft", async () => {
    const generateContent = vi.fn<GeminiVisionClient["generateContent"]>(
      async () => ({
        modelVersion: "gemini-2.5-flash",
        candidates: [
          {
            content: {
              role: "model",
              parts: [
                {
                  text: JSON.stringify({
                    ...candidateOutput,
                    name: "2 scrambled eggs on toast",
                    caloriesKcal: 320,
                  }),
                },
              ],
            },
          },
        ],
      }),
    );
    const provider = new GeminiVisionProvider({
      apiKey: "test-key",
      model: "gemini-2.5-flash",
      timeoutMs: 5_000,
      maxOutputTokens: 500,
      externalAccess: true,
      client: { generateContent },
    });

    const result = await provider.generateTextDraft({
      userId: request.userId,
      description: "2 scrambled eggs on toast",
      requestId: "text-test",
    });
    expect(result.name).toBe("2 scrambled eggs on toast");
    expect(result.caloriesKcal).toBe(320);
    expect(result.provenance.inputKind).toBe("text");
  });

  it("refines an existing draft with user instructions", async () => {
    const generateContent = vi.fn<GeminiVisionClient["generateContent"]>(
      async () => ({
        modelVersion: "gemini-2.5-flash",
        candidates: [
          {
            content: {
              role: "model",
              parts: [
                {
                  text: JSON.stringify({
                    ...candidateOutput,
                    name: "Chicken and rice (double portion)",
                    caloriesKcal: 840,
                    proteinG: 76,
                  }),
                },
              ],
            },
          },
        ],
      }),
    );
    const provider = new GeminiVisionProvider({
      apiKey: "test-key",
      model: "gemini-2.5-flash",
      timeoutMs: 5_000,
      maxOutputTokens: 500,
      externalAccess: true,
      client: { generateContent },
    });

    const refineRequest: RefineFoodDraftRequest = {
      userId: request.userId,
      instruction: "double the portion",
      currentDraft: {
        ...candidateOutput,
        provenance: {
          inputKind: "photo",
          provider: "gemini",
          model: "gemini-2.5-flash",
          promptVersion: "nutrition-draft-v2",
        },
      },
      requestId: "refine-test",
    };

    const result = await provider.refineDraft(refineRequest);
    expect(result.caloriesKcal).toBe(840);
    expect(result.proteinG).toBe(76);
  });

  it("replaces medically unsafe meal draft outputs", async () => {
    const generateContent = vi.fn<GeminiVisionClient["generateContent"]>(
      async () => ({
        modelVersion: "gemini-2.5-flash",
        candidates: [
          {
            content: {
              role: "model",
              parts: [
                {
                  text: JSON.stringify({
                    ...candidateOutput,
                    name: "Eating disorder prescription medication meal",
                  }),
                },
              ],
            },
          },
        ],
      }),
    );
    const provider = new GeminiVisionProvider({
      apiKey: "test-key",
      model: "gemini-2.5-flash",
      timeoutMs: 5_000,
      maxOutputTokens: 500,
      externalAccess: true,
      client: { generateContent },
    });

    const result = await provider.generateDraft(request);
    expect(result.name).toBeNull();
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("safety policy")]),
    );
  });

  it("disables thinking tokens for gemini-3.7-flash with thinkingBudget: 0", async () => {
    const generateContent = vi.fn<GeminiVisionClient["generateContent"]>(
      async () => ({
        modelVersion: "gemini-3.7-flash",
        candidates: [
          {
            content: {
              role: "model",
              parts: [{ text: JSON.stringify(candidateOutput) }],
            },
          },
        ],
      }),
    );
    const provider = new GeminiVisionProvider({
      apiKey: "test-key",
      model: "gemini-3.7-flash",
      fallbackModel: "gemini-3.6-flash",
      thinkingBudget: 0,
      timeoutMs: 5_000,
      maxOutputTokens: 500,
      externalAccess: true,
      client: { generateContent },
    });

    const result = await provider.generateDraft(request);
    expect(result.name).toBe("Chicken and rice");
    expect(result.provenance.model).toBe("gemini-3.7-flash");

    // Verify thinkingConfig was passed in generationConfig with thinkingBudget: 0
    const callArgs = generateContent.mock.calls[0]?.[0];
    expect(callArgs?.generationConfig).toMatchObject({
      thinkingConfig: {
        thinkingBudget: 0,
      },
    });
  });

  it("automatically falls back to gemini-3.6-flash when gemini-3.7-flash reports 429 rate limit", async () => {
    const error429 = new Error("Resource has been exhausted / high demand");
    (error429 as { statusCode?: number }).statusCode = 429;

    const generateContent = vi
      .fn<GeminiVisionClient["generateContent"]>()
      .mockImplementation(async (req) => {
        if (req.model === "gemini-3.7-flash") {
          throw error429;
        }
        return {
          modelVersion: "gemini-3.6-flash",
          candidates: [
            {
              content: {
                role: "model",
                parts: [{ text: JSON.stringify(candidateOutput) }],
              },
            },
          ],
        };
      });

    const provider = new GeminiVisionProvider({
      apiKey: "test-key",
      model: "gemini-3.7-flash",
      fallbackModel: "gemini-3.6-flash",
      timeoutMs: 5_000,
      maxOutputTokens: 500,
      externalAccess: true,
      client: { generateContent },
      sleep: vi.fn(async () => {}),
    });

    const result = await provider.generateDraft(request);
    expect(result.name).toBe("Chicken and rice");
    expect(result.provenance.model).toBe("gemini-3.6-flash");

    // Verify both primary and fallback were called
    const calledModels = generateContent.mock.calls.map((c) => c[0].model);
    expect(calledModels).toContain("gemini-3.7-flash");
    expect(calledModels).toContain("gemini-3.6-flash");
  });

  it("automatically falls back to gemini-3.6-flash when gemini-3.7-flash reports 503 capacity exhausted", async () => {
    const error503 = new Error(
      "MODEL_CAPACITY_EXHAUSTED: No capacity available for model gemini-3.7-flash",
    );
    (error503 as { statusCode?: number }).statusCode = 503;

    const generateContent = vi
      .fn<GeminiVisionClient["generateContent"]>()
      .mockImplementation(async (req) => {
        if (req.model === "gemini-3.7-flash") {
          throw error503;
        }
        return {
          modelVersion: "gemini-3.6-flash",
          candidates: [
            {
              content: {
                role: "model",
                parts: [{ text: JSON.stringify(candidateOutput) }],
              },
            },
          ],
        };
      });

    const provider = new GeminiVisionProvider({
      apiKey: "test-key",
      model: "gemini-3.7-flash",
      fallbackModel: "gemini-3.6-flash",
      timeoutMs: 5_000,
      maxOutputTokens: 500,
      externalAccess: true,
      client: { generateContent },
      sleep: vi.fn(async () => {}),
    });

    const result = await provider.generateDraft(request);
    expect(result.name).toBe("Chicken and rice");
    expect(result.provenance.model).toBe("gemini-3.6-flash");
  });

  it("does not trigger fallback on client 400 errors", async () => {
    const error400 = new Error("Invalid image format");
    (error400 as { statusCode?: number }).statusCode = 400;

    const generateContent = vi
      .fn<GeminiVisionClient["generateContent"]>()
      .mockRejectedValue(error400);

    const provider = new GeminiVisionProvider({
      apiKey: "test-key",
      model: "gemini-3.7-flash",
      fallbackModel: "gemini-3.6-flash",
      timeoutMs: 5_000,
      maxOutputTokens: 500,
      externalAccess: true,
      client: { generateContent },
    });

    await expect(provider.generateDraft(request)).rejects.toMatchObject({
      kind: "invalid_request",
    });

    // Verify only primary was called (1 attempt, 0 fallback calls)
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(generateContent.mock.calls[0]?.[0].model).toBe("gemini-3.7-flash");
  });

  it("reconciles null point estimates from ranges and infers residual missing macro", async () => {
    const rawWithNullPointEstimates = {
      name: "Open-faced Ham Sandwiches",
      caloriesKcal: 485,
      proteinG: null,
      carbohydrateG: null,
      fatG: null,
      calorieRangeKcal: { low: 420, high: 550 },
      proteinRangeG: { low: 18, high: 25 },
      carbohydrateRangeG: { low: 35, high: 45 },
      fatRangeG: null,
      confidence: 0.8,
      warnings: [],
      assumptions: ["Two bread slices with ham and cheese."],
    };

    const generateContent = vi.fn<GeminiVisionClient["generateContent"]>(
      async () => ({
        modelVersion: "gemini-3.7-flash",
        candidates: [
          {
            content: {
              role: "model",
              parts: [{ text: JSON.stringify(rawWithNullPointEstimates) }],
            },
          },
        ],
      }),
    );

    const provider = new GeminiVisionProvider({
      apiKey: "test-key",
      model: "gemini-3.7-flash",
      timeoutMs: 5_000,
      maxOutputTokens: 500,
      externalAccess: true,
      client: { generateContent },
    });

    const result = await provider.generateDraft(request);
    // Protein derived from midpoint of 18..25 = 21.5
    expect(result.proteinG).toBe(21.5);
    // Carbs derived from midpoint of 35..45 = 40
    expect(result.carbohydrateG).toBe(40);
    // Calories 485 - (21.5 * 4 + 40 * 4 = 246) = 239 kcal / 9 = 26.6 g fat
    expect(result.fatG).toBe(26.6);
    expect(result.fatRangeG).not.toBeNull();
  });
});
