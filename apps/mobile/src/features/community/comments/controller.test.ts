import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@mizyun/api-client";
import {
  COMMUNITY_READ_RENEWAL_LEAD_MS as LEAD,
  COMMUNITY_READ_RENEWAL_RETRY_MS as RETRY,
} from "../state/read-cache";
import {
  COMMENT_AUTHORITY_LIFETIME_MS as LIFETIME,
  CommentsController,
} from "./controller";
const cache = vi.hoisted(() => ({
  deadlines: new WeakMap<object, number>(),
  invalidate: vi.fn(),
}));
vi.mock("../state/read-cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../state/read-cache")>()),
  getCommunityReadDeadline: (value: object) => cache.deadlines.get(value),
  invalidateCommunityReads: cache.invalidate,
}));
const author = {
  userId: "alice",
  handle: "alice",
  displayName: "Alice",
  avatarSymbol: "A",
};
const comment = {
  id: "one",
  activityId: "activity",
  parentId: null,
  author,
  body: "Private to audience",
  version: 1,
  createdAt: "2026-10-01T12:00:00.000Z",
  updatedAt: "2026-10-01T12:00:00.000Z",
  mentions: [],
};
const page = (items = [comment], nextCursor: string | null = null) => ({
  items,
  nextCursor,
  enabled: true,
  canManage: false,
  allowMentions: false,
});
const client = (request: ReturnType<typeof vi.fn>) =>
  ({ request, status: () => ({ kind: "ready" }) }) as unknown as ApiClient;
