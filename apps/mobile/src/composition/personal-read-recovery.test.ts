import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@mizyun/api-client";
import type { AuthSession } from "@mizyun/identity";
import { unpublishActivityResponseSchema as schema } from "@mizyun/contracts";
import type { PersonalReadStorage } from "@/features/offline-cache/personal-read-storage";
import { SessionReadCache } from "./session-read-cache";

const alice = {
  user: { id: "alice" },
  accessToken: "synthetic-a",
} as AuthSession;
const bob = { user: { id: "bob" }, accessToken: "synthetic-b" } as AuthSession;
const now = new Date(2026, 9, 9, 12).getTime();
const options = {
  method: "GET" as const,
  path: "/v1/workouts?limit=200",
  schema,
};
const saved = { revoked: false };
const fresh = { revoked: true };
const offline = {
  ok: false as const,
  error: { kind: "network_error" as const, cause: "synthetic offline" },
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { resolve, promise };
}
function fixture(value: unknown = saved) {
  let owner: AuthSession | null = alice;
  const records = [{ path: options.path, value, savedAt: now - 30_000 }];
  const storage: PersonalReadStorage = {
    load: vi.fn(async (userId) => (userId === "alice" ? [...records] : [])),
    save: vi.fn(async () => {}),
    purge: vi.fn(async () => {
      records.length = 0;
    }),
  };
  const request = vi.fn().mockResolvedValue(offline);
  const cache = new SessionReadCache(
    {
      request,
      status: () => ({
        configured: true,
        baseUrl: "https://synthetic.invalid",
      }),
    } as ApiClient,
    async () => owner,
    () => now,
    storage,
  );
  return {
    cache,
    request,
    storage,
    records,
    setOwner: (next: AuthSession | null) => {
      owner = next;
    },
  };
}
afterEach(() => vi.useRealTimers());

