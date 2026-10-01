import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@mizyun/api-client";
import type { SharedActivityFeedItemDto } from "@mizyun/contracts";
import { FeedController, INITIAL_FEED_STATE } from "./controller";
import { ReactionBarController } from "../reactions/reaction-bar-controller";

const mockItem1: SharedActivityFeedItemDto = {
  id: "00000000-0000-4000-8000-000000000001",
  authorUserId: "00000000-0000-4000-8000-000000000011",
  authorHandle: "alex_runner",
  authorDisplayName: "Alex",
  authorAvatarSymbol: "AR",
  category: "running",
  sharedDay: "2026-09-30",
  durationSeconds: 1800,
  workoutDetails: null,
  publishedAt: "2026-09-30T10:00:00Z",
  reactionCounts: {},
  viewerReaction: null,
};

const mockItem2: SharedActivityFeedItemDto = {
  id: "00000000-0000-4000-8000-000000000002",
  authorUserId: "00000000-0000-4000-8000-000000000012",
  authorHandle: "sam_lift",
  authorDisplayName: "Sam",
  authorAvatarSymbol: "SL",
  category: "strength",
  sharedDay: "2026-09-30",
  durationSeconds: 3600,
  workoutDetails: null,
  publishedAt: "2026-09-30T11:00:00Z",
  reactionCounts: {},
  viewerReaction: null,
};

const mockItem3: SharedActivityFeedItemDto = {
  id: "00000000-0000-4000-8000-000000000003",
  authorUserId: "00000000-0000-4000-8000-000000000013",
  authorHandle: "taylor_swim",
  authorDisplayName: "Taylor",
  authorAvatarSymbol: "TS",
  category: "other",
  sharedDay: "2026-09-30",
  durationSeconds: 2400,
  workoutDetails: null,
  publishedAt: "2026-09-30T12:00:00Z",
  reactionCounts: {},
  viewerReaction: null,
};

function setup(
  request = vi.fn(),
  principalKey: string | null = "user-123",
  isAlive: () => boolean = () => true,
) {
  const client = { request } as unknown as ApiClient;
  const controller = new FeedController(client, principalKey, isAlive);
  return { client, request, controller };
}

