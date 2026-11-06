import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";

import { toBase64Url } from "./sha256-base64url";

describe("toBase64Url", () => {
  it("matches the API's ETag digest encoding", () => {
    for (const text of ['{"a":1}', "Übung 🏋️", "x".repeat(1000)]) {
      const hash = createHash("sha256").update(text);
      const copy = hash.copy();
      expect(toBase64Url(hash.digest("base64"))).toBe(copy.digest("base64url"));
    }
  });
});
