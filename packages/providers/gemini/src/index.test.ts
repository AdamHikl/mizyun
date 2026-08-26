import { describe, expect, it, vi } from "vitest";
import type { AgentRequest } from "@mizyun/agent-runtime";
import { GeminiAgentProvider, type GeminiChatClient } from "./index.js";

const request: AgentRequest = {
  userId: "00000000-0000-4000-8000-000000000001" as AgentRequest["userId"],
  conversationId:
    "00000000-0000-4000-8000-000000000002" as AgentRequest["conversationId"],
  messages: [{ role: "user", text: "How am I doing?" }],
  memories: [],
  grounding: [
    {
      kind: "nutrition",
      label: "Today",
      confirmed: true,
      freshness: "2026-07-23T10:00:00.000Z",
      data: { caloriesKcal: 1_800 },
    },
  ],
  systemPolicy: "Stay grounded.",
  promptVersion: "test-v1",
};

const validGeminiResponse = {
  candidates: [
    {
      content: {
        role: "model",
        parts: [
          {
            text: JSON.stringify({
              answer: "Your confirmed intake is 1,800 kcal.",
            }),
          },
        ],
      },
      finishReason: "STOP",
    },
  ],
  usageMetadata: {
    promptTokenCount: 100,
    candidatesTokenCount: 20,
    totalTokenCount: 120,
  },
  modelVersion: "gemini-2.5-flash",
};

