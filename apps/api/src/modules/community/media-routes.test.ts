import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UserId } from "@mizyun/core";
import { authenticationPlugin } from "../../plugins/authentication.js";
import { communityMediaRoutes } from "./media-routes";
const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
const id = "a1600000-0000-4000-8000-000000000001";
async function setup() {
  const app = Fastify();
  apps.push(app);
  const upload = vi.fn(async () => ({
    id,
    authorHandle: "synthetic",
    altText: "Gym",
    state: "pending",
    width: 200,
    height: 100,
    isOwner: true,
    createdAt: "2026-10-01T00:00:00.000Z",
  }));
  const content = vi.fn(async () => new Uint8Array([1, 2, 3]));
  const execute = vi.fn(async () => ({ items: [], nextCursor: null }));
  await app.register(authenticationPlugin, {
    tokenVerifier: {
      verify: async (token: string) =>
        token === "current"
          ? {
              userId: "c1600000-0000-4000-8000-000000000001" as UserId,
              accessToken: token,
            }
          : null,
    },
  });
  await app.register(communityMediaRoutes, {
    prefix: "/v1/community",
    media: { upload, content, execute, evidence: content },
  });
  return { app, upload, content, execute };
}
describe("media transport", () => {
  it("requires current authentication before any byte port", async () => {
    const { app, content } = await setup();
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/community/media/${id}/content`,
          payload: { variant: "image" },
        })
      ).statusCode,
    ).toBe(401);
    expect(content).not.toHaveBeenCalled();
  });
  it.each([
    { rightsConfirmed: false },
    { mimeType: "image/svg+xml" },
    { altText: "" },
    { base64: "data:image/jpeg;base64,abcd" },
    { sourcePrivateAssetId: id },
  ])("rejects invalid or private-crosspost input %j", async (patch) => {
    const { app, upload } = await setup();
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/community/media",
          headers: { authorization: "Bearer current" },
          payload: {
            operationId: id,
            mimeType: "image/jpeg",
            base64: "AQIDBA==",
            altText: "Gym",
            rightsConfirmed: true,
            ...patch,
          },
        })
      ).statusCode,
    ).toBe(422);
    expect(upload).not.toHaveBeenCalled();
  });
  it("passes decoded bytes with captured principal and independent upload intent", async () => {
    const { app, upload } = await setup();
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/community/media",
          headers: { authorization: "Bearer current" },
          payload: {
            operationId: id,
            mimeType: "image/jpeg",
            base64: "AQIDBA==",
            altText: "Gym",
            rightsConfirmed: true,
          },
        })
      ).statusCode,
    ).toBe(200);
    expect(upload).toHaveBeenCalledWith({
      userId: "c1600000-0000-4000-8000-000000000001",
      accessToken: "current",
      bytes: Buffer.from([1, 2, 3, 4]),
      operationId: id,
      mimeType: "image/jpeg",
      altText: "Gym",
    });
  });
  it("never returns a signed URL and marks authorized image bytes no-store", async () => {
    const { app, content } = await setup();
    const response = await app.inject({
      method: "POST",
      url: `/v1/community/media/${id}/content`,
      headers: { authorization: "Bearer current" },
      payload: { variant: "thumbnail" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toContain("no-store");
    expect(response.json()).toEqual({ mimeType: "image/jpeg", base64: "AQID" });
    expect(content).toHaveBeenCalledWith(id, "thumbnail", "current");
  });
});
