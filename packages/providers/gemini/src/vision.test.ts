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
});
