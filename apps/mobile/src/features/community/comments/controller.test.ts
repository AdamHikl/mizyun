import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@mizyun/api-client";
import { CommentsController } from "./controller";
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
    await vi.advanceTimersByTimeAsync(10_000);
    expect(controller.getSnapshot().items).toEqual([]);
    expect(controller.getSnapshot().candidates).toEqual([]);
    expect(controller.getSnapshot().privacyRevision).toBeGreaterThan(
      privacyRevision,
    );
    expect(request).toHaveBeenCalledTimes(3);
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
    await vi.advanceTimersByTimeAsync(10_000);
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
    await vi.advanceTimersByTimeAsync(10_000);
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
