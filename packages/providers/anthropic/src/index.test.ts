import type Anthropic from "@anthropic-ai/sdk";
import { APIError } from "@anthropic-ai/sdk";
import type { AgentRequest } from "@mizyun/agent-runtime";
import { describe, expect, it } from "vitest";

import {
  AnthropicAgentProvider,
  AnthropicKeywordContentScreen,
  type AnthropicMessagesClient,
} from "./index.js";
import { toAnthropicJsonSchema } from "./client.js";

const message = (
  content: Anthropic.ContentBlock[],
  stop: Anthropic.StopReason = "end_turn",
): Anthropic.Message =>
  ({
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-haiku-5-5",
    content,
    stop_reason: stop,
    stop_sequence: null,
    usage: {
      input_tokens: 100,
      output_tokens: 20,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
  }) as unknown as Anthropic.Message;

const text = (value: string): Anthropic.ContentBlock =>
  ({ type: "text", text: value, citations: null }) as Anthropic.ContentBlock;

const fakeClient = (
  responses: ReadonlyArray<Anthropic.Message | Error>,
): AnthropicMessagesClient & {
  calls: Anthropic.MessageCreateParamsNonStreaming[];
} => {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  let index = 0;
  return {
    calls,
    create: async (params) => {
      calls.push(params);
      const next = responses[Math.min(index, responses.length - 1)];
      index += 1;
      if (next instanceof Error) throw next;
      return next as Anthropic.Message;
    },
  };
};

const request = (overrides: Partial<AgentRequest> = {}): AgentRequest =>
  ({
    userId: "user-1",
    conversationId: "conversation-1",
    messages: [{ role: "user", text: "How much protein should I eat?" }],
    memories: [],
    grounding: [],
    systemPolicy: "Coach policy.",
    promptVersion: "coach-test",
    ...overrides,
  }) as AgentRequest;

const provider = (
  client: AnthropicMessagesClient,
  extra: Partial<ConstructorParameters<typeof AnthropicAgentProvider>[0]> = {},
) =>
  new AnthropicAgentProvider({
    apiKey: "test-key",
    timeoutMs: 1_000,
    maxOutputTokens: 1_024,
    externalAccess: true,
    client,
    sleep: async () => undefined,
    random: () => 0,
    ...extra,
  });

const statusError = (status: number): Error =>
  new APIError(status, undefined, `HTTP ${status}`, new Headers());

describe("AnthropicAgentProvider", () => {
  it("sends Haiku 5.5-compatible controls and returns plain text", async () => {
    const client = fakeClient([message([text("Aim for 1.6 g/kg.")])]);
    const response = await provider(client).respond(request());

    expect(response.message.text).toBe("Aim for 1.6 g/kg.");
    expect(response.provider).toBe("anthropic");
    const sent = client.calls[0]!;
    expect(sent.model).toBe("claude-haiku-5-5");
    expect(sent).not.toHaveProperty("temperature");
    expect(sent.thinking).toEqual({ type: "disabled" });
    expect(sent.output_config).toEqual({ effort: "low" });
    expect(sent.messages[0]?.role).toBe("user");
    expect(sent.messages.at(-1)?.role).toBe("user");
    expect(response.providerMetadata).toMatchObject({
      promptTokens: 100,
      completionTokens: 20,
      totalTokens: 120,
    });
  });

  it("returns tool calls and replays them as tool_use/tool_result blocks", async () => {
    const tools = [
      {
        name: "get_active_goal",
        description: "Active goal",
        parameters: { type: "object", properties: {} },
      },
    ];
    const toolUse = {
      type: "tool_use",
      id: "toolu_1",
      name: "get_active_goal",
      input: {},
    } as unknown as Anthropic.ContentBlock;
    const client = fakeClient([
      message([toolUse], "tool_use"),
      message([text("Your goal is maintenance.")]),
    ]);
    const agent = provider(client);

    const first = await agent.respond(request({ tools }));
    expect(first.toolCalls).toEqual([
      { id: "toolu_1", name: "get_active_goal", args: {} },
    ]);
    expect(client.calls[0]?.tool_choice).toEqual({ type: "auto" });

    const evidence = {
      kind: "goal",
      label: "Goal",
      confirmed: true,
      freshness: "now",
      data: { mode: "maintain" },
    } as const;
    const second = await agent.respond(
      request({
        tools,
        requestedToolCalls: first.toolCalls,
        toolResults: [{ id: "toolu_1", name: "get_active_goal", evidence }],
      }),
    );
    expect(second.message.text).toBe("Your goal is maintenance.");
    const replay = client.calls[1]!.messages;
    expect(replay.at(-2)).toEqual({
      role: "assistant",
      content: [
        { type: "tool_use", id: "toolu_1", name: "get_active_goal", input: {} },
      ],
    });
    expect(replay.at(-1)).toEqual({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_1",
          content: JSON.stringify({ evidence }),
        },
      ],
    });
  });

  it("declares replayed tools with tool_choice none once the budget is spent", async () => {
    const client = fakeClient([message([text("Done.")])]);
    await provider(client).respond(
      request({
        requestedToolCalls: [
          { id: "toolu_1", name: "get_active_goal", args: {} },
        ],
        toolResults: [
          {
            id: "toolu_1",
            name: "get_active_goal",
            evidence: {
              kind: "goal",
              label: "Goal",
              confirmed: true,
              freshness: "now",
              data: {},
            },
          },
        ],
      }),
    );
    expect(client.calls[0]?.tool_choice).toEqual({ type: "none" });
    expect(client.calls[0]?.tools).toHaveLength(1);
  });

  it("drops empty and trailing assistant turns so the request never ends in a prefill", async () => {
    const client = fakeClient([message([text("Answer.")])]);
    await provider(client).respond(
      request({
        messages: [
          { role: "user", text: "Older question" },
          { role: "assistant", text: "" },
          { role: "user", text: "Newer question" },
          { role: "assistant", text: "Newer answer" },
        ],
      }),
    );
    const sent = client.calls[0]!.messages;
    expect(sent.at(-1)).toEqual({ role: "user", content: "Newer question" });
    expect(sent.some((m) => m.content === "")).toBe(false);
  });

  it("rejects truncated tool calls instead of executing partial arguments", async () => {
    const toolUse = {
      type: "tool_use",
      id: "toolu_1",
      name: "get_active_goal",
      input: {},
    } as unknown as Anthropic.ContentBlock;
    const client = fakeClient([message([toolUse], "max_tokens")]);
    await expect(
      provider(client).respond(
        request({
          tools: [
            { name: "get_active_goal", description: "Goal", parameters: {} },
          ],
        }),
      ),
    ).rejects.toMatchObject({ kind: "malformed_response" });
  });

  it("maps refusal stop reasons to a non-retryable refused error", async () => {
    const client = fakeClient([message([], "refusal")]);
    await expect(provider(client).respond(request())).rejects.toMatchObject({
      kind: "refused",
      retryable: false,
    });
  });

  it("retries once on 529 overload, then succeeds", async () => {
    const client = fakeClient([statusError(529), message([text("Ok.")])]);
    const response = await provider(client).respond(request());
    expect(response.message.text).toBe("Ok.");
    expect(client.calls).toHaveLength(2);
  });

  it("does not retry authentication failures", async () => {
    const client = fakeClient([statusError(401)]);
    await expect(provider(client).respond(request())).rejects.toMatchObject({
      kind: "authentication",
    });
    expect(client.calls).toHaveLength(1);
  });

  it("treats truncated output as malformed", async () => {
    const client = fakeClient([message([text("Partial")], "max_tokens")]);
    await expect(provider(client).respond(request())).rejects.toMatchObject({
      kind: "malformed_response",
    });
  });

  it("never calls the API when external access is disabled", async () => {
    const client = fakeClient([message([text("x")])]);
    const agent = provider(client, { externalAccess: false });
    expect((await agent.status()).ready).toBe(false);
    await expect(agent.respond(request())).rejects.toMatchObject({
      kind: "external_access_disabled",
    });
    expect(client.calls).toHaveLength(0);
  });

  // #309: after tool rounds Haiku sometimes adds a preface and then the
  // Gemini-style {"answer": …} envelope, which reached the chat as raw JSON.
  it.each([
    [
      "separate blocks",
      [
        text("I've put together a 45-minute leg session."),
        text('{"answer": "Here is your leg session: squats 4x6."}'),
      ],
    ],
    [
      "one block with a fenced envelope",
      [
        text(
          'I\'ve put together a 45-minute leg session.\n\n```json\n{"answer": "Here is your leg session: squats 4x6."}\n```',
        ),
      ],
    ],
  ])(
    "unwraps a JSON answer envelope after a preface (%s)",
    async (_label, blocks) => {
      const response = await provider(
        fakeClient([message(blocks as Anthropic.ContentBlock[])]),
      ).respond(request());
      expect(response.message.text).toBe(
        "Here is your leg session: squats 4x6.",
      );
    },
  );

  // #309: the same unwrapping applies to the final reply after tool results.
  it.each([
    ["a pure JSON envelope", '{"answer": "Squats 4x6, then lunges 3x10."}'],
    [
      "a sentence followed by a JSON envelope",
      'I checked your routines and history.\n{"answer": "Squats 4x6, then lunges 3x10."}',
    ],
  ])("unwraps %s after tool results", async (_label, finalText) => {
    const client = fakeClient([message([text(finalText)])]);
    const response = await provider(client).respond(
      request({
        requestedToolCalls: [
          { id: "toolu_1", name: "get_available_routines", args: {} },
        ],
        toolResults: [
          {
            id: "toolu_1",
            name: "get_available_routines",
            evidence: {
              kind: "training",
              label: "Routines",
              confirmed: true,
              freshness: "now",
              data: { routines: [] },
            },
          },
        ],
      }),
    );
    expect(response.message.text).toBe("Squats 4x6, then lunges 3x10.");
  });

  it("keeps conversational text that merely contains braces", async () => {
    const reply = 'Log it as {"answer": 1} only if you weigh it.';
    const response = await provider(
      fakeClient([message([text(reply)])]),
    ).respond(request());
    expect(response.message.text).toBe(reply);
  });

  it("replaces unsafe provider output with the safety message", async () => {
    const client = fakeClient([message([text("I diagnose you with X.")])]);
    const response = await provider(client).respond(request());
    expect(response.provider).toBe("mizyun-safety");
  });
});

describe("AnthropicKeywordContentScreen", () => {
  it("blocks self-harm language locally", async () => {
    const moderator = new AnthropicKeywordContentScreen({
      externalAccess: true,
    });
    await expect(
      moderator.moderateText({
        text: "I want to kill myself",
        direction: "input",
      }),
    ).resolves.toMatchObject({ allowed: false, category: "self_harm" });
  });
});

describe("toAnthropicJsonSchema", () => {
  it("removes unsupported constraints and closes objects", () => {
    expect(
      toAnthropicJsonSchema({
        type: "OBJECT",
        properties: {
          kcal: { type: "NUMBER", minimum: 0, maximum: 9000 },
          items: {
            type: "ARRAY",
            minItems: 3,
            maxItems: 10,
            items: {
              type: "OBJECT",
              properties: { name: { type: "STRING", maxLength: 80 } },
            },
          },
          note: { type: "STRING", nullable: true },
        },
        required: ["kcal"],
      }),
    ).toEqual({
      type: "object",
      properties: {
        kcal: { type: "number" },
        items: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            properties: { name: { type: "string" } },
            additionalProperties: false,
          },
        },
        note: { type: ["string", "null"] },
      },
      required: ["kcal"],
      additionalProperties: false,
    });
  });
});
