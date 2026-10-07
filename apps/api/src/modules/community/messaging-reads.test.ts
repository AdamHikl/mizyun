import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { CommunityMutationError, type UserId } from "@mizyun/core";
import { communityMessagingRoutes } from "./messaging-routes";
const owner = "41000000-0000-4000-8000-000000000001";
const peerId = "41000000-0000-4000-8000-000000000002";
const cursor = {
  id: "42000000-0000-4000-8000-000000000004",
  createdAt: "2026-10-07T10:00:00+00:00",
};
async function setup() {
  const calls: unknown[] = [];
  const app = Fastify();
  app.decorate("authenticate", async (request, reply) => {
    if (request.headers.authorization !== "Bearer owner-token")
      return reply.code(401).send();
    request.principal = {
      userId: owner as UserId,
      accessToken: "owner-token",
      role: "authenticated",
    };
  });
  await app.register(communityMessagingRoutes, {
    prefix: "/v1/community",
    repository: {
      async execute(operation, args, token) {
        calls.push({ operation, args, token });
        if (args.peerId === owner)
          throw new CommunityMutationError("unavailable");
        return operation === "threads"
          ? { threads: [], nextBefore: null }
          : {
              messages: [],
              nextBefore: null,
              peer: { userId: peerId, displayName: "Connection" },
            };
      },
    },
  });
  return { app, calls };
}
describe("messaging read transport", () => {
  it("passes latest and summary reads only with the verified caller token", async () => {
    const { app, calls } = await setup();
    for (const payload of [
      { operation: "latest", peerId, before: cursor },
      { operation: "threads", before: cursor },
    ]) {
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/v1/community/messaging",
            payload,
          })
        ).statusCode,
      ).toBe(401);
      const response = await app.inject({
        method: "POST",
        url: "/v1/community/messaging",
        headers: { authorization: "Bearer owner-token" },
        payload,
      });
      expect(response.statusCode).toBe(200);
    }
    expect(calls).toEqual([
      {
        operation: "latest",
        args: { peerId, before: cursor },
        token: "owner-token",
      },
      { operation: "threads", args: { before: cursor }, token: "owner-token" },
    ]);
    await app.close();
  });
  it("rejects caller identity forgery and uses generic denied-conversation errors", async () => {
    const { app, calls } = await setup();
    const headers = { authorization: "Bearer owner-token" };
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/community/messaging",
          headers,
          payload: { operation: "latest", peerId, userId: owner },
        })
      ).statusCode,
    ).toBe(422);
    const denied = await app.inject({
      method: "POST",
      url: "/v1/community/messaging",
      headers,
      payload: { operation: "latest", peerId: owner },
    });
    expect(denied.statusCode).toBe(404);
    expect(denied.body).not.toContain(owner);
    expect(calls).toHaveLength(1);
    await app.close();
  });
});
