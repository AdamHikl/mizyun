import Fastify from "fastify";
import { describe, it, expect } from "vitest";
import { communityMessagingRoutes } from "./messaging-routes";
import { CommunityMutationError, type UserId } from "@mizyun/core";
const id = "41000000-0000-4000-8000-000000000001";
async function setup() {
  const calls: {
    operation: string;
    args: Readonly<Record<string, unknown>>;
    token: string;
  }[] = [];
  const app = Fastify();
  app.decorate("authenticate", async (request, reply) => {
    if (request.headers.authorization !== "Bearer current-token")
      return reply.code(401).send();
    request.principal = {
      userId: id as UserId,
      accessToken: "current-token",
      role: "authenticated",
    };
  });
  await app.register(communityMessagingRoutes, {
    prefix: "/v1/community",
    repository: {
      async execute(operation, args, token) {
        calls.push({ operation, args, token });
        if (args.peerId === id) throw new CommunityMutationError("unavailable");
        return { enabled: false, muted: false };
      },
    },
  });
  return { app, calls };
}
describe("message transport privacy", () => {
  it("requires authentication before touching persistence", async () => {
    const { app, calls } = await setup();
    const response = await app.inject({
      method: "POST",
      url: "/v1/community/messaging",
      payload: { operation: "preferences" },
    });
    expect(response.statusCode).toBe(401);
    expect(calls).toEqual([]);
    await app.close();
  });
  it("binds consent command to verified JWT and rejects client identity", async () => {
    const { app, calls } = await setup();
    const headers = { authorization: "Bearer current-token" };
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/community/messaging",
          headers,
          payload: { operation: "preferences", enabled: false },
        })
      ).statusCode,
    ).toBe(200);
    expect(calls[0]?.token).toBe("current-token");
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/community/messaging",
          headers,
          payload: { operation: "preferences", enabled: true, userId: id },
        })
      ).statusCode,
    ).toBe(422);
    expect(calls).toHaveLength(1);
    await app.close();
  });
  it("denied peer has a generic non-enumerating error and links never reach persistence", async () => {
    const { app, calls } = await setup();
    const headers = { authorization: "Bearer current-token" };
    const denied = await app.inject({
      method: "POST",
      url: "/v1/community/messaging",
      headers,
      payload: { operation: "send", id, peerId: id, text: "hello" },
    });
    expect(denied.statusCode).toBe(404);
    expect(denied.body).not.toContain(id);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/community/messaging",
          headers,
          payload: {
            operation: "send",
            id,
            peerId: id,
            text: "https://example.com",
          },
        })
      ).statusCode,
    ).toBe(422);
    expect(calls).toHaveLength(1);
    await app.close();
  });
});
