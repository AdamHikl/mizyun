import { describe, expect, it } from "vitest";
import { GeminiContentModerator } from "./index.js";

describe("GeminiContentModerator", () => {
  it("throws when external access is disabled", async () => {
    const moderator = new GeminiContentModerator({ externalAccess: false });
    await expect(
      moderator.moderateText({
        text: "hello",
        direction: "input",
      }),
    ).rejects.toThrow("External moderation access is disabled.");
  });

  it("blocks severe self-harm statements", async () => {
    const moderator = new GeminiContentModerator({ externalAccess: true });
    const result = await moderator.moderateText({
      text: "I want to commit suicide",
      direction: "input",
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.category).toBe("self_harm");
    }
  });

  it("allows standard fitness text", async () => {
    const moderator = new GeminiContentModerator({ externalAccess: true });
    const result = await moderator.moderateText({
      text: "How much protein should I eat for bench press progress?",
      direction: "input",
    });
    expect(result.allowed).toBe(true);
  });
});
