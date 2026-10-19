import { describe, expect, it, vi } from "vitest";
import {
  ACTIVITY_DRAFT_JSON_SCHEMA,
  ACTIVITY_DRAFT_PROMPT_VERSION,
  type ActivityDraftRequest,
} from "@mizyun/agent-runtime";
import { GeminiVisionProvider, type GeminiVisionClient } from "./vision.js";

const request: ActivityDraftRequest = {
  userId:
    "00000000-0000-4000-8000-000000000001" as ActivityDraftRequest["userId"],
  description: "did yardwork for 2 hours this morning",
  localDate: "2026-10-19",
  localTime: "15:10",
  requestId: "activity-test",
};

const output = {
  activityName: "Yardwork",
  durationSeconds: 7200,
  distance: null,
  date: "2026-10-19",
  startTime: null,
  endedNow: false,
  environment: null,
  note: null,
};

const reply = (body: unknown, extra: Record<string, unknown> = {}) => ({
  modelVersion: "gemini-3.8-flash",
  candidates: [
    {
      finishReason: "STOP",
      content: { role: "model", parts: [{ text: JSON.stringify(body) }] },
    },
  ],
  usageMetadata: { totalTokenCount: 321 },
  ...extra,
});

const provider = (
  generateContent: GeminiVisionClient["generateContent"],
  overrides: { externalAccess?: boolean; fallbackModel?: string } = {},
) =>
  new GeminiVisionProvider({
    apiKey: "test-key",
    model: "gemini-3.8-flash",
    timeoutMs: 5_000,
    maxOutputTokens: 2_000,
    externalAccess: overrides.externalAccess ?? true,
    ...(overrides.fallbackModel
      ? { fallbackModel: overrides.fallbackModel }
      : {}),
    client: { generateContent },
    sleep: async () => undefined,
  });

describe("Gemini activity drafts", () => {
  it("sends the shared policy, prompt and schema and returns the draft", async () => {
    const generateContent = vi.fn<GeminiVisionClient["generateContent"]>(
      async () => reply(output),
    );
    const draft =
      await provider(generateContent).generateActivityDraft(request);
    expect(draft).toEqual({
      ...output,
      provenance: {
        provider: "gemini",
        model: "gemini-3.8-flash",
        promptVersion: ACTIVITY_DRAFT_PROMPT_VERSION,
      },
      tokensUsed: 321,
    });
    const sent = generateContent.mock.calls[0]?.[0];
    expect(sent?.generationConfig?.responseJsonSchema).toBe(
      ACTIVITY_DRAFT_JSON_SCHEMA,
    );
    expect(sent?.generationConfig?.responseMimeType).toBe("application/json");
    expect(sent?.generationConfig?.temperature).toBe(0);
    // 3.8 may think at budget 0, so the full provider cap stays available.
    expect(sent?.generationConfig?.maxOutputTokens).toBe(2_000);
    expect(sent?.systemInstruction?.parts[0]?.text).toContain("Yardwork");
    const prompt = JSON.stringify(sent?.contents);
    expect(prompt).toContain("2026-10-19 (Monday)");
    expect(prompt).toContain("did yardwork for 2 hours this morning");
    // Data minimization: no account or request identifiers reach the model.
    expect(JSON.stringify(sent)).not.toContain(request.userId);
    expect(JSON.stringify(sent)).not.toContain("activity-test");
  });

  it("refuses when external access is disabled", async () => {
    const generateContent = vi.fn<GeminiVisionClient["generateContent"]>();
    await expect(
      provider(generateContent, {
        externalAccess: false,
      }).generateActivityDraft(request),
    ).rejects.toMatchObject({ kind: "external_access_disabled" });
    expect(generateContent).not.toHaveBeenCalled();
  });

  it("nulls out-of-bounds fields instead of failing the draft", async () => {
    const draft = await provider(async () =>
      reply({
        ...output,
        durationSeconds: 999_999,
        date: "2026-10-20",
        startTime: "25:00",
        distance: { value: 5, unit: "furlong" },
        environment: "moon",
        note: "x".repeat(200),
      }),
    ).generateActivityDraft(request);
    expect(draft).toMatchObject({
      activityName: "Yardwork",
      durationSeconds: null,
      date: null,
      startTime: null,
      distance: null,
      environment: null,
      note: null,
    });
  });

  it("reports malformed output", async () => {
    await expect(
      provider(async () => ({
        candidates: [
          {
            finishReason: "STOP",
            content: { parts: [{ text: "not json" }] },
          },
        ],
      })).generateActivityDraft(request),
    ).rejects.toMatchObject({ kind: "malformed_response" });
    await expect(
      provider(async () => ({
        candidates: [
          {
            finishReason: "MAX_TOKENS",
            content: { parts: [{ text: '{"activityName":' }] },
          },
        ],
      })).generateActivityDraft(request),
    ).rejects.toMatchObject({ kind: "malformed_response" });
  });

  it("reports a blocked prompt or safety stop as refused", async () => {
    await expect(
      provider(async () => ({
        promptFeedback: { blockReason: "SAFETY" },
      })).generateActivityDraft(request),
    ).rejects.toMatchObject({ kind: "refused" });
    await expect(
      provider(async () => ({
        candidates: [{ finishReason: "SAFETY" }],
      })).generateActivityDraft(request),
    ).rejects.toMatchObject({ kind: "refused" });
  });

  it("falls back to the fallback model when the primary is overloaded", async () => {
    const overloaded = Object.assign(new Error("overloaded"), { status: 503 });
    const generateContent = vi.fn<GeminiVisionClient["generateContent"]>(
      async (body) => {
        if (body.model === "gemini-3.8-flash") throw overloaded;
        return reply(output, { modelVersion: undefined });
      },
    );
    const draft = await provider(generateContent, {
      fallbackModel: "gemini-2.5-flash",
    }).generateActivityDraft(request);
    expect(draft.provenance.model).toBe("gemini-2.5-flash");
    expect(generateContent.mock.calls.map(([body]) => body.model)).toEqual([
      "gemini-3.8-flash",
      "gemini-2.5-flash",
    ]);
  });
});