describe("FeedController", () => {
  it("clears the feed immediately after a denied reaction before fresh feed authority returns", async () => {
    let finish!: (result: unknown) => void;
    const waiting = new Promise((done) => {
      finish = done;
    });
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        value: { items: [mockItem1], nextCursor: null },
      })
      .mockResolvedValueOnce({
        ok: false,
        error: {
          kind: "http_error",
          status: 404,
          code: "NOT_FOUND",
          message: "Unavailable",
        },
      })
      .mockReturnValueOnce(waiting);
    const { controller, client } = setup(request);
    await controller.load();
    expect(controller.getSnapshot().items).toEqual([mockItem1]);
    let refreshing: Promise<void> | undefined;
    const reactions = new ReactionBarController({
      activityId: mockItem1.id,
      authorUserId: mockItem1.authorUserId,
      viewerUserId: "user-123",
      initialViewerReaction: null,
      scopedClient: client,
      onUnavailable: () => {
        controller.pause();
        controller.resume();
        refreshing = controller.refresh();
      },
    });
    expect(await reactions.toggleReaction("fire")).toBe(false);
    expect(controller.getSnapshot().items).toEqual([]);
    expect(controller.getSnapshot().status).toBe("refreshing");
    finish({ ok: true, value: { items: [], nextCursor: null } });
    await refreshing;
    expect(controller.getSnapshot().items).toEqual([]);
    expect(controller.getSnapshot().status).toBe("idle");
  });
  it("initializes with empty default state", () => {
    const { controller } = setup();
    expect(controller.getSnapshot()).toEqual(INITIAL_FEED_STATE);
    expect(controller.getState()).toEqual(INITIAL_FEED_STATE);
  });

  describe("initial load", () => {
    it("fetches feed with limit 20, updates items, nextCursor, hasMore, and notifies listeners", async () => {
      const request = vi.fn().mockResolvedValue({
        ok: true,
        value: {
          items: [mockItem1, mockItem2],
          nextCursor: "cursor-page-2",
        },
      });
      const { controller } = setup(request);

      const listener = vi.fn();
      const unsubscribe = controller.subscribe(listener);

      const loadPromise = controller.load();
      expect(controller.getSnapshot().status).toBe("loading");
      expect(listener).toHaveBeenCalled();

      await loadPromise;

      expect(controller.getSnapshot()).toEqual({
        items: [mockItem1, mockItem2],
        nextCursor: "cursor-page-2",
        hasMore: true,
        status: "idle",
        error: null,
      });

      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "GET",
          path: "/v1/community/feed?limit=20",
          expectedUserId: "user-123",
        }),
      );

      unsubscribe();
    });

    it("sets hasMore to false when nextCursor is null or missing", async () => {
      const request = vi.fn().mockResolvedValue({
        ok: true,
        value: {
          items: [mockItem1],
          nextCursor: null,
        },
      });
      const { controller } = setup(request);

      await controller.load();

      expect(controller.getSnapshot()).toEqual({
        items: [mockItem1],
        nextCursor: null,
        hasMore: false,
        status: "idle",
        error: null,
      });
    });

    it("ignores subsequent load calls when already loading or refreshing", async () => {
      let resolveFirst!: (value: unknown) => void;
      const request = vi.fn().mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      );
      const { controller } = setup(request);

      const p1 = controller.load();
      expect(controller.getSnapshot().status).toBe("loading");

      // Concurrent call
      const p2 = controller.load();

      expect(request).toHaveBeenCalledTimes(1);

      resolveFirst({
        ok: true,
        value: { items: [mockItem1], nextCursor: null },
      });
      await Promise.all([p1, p2]);

      expect(request).toHaveBeenCalledTimes(1);
      expect(controller.getSnapshot().items).toEqual([mockItem1]);
    });
  });

  describe("refresh", () => {
    it("replaces existing items and resets cursor on success", async () => {
      const request = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          value: {
            items: [mockItem1],
            nextCursor: "cursor-1",
          },
        })
        .mockResolvedValueOnce({
          ok: true,
          value: {
            items: [mockItem2, mockItem3],
            nextCursor: "cursor-refreshed",
          },
        });
      const { controller } = setup(request);

      await controller.load();
      expect(controller.getSnapshot().items).toEqual([mockItem1]);
      expect(controller.getSnapshot().nextCursor).toBe("cursor-1");

      const refreshPromise = controller.refresh();
      expect(controller.getSnapshot().status).toBe("refreshing");

      await refreshPromise;

      expect(controller.getSnapshot()).toEqual({
        items: [mockItem2, mockItem3],
        nextCursor: "cursor-refreshed",
        hasMore: true,
        status: "idle",
        error: null,
      });
      expect(request).toHaveBeenCalledTimes(2);
      expect(request).toHaveBeenLastCalledWith(
        expect.objectContaining({
          method: "GET",
          path: "/v1/community/feed?limit=20",
        }),
      );
    });

    it("ignores duplicate refresh calls when already refreshing", async () => {
      let resolveRefresh!: (value: unknown) => void;
      const request = vi.fn().mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveRefresh = resolve;
          }),
      );
      const { controller } = setup(request);

      const r1 = controller.refresh();
      expect(controller.getSnapshot().status).toBe("refreshing");

      const r2 = controller.refresh();
      expect(request).toHaveBeenCalledTimes(1);

      resolveRefresh({
        ok: true,
        value: { items: [mockItem1], nextCursor: null },
      });
      await Promise.all([r1, r2]);

      expect(request).toHaveBeenCalledTimes(1);
    });
  });

  describe("loadMore", () => {
    it("appends new items, avoids duplicates by ID, and updates nextCursor", async () => {
      const request = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          value: {
            items: [mockItem1, mockItem2],
            nextCursor: "cursor-page-2",
          },
        })
        .mockResolvedValueOnce({
          ok: true,
          value: { items: [mockItem1, mockItem2], nextCursor: "cursor-page-2" },
        })
        .mockResolvedValueOnce({
          ok: true,
          value: {
            // mockItem2 is duplicate, mockItem3 is new
            items: [mockItem2, mockItem3],
            nextCursor: "cursor-page-3",
          },
        });
      const { controller } = setup(request);

      await controller.load();
      expect(controller.getSnapshot().items).toHaveLength(2);

      const loadMorePromise = controller.loadMore();
      expect(controller.getSnapshot().status).toBe("loading_more");

      await loadMorePromise;

      expect(controller.getSnapshot()).toEqual({
        items: [mockItem1, mockItem2, mockItem3],
        nextCursor: "cursor-page-3",
        hasMore: true,
        status: "idle",
        error: null,
      });

      expect(request).toHaveBeenLastCalledWith(
        expect.objectContaining({
          method: "GET",
          path: "/v1/community/feed?limit=20&cursor=cursor-page-2",
        }),
      );
    });

    it("sets hasMore to false and advances cursor when nextCursor is null", async () => {
      const request = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          value: {
            items: [mockItem1],
            nextCursor: "cursor-page-2",
          },
        })
        .mockResolvedValueOnce({
          ok: true,
          value: { items: [mockItem1], nextCursor: "cursor-page-2" },
        })
        .mockResolvedValueOnce({
          ok: true,
          value: {
            items: [mockItem2],
            nextCursor: null,
          },
        });
      const { controller } = setup(request);

      await controller.load();
      await controller.loadMore();

      expect(controller.getSnapshot()).toEqual({
        items: [mockItem1, mockItem2],
        nextCursor: null,
        hasMore: false,
        status: "idle",
        error: null,
      });

      // Subsequent call does nothing because hasMore is false and nextCursor is null
      await controller.loadMore();
      expect(request).toHaveBeenCalledTimes(3);
    });

    it("returns early if status is not idle", async () => {
      let resolveLoad!: (value: unknown) => void;
      const request = vi.fn().mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveLoad = resolve;
          }),
      );
      const { controller } = setup(request);

      void controller.load();
      expect(controller.getSnapshot().status).toBe("loading");

      // While loading, loadMore is a no-op
      await controller.loadMore();
      expect(request).toHaveBeenCalledTimes(1);

      resolveLoad({
        ok: true,
        value: { items: [mockItem1], nextCursor: "c1" },
      });
    });

    it("returns early if nextCursor is null or hasMore is false", async () => {
      const request = vi.fn().mockResolvedValue({
        ok: true,
        value: {
          items: [mockItem1],
          nextCursor: null,
        },
      });
      const { controller } = setup(request);

      await controller.load();
      expect(controller.getSnapshot().hasMore).toBe(false);

      await controller.loadMore();
      expect(request).toHaveBeenCalledTimes(1);
    });
  });

  describe("error handling", () => {
    it("handles load error with humanizeCommunityError and sets status: error", async () => {
      const request = vi.fn().mockResolvedValue({
        ok: false,
        error: {
          kind: "http_error",
          status: 403,
          code: "COMMUNITY_NOT_ENROLLED",
          message: "Forbidden",
        },
      });
      const { controller } = setup(request);

      await controller.load();

      expect(controller.getSnapshot()).toEqual({
        items: [],
        nextCursor: null,
        hasMore: false,
        status: "error",
        error: "You must join Mizyun Friends to view community features.",
      });
    });

    it("clears existing cards before an offline refresh", async () => {
      const request = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          value: {
            items: [mockItem1],
            nextCursor: "cursor-1",
          },
        })
        .mockResolvedValueOnce({
          ok: false,
          error: {
            kind: "network_error",
          },
        });
      const { controller } = setup(request);

      await controller.load();
      await controller.refresh();

      expect(controller.getSnapshot().status).toBe("error");
      expect(controller.getSnapshot().error).toBe(
        "Unable to connect. Please check your internet connection.",
      );
      // Private cards cannot be retained after failed authority refresh.
      expect(controller.getSnapshot().items).toEqual([]);
    });

    it("clears cards when pagination authority cannot be verified", async () => {
      const request = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          value: {
            items: [mockItem1],
            nextCursor: "cursor-1",
          },
        })
        .mockResolvedValueOnce({
          ok: false,
          error: {
            kind: "http_error",
            status: 429,
            code: "RATE_LIMITED",
            message: "Too many requests",
          },
        });
      const { controller } = setup(request);

      await controller.load();
      await controller.loadMore();

      expect(controller.getSnapshot().status).toBe("error");
      expect(controller.getSnapshot().error).toBe(
        "Too many requests. Please try again later.",
      );
      expect(controller.getSnapshot().items).toEqual([]);
    });
  });

  describe("principalKey isolation & account switch / reset", () => {
    it("binds all requests to principalKey via scoped client", async () => {
      const request = vi.fn().mockResolvedValue({
        ok: true,
        value: { items: [], nextCursor: null },
      });
      const { controller } = setup(request, "account-xyz");

      await controller.load();

      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          expectedUserId: "account-xyz",
        }),
      );
    });

    it("short-circuits with no_session error when principalKey is null", async () => {
      const request = vi.fn();
      const { controller } = setup(request, null);

      await controller.load();

      // Scoped client intercepts before calling underlying client
      expect(request).not.toHaveBeenCalled();
      expect(controller.getSnapshot().status).toBe("error");
      expect(controller.getSnapshot().error).toBe(
        "Please sign in to access community features.",
      );
    });

    it("resets state immediately and drops in-flight responses", async () => {
      let resolveFirst!: (value: unknown) => void;
      const request = vi.fn().mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      );
      const { controller } = setup(request);

      const loadPromise = controller.load();
      expect(controller.getSnapshot().status).toBe("loading");

      controller.reset();
      expect(controller.getSnapshot()).toEqual(INITIAL_FEED_STATE);

      // In-flight response resolves later
      resolveFirst({
        ok: true,
        value: { items: [mockItem1], nextCursor: "stale-cursor" },
      });
      await loadPromise;

      // Must remain reset and not overwritten by stale response
      expect(controller.getSnapshot()).toEqual(INITIAL_FEED_STATE);
    });

    it("switches account, resets state, and binds new requests to new principal", async () => {
      const request = vi.fn().mockResolvedValue({
        ok: true,
        value: { items: [mockItem1], nextCursor: null },
      });
      const { controller } = setup(request, "account-1");

      await controller.load();
      expect(controller.getSnapshot().items).toEqual([mockItem1]);

      controller.switchAccount("account-2");
      expect(controller.getSnapshot()).toEqual(INITIAL_FEED_STATE);

      await controller.load();
      expect(request).toHaveBeenLastCalledWith(
        expect.objectContaining({
          expectedUserId: "account-2",
        }),
      );
    });
  });

  describe("isAlive / unmount cancellation", () => {
    it("returns early and does not call fetch when isAlive is false before load", async () => {
      let alive = false;
      const request = vi.fn();
      const { controller } = setup(request, "user-1", () => alive);

      await controller.load();
      expect(request).not.toHaveBeenCalled();
      expect(controller.getSnapshot()).toEqual(INITIAL_FEED_STATE);

      await controller.refresh();
      expect(request).not.toHaveBeenCalled();

      await controller.loadMore();
      expect(request).not.toHaveBeenCalled();
    });

    it("drops response and does not notify listeners if isAlive becomes false while fetch is in flight", async () => {
      let alive = true;
      let resolveLoad!: (value: unknown) => void;
      const request = vi.fn().mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveLoad = resolve;
          }),
      );
      const { controller } = setup(request, "user-1", () => alive);

      const listener = vi.fn();
      controller.subscribe(listener);

      const loadPromise = controller.load();
      expect(controller.getSnapshot().status).toBe("loading");
      listener.mockClear();

      // Controller unmounts before response returns
      alive = false;

      resolveLoad({
        ok: true,
        value: { items: [mockItem1], nextCursor: "c1" },
      });
      await loadPromise;

      // State was not updated with items, listener was not called
      expect(controller.getSnapshot().items).toEqual([]);
      expect(listener).not.toHaveBeenCalled();
    });
  });
  it("clears on background and never accepts the pre-background response after resume", async () => {
    let finish!: (value: unknown) => void;
    const request = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValueOnce({
        ok: true,
        value: { items: [mockItem2], nextCursor: null },
      });
    const { controller } = setup(request);
    const oldRead = controller.load();
    controller.pause();
    expect(controller.getState()).toEqual(INITIAL_FEED_STATE);
    await controller.load();
    expect(request).toHaveBeenCalledTimes(1);
    controller.resume();
    await controller.load();
    finish({ ok: true, value: { items: [mockItem1], nextCursor: null } });
    await oldRead;
    expect(controller.getState().items).toEqual([mockItem2]);
  });
  it("pagination revalidates earlier pages and removes remotely revoked cards before rendering", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        value: { items: [mockItem1], nextCursor: "old" },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: { items: [mockItem2], nextCursor: "new" },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: { items: [mockItem3], nextCursor: null },
      });
    const { controller } = setup(request);
    await controller.load();
    const more = controller.loadMore();
    expect(controller.getState().items).toEqual([]);
    await more;
    expect(controller.getState().items).toEqual([mockItem2, mockItem3]);
    expect(request).toHaveBeenLastCalledWith(
      expect.objectContaining({
        path: "/v1/community/feed?limit=20&cursor=new",
      }),
    );
  });
});