describe("GeminiAgentProvider", () => {
  it("stays unavailable while external access is false", async () => {
    const provider = new GeminiAgentProvider({
      apiKey: "test-gemini-key-12345",
      model: "gemini-2.5-flash",
      timeoutMs: 5_000,
      maxOutputTokens: 1_000,
      externalAccess: false,
      client: { generateContent: vi.fn() },
    });
    await expect(provider.status()).resolves.toMatchObject({
      ready: false,
      provider: "gemini",
      externalAccess: false,
    });
    await expect(provider.respond(request)).rejects.toMatchObject({
      kind: "external_access_disabled",
    });
  });

  it("normalizes a structured response and excludes user identity from prompts", async () => {
    const generateContent = vi.fn<GeminiChatClient["generateContent"]>(
      async () => validGeminiResponse,
    );
    const provider = new GeminiAgentProvider({
      apiKey: "test-gemini-key-12345",
      model: "gemini-2.5-flash",
      timeoutMs: 5_000,
      maxOutputTokens: 1_000,
      externalAccess: true,
      client: { generateContent },
      now: (() => {
        let value = 0;
        return () => (value += 1_500);
      })(),
    });
    const response = await provider.respond(request);
    expect(response.message.text).toContain("1,800");
    expect(response.providerMetadata).toMatchObject({
      resolvedModel: "gemini-2.5-flash",
      totalTokens: 120,
      latencyBucket: "1_to_3s",
    });
    expect(JSON.stringify(generateContent.mock.calls[0])).not.toContain(
      request.userId,
    );
  });

  it("accepts plain text assistant responses and wraps them in answer", async () => {
    const generateContent = vi.fn<GeminiChatClient["generateContent"]>(
      async () => ({
        candidates: [
          {
            content: {
              role: "model",
              parts: [{ text: "Keep logging your meals consistently." }],
            },
            finishReason: "STOP",
          },
        ],
        usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 10 },
      }),
    );
    const provider = new GeminiAgentProvider({
      apiKey: "test-gemini-key-12345",
      model: "gemini-2.5-flash",
      timeoutMs: 5_000,
      maxOutputTokens: 1_000,
      externalAccess: true,
      client: { generateContent },
    });
    const response = await provider.respond(request);
    expect(response.message.text).toBe("Keep logging your meals consistently.");
  });

  it("handles tool calling functionCall parts", async () => {
    const generateContent = vi.fn<GeminiChatClient["generateContent"]>(
      async () => ({
        candidates: [
          {
            content: {
              role: "model",
              parts: [
                {
                  functionCall: {
                    name: "get_confirmed_nutrition",
                    args: { days: 7 },
                  },
                },
              ],
            },
            finishReason: "STOP",
          },
        ],
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 15 },
        modelVersion: "gemini-2.5-flash",
      }),
    );
    const provider = new GeminiAgentProvider({
      apiKey: "test-gemini-key-12345",
      model: "gemini-2.5-flash",
      timeoutMs: 5_000,
      maxOutputTokens: 1_000,
      externalAccess: true,
      client: { generateContent },
    });
    const response = await provider.respond({
      ...request,
      tools: [
        {
          name: "get_confirmed_nutrition",
          description: "Get nutrition summary",
          parameters: { type: "object" },
        },
      ],
    });
    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls?.[0]?.name).toBe("get_confirmed_nutrition");
    expect(response.toolCalls?.[0]?.args).toEqual({ days: 7 });
  });

  it("replaces unsafe medical diagnosis outputs with a safe fallback", async () => {
    const generateContent = vi.fn<GeminiChatClient["generateContent"]>(
      async () => ({
        candidates: [
          {
            content: {
              role: "model",
              parts: [
                {
                  text: JSON.stringify({
                    answer:
                      "I diagnose you with a muscle strain. Stop taking your medication.",
                  }),
                },
              ],
            },
            finishReason: "STOP",
          },
        ],
      }),
    );
    const provider = new GeminiAgentProvider({
      apiKey: "test-gemini-key-12345",
      model: "gemini-2.5-flash",
      timeoutMs: 5_000,
      maxOutputTokens: 1_000,
      externalAccess: true,
      client: { generateContent },
    });
    const response = await provider.respond(request);
    expect(response.provider).toBe("mizyun-safety");
    expect(response.message.text).toContain("could not safely answer");
  });

  it("retries on transient rate limit (429) errors", async () => {
    const error429 = new Error("Rate limit exceeded");
    (error429 as { statusCode?: number }).statusCode = 429;
    const generateContent = vi
      .fn<GeminiChatClient["generateContent"]>()
      .mockRejectedValueOnce(error429)
      .mockResolvedValueOnce(validGeminiResponse);

    const provider = new GeminiAgentProvider({
      apiKey: "test-gemini-key-12345",
      model: "gemini-2.5-flash",
      timeoutMs: 5_000,
      maxOutputTokens: 1_000,
      externalAccess: true,
      client: { generateContent },
      sleep: vi.fn(async () => {}),
    });
    const response = await provider.respond(request);
    expect(response.message.text).toContain("1,800");
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it("synthesizes clean message for structured workout_plan JSON instead of raw JSON", async () => {
    const generateContent = vi.fn<GeminiChatClient["generateContent"]>(
      async () => ({
        candidates: [
          {
            content: {
              role: "model",
              parts: [
                {
                  text: JSON.stringify({
                    response: {
                      workout_plan: {
                        focus: "hypertrophy",
                        goal: "V-shape (upper body emphasis with back and shoulder development)",
                        equipment: ["dumbbells", "barbell", "cable_machine"],
                        session_duration_minutes: 150,
                        sessions: [{ day: "Upper Body 1" }],
                      },
                    },
                  }),
                },
              ],
            },
            finishReason: "STOP",
          },
        ],
      }),
    );
    const provider = new GeminiAgentProvider({
      apiKey: "test-gemini-key-12345",
      model: "gemini-2.5-flash",
      timeoutMs: 5_000,
      maxOutputTokens: 1_000,
      externalAccess: true,
      client: { generateContent },
    });

    const response = await provider.respond(request);
    expect(response.message.text).not.toContain('{"response":');
    expect(response.message.text).not.toContain('"workout_plan":');
    expect(response.message.text).toContain("V-shape");
    expect(response.message.text).toContain(
      "Review the detailed training prescription below",
    );
  });

  it("captures thoughtSignature on tool calls and preserves it during Turn 2 replaying", async () => {
    let capturedRequestTurn1: unknown;
    let capturedRequestTurn2: unknown;

    const generateContent = vi
      .fn()
      .mockImplementationOnce(async (req) => {
        capturedRequestTurn1 = req;
        return {
          candidates: [
            {
              content: {
                role: "model",
                parts: [
                  {
                    thoughtSignature: "sig_abc123_xyz",
                    functionCall: {
                      id: "call_999",
                      name: "get_training_prescription",
                      args: { days_per_week: 3 },
                    },
                  },
                ],
              },
              finishReason: "STOP",
            },
          ],
        };
      })
      .mockImplementationOnce(async (req) => {
        capturedRequestTurn2 = req;
        return {
          candidates: [
            {
              content: {
                role: "model",
                parts: [
                  {
                    text: '{"answer":"Here is your 3-day workout plan"}',
                  },
                ],
              },
              finishReason: "STOP",
            },
          ],
        };
      });

    const provider = new GeminiAgentProvider({
      apiKey: "test-gemini-key-12345",
      model: "gemini-3.6-flash",
      timeoutMs: 5_000,
      maxOutputTokens: 1_000,
      externalAccess: true,
      client: { generateContent },
    });

    const res1 = await provider.respond({
      ...request,
      tools: [
        {
          name: "get_training_prescription",
          description: "Get prescription",
          parameters: { type: "object" },
        },
      ],
    });

    expect(res1.toolCalls).toHaveLength(1);
    expect(res1.toolCalls![0]!).toMatchObject({
      id: "call_999",
      name: "get_training_prescription",
      args: { days_per_week: 3 },
      thoughtSignature: "sig_abc123_xyz",
    });

    const res2 = await provider.respond({
      ...request,
      requestedToolCalls: res1.toolCalls,
      toolResults: [
        {
          id: "call_999",
          name: "get_training_prescription",
          evidence: {
            kind: "training",
            label: "Prescription",
            confirmed: true,
            freshness: "2026-08-25T00:00:00Z",
            data: { sessions: 3 },
          },
        },
      ],
    });

    expect(res2.message.text).toBe("Here is your 3-day workout plan");

    const turn2Req = capturedRequestTurn2 as {
      contents: { role: string; parts: Record<string, unknown>[] }[];
      tools?: unknown;
      generationConfig?: Record<string, unknown>;
    };

    const replayedModelPart = turn2Req.contents.find(
      (c) => c.role === "model" && c.parts[0]?.functionCall !== undefined,
    )?.parts[0];

    expect(replayedModelPart).toMatchObject({
      thoughtSignature: "sig_abc123_xyz",
      functionCall: {
        id: "call_999",
        name: "get_training_prescription",
        args: { days_per_week: 3 },
      },
    });

    expect(turn2Req.tools).toBeDefined();
    expect(turn2Req.generationConfig?.responseSchema).toBeUndefined();
  });
});
