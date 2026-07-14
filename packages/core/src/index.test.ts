import { describe, expect, it } from "vitest";

import { err, ok } from "./index.js";

describe("Result", () => {
  it("represents success without throwing", () => {
    expect(ok("ready")).toEqual({ ok: true, value: "ready" });
  });

  it("represents failure without throwing", () => {
    expect(err("not-ready")).toEqual({ ok: false, error: "not-ready" });
  });
});
