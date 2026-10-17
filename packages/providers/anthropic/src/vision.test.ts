import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import type {
  RefineFoodDraftRequest,
  VisionDraftRequest,
} from "@mizyun/agent-runtime";
import type { AnthropicMessagesClient } from "./client.js";
import {
  AnthropicVisionProvider,
  anthropicVisionOutputJsonSchema,
  textNutritionSystemPolicy,
  visionSystemPolicy,
  type AnthropicVisionProviderOptions,
} from "./vision.js";

type Params = Anthropic.MessageCreateParamsNonStreaming;

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
  portionWeightG: 320,
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
  calculation: "Chicken 150 g + rice 170 g.",
};

const message = (
  content: readonly unknown[],
  overrides: Record<string, unknown> = {},
): Anthropic.Message =>
  ({
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-haiku-5-5",
    content,
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: 60,
      output_tokens: 17,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
    },
    ...overrides,
  }) as unknown as Anthropic.Message;

const jsonMessage = (
  output: unknown,
  overrides: Record<string, unknown> = {},
): Anthropic.Message =>
  message([{ type: "text", text: JSON.stringify(output) }], overrides);

const statusError = (status: number): Error =>
  Object.assign(new Error(`HTTP ${status}`), { status });

const makeProvider = (
  responses: readonly (Anthropic.Message | Error)[],
  options: Partial<AnthropicVisionProviderOptions> = {},
) => {
  const create = vi.fn<AnthropicMessagesClient["create"]>();
  for (const response of responses) {
    if (response instanceof Error) create.mockRejectedValueOnce(response);
    else create.mockResolvedValueOnce(response);
  }
  const sleep = vi.fn(async (_milliseconds: number) => undefined);
  const provider = new AnthropicVisionProvider({
    apiKey: "synthetic-key",
    timeoutMs: 5_000,
    maxOutputTokens: 2_000,
    externalAccess: true,
    client: { create },
    random: () => 0.5,
    sleep,
    now: () => Date.parse("2026-10-17T08:00:00Z"),
    ...options,
  });
  const params = (index: number): Params => create.mock.calls[index]![0];
  return { provider, create, sleep, params };
};

const userContent = (params: Params) => {
  const last = params.messages.at(-1)!;
  expect(last.role).toBe("user");
  return last.content as unknown as readonly Record<string, unknown>[];
};

const textOfParams = (params: Params): string =>
  userContent(params)
    .filter((block) => block.type === "text")
    .map((block) => String(block.text))
    .join("\n");

const schemaOf = (params: Params) =>
  params.output_config?.format?.schema as Record<string, unknown> & {
    properties: Record<string, unknown>;
  };

/** Counts properties the way Claude's structured-output limits do. */
const complexity = (schema: unknown) => {
  let optional = 0;
  let unions = 0;
  const forbidden: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (typeof node !== "object" || node === null) return;
    const record = node as Record<string, unknown>;
    for (const key of [
      "minimum",
      "maximum",
      "multipleOf",
      "minLength",
      "maxLength",
      "maxItems",
      "nullable",
    ])
      if (key in record) forbidden.push(key);
    if (
      record.minItems !== undefined &&
      ![0, 1].includes(record.minItems as number)
    )
      forbidden.push("minItems");
    if (record.type === "object" && record.additionalProperties !== false)
      forbidden.push("open object");
    if (typeof record.properties === "object" && record.properties !== null) {
      const required = new Set((record.required as string[] | undefined) ?? []);
      for (const [key, value] of Object.entries(record.properties)) {
        if (!required.has(key)) optional += 1;
        const child = value as Record<string, unknown>;
        if (Array.isArray(child.type) || child.anyOf !== undefined) unions += 1;
        walk(child);
      }
    }
    if (record.items !== undefined) walk(record.items);
  };
  walk(schema);
  return { optional, unions, forbidden };
};

