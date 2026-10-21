import { describe, expect, it } from "vitest";

import { isLegacyClient } from "./client-compat.js";

describe("isLegacyClient", () => {
  it.each([
    [{}, true],
    [{ "x-mizyun-api-compat": "" }, true],
    [{ "x-mizyun-api-compat": "   " }, true],
    [{ "x-mizyun-api-compat": "2026-10-21" }, false],
    [{ "x-mizyun-api-compat": ["2026-10-21"] }, false],
  ])("treats headers %j as legacy=%s", (headers, legacy) => {
    expect(isLegacyClient({ headers })).toBe(legacy);
  });
});