describe("saved personal startup reads", () => {
  it("projects hydrated offline data without IO or changing its original save time", async () => {
    const f = fixture();
    expect(f.cache.peek(options, alice)).toBeNull();
    expect(f.storage.load).not.toHaveBeenCalled();
    await f.cache.request(options);
    vi.mocked(f.storage.load).mockClear();
    f.request.mockClear();
    for (let i = 0; i < 3; i++)
      expect(f.cache.peek(options, alice)).toEqual({
        ok: true,
        value: saved,
        savedAt: now - 30_000,
      });
    expect(f.storage.load).not.toHaveBeenCalled();
    expect(f.storage.save).not.toHaveBeenCalled();
    expect(f.request).not.toHaveBeenCalled();
    f.cache.clear();
  });
  it("never relabels pre-purge hydrated data with a new cleanup generation", async () => {
    const f = fixture();
    let generation = 0;
    f.storage.generation = () => generation;
    vi.mocked(f.storage.purge).mockImplementation(async () => {
      generation++;
      f.records.length = 0;
    });
    const hydration = deferred<readonly any[]>();
    vi.mocked(f.storage.load).mockReturnValue(hydration.promise);
    const read = f.cache.request(options);
    await vi.waitFor(() => expect(f.storage.load).toHaveBeenCalled());
    hydration.resolve([...f.records]);
    const purge = f.storage.purge("alice");
    await purge;
    expect((await read).ok).toBe(false);
    expect(f.cache.peek(options, alice)).toBeNull();
    f.cache.clear();
  });
  it("does not asynchronously revive or re-persist sibling records after external cleanup", async () => {
    const f = fixture();
    const sibling = { ...options, path: "/v1/workouts?limit=5" };
    f.records.push({ path: sibling.path, value: saved, savedAt: now - 30_000 });
    let generation = 0;
    f.storage.generation = () => generation;
    await f.cache.request(options);
    await f.cache.request(sibling);
    generation++;
    f.records.length = 0;
    f.request.mockClear().mockResolvedValue({ ok: true, value: fresh });
    expect(f.cache.peek(options, alice)).toBeNull();
    expect(await f.cache.request(options)).toEqual({ ok: true, value: fresh });
    expect(f.request).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(f.storage.save).toHaveBeenCalled());
    expect(
      vi
        .mocked(f.storage.save)
        .mock.calls.at(-1)![1]
        .map((record) => record.path),
    ).toEqual([options.path]);
    expect(f.cache.peek(sibling, alice)).toBeNull();
    f.cache.clear();
  });
  it("retires already hydrated snapshots after external cleanup, denial or maximum age", async () => {
    const f = fixture();
    let generation = 0;
    f.storage.generation = () => generation;
    await f.cache.request(options);
    generation++;
    expect(f.cache.peek(options, alice)).toBeNull();
    f.cache.clear();
    const old = fixture();
    old.records[0]!.savedAt = now - 48 * 60 * 60_000 - 1;
    await old.cache.request(options);
    expect(old.cache.peek(options, alice)).toBeNull();
    old.cache.clear();
    const denied = fixture();
    denied.request.mockResolvedValue({
      ok: false,
      error: { kind: "http_error", status: 403 },
    });
    await denied.cache.request(options);
    await vi.waitFor(() =>
      expect(denied.cache.peek(options, alice)).toBeNull(),
    );
    denied.cache.clear();
  });
  it("displays restart snapshots while network is stalled and publishes fresh replacement", async () => {
    const f = fixture();
    const transport = deferred<any>();
    f.request.mockReturnValue(transport.promise);
    const updates = vi.fn();
    const unsubscribe = f.cache.subscribe(updates);
    const result = await f.cache.request(options);
    expect(result).toMatchObject({
      ok: true,
      value: saved,
      savedAt: now - 30_000,
    });
    expect(f.request).toHaveBeenCalledTimes(1);
    await f.cache.request(options);
    expect(f.request).toHaveBeenCalledTimes(1);
    transport.resolve({ ok: true, value: fresh });
    await vi.waitFor(() => expect(updates).toHaveBeenCalledWith(options.path));
    expect(await f.cache.request(options)).toEqual({ ok: true, value: fresh });
    await vi.waitFor(() => expect(f.storage.save).toHaveBeenCalled());
    const persisted = vi.mocked(f.storage.save).mock.calls[0]![1];
    expect(persisted[0]?.savedAt).toBe(now);
    unsubscribe();
    f.cache.clear();
  });
  it("does not revive an unused stale query or loop after a screen version check", async () => {
    const f = fixture();
    f.records.push({
      path: "/v1/coach/conversations/old",
      value: saved,
      savedAt: now - 60_000,
    });
    f.request.mockResolvedValue({ ok: true, value: fresh });
    const updates = vi.fn(() => {
      f.cache.version();
      void f.cache.request(options);
    });
    const unsubscribe = f.cache.subscribe(updates);
    await f.cache.request(options);
    await vi.waitFor(() => expect(updates).toHaveBeenCalledTimes(2));
    expect(f.request).toHaveBeenCalledTimes(1);
    unsubscribe();
    f.cache.clear();
  });
  it("keeps original age on offline readback and rejects corrupt schema data", async () => {
    const f = fixture();
    expect(await f.cache.request(options)).toMatchObject({
      ok: true,
      savedAt: now - 30_000,
    });
    await new Promise((resolve) => setTimeout(resolve, 110));
    expect(f.storage.save).not.toHaveBeenCalled();
    const corrupt = fixture({ privateField: "synthetic corrupt" });
    expect(await corrupt.cache.request(options)).toEqual(offline);
    f.cache.clear();
    corrupt.cache.clear();
  });
  it("uses current owner's storage and rejects a switched owner during hydration", async () => {
    const f = fixture();
    const hydration = deferred<readonly any[]>();
    vi.mocked(f.storage.load).mockReturnValue(hydration.promise);
    const pending = f.cache.request(options);
    await vi.waitFor(() =>
      expect(f.storage.load).toHaveBeenCalledWith("alice"),
    );
    f.setOwner(bob);
    hydration.resolve(f.records);
    expect((await pending).ok).toBe(false);
    f.cache.clear();
    await f.cache.request(options);
    expect(f.storage.load).toHaveBeenLastCalledWith("bob");
    f.cache.clear();
  });
  it("purges snapshots before a lost-response write and never restores deleted content", async () => {
    const f = fixture();
    await f.cache.request(options);
    const mutation = await f.cache.request({
      method: "DELETE",
      path: "/v1/workouts/synthetic",
    });
    expect(mutation).toEqual(offline);
    expect(f.storage.purge).toHaveBeenCalledWith("alice");
    expect(await f.cache.request(options)).toEqual(offline);
    f.cache.clear();
  });
  it("fails before mutation if saved data cannot be retired", async () => {
    const f = fixture();
    vi.mocked(f.storage.purge).mockRejectedValue(
      new Error("synthetic keychain locked"),
    );
    const result = await f.cache.request({
      method: "DELETE",
      path: "/v1/workouts/synthetic",
    });
    expect(result.ok).toBe(false);
    expect(f.request).not.toHaveBeenCalled();
    f.cache.clear();
  });
  it("rejects a write if account changes while encrypted cleanup is pending", async () => {
    const f = fixture();
    const purge = deferred<void>();
    vi.mocked(f.storage.purge).mockReturnValue(purge.promise);
    const write = f.cache.request({
      method: "POST",
      path: "/v1/workouts",
      body: { name: "synthetic" },
    });
    await vi.waitFor(() =>
      expect(f.storage.purge).toHaveBeenCalledWith("alice"),
    );
    f.setOwner(bob);
    purge.resolve();
    expect((await write).ok).toBe(false);
    expect(f.request).not.toHaveBeenCalled();
    f.cache.clear();
  });
  it("permits parallel mutations owned by the same current account", async () => {
    const f = fixture();
    f.request.mockResolvedValue({ ok: true, value: fresh });
    const writes = await Promise.all(
      ["one", "two"].map((id) =>
        f.cache.request({ method: "PATCH", path: `/v1/exercises/${id}` }),
      ),
    );
    expect(writes.every((result) => result.ok)).toBe(true);
    expect(f.request).toHaveBeenCalledTimes(2);
    for (const [request] of f.request.mock.calls)
      expect(request.expectedUserId).toBe("alice");
    f.cache.clear();
  });
  it("never persists a timer or late GET retired by account cleanup", async () => {
    vi.useFakeTimers();
    const f = fixture();
    let generation = 0;
    f.storage.generation = () => generation;
    f.request.mockResolvedValue({ ok: true, value: fresh });
    await f.cache.request(options);
    await vi.advanceTimersByTimeAsync(0);
    generation++;
    await f.storage.purge("alice");
    await vi.advanceTimersByTimeAsync(100);
    expect(f.storage.save).not.toHaveBeenCalled();
    f.cache.clear();
    const transport = deferred<any>();
    f.request.mockReturnValue(transport.promise);
    const pending = f.cache.request(options);
    await vi.advanceTimersByTimeAsync(0);
    generation++;
    await f.storage.purge("alice");
    transport.resolve({ ok: true, value: fresh });
    expect((await pending).ok).toBe(false);
    await vi.advanceTimersByTimeAsync(100);
    expect(f.storage.save).not.toHaveBeenCalled();
    f.cache.clear();
  });
  it("removes denied snapshots once even when keychain cleanup fails", async () => {
    const f = fixture();
    f.request.mockResolvedValue({
      ok: false,
      error: {
        kind: "http_error",
        status: 403,
        code: "denied",
        message: "synthetic denied",
      },
    });
    vi.mocked(f.storage.purge).mockRejectedValue(
      new Error("synthetic keychain locked"),
    );
    const updates = vi.fn(() => {
      void f.cache.request(options);
    });
    const unsubscribe = f.cache.subscribe((path) => {
      if (path !== "*") updates();
    });
    await f.cache.request(options);
    await vi.waitFor(() => expect(updates).toHaveBeenCalledTimes(1));
    expect((await f.cache.request(options)).ok).toBe(false);
    expect(updates).toHaveBeenCalledTimes(1);
    expect(f.storage.load).toHaveBeenCalledTimes(1);
    unsubscribe();
    f.cache.clear();
  });
});
