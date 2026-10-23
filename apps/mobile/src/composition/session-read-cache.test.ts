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
  const sessionLookup = vi.fn(async () => session);
  const cache = new SessionReadCache(raw, sessionLookup, () => time);
  return {
    cache,
    request,
    sessionLookup,
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
  it("projects a completed startup read synchronously without auth or transport IO", async () => {
    const f = fixture();
    expect(f.cache.peek(options, alice)).toBeNull();
    expect(f.sessionLookup).not.toHaveBeenCalled();
    await f.cache.request(options);
    f.request.mockClear();
    f.sessionLookup.mockClear();
    expect(f.cache.peek(options, alice)).toEqual(success);
    expect(f.cache.peek(options, alice)).toEqual(success);
    expect(f.request).not.toHaveBeenCalled();
    expect(f.sessionLookup).not.toHaveBeenCalled();
  });
  it("never projects another owner, unscoped query, authority or retired caller", async () => {
    const f = fixture();
    await f.cache.request(options);
    for (const owner of [
      null,
      { ...alice, user: { ...alice.user, id: "bob" } } as AuthSession,
    ]) {
      expect(f.cache.peek(options, owner)).toBeNull();
    }
    // A routine token refresh keeps the same account's display records.
    expect(f.cache.peek(options, { ...alice, accessToken: "rotated" })).toEqual(
      success,
    );
    expect(
      f.cache.peek({ ...options, expectedUserId: "bob" }, alice),
    ).toBeNull();
    expect(
      f.cache.peek({ ...options, isCurrent: () => false }, alice),
    ).toBeNull();
    expect(
      f.cache.peek({ ...options, path: "/v1/workouts?limit=5" }, alice),
    ).toBeNull();
    expect(
      f.cache.peek({ ...options, path: "/v1/coach/status" }, alice),
    ).toBeNull();
    expect(
      f.cache.peek({ ...options, schema: schema.extend({}) }, alice),
    ).toBeNull();
    expect(
      f.cache.peek({ ...options, signal: new AbortController().signal }, alice),
    ).toBeNull();
  });
  it("retires synchronous display on expiry, clear, while backgrounded and on mutation dispatch", async () => {
    const f = fixture();
    await f.cache.request(options);
    f.advance(5 * 60_000);
    expect(f.cache.peek(options, alice)).toBeNull();
    await f.cache.request(options);
    f.cache.setForeground(false);
    expect(f.cache.peek(options, alice)).toBeNull();
    // Returning keeps records that are still fresh, without a new request.
    f.cache.setForeground(true);
    f.request.mockClear();
    expect(f.cache.peek(options, alice)).toEqual(success);
    await f.cache.request(options);
    expect(f.request).not.toHaveBeenCalled();
    const pending = deferred();
    f.request.mockReturnValueOnce(pending.promise);
    const write = f.cache.request({
      method: "DELETE",
      path: "/v1/workouts/synthetic",
    });
    expect(f.cache.peek(options, alice)).toBeNull();
    pending.resolve(success);
    await write;
    await f.cache.request(options);
    f.cache.clear();
    expect(f.cache.peek(options, alice)).toBeNull();
  });
  it("rejects yesterday or another UTC offset even before the read TTL expires", async () => {
    const f = fixture();
    f.advance(12 * 60 * 60_000 - 1000);
    await f.cache.request(options);
    f.advance(1000);
    expect(f.cache.peek(options, alice)).toBeNull();
    await f.cache.request(options);
    const offset = Date.prototype.getTimezoneOffset;
    const spy = vi
      .spyOn(Date.prototype, "getTimezoneOffset")
      .mockImplementation(function (this: Date) {
        return offset.call(this) + 60;
      });
    expect(f.cache.peek(options, alice)).toBeNull();
    spy.mockRestore();
  });
  it("validates cached data again before returning it to a first render", async () => {
    const f = fixture();
    f.request.mockResolvedValue({ ok: true, value: { malformed: true } });
    await f.cache.request(options);
    expect(f.cache.peek(options, alice)).toBeNull();
  });
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
  it("does not reuse after sign-out or explicit refresh, but does across token rotation and background", async () => {
    const f = fixture();
    await f.cache.request(options);
    f.setSession(null);
    expect((await f.cache.request(options)).ok).toBe(false);
    f.setSession(alice);
    await f.cache.request(options);
    f.setSession({ ...alice, accessToken: "rotated" });
    await f.cache.request(options);
    f.cache.setForeground(false);
    expect((await f.cache.request(options)).ok).toBe(false);
    f.cache.setForeground(true);
    await f.cache.request(options);
    expect(f.request).toHaveBeenCalledTimes(2);
    f.cache.clear();
    await f.cache.request(options);
    expect(f.request).toHaveBeenCalledTimes(3);
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
    pending.resolve({ ok: true, value: { revoked: true } });
    // The pre-write response is never returned; the caller re-reads.
    expect(await old).toEqual(success);
    await f.cache.request(options);
    expect(f.request).toHaveBeenCalledTimes(3);
  });
  it("re-reads instead of reporting a missing session when a refresh retires an in-flight read", async () => {
    const f = fixture();
    const pending = deferred();
    f.request.mockReturnValueOnce(pending.promise);
    const read = f.cache.request({
      ...options,
      expectedUserId: "alice",
      isCurrent: () => true,
    });
    await vi.waitFor(() => expect(f.request).toHaveBeenCalledTimes(1));
    f.cache.clear();
    pending.resolve(success);
    expect(await read).toEqual(success);
    expect(f.request).toHaveBeenCalledTimes(2);
  });
  it("keeps a read that finishes after a token rotation for the same account", async () => {
    const f = fixture();
    const pending = deferred();
    f.request.mockReturnValueOnce(pending.promise);
    const read = f.cache.request(options);
    await vi.waitFor(() => expect(f.request).toHaveBeenCalledTimes(1));
    f.setSession({ ...alice, accessToken: "rotated" });
    pending.resolve(success);
    expect(await read).toEqual(success);
    expect(f.request).toHaveBeenCalledTimes(1);
  });
  it("waits for a pending write before returning a retried read", async () => {
    const f = fixture();
    const stale = { ok: true as const, value: { revoked: true } };
    const read = deferred();
    const write = deferred();
    f.request.mockReturnValueOnce(read.promise);
    const reading = f.cache.request(options);
    await vi.waitFor(() => expect(f.request).toHaveBeenCalledTimes(1));
    f.request.mockReturnValueOnce(write.promise);
    const writing = f.cache.request({
      method: "PATCH",
      path: "/v1/workouts/id",
      body: { name: "updated" },
    });
    await vi.waitFor(() => expect(f.request).toHaveBeenCalledTimes(2));
    read.resolve(stale);
    await new Promise((resolve) => setTimeout(resolve, 10));
    // The retired read does not re-read until the write settles.
    expect(f.request).toHaveBeenCalledTimes(2);
    f.request.mockResolvedValue(success);
    write.resolve(success);
    await writing;
    expect(await reading).toEqual(success);
    expect(f.request).toHaveBeenCalledTimes(3);
  });
  it("caps retries and never retries a backgrounded or stale caller", async () => {
    const f = fixture();
    f.request.mockImplementation(async () => {
      f.cache.clear();
      return success;
    });
    expect((await f.cache.request(options)).ok).toBe(false);
    expect(f.request).toHaveBeenCalledTimes(3);

    f.request.mockReset();
    f.request.mockImplementation(async () => {
      f.cache.setForeground(false);
      return success;
    });
    expect((await f.cache.request(options)).ok).toBe(false);
    expect(f.request).toHaveBeenCalledTimes(1);
    f.cache.setForeground(true);

    f.request.mockReset();
    let current = true;
    f.request.mockImplementation(async () => {
      current = false;
      f.cache.clear();
      return success;
    });
    expect(
      (await f.cache.request({ ...options, isCurrent: () => current })).ok,
    ).toBe(false);
    expect(f.request).toHaveBeenCalledTimes(1);
  });
  it("reports a read retired by locking the phone as suspended, not signed out", async () => {
    const f = fixture();
    const pending = deferred();
    f.request.mockReturnValueOnce(pending.promise);
    const read = f.cache.request(options);
    await vi.waitFor(() => expect(f.request).toHaveBeenCalledTimes(1));
    f.cache.setForeground(false);
    pending.resolve(success);
    expect(await read).toEqual({
      ok: false,
      error: { kind: "context_changed" },
    });
    // A read started while still backgrounded is suspended the same way.
    expect(await f.cache.request(options)).toEqual({
      ok: false,
      error: { kind: "context_changed" },
    });
    f.cache.setForeground(true);
    expect(await f.cache.request(options)).toEqual(success);
  });
  it("reports a failed session lookup as a network failure, not a sign-out", async () => {
    const f = fixture();
    const cause = new Error("refresh unreachable");
    f.sessionLookup.mockRejectedValueOnce(cause);
    expect(await f.cache.request(options)).toEqual({
      ok: false,
      error: { kind: "network_error", cause },
    });
    expect(f.request).not.toHaveBeenCalled();
    expect(await f.cache.request(options)).toEqual(success);
    f.setSession(null);
    f.cache.clear();
    expect(await f.cache.request(options)).toEqual({
      ok: false,
      error: { kind: "no_session" },
    });
  });
  it("lifts a token denial only for a new token of that owner", async () => {
    const f = fixture();
    f.request.mockResolvedValueOnce({
      ok: false,
      error: { kind: "session_expired" },
    });
    await f.cache.request(options);
    f.request.mockImplementationOnce(async () => {
      f.cache.clear();
      return success;
    });
    expect((await f.cache.request(options)).ok).toBe(false);
    f.setSession({ ...alice, accessToken: "signed-in-again" });
    f.request.mockImplementationOnce(async () => {
      f.cache.clear();
      return success;
    });
    expect(await f.cache.request(options)).toEqual(success);
  });
  it("still retires a read after a server denial instead of retrying it", async () => {
    const f = fixture();
    f.request.mockResolvedValueOnce({
      ok: false,
      error: { kind: "session_expired" },
    });
    expect(await f.cache.request(options)).toEqual({
      ok: false,
      error: { kind: "no_session" },
    });
    expect(f.request).toHaveBeenCalledTimes(1);
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

describe("running retained reads", () => {
  it.each([
    "/v1/runs?limit=50",
    "/v1/runs/11111111-1111-4111-8111-111111111111",
  ])("reuses %s then invalidates after run mutations", async (path) => {
    const f = fixture();
    const read = { ...options, path };
    await f.cache.request(read);
    await f.cache.request(read);
    expect(f.request).toHaveBeenCalledTimes(1);
    await f.cache.request({
      method: "PUT",
      path: "/v1/runs/11111111-1111-4111-8111-111111111111",
      body: { expectedRevision: 1 },
    });
    await f.cache.request(read);
    expect(f.request).toHaveBeenCalledTimes(3);
  });
  it("retires previous-account run reads", async () => {
    const f = fixture();
    const pending = deferred();
    f.request.mockReturnValueOnce(pending.promise);
    const original = f.cache.request({ ...options, path: "/v1/runs?limit=50" });
    await vi.waitFor(() => expect(f.request).toHaveBeenCalledTimes(1));
    f.setSession({
      ...alice,
      user: { ...alice.user, id: "bob" },
    } as AuthSession);
    await f.cache.request({ ...options, path: "/v1/runs?limit=50" });
    pending.resolve(success);
    expect((await original).ok).toBe(false);
  });
});
