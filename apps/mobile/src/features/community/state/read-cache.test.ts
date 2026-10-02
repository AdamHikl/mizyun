import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { unpublishActivityResponseSchema } from "@mizyun/contracts";
import type { ApiClient } from "@mizyun/api-client";
import type { AuthSession } from "@mizyun/identity";
import { scopeCommunityClient } from "../scoped-client";
import {
  CommunityReadCache,
  getCommunityReadDeadline,
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
  const cache = new CommunityReadCache(raw, async () => session);
  stores.push(cache);
  cache.setPrincipal("alice");
  cache.setForeground(true);
  return {
    raw,
    cache,
    request,
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
    await vi.advanceTimersByTimeAsync(6000);
    const restored = await scopeCommunityClient(
      cache,
      "alice",
      () => true,
    ).request<{ revoked: boolean }>(options);
    expect(restored.ok).toBe(true);
    if (restored.ok)
      expect(getCommunityReadDeadline(restored.value)).toBe(10000);
    expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4000);
    await scopeCommunityClient(cache, "alice", () => true).request(options);
    expect(request).toHaveBeenCalledTimes(2);
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
