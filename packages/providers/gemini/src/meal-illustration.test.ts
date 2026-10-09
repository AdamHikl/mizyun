import { describe, expect, it, vi } from "vitest";
import { GeminiMealIllustrationProvider } from "./meal-illustration.js";

describe("Gemini decorative image adapter", () => {
  it("sends only bounded dish text and receives inline bytes without grounding or retry", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  { inlineData: { mimeType: "image/png", data: "AQIDBA==" } },
                ],
              },
            },
          ],
        }),
      ),
    );
    const provider = new GeminiMealIllustrationProvider({
      apiKey: "synthetic-key",
      model: "gemini-3.1-flash-lite-image",
      fetch: fetcher,
    });
    expect(
      await provider.generate("toast", new AbortController().signal),
    ).toEqual(Buffer.from([1, 2, 3, 4]));
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, request] = fetcher.mock.calls[0]!;
    expect(url).toContain("gemini-3.1-flash-lite-image:generateContent");
    const body = JSON.parse(request.body);
    expect(body.tools).toBeUndefined();
    expect(body.generationConfig.responseModalities).toEqual(["IMAGE"]);
    expect(body.contents[0].parts[0].text).toContain('"toast"');
    expect(body.contents[0].parts).toHaveLength(1);
  });
  it.each([
    { candidates: [] },
    { candidates: [{ content: { parts: [{ text: "refused" }] } }] },
    {
      candidates: [
        {
          content: {
            parts: [
              { inlineData: { mimeType: "image/svg+xml", data: "AQIDBA==" } },
            ],
          },
        },
      ],
    },
    {
      candidates: [
        {
          content: {
            parts: [
              { inlineData: { mimeType: "image/png", data: "not base64" } },
            ],
          },
        },
      ],
    },
    {
      candidates: [
        {
          content: {
            parts: [
              { inlineData: { mimeType: "image/png", data: "AQID" } },
              { inlineData: { mimeType: "image/png", data: "AQID" } },
            ],
          },
        },
      ],
    },
  ])("rejects malformed or ambiguous image response %j", async (payload) => {
    const provider = new GeminiMealIllustrationProvider({
      apiKey: "synthetic-key",
      model: "gemini-3.1-flash-lite-image",
      fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify(payload))),
    });
    await expect(
      provider.generate("toast", new AbortController().signal),
    ).rejects.toThrow("Invalid illustration response");
  });
  it("bounds upstream bytes before JSON decode", async () => {
    const provider = new GeminiMealIllustrationProvider({
      apiKey: "synthetic-key",
      model: "gemini-3.1-flash-lite-image",
      fetch: vi
        .fn()
        .mockResolvedValue(
          new Response("{}", { headers: { "content-length": "6000001" } }),
        ),
    });
    await expect(
      provider.generate("toast", new AbortController().signal),
    ).rejects.toThrow("Invalid illustration response");
  });
  it("normalizes provider errors without exposing payload or secrets and never retries", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response("upstream private details", { status: 429 }),
      );
    const provider = new GeminiMealIllustrationProvider({
      apiKey: "synthetic-key",
      model: "gemini-3.1-flash-lite-image",
      fetch: fetcher,
    });
    await expect(
      provider.generate("toast", new AbortController().signal),
    ).rejects.toThrow("Meal illustration provider unavailable");
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
