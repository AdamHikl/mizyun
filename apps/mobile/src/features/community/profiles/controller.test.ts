import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@mizyun/api-client";
import {
  communityProfileViewDtoSchema,
  type CommunityProfileViewDto,
} from "@mizyun/contracts";
import { ProfileViewController } from "./controller";
import {
  COMMUNITY_READ_LIFETIME_MS as LIFETIME,
  COMMUNITY_READ_RENEWAL_LEAD_MS as LEAD,
  CommunityReadCache,
  invalidateCommunityReads,
} from "../state/read-cache";
const profile: CommunityProfileViewDto = {
  userId: "00000000-0000-4000-8000-000000000002",
  handle: "friend",
  displayName: "Friend",
  avatarSymbol: "F",
  bio: null,
  createdAt: "2026-10-07T00:00:00.000Z",
  relationshipWithViewer: "none",
  relationshipContext: { outgoing: null, incoming: null },
};
const controllers: ProfileViewController[] = [];
function setup(
  // Fresh object per read: the shared constant may carry a stale cache deadline.
  request = vi
    .fn()
    .mockImplementation(async () => ({ ok: true, value: { ...profile } })),
) {
  const controller = new ProfileViewController(
    { request } as unknown as ApiClient,
    "owner",
    profile.userId,
  );
  controllers.push(controller);
  controller.resume();
  return { controller, request };
}
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.pause();
  vi.useRealTimers();
});
describe("addressable profile authority", () => {
  it("preserves a settled failed-cache response without a later false timeout", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const raw = {
      request: vi.fn().mockResolvedValue({
        ok: false,
        error: {
          kind: "http_error",
          status: 404,
          code: "NOT_FOUND",
          message: "Unavailable",
        },
      }),
    } as unknown as ApiClient;
    const cache = new CommunityReadCache(
      raw,
      async () => ({ user: { id: "owner" }, accessToken: "token" }) as any,
    );
    cache.setForeground(true);
    cache.setPrincipal("owner");
    const controller = new ProfileViewController(
      cache,
      "owner",
      profile.userId,
    );
    controllers.push(controller);
    controller.resume();
    await controller.load();
    const error = controller.getState().error;
    expect(error).toBeTruthy();
    expect(error).not.toMatch(/sign in|timed out/i);
    expect(controller.getState().profile).toBeNull();
    await vi.advanceTimersByTimeAsync(LIFETIME + 1);
    expect(controller.getState().error).toBe(error);
    expect(controller.getState().loading).toBe(false);
    cache.dispose();
  });
  it("uses a full target context without inferring relationships from paginated lists", async () => {
    const { controller, request } = setup();
    await controller.load();
    expect(controller.getState().profile).toEqual(profile);
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0][0].path).toBe(
      `/v1/community/profiles/${profile.userId}`,
    );
    expect(request.mock.calls[0][0].expectedUserId).toBe("owner");
  });
  it("fails closed when directional context is missing", async () => {
    const { relationshipContext: _omitted, ...incomplete } = profile;
    const { controller } = setup(
      vi.fn().mockResolvedValue({ ok: true, value: incomplete }),
    );
    await controller.load();
    expect(controller.getState().profile).toBeNull();
    expect(controller.getState().error).toContain("unavailable");
  });
  it("preserves a reverse pending request alongside approved outgoing access and uses its incarnation", async () => {
    const overlapping = {
      ...profile,
      relationshipWithViewer: "following",
      relationshipContext: {
        outgoing: { id: "outgoing", status: "approved" },
        incoming: { id: "incoming", status: "pending" },
      },
    };
    const request = vi.fn().mockImplementation(async ({ method, path }) => ({
      ok: true,
      value:
        method === "PUT"
          ? {}
          : path.endsWith("activities?limit=20")
            ? { items: [] }
            : overlapping,
    }));
    const { controller } = setup(request);
    await controller.load();
    await controller.act("approve", controller.getState().profile!);
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "PUT",
        path: "/v1/community/relationships/incoming",
        body: { action: "approve" },
        expectedUserId: "owner",
      }),
    );
  });
  it("discards delayed target reads when navigation retires the controller", async () => {
    let finish!: (value: unknown) => void;
    const { controller } = setup(
      vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      ),
    );
    const work = controller.load();
    controller.pause();
    finish({ ok: true, value: profile });
    await work;
    expect(controller.getState().profile).toBeNull();
  });
  it("rejects a previously displayed action after read invalidation", async () => {
    const { controller, request } = setup();
    await controller.load();
    const displayed = controller.getState().profile!;
    const cache = new CommunityReadCache(
      { request } as unknown as ApiClient,
      async () => null,
    );
    invalidateCommunityReads();
    await controller.act("follow", displayed);
    expect(request).toHaveBeenCalledOnce();
    cache.dispose();
  });
  it("revalidates at the original deadline and hides old data while offline", async () => {
    vi.useFakeTimers();
    const request = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, value: profile })
      .mockResolvedValue({
        ok: false,
        error: { kind: "network_error", cause: null },
      });
    const { controller } = setup(request);
    await controller.load();
    await vi.advanceTimersByTimeAsync(LIFETIME);
    expect(controller.getState().profile).toBeNull();
    expect(controller.getState().error).toContain("connect");
  });
  it("reuses the follow operation after a lost response and refresh", async () => {
    const request = vi
      .fn()
      .mockImplementation(async ({ method }) =>
        method === "POST"
          ? { ok: false, error: { kind: "network_error", cause: null } }
          : { ok: true, value: profile },
      );
    const { controller } = setup(request);
    await controller.load();
    await controller.act("follow", controller.getState().profile!);
    await controller.load();
    await controller.act("follow", controller.getState().profile!);
    const mutations = request.mock.calls.filter(
      ([options]) => options.method === "POST",
    );
    expect(mutations).toHaveLength(2);
    expect(mutations[0][0].body.operationId).toBe(
      mutations[1][0].body.operationId,
    );
  });
  it("re-reads the visible timeline prefix when paging, clearing revoked earlier cards", async () => {
    const follower = {
      ...profile,
      relationshipWithViewer: "following",
      relationshipContext: {
        outgoing: { id: "edge", status: "approved" },
        incoming: null,
      },
    };
    let pageReads = 0;
    const request = vi.fn().mockImplementation(async ({ path }) =>
      path.includes("activities")
        ? {
            ok: true,
            value: {
              items: ++pageReads === 1 ? [{ id: "revoked-next" }] : [],
              nextCursor: pageReads <= 2 ? "cursor" : null,
            },
          }
        : { ok: true, value: follower },
    );
    const { controller } = setup(request);
    await controller.load();
    await controller.load(true);
    expect(controller.getState().activities).toEqual([]);
    expect(pageReads).toBe(3);
  });
  it("does not restart a cached identity's original authorization lifetime", async () => {
    vi.useFakeTimers();
    const request = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, value: profile })
      .mockResolvedValue({
        ok: false,
        error: { kind: "network_error", cause: null },
      });
    const cache = new CommunityReadCache(
      { request } as unknown as ApiClient,
      async () => ({ user: { id: "owner" }, accessToken: "token" }) as any,
    );
    cache.setForeground(true);
    cache.setPrincipal("owner");
    await cache.request({
      method: "GET",
      path: `/v1/community/profiles/${profile.userId}`,
      expectedUserId: "owner",
      schema: communityProfileViewDtoSchema,
    });
    await vi.advanceTimersByTimeAsync(LIFETIME - LEAD - 1_000);
    const controller = new ProfileViewController(
      cache,
      "owner",
      profile.userId,
    );
    controllers.push(controller);
    controller.resume();
    await controller.load();
    expect(controller.getState().profile).toBeTruthy();
    expect(request).toHaveBeenCalledOnce();
    // The renewal inside the lead bypasses the cache; its failure keeps the
    // content until the original deadline, which it does not extend.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(request).toHaveBeenCalledTimes(2);
    expect(controller.getState().profile).toBeTruthy();
    await vi.advanceTimersByTimeAsync(LEAD);
    expect(controller.getState().profile).toBeNull();
    cache.dispose();
  });
  it("renews silently before the deadline: profile stays, no loading or error", async () => {
    vi.useFakeTimers();
    const { controller, request } = setup();
    const states: unknown[] = [];
    controller.subscribe(() => states.push(controller.getState()));
    await controller.load();
    expect(request).toHaveBeenCalledOnce();
    states.length = 0;
    await vi.advanceTimersByTimeAsync(LIFETIME - LEAD);
    expect(request).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(LEAD + 500);
    expect(controller.getState().profile).toBeTruthy();
    expect(controller.getState().error).toBeNull();
    expect(
      (
        states as { profile: unknown; loading: boolean; error: unknown }[]
      ).every(
        (state) => state.profile && !state.loading && state.error === null,
      ),
    ).toBe(true);
    await vi.advanceTimersByTimeAsync(LIFETIME - 2 * LEAD - 500);
    expect(request).toHaveBeenCalledTimes(3);
    expect(controller.getState().profile).toBeTruthy();
  });
  it("retires the profile at the original deadline when the renewal fails or hangs", async () => {
    vi.useFakeTimers();
    for (const hang of [false, true]) {
      const request = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, value: { ...profile } })
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
      expect(controller.getState().profile).toBeTruthy();
      expect(controller.getState().error).toBeNull();
      // A failed renewal is retried while the profile stays visible.
      if (!hang) expect(request.mock.calls.length).toBeGreaterThan(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(controller.getState().profile).toBeNull();
      controller.pause();
    }
  });
  it("retires the profile at once when the renewal is explicitly denied", async () => {
    vi.useFakeTimers();
    const request = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, value: profile })
      .mockResolvedValue({
        ok: false,
        error: {
          kind: "http_error",
          status: 404,
          code: "NOT_FOUND",
          message: "",
        },
      });
    const { controller } = setup(request);
    await controller.load();
    await vi.advanceTimersByTimeAsync(LIFETIME - LEAD);
    expect(controller.getState().profile).toBeNull();
    expect(controller.getState().error).toBeTruthy();
  });
  it("revalidates a mutual profile after optional messaging denial instead of showing a false Message action", async () => {
    const mutual = {
      ...profile,
      relationshipWithViewer: "mutual",
      relationshipContext: {
        outgoing: { id: "out", status: "approved" },
        incoming: { id: "in", status: "approved" },
      },
    };
    const request = vi.fn().mockImplementation(async ({ path }) =>
      path.includes("messaging")
        ? {
            ok: false,
            error: {
              kind: "http_error",
              status: 403,
              code: "FORBIDDEN",
              message: "Unavailable",
            },
          }
        : path.includes("activities")
          ? { ok: true, value: { items: [] } }
          : { ok: true, value: mutual },
    );
    const cache = new CommunityReadCache(
      { request } as unknown as ApiClient,
      async () => ({ user: { id: "owner" }, accessToken: "token" }) as any,
    );
    cache.setForeground(true);
    cache.setPrincipal("owner");
    const controller = new ProfileViewController(
      cache,
      "owner",
      profile.userId,
    );
    controllers.push(controller);
    controller.resume();
    await controller.load();
    expect(controller.getState().profile?.userId).toBe(profile.userId);
    expect(controller.getState().canMessage).toBe(false);
    expect(
      request.mock.calls.filter(
        ([options]) =>
          options.path === `/v1/community/profiles/${profile.userId}`,
      ),
    ).toHaveLength(2);
    cache.dispose();
  });
  it("allows a server-checked report receipt's own cache invalidation while rejecting subsequent stale relationship actions", async () => {
    const { controller, request } = setup();
    await controller.load();
    const cache = new CommunityReadCache(
      { request } as unknown as ApiClient,
      async () => null,
    );
    const receipt = controller.captureReceiptIntent();
    expect(receipt()).toBe(true);
    invalidateCommunityReads();
    expect(receipt()).toBe(true);
    expect(controller.captureIntent()()).toBe(false);
    controller.pause();
    expect(receipt()).toBe(false);
    cache.dispose();
  });
  it("retires loading at the original deadline while optional contacts remain unresolved, and ignores their late success", async () => {
    vi.useFakeTimers();
    const mutual = {
      ...profile,
      relationshipWithViewer: "mutual",
      relationshipContext: {
        outgoing: { id: "out", status: "approved" },
        incoming: { id: "in", status: "approved" },
      },
    };
    let finish!: (value: unknown) => void;
    const request = vi.fn().mockImplementation(({ path }) =>
      path.includes("messaging")
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : Promise.resolve({ ok: true, value: mutual }),
    );
    const { controller } = setup(request);
    const work = controller.load();
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.getState().loading).toBe(true);
    await vi.advanceTimersByTimeAsync(LIFETIME);
    expect(controller.getState()).toMatchObject({
      loading: false,
      profile: null,
      canMessage: false,
      error: "Profile access timed out. Try again.",
    });
    finish({ ok: true, value: { contacts: [{ userId: profile.userId }] } });
    await work;
    expect(controller.getState().loading).toBe(false);
    expect(controller.getState().error).toContain("Try again");
    expect(
      request.mock.calls.some(([options]) =>
        options.path.includes("activities"),
      ),
    ).toBe(false);
  });
  it("retires loading when a required author page exceeds the original profile deadline", async () => {
    vi.useFakeTimers();
    const following = {
      ...profile,
      relationshipWithViewer: "following",
      relationshipContext: {
        outgoing: { id: "out", status: "approved" },
        incoming: null,
      },
    };
    let finish!: (value: unknown) => void;
    const request = vi.fn().mockImplementation(({ path }) =>
      path.includes("activities")
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : Promise.resolve({ ok: true, value: following }),
    );
    const { controller } = setup(request);
    const work = controller.load();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(LIFETIME);
    expect(controller.getState().loading).toBe(false);
    expect(controller.getState().profile).toBeNull();
    finish({ ok: true, value: { items: [{ id: "late-card" }] } });
    await work;
    expect(controller.getState().activities).toEqual([]);
    expect(controller.getState().error).toContain("Try again");
  });
  it("hides identity and rejects old actions when the same principal receives a new session token", async () => {
    let token = "session-one";
    const capturedToken = token;
    const request = vi.fn().mockResolvedValue({ ok: true, value: profile });
    const controller = new ProfileViewController(
      { request } as unknown as ApiClient,
      "owner",
      profile.userId,
      () => token === capturedToken,
    );
    controllers.push(controller);
    controller.resume();
    await controller.load();
    const displayed = controller.getState().profile!;
    const intent = controller.captureIntent();
    const receipt = controller.captureReceiptIntent();
    token = "session-two";
    expect(controller.getState().profile).toBeNull();
    expect(intent()).toBe(false);
    expect(receipt()).toBe(false);
    await controller.act("follow", displayed);
    expect(request).toHaveBeenCalledOnce();
  });
});