describe("comment memory and authorization lifetime", () => {
  afterEach(() => vi.useRealTimers());
  it("hides idle foreground text when a remote unpublish denies the bounded recheck", async () => {
    vi.useFakeTimers();
    let revoked = false;
    const request = vi.fn(async (options) =>
      revoked
        ? { ok: false, error: { kind: "no_session" } }
        : {
            ok: true,
            value: options.path.endsWith("candidates")
              ? { items: [author] }
              : page(),
          },
    );
    const controller = new CommentsController(
      client(request),
      "alice",
      "activity",
    );
    await controller.load();
    const privacyRevision = controller.getSnapshot().privacyRevision;
    revoked = true;
    await vi.advanceTimersByTimeAsync(LIFETIME);
    expect(controller.getSnapshot().items).toEqual([]);
    expect(controller.getSnapshot().candidates).toEqual([]);
    expect(controller.getSnapshot().privacyRevision).toBeGreaterThan(
      privacyRevision,
    );
    expect(request).toHaveBeenCalledTimes(4);
    controller.pause();
  });
  it("renews silently before the deadline: text stays, no error, no privacy reset", async () => {
    vi.useFakeTimers();
    const request = vi.fn(async (options) => ({
      ok: true,
      value: options.path.endsWith("candidates") ? { items: [author] } : page(),
    }));
    const controller = new CommentsController(
      client(request),
      "alice",
      "activity",
    );
    const states: unknown[] = [];
    controller.subscribe(() => states.push(controller.getSnapshot()));
    await controller.load();
    const privacyRevision = controller.getSnapshot().privacyRevision;
    states.length = 0;
    await vi.advanceTimersByTimeAsync(LIFETIME - LEAD);
    expect(request).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(LEAD + 500);
    const snapshot = controller.getSnapshot();
    expect(snapshot.items).toHaveLength(1);
    expect(snapshot.error).toBeNull();
    expect(snapshot.privacyRevision).toBe(privacyRevision);
    expect(
      (states as { items: unknown[]; error: unknown }[]).every(
        (state) => state.items.length === 1 && state.error === null,
      ),
    ).toBe(true);
    // The fresh lease renews again instead of expiring at the old deadline.
    await vi.advanceTimersByTimeAsync(LIFETIME - 2 * LEAD - 500);
    expect(request).toHaveBeenCalledTimes(6);
    controller.pause();
  });
  it("retires text at the original deadline when the renewal fails or hangs", async () => {
    vi.useFakeTimers();
    for (const mode of ["fail", "hang"]) {
      let calls = 0;
      const request = vi.fn(async (options) => {
        if (++calls > 2)
          return mode === "hang"
            ? new Promise<never>(() => {})
            : { ok: false, error: { kind: "network_error", cause: null } };
        return {
          ok: true,
          value: options.path.endsWith("candidates")
            ? { items: [author] }
            : page(),
        };
      });
      const controller = new CommentsController(
        client(request),
        "alice",
        "activity",
      );
      await controller.load();
      await vi.advanceTimersByTimeAsync(LIFETIME - 1);
      expect(controller.getSnapshot().items).toHaveLength(1);
      // A failed renewal is retried while the content stays visible.
      if (mode === "fail") expect(request.mock.calls.length).toBeGreaterThan(4);
      await vi.advanceTimersByTimeAsync(1);
      expect(controller.getSnapshot().items).toEqual([]);
      controller.pause();
    }
  });
  it("retries a transiently failed renewal and keeps the text past the original deadline", async () => {
    vi.useFakeTimers();
    let failing = false;
    const request = vi.fn(async (options) =>
      failing
        ? { ok: false, error: { kind: "network_error", cause: null } }
        : {
            ok: true,
            value: options.path.endsWith("candidates")
              ? { items: [author] }
              : page(),
          },
    );
    const controller = new CommentsController(
      client(request),
      "alice",
      "activity",
    );
    await controller.load();
    expect(request).toHaveBeenCalledTimes(2);
    failing = true;
    const privacyRevision = controller.getSnapshot().privacyRevision;
    await vi.advanceTimersByTimeAsync(LIFETIME - LEAD);
    expect(request).toHaveBeenCalledTimes(4);
    expect(controller.getSnapshot().items).toHaveLength(1);
    failing = false;
    await vi.advanceTimersByTimeAsync(RETRY);
    expect(request).toHaveBeenCalledTimes(6);
    await vi.advanceTimersByTimeAsync(LEAD);
    expect(Date.now()).toBeGreaterThan(LIFETIME);
    const snapshot = controller.getSnapshot();
    expect(snapshot.items).toHaveLength(1);
    expect(snapshot.error).toBeNull();
    expect(snapshot.privacyRevision).toBe(privacyRevision);
    controller.pause();
  });
  it("clears at once when the renewal is explicitly denied", async () => {
    vi.useFakeTimers();
    let denied = false;
    const request = vi.fn(async (options) =>
      denied
        ? {
            ok: false,
            error: { kind: "http_error", status: 403, code: "x", message: "" },
          }
        : {
            ok: true,
            value: options.path.endsWith("candidates")
              ? { items: [author] }
              : page(),
          },
    );
    const controller = new CommentsController(
      client(request),
      "alice",
      "activity",
    );
    await controller.load();
    denied = true;
    await vi.advanceTimersByTimeAsync(LIFETIME - LEAD);
    expect(controller.getSnapshot().items).toEqual([]);
    controller.pause();
  });
  it("expires compound restored reads at the earliest original deadline, without extending their lease", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(5_000);
    const comments = page();
    const candidates = { items: [author] };
    cache.deadlines.set(comments, 5_000 + LIFETIME);
    cache.deadlines.set(candidates, 5_000 + LIFETIME - 1_000);
    let denied = false;
    const request = vi.fn(async (options) =>
      denied
        ? { ok: false, error: { kind: "network_error", cause: null } }
        : {
            ok: true,
            value: options.path.endsWith("candidates") ? candidates : comments,
          },
    );
    const controller = new CommentsController(
      client(request),
      "alice",
      "activity",
    );
    await controller.load();
    expect(controller.getSnapshot().items).toHaveLength(1);
    denied = true;
    await vi.advanceTimersByTimeAsync(LIFETIME - 1_000 - 1);
    expect(controller.getSnapshot().items).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(controller.getSnapshot().items).toEqual([]);
    expect(controller.getSnapshot().candidates).toEqual([]);
    controller.pause();
  });
  it("starts candidates alongside the page and invalidates navigation reads only for explicit refresh", async () => {
    let finish!: (response: unknown) => void;
    const request = vi.fn((options) =>
      options.path.endsWith("candidates")
        ? Promise.resolve({ ok: true, value: { items: [] } })
        : new Promise((resolve) => {
            finish = resolve;
          }),
    );
    const controller = new CommentsController(
      client(request),
      "alice",
      "activity",
    );
    cache.invalidate.mockClear();
    const loading = controller.load();
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(2);
    expect(cache.invalidate).not.toHaveBeenCalled();
    finish({ ok: true, value: page() });
    await loading;
    request.mockImplementation(async (options) => ({
      ok: true,
      value: options.path.endsWith("candidates") ? { items: [] } : page(),
    }));
    await controller.refresh();
    expect(cache.invalidate).toHaveBeenCalledTimes(1);
    controller.pause();
  });
  it("does not restart a lease when candidates arrive after a failed page read", async () => {
    vi.useFakeTimers();
    let finish!: (response: unknown) => void;
    const request = vi.fn((options) =>
      options.path.endsWith("candidates")
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : Promise.resolve({ ok: false, error: { kind: "no_session" } }),
    );
    const controller = new CommentsController(
      client(request),
      "alice",
      "activity",
    );
    await controller.load();
    expect(controller.getSnapshot().error).not.toBeNull();
    const candidates = { items: [author] };
    cache.deadlines.set(candidates, Date.now() + LIFETIME);
    finish({ ok: true, value: candidates });
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(LIFETIME);
    expect(request).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot().items).toEqual([]);
    expect(controller.getSnapshot().candidates).toEqual([]);
    controller.pause();
  });
  it("a stalled candidate check cannot extend the first page authority or restore expired content", async () => {
    vi.useFakeTimers();
    let candidates: ((value: unknown) => void) | undefined;
    const request = vi.fn(async (options) =>
      options.path.endsWith("candidates")
        ? new Promise((resolve) => {
            candidates = resolve;
          })
        : { ok: true, value: page() },
    );
    const controller = new CommentsController(
      client(request),
      "alice",
      "activity",
    );
    const loading = controller.load();
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(LIFETIME);
    expect(controller.getSnapshot().busy).toBe(false);
    expect(controller.getSnapshot().items).toEqual([]);
    candidates!({ ok: true, value: { items: [author] } });
    await loading;
    expect(controller.getSnapshot().items).toEqual([]);
    expect(controller.getSnapshot().candidates).toEqual([]);
    expect(controller.getSnapshot().error).toContain("fresh check");
    controller.pause();
  });
  it("expires foreground content during a stalled mutation independently of request revisions", async () => {
    vi.useFakeTimers();
    let finish: ((value: unknown) => void) | undefined;
    const request = vi.fn(async (options) => {
      if (options.method === "DELETE")
        return new Promise((resolve) => {
          finish = resolve;
        });
      return {
        ok: true,
        value: options.path.endsWith("candidates")
          ? { items: [author] }
          : page(),
      };
    });
    const controller = new CommentsController(
      client(request),
      "alice",
      "activity",
    );
    await controller.load();
    const pending = controller.remove("one", 1);
    expect(controller.getSnapshot().items).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(LIFETIME);
    expect(controller.getSnapshot().items).toEqual([]);
    expect(controller.getSnapshot().candidates).toEqual([]);
    expect(controller.getSnapshot().busy).toBe(false);
    finish!({ ok: true, value: { id: "one", version: 2 } });
    expect(await pending).toBe(false);
    expect(controller.getSnapshot().notice).toBeNull();
    controller.pause();
  });
  it("discards late results after account switch", async () => {
    let resolve: (value: unknown) => void = () => {};
    const request = vi.fn(
      (_options: { expectedUserId?: string }) =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const controller = new CommentsController(
      client(request),
      "alice",
      "activity",
    );
    const pending = controller.load();
    controller.switchAccount("bob");
    resolve({ ok: true, value: page() });
    await pending;
    expect(controller.getSnapshot().items).toEqual([]);
    expect(request.mock.calls[0]![0].expectedUserId).toBe("alice");
  });
  it("clears text and retires pending intents on blur/background", async () => {
    const request = vi.fn(async (options) => ({
      ok: true,
      value: options.path.endsWith("candidates") ? { items: [] } : page(),
    }));
    const controller = new CommentsController(
      client(request),
      "alice",
      "activity",
    );
    await controller.load();
    expect(controller.getSnapshot().items).toHaveLength(1);
    controller.pause();
    expect(controller.getSnapshot().items).toEqual([]);
    expect(await controller.remove("one", 1)).toBe(false);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("reauthorizes the prefix before adding another page and clears on denial", async () => {
    let denied = false;
    const request = vi.fn(async (options) =>
      options.path.endsWith("candidates")
        ? { ok: true, value: { items: [] } }
        : denied
          ? { ok: false, error: { kind: "no_session" } }
          : { ok: true, value: page([comment], "cursor") },
    );
    const controller = new CommentsController(
      client(request),
      "alice",
      "activity",
    );
    await controller.load();
    denied = true;
    await controller.load(true);
    expect(controller.getSnapshot().items).toEqual([]);
    expect(request.mock.calls[2]![0].path).not.toContain("cursor=");
  });
  it("a delayed delete confirmation cannot target retired text", async () => {
    const request = vi.fn(async (options) => ({
      ok: true,
      value: options.path.endsWith("candidates") ? { items: [] } : page(),
    }));
    const controller = new CommentsController(
      client(request),
      "alice",
      "activity",
    );
    await controller.load();
    controller.pause();
    controller.resume();
    expect(await controller.remove("one", 1)).toBe(false);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("retires an acknowledged mutation whose refresh crosses background/resume", async () => {
    let refresh: ((value: unknown) => void) | undefined;
    let reloading = false;
    const request = vi.fn(async (options) => {
      if (options.method === "DELETE") {
        reloading = true;
        return { ok: true, value: { id: "one", version: 2 } };
      }
      if (reloading)
        return new Promise((resolve) => {
          refresh = resolve;
        });
      return {
        ok: true,
        value: options.path.endsWith("candidates") ? { items: [] } : page(),
      };
    });
    const controller = new CommentsController(
      client(request),
      "alice",
      "activity",
    );
    await controller.load();
    const pending = controller.remove("one", 1);
    await vi.waitFor(() => expect(refresh).toBeTypeOf("function"));
    controller.pause();
    controller.resume();
    refresh!({ ok: true, value: page([]) });
    expect(await pending).toBe(false);
    expect(controller.getSnapshot().notice).toBeNull();
    expect(controller.getSnapshot().items).toEqual([]);
  });
});
