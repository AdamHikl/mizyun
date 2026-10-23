import { describe, it, expect, vi } from "vitest";
import type { ApiClient } from "@mizyun/api-client";
import {
  COMMUNITY_READ_LIFETIME_MS as LIFETIME,
  COMMUNITY_READ_RENEWAL_LEAD_MS as LEAD,
} from "../state/read-cache";
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
  it("opens block management directly without loading follow requests", async () => {
    const request = vi
      .fn()
      .mockResolvedValue({ ok: true, value: { items: [] } });
    const controller = new RelationshipsController(
      { request } as unknown as ApiClient,
      "owner",
      () => true,
      "blocked",
    );
    controller.resume();
    await controller.load();
    expect(controller.getState().list).toBe("blocked");
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0][0].path).toBe("/v1/community/blocks?limit=20");
  });
  it("discards a page that arrives after a list change", async () => {
    let resolve!: (value: unknown) => void;
    const request = vi
      .fn()
      .mockResolvedValue({ ok: true, value: { items: [] } })
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
  it("loads complete outgoing states before offering follow back", async () => {
    const { controller, request } = setup(
      vi.fn().mockImplementation(async ({ path }) => ({
        ok: true,
        value: {
          items: path.includes("followers?")
            ? [
                row,
                { ...row, user: { ...row.user, userId: "pending" } },
                { ...row, user: { ...row.user, userId: "new" } },
              ]
            : path.includes("following?")
              ? [row]
              : [{ ...row, user: { ...row.user, userId: "pending" } }],
        },
      })),
    );
    await controller.load("followers");
    expect(
      controller.getState().rows.map((item) => item.outgoingFollowStatus),
    ).toEqual(["approved", "pending", "none"]);
    expect(
      request.mock.calls.slice(1).map(([options]) => options.path),
    ).toEqual([
      "/v1/community/relationships/following?limit=50",
      "/v1/community/relationships/outgoing?limit=50",
    ]);
    await controller.act("follow", controller.getState().rows[0]);
    expect(request).toHaveBeenCalledTimes(3);
  });
  it.each(["outgoing", "following"])(
    "fails closed when %s states cannot be loaded",
    async (failedList) => {
      const { controller } = setup(
        vi
          .fn()
          .mockImplementation(async ({ path }) =>
            path.includes("outgoing?")
              ? { ok: false, error: { kind: "network_error", cause: null } }
              : { ok: true, value: { items: [row] } },
          ),
      );
      await controller.load("followers");
      expect(controller.getState().rows).toEqual([]);
      expect(controller.getState().error).toContain("Unable to connect");
    },
  );
  it("sends one owner-bound request for a follower and reloads pending state", async () => {
    let resolve!: (value: unknown) => void;
    let requested = false;
    const { controller, request } = setup(
      vi.fn().mockImplementation(({ method, path }) => {
        if (method === "POST") {
          requested = true;
          return new Promise((r) => {
            resolve = r;
          });
        }
        return Promise.resolve({
          ok: true,
          value: {
            items:
              path.includes("followers?") ||
              (path.includes("outgoing?") && requested)
                ? [row]
                : [],
          },
        });
      }),
    );
    await controller.load("followers");
    const follower = controller.getState().rows[0];
    const first = controller.act("follow", follower);
    await controller.act("follow", follower);
    expect(request).toHaveBeenCalledTimes(4);
    expect(request).toHaveBeenLastCalledWith(
      expect.objectContaining({
        method: "POST",
        expectedUserId: "owner",
        path: "/v1/community/relationships/follow",
        body: {
          targetUserId: "friend",
          operationId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        },
      }),
    );
    resolve({ ok: true, value: { status: "pending" } });
    await first;
    expect(controller.getState().rows[0].outgoingFollowStatus).toBe("pending");
    expect(controller.getState().notice).toContain("must approve");
  });
  it("does not restore a follow-back response after the owner is retired", async () => {
    let resolve!: (value: unknown) => void;
    const { controller, request } = setup(
      vi.fn().mockImplementation(({ method, path }) =>
        method === "POST"
          ? new Promise((r) => {
              resolve = r;
            })
          : Promise.resolve({
              ok: true,
              value: { items: path.includes("followers?") ? [row] : [] },
            }),
      ),
    );
    await controller.load("followers");
    const first = controller.act("follow", controller.getState().rows[0]);
    controller.destroy();
    resolve({ ok: true, value: { status: "pending" } });
    await first;
    expect(controller.getState().rows).toEqual([]);
    expect(controller.getState().notice).toBeNull();
    expect(request).toHaveBeenCalledTimes(4);
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
      .mockResolvedValueOnce({ ok: true, value: { id: "receipt" } })
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
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(3));
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
        .mockResolvedValueOnce({ ok: true, value: { id: "receipt" } })
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
  it("does not revive pre-background confirmation intents after foreground", async () => {
    const { controller } = setup(
      vi.fn().mockResolvedValue({ ok: true, value: { items: [] } }),
    );
    await controller.load();
    const confirm = controller.captureIntent();
    expect(confirm()).toBe(true);
    controller.pause();
    controller.resume();
    expect(confirm()).toBe(false);
    expect(controller.captureIntent()()).toBe(false);
    await controller.load();
    expect(controller.captureIntent()()).toBe(true);
    controller.pause();
  });
  it("expires relationship action authority at its lifetime before accepting a stale confirmation", async () => {
    vi.useFakeTimers();
    const request = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, value: { items: [row] } })
      .mockResolvedValue({
        ok: false,
        error: { kind: "network_error", cause: null },
      });
    const { controller } = setup(request);
    await controller.load();
    const current = controller.captureIntent();
    expect(current()).toBe(true);
    await vi.advanceTimersByTimeAsync(LIFETIME);
    expect(current()).toBe(false);
    expect(controller.getState().rows).toEqual([]);
    await controller.act("approve", row);
    // Failed silent renewals are retried, but no mutation is ever sent.
    expect(request.mock.calls.length).toBeGreaterThan(2);
    expect(
      request.mock.calls.filter(
        ([options]) => options.method && options.method !== "GET",
      ),
    ).toEqual([]);
    controller.pause();
    vi.useRealTimers();
  });
  it("renews silently before the deadline: rows stay, no loading or error", async () => {
    vi.useFakeTimers();
    const request = vi
      .fn()
      .mockResolvedValue({ ok: true, value: { items: [row] } });
    const { controller } = setup(request);
    const states: { rows: unknown[]; loading: boolean; error: unknown }[] = [];
    await controller.load();
    controller.subscribe(() => states.push(controller.getState() as never));
    await vi.advanceTimersByTimeAsync(LIFETIME - LEAD);
    expect(request).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(LEAD + 500);
    expect(controller.getState().rows).toHaveLength(1);
    expect(controller.getState().error).toBeNull();
    expect(controller.captureIntent()()).toBe(true);
    expect(
      states.every(
        (state) => state.rows.length === 1 && !state.loading && !state.error,
      ),
    ).toBe(true);
    await vi.advanceTimersByTimeAsync(LIFETIME - 2 * LEAD - 500);
    expect(request).toHaveBeenCalledTimes(3);
    expect(controller.getState().rows).toHaveLength(1);
    controller.pause();
    vi.useRealTimers();
  });
  it("retires rows at the original deadline when the renewal fails or hangs", async () => {
    vi.useFakeTimers();
    for (const hang of [false, true]) {
      const request = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, value: { items: [row] } })
        .mockImplementation(() =>
          hang
            ? new Promise(() => {})
            : Promise.resolve({
                ok: false,
                error: { kind: "network_error", cause: null },
              }),
        );
      const { controller } = setup(request);
      await controller.load();
      await vi.advanceTimersByTimeAsync(LIFETIME - 1);
      expect(controller.getState().rows).toHaveLength(1);
      expect(controller.getState().error).toBeNull();
      // A failed renewal is retried while the rows stay visible.
      if (!hang) expect(request.mock.calls.length).toBeGreaterThan(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(controller.getState().rows).toEqual([]);
      controller.pause();
    }
    vi.useRealTimers();
  });
  it("clears rows at once when the renewal is explicitly denied", async () => {
    vi.useFakeTimers();
    const request = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, value: { items: [row] } })
      .mockResolvedValue({
        ok: false,
        error: {
          kind: "http_error",
          status: 403,
          code: "FORBIDDEN",
          message: "",
        },
      });
    const { controller } = setup(request);
    await controller.load();
    await vi.advanceTimersByTimeAsync(LIFETIME - LEAD);
    expect(controller.getState().rows).toEqual([]);
    expect(controller.getState().error).toBeTruthy();
    controller.pause();
    vi.useRealTimers();
  });
  it("reuses the follow-back operation after a lost response", async () => {
    const request = vi.fn().mockImplementation(async ({ method, path }) =>
      method === "POST"
        ? { ok: false, error: { kind: "network_error", cause: null } }
        : {
            ok: true,
            value: { items: path.includes("followers?") ? [row] : [] },
          },
    );
    const { controller } = setup(request);
    await controller.load("followers");
    await controller.act("follow", controller.getState().rows[0]);
    await controller.load("followers");
    await controller.act("follow", controller.getState().rows[0]);
    const writes = request.mock.calls.filter(
      ([options]) => options.method === "POST",
    );
    expect(writes).toHaveLength(2);
    expect(writes[0][0].body.operationId).toBe(writes[1][0].body.operationId);
    controller.pause();
  });
  it("hides an owner list and rejects captured actions when the same principal's session lifetime changes", async () => {
    let token = "session-one";
    const capturedToken = token;
    const request = vi
      .fn()
      .mockResolvedValue({ ok: true, value: { items: [row] } });
    const controller = new RelationshipsController(
      { request } as unknown as ApiClient,
      "owner",
      () => token === capturedToken,
    );
    await controller.load();
    const intent = controller.captureIntent();
    const receipt = controller.captureReceiptIntent();
    expect(controller.getState().rows).toHaveLength(1);
    token = "session-two";
    expect(controller.getState().rows).toEqual([]);
    expect(intent()).toBe(false);
    expect(receipt()).toBe(false);
    await controller.act("approve", row);
    expect(request).toHaveBeenCalledOnce();
    controller.pause();
  });
  it("continues an already authorized ID-bound reduction after its receipt clears read cache", async () => {
    const { CommunityReadCache } = await import("../state/read-cache");
    let removed = false;
    const request = vi.fn().mockImplementation(async ({ method, path }) => {
      if (path.includes("safety/receipts"))
        return { ok: true, value: { id: "receipt" } };
      if (method === "DELETE") {
        removed = true;
        return { ok: true, value: { unfollowed: true } };
      }
      return { ok: true, value: { items: removed ? [] : [row] } };
    });
    const cache = new CommunityReadCache(
      { request } as unknown as ApiClient,
      async () => ({ user: { id: "owner" }, accessToken: "token" }) as any,
    );
    cache.setForeground(true);
    cache.setPrincipal("owner");
    const controller = new RelationshipsController(cache, "owner");
    await controller.load("following");
    await controller.act("unfollow", controller.getState().rows[0]);
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "DELETE",
        path: "/v1/community/relationships/following/friend?relationshipId=edge-1",
      }),
    );
    expect(controller.getState().rows).toEqual([]);
    controller.pause();
    cache.dispose();
  });
  it("restores usable current actions after a report receipt is closed and reauthorization completes", async () => {
    const { CommunityReadCache } = await import("../state/read-cache");
    const { captureSafetyReceipt } = await import("../safety/safety-api");
    const { scopeCommunityClient } = await import("../scoped-client");
    const request = vi
      .fn()
      .mockImplementation(async ({ path, method }) =>
        path.includes("safety/receipts")
          ? { ok: true, value: { id: "receipt" } }
          : method === "PUT"
            ? { ok: true, value: {} }
            : { ok: true, value: { items: [row] } },
      );
    const cache = new CommunityReadCache(
      { request } as unknown as ApiClient,
      async () => ({ user: { id: "owner" }, accessToken: "token" }) as any,
    );
    cache.setForeground(true);
    cache.setPrincipal("owner");
    const controller = new RelationshipsController(cache, "owner");
    await controller.load();
    const receipt = controller.captureReceiptIntent();
    await captureSafetyReceipt(
      scopeCommunityClient(cache, "owner", receipt),
      "profile",
      row.user.userId,
    );
    expect(controller.captureIntent()()).toBe(false);
    controller.pause();
    expect(controller.getState().rows).toEqual([]);
    controller.resume();
    await controller.load();
    expect(controller.captureIntent()()).toBe(true);
    await controller.act("approve", controller.getState().rows[0]);
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ method: "PUT", body: { action: "approve" } }),
    );
    controller.pause();
    cache.dispose();
  });
  it("retires visible identities immediately while a pre-reduction receipt stalls beyond their deadline", async () => {
    vi.useFakeTimers();
    let finish!: (value: unknown) => void;
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        value: { items: [row], nextCursor: "next" },
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue({
        ok: false,
        error: { kind: "network_error", cause: null },
      });
    const { controller } = setup(request);
    await controller.load("following");
    const displayed = controller.getState().rows[0];
    const work = controller.act("unfollow", displayed);
    expect(controller.getState()).toMatchObject({
      rows: [],
      cursor: null,
      pending: true,
    });
    await vi.advanceTimersByTimeAsync(LIFETIME + 1_000);
    expect(controller.getState().rows).toEqual([]);
    expect(controller.captureIntent()()).toBe(false);
    finish({ ok: true, value: { id: "receipt" } });
    await work;
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "DELETE",
        path: "/v1/community/relationships/following/friend?relationshipId=edge-1",
      }),
    );
    expect(controller.getState().rows).toEqual([]);
    controller.pause();
    vi.useRealTimers();
  });
  it("retires visible identities immediately while an accepted mutation stalls beyond their deadline", async () => {
    vi.useFakeTimers();
    let finish!: (value: unknown) => void;
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        value: { items: [row], nextCursor: "next" },
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
    const { controller } = setup(request);
    await controller.load();
    const work = controller.act("approve", controller.getState().rows[0]);
    expect(controller.getState()).toMatchObject({
      rows: [],
      cursor: null,
      pending: true,
    });
    await vi.advanceTimersByTimeAsync(LIFETIME + 1_000);
    expect(controller.getState().rows).toEqual([]);
    expect(controller.captureIntent()()).toBe(false);
    finish({ ok: false, error: { kind: "network_error", cause: null } });
    await work;
    expect(controller.getState().rows).toEqual([]);
    expect(controller.getState().notice).toBeNull();
    controller.pause();
    vi.useRealTimers();
  });
  it("hides an earlier page while paging and never restores either page after the inherited deadline", async () => {
    vi.useFakeTimers();
    let finish!: (value: unknown) => void;
    let paging = false;
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        value: { items: [row], nextCursor: "next" },
      })
      // Silent renewals fail (and are retried); the rows stay until the
      // original deadline. Only the explicit page read hangs.
      .mockImplementation(() =>
        paging
          ? new Promise((resolve) => {
              finish = resolve;
            })
          : Promise.resolve({
              ok: false,
              error: { kind: "network_error", cause: null },
            }),
      );
    const { controller } = setup(request);
    await controller.load();
    await vi.advanceTimersByTimeAsync(LIFETIME - 1_000);
    paging = true;
    const work = controller.load("incoming", true);
    expect(controller.getState()).toMatchObject({
      rows: [],
      cursor: null,
      loading: true,
    });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(controller.getState().rows).toEqual([]);
    finish({
      ok: true,
      value: {
        items: [
          {
            ...row,
            relationshipId: "new-edge",
            user: { ...row.user, userId: "another" },
          },
        ],
      },
    });
    await work;
    expect(controller.getState()).toMatchObject({
      rows: [],
      cursor: null,
      loading: false,
    });
    expect(controller.getState().error).toContain("access changed");
    controller.pause();
    vi.useRealTimers();
  });
});
