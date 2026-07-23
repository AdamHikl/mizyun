import { describe, expect, it, vi } from "vitest";
import type { AgentRequest } from "@mizyun/agent-runtime";
import type { MistralChatClient } from "./index.js";
import { MistralAgentProvider } from "./index.js";

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

const validResponse = {
  id: "request-1",
  model: "mistral-medium-2604",
  usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
  choices: [
    {
      finishReason: "stop",
      message: { parsed: { answer: "Your confirmed intake is 1,800 kcal." } },
    },
  ],
};

describe("MistralAgentProvider", () => {
  it("stays unavailable while external access is false", async () => {
    const provider = new MistralAgentProvider({
      apiKey: "test-key-that-is-long-enough",
      model: "mistral-medium-latest",
      timeoutMs: 5_000,
      maxOutputTokens: 1_000,
      externalAccess: false,
      client: { parse: vi.fn() },
    });
    await expect(provider.status()).resolves.toMatchObject({
      ready: false,
      provider: "mistral",
      externalAccess: false,
    });
    await expect(provider.respond(request)).rejects.toMatchObject({
      kind: "external_access_disabled",
    });
  });

  it("normalizes a structured response and excludes user identity from prompts", async () => {
    const parse = vi.fn(async () => validResponse);
    const provider = new MistralAgentProvider({
      apiKey: "test-key-that-is-long-enough",
      model: "mistral-medium-latest",
      timeoutMs: 5_000,
      maxOutputTokens: 1_000,
      externalAccess: true,
      client: { parse },
      now: (() => {
        let value = 0;
        return () => (value += 1_500);
      })(),
    });
    const response = await provider.respond(request);
    expect(response.message.text).toContain("1,800");
    expect(response.providerMetadata).toMatchObject({
      resolvedModel: "mistral-medium-2604",
      totalTokens: 120,
      latencyBucket: "1_to_3s",
    });
    expect(JSON.stringify(parse.mock.calls[0])).not.toContain(request.userId);
  });

  it("retries one transient failure and then succeeds", async () => {
    const transient = Object.assign(new Error("busy"), { statusCode: 503 });
    const parse = vi
      .fn<MistralChatClient["parse"]>()
      .mockRejectedValueOnce(transient)
      .mockResolvedValueOnce(validResponse);
    const provider = new MistralAgentProvider({
      apiKey: "test-key-that-is-long-enough",
      model: "mistral-medium-latest",
      timeoutMs: 5_000,
      maxOutputTokens: 1_000,
      externalAccess: true,
      client: { parse },
      sleep: async () => undefined,
    });
    await expect(provider.respond(request)).resolves.toMatchObject({
      provider: "mistral",
    });
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it("fails closed on malformed structured output", async () => {
    const provider = new MistralAgentProvider({
      apiKey: "test-key-that-is-long-enough",
      model: "mistral-medium-latest",
      timeoutMs: 5_000,
      maxOutputTokens: 1_000,
      externalAccess: true,
      client: { parse: async () => ({ choices: [] }) },
    });
    await expect(provider.respond(request)).rejects.toMatchObject({
      kind: "malformed_response",
    });
  });
});
