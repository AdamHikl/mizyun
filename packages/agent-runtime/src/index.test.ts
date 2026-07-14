import { describe, expect, it } from "vitest";

import { DisabledAgentProvider } from "./index.js";

describe("DisabledAgentProvider", () => {
  it("makes deferred provider setup explicit", async () => {
    const status = await new DisabledAgentProvider().status();
    expect(status.ready).toBe(false);
    expect(status.provider).toBe("disabled");
  });
});
