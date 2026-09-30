import { describe, it, expect, vi } from "vitest";
import type { ApiClient } from "@mizyun/api-client";
import { RelationshipsController } from "./controller";
const row = {
  relationshipId: "edge-1",
  user: {
    userId: "friend",
    handle: "friend",
    displayName: "Friend",
    avatarSymbol: "F",
    bio: null,
    createdAt: "2026-09-30T00:00:00Z",
  },
  status: "pending",
  createdAt: "2026-09-30T00:00:00Z",
};
function setup(request = vi.fn()) {
  return {
    request,
    controller: new RelationshipsController(
      { request } as unknown as ApiClient,
      "owner",
    ),
  };
}
describe("owner relationship controller", () => {
  it("discards a page that arrives after a list change", async () => {
    let resolve!: (value: unknown) => void;
    const request = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolve = r;
          }),
      )
      .mockResolvedValueOnce({
        ok: true,
        value: { items: [], nextCursor: null },
      });
    const { controller } = setup(request);
    const first = controller.load("incoming");
    await controller.load("followers");
    resolve({ ok: true, value: { items: [row] } });
    await first;
    expect(controller.getState().list).toBe("followers");
    expect(controller.getState().rows).toEqual([]);
  });
  it("pages in memory, deduplicates, and binds every read to the owner", async () => {
    const { controller, request } = setup(
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          value: { items: [row], nextCursor: "opaque +&" },
        })
        .mockResolvedValueOnce({
          ok: true,
          value: { items: [row], nextCursor: null },
        }),
    );
    await controller.load();
    await controller.load("incoming", true);
    expect(controller.getState().rows).toHaveLength(1);
    expect(request).toHaveBeenLastCalledWith(
      expect.objectContaining({
        path: "/v1/community/relationships/incoming?limit=20&cursor=opaque+%2B%26",
        expectedUserId: "owner",
      }),
    );
  });
  it("binds a removal to the displayed incarnation and ignores duplicate taps", async () => {
    let resolve!: (value: unknown) => void;
    const request = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, value: { items: [row] } })
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolve = r;
          }),
      )
      .mockResolvedValueOnce({ ok: true, value: { items: [] } });
    const { controller } = setup(request);
    await controller.load("following");
    const first = controller.act("unfollow", row);
    await controller.act("unfollow", row);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenLastCalledWith(
      expect.objectContaining({
        method: "DELETE",
        path: "/v1/community/relationships/following/friend?relationshipId=edge-1",
      }),
    );
    resolve({ ok: true, value: { unfollowed: true } });
    await first;
    expect(controller.getState().rows).toEqual([]);
  });
  it("retiring the owner suppresses a pending mutation response and further actions", async () => {
    let resolve!: (value: unknown) => void;
    const request = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, value: { items: [row] } })
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolve = r;
          }),
      );
    const { controller } = setup(request);
    await controller.load();
    const action = controller.act("approve", row);
    controller.destroy();
    resolve({ ok: true, value: {} });
    await action;
    await controller.act("block", row);
    expect(controller.getState().rows).toEqual([]);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("clears stale identities on failed intent without claiming success", async () => {
    const { controller } = setup(
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true, value: { items: [row] } })
        .mockResolvedValueOnce({
          ok: false,
          error: { kind: "network_error", cause: null },
        }),
    );
    await controller.load();
    await controller.act("decline", row);
    expect(controller.getState().rows).toHaveLength(0);
    expect(controller.getState().notice).toBeNull();
    expect(controller.getState().error).toContain("Unable to connect");
  });
  it("exposes owner block and mute management without following", async () => {
    const { controller, request } = setup(
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          value: { items: [{ blockedUser: row.user }] },
        })
        .mockResolvedValueOnce({
          ok: true,
          value: { items: [{ user: row.user }] },
        }),
    );
    await controller.load("blocked");
    expect(controller.getState().rows[0]?.user.userId).toBe("friend");
    await controller.load("muted");
    expect(request).toHaveBeenLastCalledWith(
      expect.objectContaining({ path: "/v1/community/mutes?limit=20" }),
    );
  });
  it("clears identities on background and rejects a pre-background mutation after resume", async () => {
    let resolve!: (value: unknown) => void;
    const request = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, value: { items: [row] } })
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolve = r;
          }),
      )
      .mockResolvedValueOnce({ ok: true, value: { items: [] } });
    const { controller } = setup(request);
    await controller.load();
    const action = controller.act("approve", row);
    controller.pause();
    expect(controller.getState().rows).toEqual([]);
    controller.resume();
    await controller.load();
    resolve({ ok: true, value: {} });
    await action;
    expect(controller.getState().notice).toBeNull();
    expect(request).toHaveBeenCalledTimes(3);
  });
});
