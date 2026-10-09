import { describe, expect, it } from "vitest";
import { loadServerConfig } from "./server.js";
describe("server-only illustration configuration", () => {
  it("is disabled even with existing provider credentials by default", () => {
    const result = loadServerConfig({
      env: {
        NODE_ENV: "test",
        GEMINI_API_KEY: "synthetic-key-long-enough",
        AI_EXTERNAL_ACCESS: "true",
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.mealIllustrationConfig).toBeNull();
  });
  it("requires a server credential and a supported bounded image model", () => {
    expect(
      loadServerConfig({
        env: { NODE_ENV: "test", MEAL_ILLUSTRATIONS_ENABLED: "true" },
      }).ok,
    ).toBe(false);
    expect(
      loadServerConfig({
        env: {
          NODE_ENV: "test",
          MEAL_ILLUSTRATIONS_ENABLED: "true",
          GEMINI_API_KEY: "synthetic-key-long-enough",
          GEMINI_IMAGE_MODEL: "arbitrary-expensive-model",
        },
      }).ok,
    ).toBe(false);
    const result = loadServerConfig({
      env: {
        NODE_ENV: "test",
        MEAL_ILLUSTRATIONS_ENABLED: "true",
        GEMINI_API_KEY: "synthetic-key-long-enough",
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.aiExternalAccess).toBe(false);
      expect(result.value.mealIllustrationConfig?.model).toBe(
        "gemini-3.1-flash-lite-image",
      );
    }
  });
});
