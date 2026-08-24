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
});
