import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommunityMutationError, type UserId } from "@mizyun/core";
import { communityCommentRoutes } from "./comment-routes";
const apps: ReturnType<typeof Fastify>[] = [];
const id = "a1560000-0000-4000-8000-000000000001";
const headers = { authorization: "Bearer valid" };
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
function setup() {
  const execute = vi.fn(async () => ({
    items: [],
    nextCursor: null,
    enabled: false,
    canManage: true,
    allowMentions: false,
  }));
  const app = Fastify();
  app.decorate("authenticate", async (request, reply) => {
    if (request.headers.authorization !== "Bearer valid") {
      await reply.code(401).send({ error: "Unauthorized" });
      return;
    }
    request.principal = {
      userId: id as UserId,
      role: "authenticated",
      accessToken: "captured",
    };
  });
  app.register(communityCommentRoutes, {
    prefix: "/v1/community",
    comments: { execute },
  });
  apps.push(app);
  return { app, execute };
}
describe("comment API failure boundaries", () => {
  it("authenticates before querying a thread", async () => {
    const { app, execute } = setup();
    expect(
      (await app.inject({ url: `/v1/community/activities/${id}/comments` }))
        .statusCode,
    ).toBe(401);
    expect(execute).not.toHaveBeenCalled();
  });
  it("passes current JWT and bounded query to authority", async () => {
    const { app, execute } = setup();
    expect(
      (
        await app.inject({
          url: `/v1/community/activities/${id}/comments`,
          headers,
        })
      ).statusCode,
    ).toBe(200);
    expect(execute).toHaveBeenCalledWith(
      "list",
      { activityId: id, limit: 20 },
      "captured",
    );
  });
  it("refuses hidden target authority errors without leaking content", async () => {
    const { app, execute } = setup();
    execute.mockRejectedValue(new CommunityMutationError("unavailable"));
    const response = await app.inject({
      url: `/v1/community/activities/${id}/comments`,
      headers,
    });
    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain("community_unavailable");
  });
  it.each([
    { body: "@someone", mentions: [] },
    { body: "Nice", mentions: [id, id] },
    { body: "Nice", mentions: [], attachment: "private.jpg" },
  ])("rejects forged input before mutation", async (input) => {
    const { app, execute } = setup();
    const response = await app.inject({
      method: "POST",
      url: `/v1/community/activities/${id}/comments`,
      headers,
      payload: { id, operationId: id, expectedVersion: 0, ...input },
    });
    expect(response.statusCode).toBe(422);
    expect(execute).not.toHaveBeenCalled();
  });
});
