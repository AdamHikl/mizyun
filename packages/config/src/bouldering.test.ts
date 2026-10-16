import { describe, expect, it } from "vitest";
import { boulderingEnabled } from "./bouldering";

describe("boulderingEnabled", () => {
  it("is on in Dev", () => {
    expect(boulderingEnabled({ MIZYUN_ENVIRONMENT: "dev" })).toBe(true);
  });
  it("is off elsewhere unless explicitly enabled", () => {
    expect(boulderingEnabled({ MIZYUN_ENVIRONMENT: "production" })).toBe(false);
    expect(boulderingEnabled({})).toBe(false);
    expect(
      boulderingEnabled({
        MIZYUN_ENVIRONMENT: "production",
        MIZYUN_BOULDERING_ENABLED: "true",
      }),
    ).toBe(true);
    expect(
      boulderingEnabled({
        MIZYUN_ENVIRONMENT: "production",
        MIZYUN_BOULDERING_ENABLED: "1",
      }),
    ).toBe(false);
  });
});
