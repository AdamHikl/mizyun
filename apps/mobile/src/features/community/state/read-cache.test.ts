import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { unpublishActivityResponseSchema } from "@mizyun/contracts";
import type { ApiClient } from "@mizyun/api-client";
import type { AuthSession } from "@mizyun/identity";
import { scopeCommunityClient } from "../scoped-client";
import { humanizeCommunityError } from "../community-client";
import {
  CommunityReadCache,
  getCommunityReadDeadline,
  getCommunityReadEpoch,
  COMMUNITY_READ_LIFETIME_MS,
  COMMUNITY_READ_RENEWAL_LEAD_MS,
  setCommunityReadPrincipal,
  invalidateCommunityReads,
} from "./read-cache";

const schema = unpublishActivityResponseSchema;
const options = {
  method: "GET" as const,
  path: "/v1/community/profile",
  schema,
};
const stores: CommunityReadCache[] = [];
function fixture() {
  let session = {
    user: { id: "alice" },
    accessToken: "alice-token",
  } as AuthSession | null;
  const request = vi
    .fn()
    .mockResolvedValue({ ok: true, value: { revoked: false } });
  const raw = {
    request,
    status: () => ({
      configured: true,
      baseUrl: "https://dev.example.invalid",
    }),
  } as ApiClient;
  const sessionRead = vi.fn(async () => session);
  const cache = new CommunityReadCache(raw, sessionRead);
  stores.push(cache);
  cache.setPrincipal("alice");
  cache.setForeground(true);
  return {
    raw,
    cache,
    request,
    sessionRead,
    setSession: (next: AuthSession | null) => {
      session = next;
    },
  };
}
function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => {
  for (const store of stores.splice(0)) store.dispose();
  vi.useRealTimers();
});

