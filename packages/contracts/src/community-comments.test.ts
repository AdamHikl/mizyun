import { describe, expect, it } from "vitest";
import {
  communityCommentMutationSchema,
  communityCommentTextSchema,
  communityCommentQuerySchema,
} from "./community-comments";
const id = "a1560000-0000-4000-8000-000000000001";
describe("deliberate comment contracts", () => {
  it.each(["", "@friend", "https://example.com", "Call\nme", "x".repeat(501)])(
    "rejects unsafe or unbounded plain text %s",
    (text) =>
      expect(communityCommentTextSchema.safeParse(text).success).toBe(false),
  );
  it("counts Unicode characters consistently with PostgreSQL", () =>
    expect(communityCommentTextSchema.safeParse("🙂".repeat(500)).success).toBe(
      true,
    ));
  it("does not accept arbitrary media or duplicate mention identities", () => {
    const body = {
      id,
      operationId: id,
      body: "Nice consistency",
      expectedVersion: 0,
      mentions: [id, id],
    };
    expect(communityCommentMutationSchema.safeParse(body).success).toBe(false);
    expect(
      communityCommentMutationSchema.safeParse({
        ...body,
        mentions: [],
        attachment: "private-photo",
      }).success,
    ).toBe(false);
  });
  it("bounds pages and rejects malformed cursors", () => {
    expect(communityCommentQuerySchema.safeParse({ limit: 21 }).success).toBe(
      false,
    );
    expect(
      communityCommentQuerySchema.safeParse({ cursor: `not-time|${id}` })
        .success,
    ).toBe(false);
    expect(
      communityCommentQuerySchema.safeParse({
        cursor: `2026-10-01T12:00:00.000Z|${id}`,
      }).success,
    ).toBe(true);
  });
});
