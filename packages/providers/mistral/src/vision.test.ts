import { describe, expect, it, vi } from "vitest";

import type {
  RefineFoodDraftRequest,
  VisionDraftRequest,
} from "@mizyun/agent-runtime";

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
  it("accepts the SDK chat.parse structured payload shape", async () => {
    const candidate = {
      name: "Synthetic meal",
      caloriesKcal: 300,
      proteinG: 20,
      carbohydrateG: 30,
      fatG: 10,
      calorieRangeKcal: { low: 250, high: 360 },
      proteinRangeG: { low: 16, high: 24 },
      carbohydrateRangeG: { low: 24, high: 38 },
      fatRangeG: { low: 7, high: 14 },
      confidence: 0.8,
      warnings: [],
      assumptions: ["One serving"],
    };
    const complete = vi.fn<MistralVisionClient["complete"]>(async () => ({
      model: "resolved-vision-model",
      choices: [{ message: { parsed: candidate } }],
    }));
    const provider = new MistralVisionProvider({
      apiKey: "test-key",
      model: "vision-test-model",
      timeoutMs: 5_000,
      maxOutputTokens: 500,
      externalAccess: true,
      client: { complete },
    });

    await expect(provider.generateDraft(request)).resolves.toMatchObject({
      name: "Synthetic meal",
      provenance: { model: "resolved-vision-model" },
    });
  });

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

  it("reconciles null point estimates from ranges and infers residual missing macro", async () => {
    const { provider } = providerWith({
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

describe("MistralVisionProvider.refineDraft (AI-ACT-007)", () => {
  const baselineCurrent = {
    name: "Grilled chicken" as const,
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
      provider: "stub",
      model: "stub",
      promptVersion: "nutrition-draft-v2",
    },
  };

  it("uses the refine prompt + prompt version and forwards the instruction", async () => {
    const complete = vi.fn<MistralVisionClient["complete"]>(async () => ({
      model: "resolved-vision-model",
      choices: [
        {
          message: {
            parsed: {
              name: "Grilled chicken (200g)",
              caloriesKcal: 600,
              proteinG: 100,
              carbohydrateG: 0,
              fatG: 20,
              calorieRangeKcal: { low: 480, high: 720 },
              proteinRangeG: { low: 80, high: 120 },
              carbohydrateRangeG: { low: 0, high: 10 },
              fatRangeG: { low: 14, high: 28 },
              confidence: 0.72,
              warnings: [],
              assumptions: ["Assumes 200g chicken breast."],
            },
          },
        },
      ],
    }));
    const provider = new MistralVisionProvider({
      apiKey: "test-key",
      model: "vision-test-model",
      timeoutMs: 5_000,
      maxOutputTokens: 500,
      externalAccess: true,
      client: { complete },
    });
    const refineRequest: RefineFoodDraftRequest = {
      userId: request.userId,
      currentDraft: baselineCurrent,
      instruction: "Make the chicken 200g instead of 100g",
    };
    const result = await provider.refineDraft(refineRequest);
    expect(result.caloriesKcal).toBe(600);
    expect(result.proteinG).toBe(100);
    expect(result.provenance).toMatchObject({
      inputKind: "text",
      provider: "mistral",
      promptVersion: "nutrition-draft-refine-v1",
    });
    const firstCall = complete.mock.calls[0]?.[0];
    const systemMessage = firstCall?.messages[0];
    expect(systemMessage?.content).toEqual(
      expect.stringContaining("refining an existing meal draft"),
    );
    const userMessage = firstCall?.messages[1];
    expect(userMessage?.content).toEqual(
      expect.stringContaining("Make the chicken 200g instead of 100g"),
    );
    expect(userMessage?.content).toEqual(
      expect.stringContaining("Grilled chicken"),
    );
  });

  it("replaces medically loaded refine output with an editable empty draft", async () => {
    const complete = vi.fn<MistralVisionClient["complete"]>(async () => ({
      model: "resolved-vision-model",
      choices: [
        {
          message: {
            parsed: {
              name: "Diagnose this disorder",
              caloriesKcal: 100,
              proteinG: 0,
              carbohydrateG: 0,
              fatG: 0,
              calorieRangeKcal: { low: 0, high: 100 },
              proteinRangeG: { low: 0, high: 0 },
              carbohydrateRangeG: { low: 0, high: 0 },
              fatRangeG: { low: 0, high: 0 },
              confidence: 0.6,
              warnings: [],
              assumptions: [],
            },
          },
        },
      ],
    }));
    const provider = new MistralVisionProvider({
      apiKey: "test-key",
      model: "vision-test-model",
      timeoutMs: 5_000,
      maxOutputTokens: 500,
      externalAccess: true,
      client: { complete },
    });
    const result = await provider.refineDraft({
      userId: request.userId,
      currentDraft: baselineCurrent,
      instruction: "double the portion",
    });
    expect(result).toMatchObject({
      name: null,
      caloriesKcal: null,
      proteinG: null,
      fatG: null,
      confidence: 0.6,
      provenance: {
        inputKind: "text",
        provider: "mistral",
        promptVersion: "nutrition-draft-refine-v1",
      },
    });
    expect(result.warnings[0]).toContain("safety policy");
  });

  it("refuses to refine when external access is disabled", async () => {
    const provider = new MistralVisionProvider({
      apiKey: "test-key",
      model: "vision-test-model",
      timeoutMs: 5_000,
      maxOutputTokens: 500,
      externalAccess: false,
    });
    await expect(
      provider.refineDraft({
        userId: request.userId,
        currentDraft: baselineCurrent,
        instruction: "double the portion",
      }),
    ).rejects.toMatchObject({ kind: "external_access_disabled" });
  });
});