describe("Community navigation reads", () => {
  it("notifies mounted fill observers only after insertion, without changing authorization epoch or deadline", async () => {
    const { cache, request } = fixture();
    const epoch = getCommunityReadEpoch();
    const principal = { user: { id: "alice" }, accessToken: "alice-token" };
    const observed = vi.fn(() => {
      const value = cache.peek(
        { ...options, expectedUserId: "alice" },
        principal,
      );
      expect(value).toEqual({ revoked: false });
      expect(getCommunityReadDeadline(value)).toBe(COMMUNITY_READ_LIFETIME_MS);
    });
    const unsubscribe = cache.subscribeFills(observed);
    await cache.request({ ...options, expectedUserId: "alice" });
    expect(observed).toHaveBeenCalledTimes(1);
    expect(getCommunityReadEpoch()).toBe(epoch);
    expect(request).toHaveBeenCalledTimes(1);
    unsubscribe();
    cache.clear();
    await cache.request({ ...options, expectedUserId: "alice" });
    expect(observed).toHaveBeenCalledTimes(1);
  });

  it("peeks synchronously without auth/network calls or extending the original deadline", async () => {
    const { cache, request, sessionRead } = fixture();
    await cache.request({ ...options, expectedUserId: "alice" });
    const principal = { user: { id: "alice" }, accessToken: "alice-token" };
    request.mockClear();
    sessionRead.mockClear();
    vi.advanceTimersByTime(COMMUNITY_READ_LIFETIME_MS - 1_000);
    const first = cache.peek(
      { ...options, expectedUserId: "alice" },
      principal,
    );
    expect(first).toEqual({ revoked: false });
    expect(getCommunityReadDeadline(first)).toBe(COMMUNITY_READ_LIFETIME_MS);
    expect(
      cache.peek({ ...options, expectedUserId: "alice" }, principal),
    ).toEqual(first);
    expect(request).not.toHaveBeenCalled();
    expect(sessionRead).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(
      cache.peek({ ...options, expectedUserId: "alice" }, principal),
    ).toBeUndefined();
  });

  it("fails closed for missing/wrong owner or token, changed context and mismatched schema", async () => {
    const { cache } = fixture();
    await cache.request({ ...options, expectedUserId: "alice" });
    const principal = { user: { id: "alice" }, accessToken: "alice-token" };
    expect(cache.peek(options, principal)).toBeUndefined();
    expect(
      cache.peek({ ...options, expectedUserId: "alice" }, null),
    ).toBeUndefined();
    expect(
      cache.peek({ ...options, expectedUserId: "bob" }, principal),
    ).toBeUndefined();
    expect(
      cache.peek(
        { ...options, expectedUserId: "alice" },
        { ...principal, user: { id: "bob" } },
      ),
    ).toBeUndefined();
    expect(
      cache.peek(
        { ...options, expectedUserId: "alice" },
        { ...principal, accessToken: "rotated-token" },
      ),
    ).toBeUndefined();
    expect(
      cache.peek(
        { ...options, expectedUserId: "alice", isCurrent: () => false },
        principal,
      ),
    ).toBeUndefined();
    expect(
      cache.peek(
        { ...options, expectedUserId: "alice", headers: {} },
        principal,
      ),
    ).toBeUndefined();
    expect(
      cache.peek(
        {
          ...options,
          expectedUserId: "alice",
          path: "/v1/community/media/a/content",
        },
        principal,
      ),
    ).toBeUndefined();
    expect(
      cache.peek(
        { ...options, expectedUserId: "alice", schema: schema.optional() },
        principal,
      ),
    ).toBeUndefined();
  });

  it.each(["clear", "background", "principal", "token", "date"])(
    "retires synchronous snapshots after %s changes",
    async (change) => {
      const { cache } = fixture();
      await cache.request({ ...options, expectedUserId: "alice" });
      if (change === "clear") invalidateCommunityReads();
      if (change === "background") cache.setForeground(false);
      if (change === "principal") cache.setPrincipal("bob", "bob-token");
      if (change === "token") cache.setPrincipal("alice", "rotated-token");
      if (change === "date")
        vi.setSystemTime(new Date(0).getTime() + 86_400_000);
      expect(
        cache.peek(
          { ...options, expectedUserId: "alice" },
          { user: { id: "alice" }, accessToken: "alice-token" },
        ),
      ).toBeUndefined();
    },
  );

  it("retains no synchronous authority during unresolved writes or after denied reads", async () => {
    const { cache, request } = fixture();
    const principal = { user: { id: "alice" }, accessToken: "alice-token" };
    await cache.request({ ...options, expectedUserId: "alice" });
    const mutation = deferred();
    request.mockReturnValueOnce(mutation.promise);
    const pending = cache.request({
      method: "PATCH",
      path: "/v1/community/profile",
      body: {},
    });
    expect(
      cache.peek({ ...options, expectedUserId: "alice" }, principal),
    ).toBeUndefined();
    mutation.resolve({ ok: true, value: {} });
    await pending;
    await cache.request({ ...options, expectedUserId: "alice" });
    request.mockResolvedValueOnce({
      ok: false,
      error: { kind: "network_error", message: "offline" },
    });
    await cache.request({
      ...options,
      path: "/v1/community/features",
      expectedUserId: "alice",
    });
    expect(
      cache.peek({ ...options, expectedUserId: "alice" }, principal),
    ).toBeUndefined();
  });

  it("rejects a prior local day's snapshot even while its original lease is still live", async () => {
    const beforeMidnight = new Date(2026, 9, 12, 23, 59, 59).getTime();
    vi.setSystemTime(beforeMidnight);
    const { cache } = fixture();
    await cache.request({ ...options, expectedUserId: "alice" });
    const principal = { user: { id: "alice" }, accessToken: "alice-token" };
    const value = cache.peek(
      { ...options, expectedUserId: "alice" },
      principal,
    );
    expect(getCommunityReadDeadline(value)).toBe(
      beforeMidnight + COMMUNITY_READ_LIFETIME_MS,
    );
    vi.advanceTimersByTime(1_000);
    expect(Date.now()).toBeLessThan(getCommunityReadDeadline(value)!);
    expect(
      cache.peek({ ...options, expectedUserId: "alice" }, principal),
    ).toBeUndefined();
  });

  it("preserves a failed endpoint's error while retiring overlapping reads without claiming sign-out", async () => {
    const { cache, request } = fixture();
    const legacy = deferred();
    const failure = {
      kind: "http_error" as const,
      status: 404,
      code: "NOT_FOUND",
      message: "Not found",
    };
    request
      .mockReturnValueOnce(legacy.promise)
      .mockResolvedValueOnce({ ok: false, error: failure });
    const client = scopeCommunityClient(cache, "alice", () => true);
    const pending = client.request(options);
    await Promise.resolve();
    await Promise.resolve();
    const missing = await client.request({
      ...options,
      path: "/v1/community/profiles/alice",
    });
    expect(missing).toEqual({
      ok: false,
      error: { kind: "context_changed", cause: failure },
    });
    legacy.resolve({ ok: true, value: { revoked: false } });
    const retired = await pending;
    expect(retired).toEqual({ ok: false, error: { kind: "context_changed" } });
    if (!retired.ok)
      expect(humanizeCommunityError(retired.error)).not.toContain("sign in");
    expect((await client.request(options)).ok).toBe(true);
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("keeps real absent authentication distinct from a retired read", async () => {
    const { cache, setSession } = fixture();
    setSession(null);
    expect(
      await scopeCommunityClient(cache, "alice", () => true).request(options),
    ).toEqual({
      ok: false,
      error: { kind: "no_session" },
    });
  });

  it("retires a read interrupted by an unrelated API write without exposing its value or claiming sign-out", async () => {
    const { cache, request } = fixture();
    const legacy = deferred();
    request.mockReturnValueOnce(legacy.promise);
    const client = scopeCommunityClient(cache, "alice", () => true);
    const pending = client.request(options);
    await Promise.resolve();
    await Promise.resolve();
    await cache.request({
      method: "POST",
      path: "/v1/notifications/token",
      body: {},
    });
    legacy.resolve({ ok: true, value: { revoked: false } });
    expect(await pending).toEqual({
      ok: false,
      error: { kind: "context_changed" },
    });
    expect((await client.request(options)).ok).toBe(true);
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("retires same-account reads eagerly when Auth rotates the token before a new destination loads", async () => {
    const { cache, request, setSession } = fixture();
    const client = scopeCommunityClient(cache, "alice", () => true);
    await client.request(options);
    const previousEpoch = getCommunityReadEpoch();
    setSession({
      user: { id: "alice" },
      accessToken: "renewed-token",
    } as AuthSession);
    setCommunityReadPrincipal("alice", "renewed-token");
    expect(getCommunityReadEpoch()).toBeGreaterThan(previousEpoch);
    const newDestinationEpoch = getCommunityReadEpoch();
    expect((await client.request(options)).ok).toBe(true);
    expect(getCommunityReadEpoch()).toBe(newDestinationEpoch);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("keeps nested conversation cursors distinct without invalidating other authorized reads", async () => {
    const { cache, request } = fixture();
    const client = scopeCommunityClient(cache, "alice", () => true);
    await client.request(options);
    for (const id of ["first", "second", "first"])
      await client.request({
        method: "POST",
        path: "/v1/community/messaging",
        schema,
        body: {
          operation: "latest",
          peerId: "peer",
          before: { createdAt: "2026-10-07T00:00:00Z", id },
        },
      });
    await client.request(options);
    expect(request).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(COMMUNITY_READ_LIFETIME_MS + 1);
    await client.request(options);
    expect(request).toHaveBeenCalledTimes(4);
  });
  it("keys complete profile timeline pages by author and cursor", async () => {
    const { cache, request } = fixture();
    const client = scopeCommunityClient(cache, "alice", () => true);
    for (const path of [
      "/v1/community/profiles/bob/activities",
      "/v1/community/profiles/bob/activities?cursor=older",
      "/v1/community/profiles/carol/activities",
      "/v1/community/profiles/bob/activities",
    ])
      await client.request({ method: "GET", path, schema });
    expect(request).toHaveBeenCalledTimes(3);
  });
  it("preserves multipart meal and Coach uploads and optional disabled capabilities", async () => {
    const { raw, cache } = fixture();
    expect(cache.draftFoodEntry).toBeUndefined();
    expect(cache.draftCoachMealPhoto).toBeUndefined();
    const draft = {
      ok: false as const,
      error: { kind: "no_session" as const },
    };
    raw.draftFoodEntry = vi.fn().mockResolvedValue(draft);
    raw.draftCoachMealPhoto = vi.fn().mockResolvedValue(draft);
    const wrapped = new CommunityReadCache(raw, async () => null);
    stores.push(wrapped);
    const photo = new Blob(["synthetic"]);
    const food = {
      photo,
      mimeType: "image/jpeg" as const,
      textHint: "synthetic meal",
    };
    const coach = {
      photo,
      mimeType: "image/jpeg" as const,
      conversationId: "fixture",
      idempotencyKey: "fixture",
    };
    expect(await wrapped.draftFoodEntry!(food)).toBe(draft);
    expect(await wrapped.draftCoachMealPhoto!(coach)).toBe(draft);
    expect(raw.draftFoodEntry).toHaveBeenCalledWith(food);
    expect(raw.draftCoachMealPhoto).toHaveBeenCalledWith(coach);
  });
  it("reproduces two backend reads on ordinary route return without the shared store", async () => {
    const { raw, request } = fixture();
    await scopeCommunityClient(raw, "alice", () => true).request(options);
    await scopeCommunityClient(raw, "alice", () => true).request(options);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("restores a new route scope without a second backend read and preserves original expiry", async () => {
    const { cache, request } = fixture();
    let firstActive = true;
    await scopeCommunityClient(cache, "alice", () => firstActive).request(
      options,
    );
    firstActive = false;
    const lead = COMMUNITY_READ_RENEWAL_LEAD_MS;
    await vi.advanceTimersByTimeAsync(
      COMMUNITY_READ_LIFETIME_MS - lead - 1_000,
    );
    const restored = await scopeCommunityClient(
      cache,
      "alice",
      () => true,
    ).request<{ revoked: boolean }>(options);
    expect(restored.ok).toBe(true);
    if (restored.ok)
      expect(getCommunityReadDeadline(restored.value)).toBe(
        COMMUNITY_READ_LIFETIME_MS,
      );
    expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(lead + 1_000);
    await scopeCommunityClient(cache, "alice", () => true).request(options);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("sends a renewal read inside the renewal lead to the backend with a new deadline", async () => {
    const { cache, request } = fixture();
    await scopeCommunityClient(cache, "alice", () => true).request(options);
    const renewalAt =
      COMMUNITY_READ_LIFETIME_MS - COMMUNITY_READ_RENEWAL_LEAD_MS + 1_000;
    await vi.advanceTimersByTimeAsync(renewalAt);
    const renewed = await scopeCommunityClient(
      cache,
      "alice",
      () => true,
    ).request<{ revoked: boolean }>(options);
    expect(request).toHaveBeenCalledTimes(2);
    expect(renewed.ok).toBe(true);
    if (renewed.ok)
      expect(getCommunityReadDeadline(renewed.value)).toBe(
        renewalAt + COMMUNITY_READ_LIFETIME_MS,
      );
  });
  it("coalesces simultaneous live profile reads without one retired scope cancelling another", async () => {
    const { cache, request } = fixture();
    const pending = deferred();
    request.mockReturnValueOnce(pending.promise);
    let active = true;
    const first = scopeCommunityClient(cache, "alice", () => active).request(
      options,
    );
    const second = scopeCommunityClient(cache, "alice", () => true).request(
      options,
    );
    await Promise.resolve();
    await Promise.resolve();
    active = false;
    pending.resolve({ ok: true, value: { revoked: false } });
    expect((await first).ok).toBe(false);
    expect((await second).ok).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("forces a real read after manual refresh, mutation, known failure or backgrounding", async () => {
    const { cache, request } = fixture();
    const client = scopeCommunityClient(cache, "alice", () => true);
    await client.request(options);
    invalidateCommunityReads();
    await client.request(options);
    await client.request({
      method: "DELETE",
      path: "/v1/community/profile",
      schema,
    });
    await client.request(options);
    cache.setForeground(false);
    cache.setForeground(true);
    await client.request(options);
    request.mockResolvedValueOnce({
      ok: false,
      error: { kind: "network_error", cause: "offline" },
    });
    await client.request({
      method: "GET",
      path: "/v1/community/reports",
      schema,
    });
    await client.request(options);
    expect(request).toHaveBeenCalledTimes(7);
  });
  it("cannot fill or return an old read after a mutation, background or account switch", async () => {
    for (const invalidate of ["mutation", "background", "account"] as const) {
      const { cache, request } = fixture();
      const pending = deferred();
      request.mockReturnValueOnce(pending.promise);
      const client = scopeCommunityClient(cache, "alice", () => true);
      const result = client.request(options);
      await Promise.resolve();
      await Promise.resolve();
      if (invalidate === "mutation")
        await client.request({
          method: "DELETE",
          path: "/v1/community/profile",
          schema,
        });
      else if (invalidate === "background") {
        cache.setForeground(false);
        cache.setForeground(true);
      } else {
        cache.setPrincipal("bob");
        cache.setPrincipal("alice");
      }
      pending.resolve({ ok: true, value: { revoked: true } });
      expect((await result).ok).toBe(false);
      await client.request(options);
      expect(request).toHaveBeenCalledTimes(invalidate === "mutation" ? 3 : 2);
    }
  });
  it("checks the actual account and renewed token before every reuse", async () => {
    const { cache, request, setSession } = fixture();
    const client = scopeCommunityClient(cache, "alice", () => true);
    await client.request(options);
    setSession({
      user: { id: "bob" },
      accessToken: "bob-token",
    } as AuthSession);
    expect((await client.request(options)).ok).toBe(false);
    setSession({
      user: { id: "alice" },
      accessToken: "new-token",
    } as AuthSession);
    await client.request(options);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("never preserves a read of the pre-commit state while a mutation is pending", async () => {
    const { cache, request } = fixture();
    const write = deferred();
    request.mockImplementation((options) =>
      options.method === "DELETE"
        ? write.promise
        : Promise.resolve({ ok: true, value: { revoked: false } }),
    );
    const client = scopeCommunityClient(cache, "alice", () => true);
    await client.request(options);
    const mutation = client.request({
      method: "DELETE",
      path: "/v1/community/profile",
      schema,
    });
    await client.request(options);
    write.resolve({ ok: true, value: { revoked: true } });
    await mutation;
    await client.request(options);
    expect(request).toHaveBeenCalledTimes(4);
  });
  it("never reuses photos, previews, searches, invitations, staff or notification target reads", async () => {
    const { cache, request } = fixture();
    const client = scopeCommunityClient(cache, "alice", () => true);
    const requests = [
      { method: "GET" as const, path: "/v1/community/media?limit=10" },
      { method: "POST" as const, path: "/v1/community/media/id/content" },
      { method: "GET" as const, path: "/v1/community/workouts/id/preview" },
      { method: "POST" as const, path: "/v1/community/routines/preview" },
      { method: "GET" as const, path: "/v1/community/search?q=alice" },
      { method: "GET" as const, path: "/v1/community/invitations/token" },
      { method: "GET" as const, path: "/v1/community/notifications/inbox/id" },
      {
        method: "POST" as const,
        path: "/v1/community/groups/operations",
        body: { operation: "staffAppeals" },
      },
    ];
    for (const request of requests) {
      await client.request({ ...request, schema });
      await client.request({ ...request, schema });
    }
    expect(request).toHaveBeenCalledTimes(requests.length * 2);
  });
  it("reuses only allowlisted POST reads, while preferences writes always invalidate", async () => {
    const { cache, request } = fixture();
    const client = scopeCommunityClient(cache, "alice", () => true);
    const read = {
      method: "POST" as const,
      path: "/v1/community/messaging",
      body: { operation: "preferences" },
      schema,
    };
    await client.request(read);
    await client.request(read);
    expect(request).toHaveBeenCalledTimes(1);
    await client.request({
      ...read,
      body: { operation: "preferences", enabled: false },
    });
    await client.request(read);
    expect(request).toHaveBeenCalledTimes(3);
  });
});

describe("rendered activity kinds (BLD-05 S1)", () => {
  it("sends the activity-kinds header on feed and profile-activity reads while keeping them cached", async () => {
    const { cache, request } = fixture();
    for (const path of [
      "/v1/community/feed?limit=20",
      "/v1/community/profiles/bob/activities?limit=20",
    ]) {
      request.mockClear();
      const read = { ...options, path, expectedUserId: "alice" };
      expect((await cache.request(read)).ok).toBe(true);
      expect(request).toHaveBeenCalledOnce();
      expect(request.mock.calls[0]![0].headers).toEqual({
        "x-mizyun-activity-kinds": "meal,bouldering",
      });
      // The constant header does not change the read identity.
      await cache.request(read);
      expect(request).toHaveBeenCalledOnce();
    }
  });
  it("does not add the header to other Community requests", async () => {
    const { cache, request } = fixture();
    await cache.request({ ...options, expectedUserId: "alice" });
    await cache.request({
      method: "GET",
      path: "/v1/community/activities/a",
      expectedUserId: "alice",
    });
    for (const call of request.mock.calls)
      expect(call[0].headers).toBeUndefined();
  });
});
