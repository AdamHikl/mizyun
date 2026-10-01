import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommunityMutationError, type UserId } from "@mizyun/core";
import { communityGroupRoutes } from "./group-routes";
import { authenticationPlugin } from "../../plugins/authentication.js";
const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
async function setup() {
  const app = Fastify();
  apps.push(app);
  const execute = vi.fn(async () => ({ groups: [] }));
  await app.register(authenticationPlugin, {
    tokenVerifier: {
      verify: async (token: string) =>
        token === "current"
          ? {
              userId: "c1570000-0000-4000-8000-000000000001" as UserId,
              accessToken: token,
            }
          : null,
    },
  });
  await app.register(communityGroupRoutes, {
    prefix: "/v1/community",
    groups: { execute },
  });
  return { app, execute };
}
const groupId = "c1570000-0000-4000-8000-000000000001";
const request = (payload: Record<string, unknown>, authenticated = true) => ({
  method: "POST" as const,
  url: "/v1/community/groups/operations",
  headers: authenticated ? { authorization: "Bearer current" } : {},
  payload,
});
describe("group authenticated transport", () => {
  it("never executes without verified bearer", async () => {
    const { app, execute } = await setup();
    expect(
      (await app.inject(request({ operation: "list" }, false))).statusCode,
    ).toBe(401);
    expect(execute).not.toHaveBeenCalled();
  });
  it.each([
    { operation: "list", userId: groupId },
    { operation: "role", groupId, targetUserId: groupId, role: "owner" },
    {
      operation: "post",
      groupId,
      operationId: groupId,
      body: "Hello",
      acceptedAudience: false,
    },
  ])("rejects forged authority %#", async (payload) => {
    const { app, execute } = await setup();
    expect((await app.inject(request(payload))).statusCode).toBe(422);
    expect(execute).not.toHaveBeenCalled();
  });
  it("uses the authenticated token and only validated arguments", async () => {
    const { app, execute } = await setup();
    expect(
      (
        await app.inject(
          request({ operation: "leave", groupId, membershipVersion: 1 }),
        )
      ).statusCode,
    ).toBe(200);
    expect(execute).toHaveBeenCalledWith(
      "leave",
      { groupId, membershipVersion: 1 },
      "current",
    );
  });
  it("normalizes denied target without identity details", async () => {
    const { app, execute } = await setup();
    execute.mockRejectedValueOnce(new CommunityMutationError("access_denied"));
    const reply = await app.inject(request({ operation: "read", groupId }));
    expect(reply.statusCode).toBe(403);
    expect(reply.body).not.toContain(groupId);
  });
});
