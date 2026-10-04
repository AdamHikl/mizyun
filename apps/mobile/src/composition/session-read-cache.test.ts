import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@mizyun/api-client";
import type { AuthSession } from "@mizyun/identity";
import { unpublishActivityResponseSchema as schema } from "@mizyun/contracts";
import { SessionReadCache } from "./session-read-cache";

const options = {
  method: "GET" as const,
  path: "/v1/workouts?limit=200",
  schema,
};
const success = { ok: true as const, value: { revoked: false } };
const alice = {
  user: { id: "alice" },
  accessToken: "test-alice",
} as AuthSession;
function fixture() {
  let session: AuthSession | null = alice;
  let time = new Date(2026, 9, 3, 12).getTime();
  const request = vi.fn().mockResolvedValue(success);
  const raw = {
    request,
    status: () => ({ configured: false, reason: "fixture" }),
  } as ApiClient;
  const cache = new SessionReadCache(
    raw,
    async () => session,
    () => time,
  );
  return {
    cache,
    request,
    setSession: (next: AuthSession | null) => {
      session = next;
    },
    advance: (ms: number) => {
      time += ms;
    },
  };
}
function deferred() {
  let resolve!: (value: typeof success) => void;
  const promise = new Promise<typeof success>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

afterEach(() => vi.useRealTimers());

describe("personal screen navigation reads", () => {
  it.each([
    ["PUT", "/v1/beta-pro/push-token"],
    ["POST", "/v1/analytics/events"],
    ["DELETE", "/v1/analytics/events"],
    ["PUT", "/v1/analytics/consent"],
  ] as const)(
    "keeps startup reads alive during %s %s",
    async (method, path) => {
      const f = fixture();
      const pending = deferred();
      f.request.mockReturnValueOnce(pending.promise);
      const read = f.cache.request(options);
      await vi.waitFor(() => expect(f.request).toHaveBeenCalledTimes(1));
      await f.cache.request({ method, path });
      pending.resolve(success);
      expect(await read).toEqual(success);
      expect(await f.cache.request(options)).toEqual(success);
      expect(f.request).toHaveBeenCalledTimes(2);
    },
  );
  it("does not cancel startup reads for a repeated active event", async () => {
    const f = fixture();
    const pending = deferred();
    f.request.mockReturnValueOnce(pending.promise);
    const read = f.cache.request(options);
    await vi.waitFor(() => expect(f.request).toHaveBeenCalledTimes(1));
    f.cache.setForeground(true);
    pending.resolve(success);
    expect(await read).toEqual(success);
  });
  it("times out a stalled startup read and permits a fresh retry", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.request.mockReturnValueOnce(new Promise(() => {}));
    const pending = f.cache.request(options);
    await vi.advanceTimersByTimeAsync(20_000);
    expect((await pending).ok).toBe(false);
    expect(f.request.mock.calls[0]?.[0].signal.aborted).toBe(true);
    expect(await f.cache.request(options)).toEqual(success);
    expect(f.request).toHaveBeenCalledTimes(2);
  });
  it("does not invalidate personal reads on social commands, but does on routine import", async () => {
    const f = fixture();
    await f.cache.request(options);
    await f.cache.request({
      method: "POST",
      path: "/v1/community/groups/operations",
      body: { operation: "list" },
    });
    await f.cache.request(options);
    expect(f.request).toHaveBeenCalledTimes(2);
    await f.cache.request({
      method: "POST",
      path: "/v1/community/routines/fixture/import",
    });
    await f.cache.request(options);
    expect(f.request).toHaveBeenCalledTimes(4);
  });
  it("shares startup/focus transport and reuses completed reads", async () => {
    const { cache, request } = fixture();
    const pending = deferred();
    request.mockReturnValue(pending.promise);
    const a = cache.request(options);
    const b = cache.request(options);
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    pending.resolve(success);
    expect(await a).toEqual(success);
    expect(await b).toEqual(success);
    expect(await cache.request(options)).toEqual(success);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("rewarming after token invalidation does not retire sibling startup reads", async () => {
    const f = fixture();
    await f.cache.request(options);
    f.setSession({ ...alice, accessToken: "rotated" });
    f.cache.clear();
    const results = await Promise.all([
      f.cache.request(options),
      f.cache.request({ ...options, path: "/v1/exercises?limit=200" }),
      f.cache.request({ ...options, path: "/v1/body-measurements?limit=200" }),
    ]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(f.request).toHaveBeenCalledTimes(4);
  });
  it("invalidates conversation reads after multipart Coach messages too", async () => {
    const request = vi.fn().mockResolvedValue(success);
    const raw = {
      request,
      status: () => ({ configured: false, reason: "fixture" }),
      draftCoachMealPhoto: vi.fn().mockResolvedValue({
        ok: false,
        error: { kind: "network_error", cause: "lost response" },
      }),
    } as unknown as ApiClient;
    const cache = new SessionReadCache(raw, async () => alice);
    const conversation = {
      ...options,
      path: "/v1/coach/conversations/synthetic",
    };
    await cache.request(conversation);
    await cache.draftCoachMealPhoto!({
      conversationId: "synthetic",
      idempotencyKey: "fixture",
      photo: {} as Blob,
      mimeType: "image/jpeg",
    });
    await cache.request(conversation);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("separates query parameters and schemas", async () => {
    const { cache, request } = fixture();
    await cache.request(options);
    await cache.request({
      ...options,
      path: "/v1/workouts?kind=routine&limit=200",
    });
    await cache.request({ ...options, schema: schema.optional() });
    expect(request).toHaveBeenCalledTimes(3);
  });
  it("retires old-account responses and never supplies them to the next account", async () => {
    const { cache, request, setSession } = fixture();
    const pending = deferred();
    request.mockReturnValueOnce(pending.promise);
    const old = cache.request(options);
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    setSession({ ...alice, user: { id: "bob" } } as AuthSession);
    pending.resolve(success);
    expect((await old).ok).toBe(false);
    await cache.request(options);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("does not reuse after sign-out, token rotation, background or explicit refresh", async () => {
    const f = fixture();
    await f.cache.request(options);
    f.setSession(null);
    expect((await f.cache.request(options)).ok).toBe(false);
    f.setSession({ ...alice, accessToken: "rotated" });
    await f.cache.request(options);
    f.cache.setForeground(false);
    expect((await f.cache.request(options)).ok).toBe(false);
    f.cache.setForeground(true);
    await f.cache.request(options);
    f.cache.clear();
    await f.cache.request(options);
    expect(f.request).toHaveBeenCalledTimes(4);
  });
  it("does not keep a response from a caller retired during a shared read", async () => {
    const { cache, request } = fixture();
    const pending = deferred();
    request.mockReturnValueOnce(pending.promise);
    let current = true;
    const a = cache.request({ ...options, isCurrent: () => current });
    const b = cache.request(options);
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    current = false;
    pending.resolve(success);
    expect((await a).ok).toBe(false);
    expect(await b).toEqual(success);
  });
  it("expires after five minutes and on a new local day", async () => {
    const f = fixture();
    await f.cache.request(options);
    f.advance(5 * 60_000);
    await f.cache.request(options);
    f.advance(24 * 60 * 60_000);
    await f.cache.request(options);
    expect(f.request).toHaveBeenCalledTimes(3);
  });
  it("does not cache failures", async () => {
    const f = fixture();
    f.request.mockResolvedValueOnce({
      ok: false,
      error: { kind: "network_error" },
    });
    await f.cache.request(options);
    await f.cache.request(options);
    expect(f.request).toHaveBeenCalledTimes(2);
  });
  it("invalidates even a lost write response and rejects concurrent pre-write reads", async () => {
    const f = fixture();
    const pending = deferred();
    f.request.mockReturnValueOnce(pending.promise);
    const old = f.cache.request(options);
    await vi.waitFor(() => expect(f.request).toHaveBeenCalledTimes(1));
    f.request.mockResolvedValueOnce({
      ok: false,
      error: { kind: "network_error" },
    });
    await f.cache.request({
      method: "PATCH",
      path: "/v1/workouts/id",
      body: { name: "updated" },
    });
    pending.resolve(success);
    expect((await old).ok).toBe(false);
    await f.cache.request(options);
    expect(f.request).toHaveBeenCalledTimes(3);
  });
  it("bypasses authority, Community, signed media and custom cancellation", async () => {
    const f = fixture();
    for (const path of [
      "/v1/coach/status",
      "/v1/food-entries/capabilities",
      "/v1/community/feed",
      "/v1/media/timeline?purpose=progress",
    ]) {
      await f.cache.request({ ...options, path });
      await f.cache.request({ ...options, path });
    }
    const signal = new AbortController().signal;
    await f.cache.request({ ...options, signal });
    await f.cache.request({ ...options, signal });
    expect(f.request).toHaveBeenCalledTimes(10);
  });
  it("rejects wrong-account intent before accessing a cached value", async () => {
    const f = fixture();
    await f.cache.request(options);
    expect(
      (await f.cache.request({ ...options, expectedUserId: "bob" })).ok,
    ).toBe(false);
    expect(f.request).toHaveBeenCalledTimes(1);
  });
});

describe("server scheduled meal freshness", () => {
  it("expires meal entries and totals after one minute while retaining other screen reads", async () => {
    const f = fixture();
    const paths = [
      "/v1/food-entries?limit=200",
      "/v1/food-entries/summary?date=2026-10-03",
      "/v1/energy/summary?date=2026-10-03",
      options.path,
    ];
    for (const path of paths) await f.cache.request({ ...options, path });
    f.advance(59_999);
    for (const path of paths) await f.cache.request({ ...options, path });
    expect(f.request).toHaveBeenCalledTimes(4);
    f.advance(1);
    for (const path of paths) await f.cache.request({ ...options, path });
    expect(f.request).toHaveBeenCalledTimes(7);
  });
  it("does not retain schedule management reads", async () => {
    const f = fixture();
    await f.cache.request({ ...options, path: "/v1/recurring-meals" });
    await f.cache.request({ ...options, path: "/v1/recurring-meals" });
    expect(f.request).toHaveBeenCalledTimes(2);
  });
});
