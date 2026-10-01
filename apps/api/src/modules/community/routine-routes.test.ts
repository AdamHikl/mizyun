import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UserId } from "@mizyun/core";
import { communityRoutineRoutes } from "./routine-routes";
import { authenticationPlugin as authentication } from "../../plugins/authentication.js";
const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
async function setup() {
  const app = Fastify();
  apps.push(app);
  const execute = vi.fn(async () => ({ items: [], nextCursor: null }));
  await app.register(authentication, {
    tokenVerifier: {
      verify: async (token: string) =>
        token === "current"
          ? {
              userId: "c1610000-0000-4000-8000-000000000001" as UserId,
              accessToken: token,
            }
          : null,
    },
  });
  await app.register(communityRoutineRoutes, {
    prefix: "/v1/community",
    routines: { execute },
  });
  return { app, execute };
}
describe("routine transport boundaries", () => {
  it("requires authentication before repository", async () => {
    const { app, execute } = await setup();
    expect(
      (await app.inject({ url: "/v1/community/routines" })).statusCode,
    ).toBe(401);
    expect(execute).not.toHaveBeenCalled();
  });
  it.each([
    "limit=51",
    "limit=0",
    "cursor=guessed",
    "mine=1",
    "userId=someone",
  ])("rejects malformed bounded query %s", async (query) => {
    const { app, execute } = await setup();
    expect(
      (
        await app.inject({
          url: `/v1/community/routines?${query}`,
          headers: { authorization: "Bearer current" },
        })
      ).statusCode,
    ).toBe(422);
    expect(execute).not.toHaveBeenCalled();
  });
  it("captures bearer token and bounded query", async () => {
    const { app, execute } = await setup();
    expect(
      (
        await app.inject({
          url: "/v1/community/routines?mine=true",
          headers: { authorization: "Bearer current" },
        })
      ).statusCode,
    ).toBe(200);
    expect(execute).toHaveBeenCalledWith(
      "list",
      { limit: 20, mine: "true" },
      "current",
    );
  });
  it("rejects missing confirmation before import", async () => {
    const { app, execute } = await setup();
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/community/routines/a1610000-0000-4000-8000-000000000001/import",
          headers: { authorization: "Bearer current" },
          payload: { version: 1 },
        })
      ).statusCode,
    ).toBe(422);
    expect(execute).not.toHaveBeenCalled();
  });
});
