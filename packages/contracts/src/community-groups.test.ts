import { describe, expect, it } from "vitest";
import { communityGroupRequestSchema } from "./community-groups";
const groupId = "c1570000-0000-4000-8000-000000000001";
const operationId = "e1570000-0000-4000-8000-000000000001";
describe("private group input authority", () => {
  it.each([
    {
      operation: "create",
      name: "Friends",
      rules: "Be kind",
      operationId,
      userId: groupId,
    },
    {
      operation: "post",
      groupId,
      operationId,
      body: "Hello",
      acceptedAudience: false,
    },
    { operation: "post", groupId, operationId, body: "Hello" },
    {
      operation: "create",
      name: "\u0000hidden",
      rules: "Be kind",
      operationId,
    },
    { operation: "request", token: "guessed" },
    {
      operation: "role",
      groupId,
      targetUserId: groupId,
      targetMembershipVersion: 1,
      role: "owner",
    },
    { operation: "approve", groupId, targetUserId: groupId },
    { operation: "list", userId: groupId },
  ])("rejects forged or unconfirmed intent %#", (body) =>
    expect(communityGroupRequestSchema.safeParse(body).success).toBe(false),
  );
  it("accepts a fresh versioned explicit group audience", () => {
    expect(
      communityGroupRequestSchema.parse({
        operation: "post",
        groupId,
        membershipVersion: 3,
        operationId,
        body: "  Hello friends  ",
        acceptedAudience: true,
      }),
    ).toMatchObject({ body: "Hello friends", membershipVersion: 3 });
  });
});
