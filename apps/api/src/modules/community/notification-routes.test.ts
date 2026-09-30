import { afterEach, describe, it, expect, vi } from "vitest";
import { buildApp } from "../../app.js";
import type { UserId, CommunityNotificationRepository } from "@mizyun/core";
const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});
function setup() {
  const execute = vi.fn(async (operation: string) =>
    operation === "inbox" ? { items: [], nextCursor: null } : null,
  );
  const app = buildApp({
    tokenVerifier: {
      verify: async (token) =>
        token === "valid"
          ? {
              userId: "00000000-0000-4000-8000-000000000001" as UserId,
              role: "authenticated",
              accessToken: token,
            }
          : null,
    },
    communityNotifications: { execute } as CommunityNotificationRepository,
  });
  apps.push(app);
  return { app, execute };
}
describe("notification boundaries", () => {
  it("requires authentication before inbox calls", async () => {
    const { app, execute } = setup();
    expect(
      (await app.inject({ url: "/v1/community/notifications/inbox" }))
        .statusCode,
    ).toBe(401);
    expect(execute).not.toHaveBeenCalled();
  });
  it("passes captured authenticated token and bounded page", async () => {
    const { app, execute } = setup();
    expect(
      (
        await app.inject({
          url: "/v1/community/notifications/inbox?limit=20",
          headers: { authorization: "Bearer valid" },
        })
      ).json(),
    ).toEqual({ items: [], nextCursor: null });
    expect(execute).toHaveBeenCalledWith(
      "inbox",
      { limit: 20, cursor: null },
      "valid",
    );
  });
  it.each([
    "limit=51",
    "limit=-1",
    "cursor=2026-99-99T88:88:88Z%7C00000000-0000-4000-8000-000000000001",
  ])("rejects malformed page %s before RPC", async (query) => {
    const { app, execute } = setup();
    expect(
      (
        await app.inject({
          url: `/v1/community/notifications/inbox?${query}`,
          headers: { authorization: "Bearer valid" },
        })
      ).statusCode,
    ).toBe(422);
    expect(execute).not.toHaveBeenCalled();
  });
  it("malformed event UUID is neutral404 without RPC", async () => {
    const { app, execute } = setup();
    expect(
      (
        await app.inject({
          url: "/v1/community/notifications/inbox/------------------------------------",
          headers: { authorization: "Bearer valid" },
        })
      ).statusCode,
    ).toBe(404);
    expect(execute).not.toHaveBeenCalled();
  });
  it("unavailable opaque event never becomes a destination", async () => {
    const { app } = setup();
    expect(
      (
        await app.inject({
          url: "/v1/community/notifications/inbox/00000000-0000-4000-8000-000000000009",
          headers: { authorization: "Bearer valid" },
        })
      ).statusCode,
    ).toBe(404);
  });
  it("refuses invalid timezone/preferences and legacy privileged token fields", async () => {
    const { app, execute } = setup();
    const headers = { authorization: "Bearer valid" };
    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/v1/community/notifications/preferences",
          headers,
          payload: {
            requests: true,
            reactions: true,
            moderation: true,
            muted: false,
            timezone: "not/a-zone",
            quietHours: null,
          },
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/v1/community/notifications/token",
          headers,
          payload: {
            installationId: "00000000-0000-4000-8000-000000000009",
            token: "ExpoPushToken[abcdefghijklmn]",
            tier: "paid",
          },
        })
      ).statusCode,
    ).toBe(422);
    expect(execute).not.toHaveBeenCalled();
  });
});
