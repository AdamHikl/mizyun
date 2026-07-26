import { describe, expect, it, vi } from "vitest";

import type { VisionDraftRequest } from "@mizyun/agent-runtime";

import { MistralVisionProvider, type MistralVisionClient } from "./vision.js";

const request: VisionDraftRequest = {
  userId:
    "00000000-0000-4000-8000-000000000001" as VisionDraftRequest["userId"],
  photo: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
  mimeType: "image/jpeg" as const,
  textHint: "chicken and rice",
  requestId: "vision-test",
};

const providerWith = (candidate: Record<string, unknown>) => {
  const complete = vi.fn<MistralVisionClient["complete"]>(async () => ({
    model: "resolved-test-model",
    choices: [
      {
        message: {
          content: JSON.stringify({
            calorieRangeKcal: { low: 380, high: 500 },
            proteinRangeG: { low: 32, high: 44 },
            carbohydrateRangeG: { low: 38, high: 55 },
            fatRangeG: { low: 6, high: 13 },
            assumptions: ["Assumes one ordinary plate."],
            ...candidate,
          }),
        },
      },
    ],
  }));
  return {
    complete,
    provider: new MistralVisionProvider({
      apiKey: "test-key",
      model: "vision-test-model",
      timeoutMs: 5_000,
      maxOutputTokens: 500,
      externalAccess: true,
      client: { complete },
    }),
  };
};

describe("MistralVisionProvider", () => {
  it("accepts an ordinary meal estimate below 800 kcal", async () => {
    const { complete, provider } = providerWith({
      name: "Chicken and rice",
      caloriesKcal: 420,
      proteinG: 38,
      carbohydrateG: 45,
      fatG: 9,
      confidence: 0.82,
      warnings: ["Confirm the portion size."],
    });

    await expect(provider.generateDraft(request)).resolves.toMatchObject({
      name: "Chicken and rice",
      caloriesKcal: 420,
      proteinG: 38,
    });

    const firstCall = complete.mock.calls[0]?.[0];
    const userMessage = firstCall?.messages[1];
    expect(userMessage?.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "image_url",
          imageUrl: expect.stringMatching(/^data:image\/jpeg;base64,/),
        }),
      ]),
    );
  });

  it("replaces medically loaded output with an editable empty draft", async () => {
    const { provider } = providerWith({
      name: "Diagnose this disorder",
      caloriesKcal: 420,
      proteinG: 38,
      carbohydrateG: 45,
      fatG: 9,
      confidence: 0.7,
      warnings: [],
    });

    await expect(provider.generateDraft(request)).resolves.toEqual({
      name: null,
      caloriesKcal: null,
      proteinG: null,
      carbohydrateG: null,
      fatG: null,
      calorieRangeKcal: null,
      proteinRangeG: null,
      carbohydrateRangeG: null,
      fatRangeG: null,
      confidence: 0.7,
      warnings: [
        "The AI suggestion was rejected by the safety policy. Please enter the values manually.",
      ],
      assumptions: [],
      provenance: {
        inputKind: "photo",
        provider: "mistral",
        model: "resolved-test-model",
        promptVersion: "nutrition-draft-v2",
      },
    });
  });

  it("creates a text draft with text provenance and no image block", async () => {
    const { complete, provider } = providerWith({
      name: "Oats and yogurt",
      caloriesKcal: 390,
      proteinG: 24,
      carbohydrateG: 52,
      fatG: 9,
      confidence: 0.75,
      warnings: ["Verify yogurt fat percentage."],
    });

    const result = await provider.generateTextDraft({
      userId: request.userId,
      description: "60g oats and 200g Greek yogurt",
    });

    expect(result.provenance.inputKind).toBe("text");
    expect(complete.mock.calls[0]?.[0].messages[1]?.content).toEqual(
      expect.any(String),
    );
  });
});
