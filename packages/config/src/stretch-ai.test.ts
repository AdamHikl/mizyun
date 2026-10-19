import { describe, expect, it } from "vitest";
import { stretchAiEnabled } from "./stretch-ai";

describe("stretchAiEnabled", () => {
  it("is on in Dev", () => {
    expect(stretchAiEnabled({ MIZYUN_ENVIRONMENT: "dev" })).toBe(true);
  });
  it("is off elsewhere unless explicitly enabled", () => {
    expect(stretchAiEnabled({ MIZYUN_ENVIRONMENT: "production" })).toBe(false);
    expect(stretchAiEnabled({})).toBe(false);
    expect(
      stretchAiEnabled({
        MIZYUN_ENVIRONMENT: "production",
        MIZYUN_STRETCH_AI_ENABLED: "true",
      }),
    ).toBe(true);
    expect(
      stretchAiEnabled({
        MIZYUN_ENVIRONMENT: "production",
        MIZYUN_STRETCH_AI_ENABLED: "1",
      }),
    ).toBe(false);
  });
});
