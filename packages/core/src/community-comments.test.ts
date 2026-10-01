import { describe, expect, it } from "vitest";
import { isPlainCommunityComment } from "./community-comments";
describe("comment text boundary", () => {
  it("keeps arbitrary references and contact mechanisms out of plain text", () => {
    for (const text of [
      "@someone",
      "www.example.com",
      "\u001bControl",
      "x".repeat(501),
      " ",
    ])
      expect(isPlainCommunityComment(text)).toBe(false);
    expect(isPlainCommunityComment("Small steps count 👏")).toBe(true);
  });
});
