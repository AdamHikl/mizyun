import { describe, expect, it, vi } from "vitest";

import {
  MistralContentModerator,
  type MistralModerationClient,
} from "./moderation.js";

const response = (
  categories: Readonly<Record<string, boolean>>,
  categoryScores: Readonly<Record<string, number>>,
) => ({
  id: "mod-test",
  model: "mistral-moderation-2603",
  results: [{ categories, categoryScores }],
});

const moderator = (client: MistralModerationClient, externalAccess = true) =>
  new MistralContentModerator({
    apiKey: "test-key-that-is-long-enough",
    model: "mistral-moderation-2603",
    timeoutMs: 5_000,
    externalAccess,
    client,
  });

describe("MistralContentModerator", () => {
  it("allows text when every provider category decision is false", async () => {
    const moderate = vi.fn(async () =>
      response(
        { dangerous: false, health: false, selfharm: false },
        { dangerous: 0.01, health: 0.02, selfharm: 0.001 },
      ),
    );

    await expect(
      moderator({ moderate }).moderateText({
        text: "Give one general wellness reminder.",
        direction: "input",
      }),
    ).resolves.toEqual({
      allowed: true,
      provider: "mistral",
      model: "mistral-moderation-2603",
    });
    expect(moderate).toHaveBeenCalledWith(
      {
        model: "mistral-moderation-2603",
        inputs: "Give one general wellness reminder.",
      },
      { timeoutMs: 5_000 },
    );
  });

  it("selects the highest-scoring category among provider-blocked categories", async () => {
    const moderate = vi.fn(async () =>
      response(
        { dangerous: true, criminal: true, health: false },
        { dangerous: 0.71, criminal: 0.94, health: 0.12 },
      ),
    );

    await expect(
      moderator({ moderate }).moderateText({
        text: "A synthetic blocked request.",
        direction: "output",
      }),
    ).resolves.toEqual({
      allowed: false,
      provider: "mistral",
      model: "mistral-moderation-2603",
      category: "criminal",
    });
  });

  it("rejects malformed responses instead of guessing a decision", async () => {
    const moderate = vi.fn(async () =>
      response({ dangerous: true, health: false }, { dangerous: 0.8 }),
    );

    await expect(
      moderator({ moderate }).moderateText({
        text: "A synthetic request.",
        direction: "input",
      }),
    ).rejects.toThrow(/invalid response/i);
  });

  it("propagates provider failures for the runtime to fail closed", async () => {
    const providerFailure = new Error("provider unavailable");
    const moderate = vi.fn(async () => {
      throw providerFailure;
    });

    await expect(
      moderator({ moderate }).moderateText({
        text: "A synthetic request.",
        direction: "input",
      }),
    ).rejects.toBe(providerFailure);
  });

  it("rejects disabled external access without calling the provider", async () => {
    const moderate = vi.fn(async () =>
      response({ dangerous: false }, { dangerous: 0.01 }),
    );

    await expect(
      moderator({ moderate }, false).moderateText({
        text: "A synthetic request.",
        direction: "input",
      }),
    ).rejects.toThrow(/disabled/i);
    expect(moderate).not.toHaveBeenCalled();
  });
});