describe("AnthropicVisionProvider", () => {
  it("stays disabled when external access is false", async () => {
    const { provider, create } = makeProvider([], { externalAccess: false });
    expect(await provider.status()).toMatchObject({
      ready: false,
      provider: "anthropic-vision",
    });
    await expect(provider.generateDraft(request)).rejects.toMatchObject({
      kind: "external_access_disabled",
    });
    await expect(
      provider.generateTextDraft({
        userId: request.userId,
        description: "McDonald's fries",
      }),
    ).rejects.toMatchObject({ kind: "external_access_disabled" });
    expect(create).not.toHaveBeenCalled();
  });

  it("sends the image before the text with Haiku 5.5 controls and validates output", async () => {
    const { provider, create, params } = makeProvider([
      message([
        { type: "thinking", thinking: "", signature: "sig" },
        { type: "text", text: JSON.stringify(candidateOutput) },
      ]),
    ]);
    const result = await provider.generateDraft(request);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]![1]).toEqual({ timeoutMs: 5_000 });
    const sent = params(0);
    expect(sent.model).toBe("claude-haiku-5-5");
    expect(sent.max_tokens).toBe(2_000);
    for (const key of ["temperature", "top_p", "top_k", "tools", "fallbacks"])
      expect(sent).not.toHaveProperty(key);
    expect(sent.system).toBe(visionSystemPolicy);
    expect(sent.thinking).toEqual({ type: "disabled" });
    expect(sent.output_config).toMatchObject({
      effort: "low",
      format: { type: "json_schema" },
    });
    const content = userContent(sent);
    expect(content).toHaveLength(2);
    expect(content[0]).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: "/9j/4A==" },
    });
    expect(content[1]).toMatchObject({ type: "text" });
    expect(String(content[1]!.text)).toContain("chicken and rice");
    expect(schemaOf(sent).properties).not.toHaveProperty("additionalDrafts");
    expect(schemaOf(sent).properties).not.toHaveProperty("photoAdvice");
    expect(result).toMatchObject({
      name: "Chicken and rice",
      portionWeightG: 320,
      caloriesKcal: 420,
      calorieRangeKcal: { low: 380, high: 500 },
      calculation: "Chicken 150 g + rice 170 g.",
      tokensUsed: 77,
      provenance: {
        inputKind: "photo",
        provider: "anthropic",
        model: "claude-haiku-5-5",
        promptVersion: "nutrition-photo-v5",
      },
    });
  });

  it("derives omitted ranges from point estimates", async () => {
    const {
      calorieRangeKcal: _c,
      proteinRangeG: _p,
      ...withoutRanges
    } = candidateOutput;
    const { provider } = makeProvider([jsonMessage(withoutRanges)]);
    const result = await provider.generateDraft(request);
    expect(result.calorieRangeKcal).toEqual({ low: 357, high: 483 });
    expect(result.proteinRangeG).not.toBeNull();
  });

  it.each([
    ["schema-invalid", jsonMessage({ ...candidateOutput, confidence: 85 })],
    ["out-of-bounds", jsonMessage({ ...candidateOutput, caloriesKcal: -1 })],
    [
      "non-JSON",
      message([{ type: "text", text: "Here is your meal: chicken" }]),
    ],
    ["empty", message([])],
  ])("rejects %s output as malformed without retry", async (_label, reply) => {
    const { provider, create } = makeProvider([reply]);
    await expect(provider.generateDraft(request)).rejects.toMatchObject({
      kind: "malformed_response",
    });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("maps a refusal stop reason to a refused error", async () => {
    const { provider, create } = makeProvider([
      message([], { stop_reason: "refusal" }),
    ]);
    await expect(provider.generateDraft(request)).rejects.toMatchObject({
      kind: "refused",
      retryable: false,
    });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("treats max_tokens truncation as malformed even when text parses", async () => {
    const { provider } = makeProvider([
      jsonMessage(candidateOutput, { stop_reason: "max_tokens" }),
    ]);
    await expect(provider.generateDraft(request)).rejects.toMatchObject({
      kind: "malformed_response",
    });
  });

  it("retries a 429 once with bounded jitter", async () => {
    const { provider, create, sleep } = makeProvider([
      statusError(429),
      jsonMessage(candidateOutput),
    ]);
    const result = await provider.generateDraft(request);
    expect(result.name).toBe("Chicken and rice");
    expect(create).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(125);
    expect(create.mock.calls[1]![0].model).toBe("claude-haiku-5-5");
  });

  it("retries a 529 overload once and then surfaces it without a fallback model", async () => {
    const { provider, create } = makeProvider([
      statusError(529),
      statusError(529),
    ]);
    await expect(provider.generateDraft(request)).rejects.toMatchObject({
      kind: "unavailable",
    });
    expect(create).toHaveBeenCalledTimes(2);
    expect(new Set(create.mock.calls.map((call) => call[0].model))).toEqual(
      new Set(["claude-haiku-5-5"]),
    );
  });

  it("surfaces a second 429 as rate_limited", async () => {
    const { provider, create } = makeProvider([
      statusError(429),
      statusError(429),
    ]);
    await expect(provider.generateDraft(request)).rejects.toMatchObject({
      kind: "rate_limited",
      retryable: true,
    });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it.each([
    [statusError(400), "invalid_request"],
    [statusError(401), "authentication"],
    [new Anthropic.APIConnectionTimeoutError(), "timeout"],
  ] as const)("does not retry %s", async (error, kind) => {
    const { provider, create, sleep } = makeProvider([
      error,
      jsonMessage(candidateOutput),
    ]);
    await expect(provider.generateDraft(request)).rejects.toMatchObject({
      kind,
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("rejects too many or empty photos before calling the provider", async () => {
    const { provider, create } = makeProvider([]);
    await expect(
      provider.generateDraft({
        ...request,
        additionalPhotos: Array.from({ length: 3 }, () => ({
          photo: new Uint8Array([1]),
          mimeType: "image/png" as const,
        })),
      }),
    ).rejects.toMatchObject({ kind: "invalid_request" });
    await expect(
      provider.generateDraft({ ...request, photo: new Uint8Array() }),
    ).rejects.toMatchObject({ kind: "invalid_request" });
    expect(create).not.toHaveBeenCalled();
  });

  it("replaces medically unsafe meal draft outputs", async () => {
    const { provider } = makeProvider([
      jsonMessage({ ...candidateOutput, name: "Diagnose your disorder" }),
    ]);
    const result = await provider.generateDraft(request);
    expect(result.name).toBeNull();
    expect(result.caloriesKcal).toBeNull();
    expect(result.warnings.at(-1)).toContain("safety policy");
  });

  it("honours effort and thinking options", async () => {
    const { provider, params } = makeProvider([jsonMessage(candidateOutput)], {
      effort: "medium",
      thinking: true,
      model: "claude-haiku-5-5",
    });
    await provider.generateDraft(request);
    expect(params(0).thinking).toEqual({ type: "adaptive" });
    expect(params(0).output_config?.effort).toBe("medium");
  });
});

describe("Anthropic structured-output schema limits", () => {
  const variants = [false, true].flatMap((includeAdvancedNutrition) =>
    [false, true].flatMap((allowAdditionalDrafts) =>
      [false, true].map((allowPhotoAdvice) => ({
        includeAdvancedNutrition,
        allowAdditionalDrafts,
        allowPhotoAdvice,
      })),
    ),
  );
  it.each(variants)(
    "stays within 24 optional / 16 union properties for %j",
    (variant) => {
      const counts = complexity(anthropicVisionOutputJsonSchema(variant));
      expect(counts.forbidden).toEqual([]);
      expect(counts.optional).toBeLessThanOrEqual(24);
      expect(counts.unions).toBeLessThanOrEqual(16);
    },
  );
  it("records the worst-case counts", () => {
    expect(
      complexity(
        anthropicVisionOutputJsonSchema({
          includeAdvancedNutrition: true,
          allowAdditionalDrafts: true,
          allowPhotoAdvice: true,
        }),
      ),
    ).toEqual({ optional: 22, unions: 12, forbidden: [] });
  });
});

describe("Anthropic advanced nutrient drafts", () => {
  const advancedOutput = {
    ...candidateOutput,
    fibreG: 4.567,
    saturatedFatG: 0,
    totalSugarsG: null,
    sodiumMg: 812.345,
    cholesterolMg: null,
  };
  it("requests and keeps advanced values only with the server opt-in", async () => {
    const enabled = makeProvider([jsonMessage(advancedOutput)]);
    const result = await enabled.provider.generateDraft({
      ...request,
      includeAdvancedNutrition: true,
    });
    expect(schemaOf(enabled.params(0)).required).toContain("sodiumMg");
    expect(enabled.params(0).system).toContain(
      "Never derive advanced nutrients",
    );
    expect(result).toMatchObject({
      fibreG: 4.57,
      saturatedFatG: 0,
      totalSugarsG: null,
      sodiumMg: 812.35,
      cholesterolMg: null,
    });

    const disabled = makeProvider([jsonMessage(advancedOutput)]);
    const basic = await disabled.provider.generateDraft(request);
    expect(schemaOf(disabled.params(0)).properties).not.toHaveProperty(
      "sodiumMg",
    );
    expect(basic).not.toHaveProperty("sodiumMg");
  });

  it("clears only contradictory advanced values", async () => {
    const { provider } = makeProvider([
      jsonMessage({ ...advancedOutput, saturatedFatG: 20, fatG: 9 }),
    ]);
    const result = await provider.generateDraft({
      ...request,
      includeAdvancedNutrition: true,
    });
    expect(result.saturatedFatG).toBeNull();
    expect(result.fibreG).toBe(4.57);
    expect(result.warnings.at(-1)).toContain("saturated fat exceeded");
  });
});

describe("Anthropic multi-photo inference", () => {
  const multiRequest: VisionDraftRequest = {
    ...request,
    additionalPhotos: [
      { photo: new Uint8Array([1, 2, 3]), mimeType: "image/png" },
      { photo: new Uint8Array([4, 5, 6]), mimeType: "image/webp" },
    ],
  };

  it("sends all angles in one inference before the text", async () => {
    const { provider, create, params } = makeProvider([
      jsonMessage(candidateOutput),
    ]);
    const result = await provider.generateDraft(multiRequest);
    expect(create).toHaveBeenCalledTimes(1);
    const content = userContent(params(0));
    expect(content.map((block) => block.type)).toEqual([
      "image",
      "image",
      "image",
      "text",
    ]);
    expect(content[1]).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: "AQID" },
    });
    expect(params(0).system).toContain("count each edible component once");
    expect(schemaOf(params(0)).properties).toHaveProperty("additionalDrafts");
    expect(result).not.toHaveProperty("additionalDrafts");
  });

  it("normalizes distinct meals separately with shared provenance and one token count", async () => {
    const { provider } = makeProvider([
      jsonMessage({
        ...candidateOutput,
        additionalDrafts: [
          {
            name: "Apple",
            caloriesKcal: 95,
            proteinG: 0.5,
            carbohydrateG: 25,
            fatG: 0.3,
            confidence: 0.7,
            warnings: [],
            assumptions: ["One medium apple."],
          },
        ],
      }),
    ]);
    const result = await provider.generateDraft(multiRequest);
    expect(result.tokensUsed).toBe(77);
    expect(result.additionalDrafts).toHaveLength(1);
    const apple = result.additionalDrafts![0]!;
    expect(apple).toMatchObject({
      name: "Apple",
      portionWeightG: null,
      calculation: null,
      calorieRangeKcal: { low: 75, high: 115 },
      provenance: { provider: "anthropic", inputKind: "photo" },
    });
    expect(apple).not.toHaveProperty("tokensUsed");
  });

  it("rejects a malformed additional meal instead of silently dropping it", async () => {
    const { provider } = makeProvider([
      jsonMessage({
        ...candidateOutput,
        additionalDrafts: [{ name: "Apple", confidence: 3 }],
      }),
    ]);
    await expect(provider.generateDraft(multiRequest)).rejects.toMatchObject({
      kind: "malformed_response",
    });
  });

  it("allows screened Coach visual advice only for Coach requests", async () => {
    const coach = makeProvider([
      jsonMessage({
        ...candidateOutput,
        name: null,
        photoAdvice:
          "The lesion is melanoma. Take ibuprofen 800 mg twice daily.",
      }),
    ]);
    const result = await coach.provider.generateDraft({
      ...request,
      purpose: "coach",
    });
    expect(coach.params(0).system).toContain(
      "Only propose meal estimates when",
    );
    expect(schemaOf(coach.params(0)).properties).toHaveProperty("photoAdvice");
    expect(result.provenance.promptVersion).toBe("coach-photo-v1");
    expect(result.photoAdvice).toContain("qualified medical professional");
    expect(result.photoAdvice).not.toContain("800 mg");

    const meal = makeProvider([
      jsonMessage({ ...candidateOutput, photoAdvice: "Unsupported output" }),
    ]);
    expect(await meal.provider.generateDraft(request)).not.toHaveProperty(
      "photoAdvice",
    );
  });
});

describe("Anthropic text drafts", () => {
  const searchResult = {
    type: "web_search_tool_result",
    tool_use_id: "srvtoolu_1",
    content: [
      {
        type: "web_search_result",
        url: "https://example.test/nutrition",
        title: "Nutrition",
        encrypted_content: "enc",
        page_age: null,
      },
    ],
  };
  const searchMessage = (
    findings: string,
    result: unknown = searchResult,
    overrides: Record<string, unknown> = {},
  ) =>
    message(
      [
        {
          type: "server_tool_use",
          id: "srvtoolu_1",
          name: "web_search",
          input: { query: "Big Tasty Bacon SK nutrition" },
        },
        result,
        { type: "text", text: findings, citations: null },
      ],
      {
        usage: {
          input_tokens: 900,
          output_tokens: 100,
          cache_creation_input_tokens: null,
          cache_read_input_tokens: null,
        },
        ...overrides,
      },
    );
  const brandOutput = {
    ...candidateOutput,
    name: "Single Big Tasty Bacon",
    caloriesKcal: 588,
    proteinG: 33,
    carbohydrateG: 42,
    fatG: 31,
  };
  const brandRequest = {
    userId: request.userId,
    description: "McDonald's Single Big Tasty Bacon",
    countryCode: "SK",
  };

  it("drafts ordinary meals in one structured call without tools", async () => {
    const { provider, create, params } = makeProvider([
      jsonMessage(candidateOutput),
    ]);
    const result = await provider.generateTextDraft({
      userId: request.userId,
      description: "Grilled chicken with rice",
      countryCode: "SK",
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(params(0)).not.toHaveProperty("tools");
    expect(params(0).system).toBe(textNutritionSystemPolicy);
    expect(textOfParams(params(0))).toContain("(country: SK)");
    expect(result.provenance).toMatchObject({
      inputKind: "text",
      promptVersion: "nutrition-draft-v4",
    });
  });

  it("runs a dated web search pass and then a structured pass over the findings", async () => {
    const { provider, create, params } = makeProvider([
      searchMessage("Official McDonald's SK Single Big Tasty Bacon: 588 kcal."),
      jsonMessage(brandOutput),
    ]);
    const result = await provider.generateTextDraft(brandRequest);
    expect(create).toHaveBeenCalledTimes(2);

    const search = params(0);
    expect(search.tools).toEqual([
      { type: "web_search_20250305", name: "web_search", max_uses: 3 },
    ]);
    expect(search.output_config).toEqual({ effort: "low" });
    expect(search.system).toContain("Today's date is 2026-10-17.");
    expect(search.messages.at(-1)!.role).toBe("user");
    expect(String(search.messages[0]!.content)).toContain(
      "Search the web for official published nutrition facts",
    );
    expect(String(search.messages[0]!.content)).toContain("(SK)");
    for (const key of ["temperature", "top_p", "top_k"])
      expect(search).not.toHaveProperty(key);

    const structured = params(1);
    expect(structured).not.toHaveProperty("tools");
    expect(structured.output_config?.format?.type).toBe("json_schema");
    expect(structured.system).toBe(textNutritionSystemPolicy);
    expect(textOfParams(structured)).toContain("Verified search findings:");
    expect(textOfParams(structured)).toContain("588 kcal");
    expect(result.caloriesKcal).toBe(588);
    expect(result.tokensUsed).toBe(1_000 + 77);
  });

  it("uses findings produced before a pause_turn without continuing", async () => {
    const { provider, create, params } = makeProvider([
      searchMessage("Partial findings: 588 kcal.", searchResult, {
        stop_reason: "pause_turn",
      }),
      jsonMessage(brandOutput),
    ]);
    await provider.generateTextDraft(brandRequest);
    expect(create).toHaveBeenCalledTimes(2);
    expect(textOfParams(params(1))).toContain("Partial findings");
  });

  it.each([
    [
      "a web search error result",
      searchMessage("I could not search.", {
        type: "web_search_tool_result",
        tool_use_id: "srvtoolu_1",
        content: {
          type: "web_search_tool_result_error",
          error_code: "unavailable",
        },
      }),
    ],
    [
      "an answer without any search",
      message([{ type: "text", text: "From memory: 600 kcal." }]),
    ],
    ["a refused search", message([], { stop_reason: "refusal" })],
    ["a rejected search request", statusError(400)],
  ])(
    "falls back to a description-only draft after %s",
    async (_label, first) => {
      const { provider, create, params } = makeProvider([
        first,
        jsonMessage(brandOutput),
      ]);
      const result = await provider.generateTextDraft(brandRequest);
      expect(create).toHaveBeenCalledTimes(2);
      expect(params(1)).not.toHaveProperty("tools");
      expect(textOfParams(params(1))).toContain("user description only");
      expect(textOfParams(params(1))).not.toContain("Verified search findings");
      expect(result.name).toBe("Single Big Tasty Bacon");
    },
  );

  it("keeps advanced opt-in across the search and structured passes", async () => {
    const { provider, params } = makeProvider([
      searchMessage("Sodium 1200 mg."),
      jsonMessage({
        ...brandOutput,
        fibreG: 3,
        saturatedFatG: 12,
        totalSugarsG: 9,
        sodiumMg: 1200,
        cholesterolMg: 90,
      }),
    ]);
    const result = await provider.generateTextDraft({
      ...brandRequest,
      includeAdvancedNutrition: true,
    });
    expect(String(params(0).messages[0]!.content)).toContain("sodium");
    expect(schemaOf(params(1)).required).toContain("sodiumMg");
    expect(result.sodiumMg).toBe(1200);
  });

  it("skips web search when enableWebSearch is false", async () => {
    const { provider, create, params } = makeProvider(
      [jsonMessage(brandOutput)],
      { enableWebSearch: false },
    );
    await provider.generateTextDraft(brandRequest);
    expect(create).toHaveBeenCalledTimes(1);
    expect(params(0)).not.toHaveProperty("tools");
  });
});

describe("Anthropic draft refinement", () => {
  const currentDraft: RefineFoodDraftRequest["currentDraft"] = {
    ...candidateOutput,
    provenance: {
      inputKind: "photo",
      provider: "anthropic",
      model: "claude-haiku-5-5",
      promptVersion: "nutrition-photo-v5",
    },
  };

  it("refines with the current values and keeps the input kind", async () => {
    const { provider, params } = makeProvider([
      jsonMessage({
        ...candidateOutput,
        portionWeightG: 640,
        caloriesKcal: 840,
      }),
    ]);
    const result = await provider.refineDraft({
      userId: request.userId,
      currentDraft,
      instruction: "double the portion",
    });
    const prompt = textOfParams(params(0));
    expect(prompt).toContain("Calories: 420 kcal");
    expect(prompt).toContain("Current calculation: Chicken 150 g");
    expect(prompt).toContain('User instruction: "double the portion"');
    expect(params(0).system).toContain("refining an existing meal draft");
    expect(result.caloriesKcal).toBe(840);
    expect(result.provenance).toMatchObject({
      inputKind: "photo",
      promptVersion: "nutrition-draft-refine-v3",
    });
  });

  it("rejects a too-short instruction without calling the provider", async () => {
    const { provider, create } = makeProvider([]);
    await expect(
      provider.refineDraft({
        userId: request.userId,
        currentDraft,
        instruction: " x ",
      }),
    ).rejects.toMatchObject({ kind: "invalid_request" });
    expect(create).not.toHaveBeenCalled();
  });
});
