import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@mizyun/api-client";
import type { AuthSession } from "@mizyun/identity";
import { unpublishActivityResponseSchema as schema } from "@mizyun/contracts";
import type {
  PersonalReadRecord,
  PersonalReadStorage,
} from "@/features/offline-cache/personal-read-storage";
import { SessionReadCache, affectedReads } from "./session-read-cache";

const alice = {
  user: { id: "alice" },
  accessToken: "token-1",
} as AuthSession;
const success = { ok: true as const, value: { revoked: false } };
const read = (path: string) => ({ method: "GET" as const, path, schema });
const meals = read("/v1/food-entries?limit=200");
const mealTotals = read("/v1/food-entries/summary?date=2026-10-03");
const workouts = read("/v1/workouts?limit=200");
const profile = read("/v1/profile");
const chats = read("/v1/coach/conversations");

function memoryStorage() {
  const saved = new Map<string, ReadonlyArray<PersonalReadRecord>>();
  let generation = 0;
  const storage: PersonalReadStorage = {
    generation: () => generation,
    load: async (userId) => saved.get(userId) ?? [],
    save: async (userId, records) => {
      saved.set(userId, records);
    },
    replace: vi.fn(async (userId: string, records) => {
      saved.set(userId, records);
    }),
    purge: async (userId) => {
      generation++;
      saved.delete(userId);
    },
  };
  return {
    storage,
    paths: (userId = "alice") =>
      (saved.get(userId) ?? []).map((record) => record.path).sort(),
    put: (records: PersonalReadRecord[]) => saved.set("alice", records),
  };
}

function fixture(disk = memoryStorage()) {
  let time = new Date(2026, 9, 3, 12).getTime();
  const request = vi.fn().mockResolvedValue(success);
  const raw = {
    request,
    status: () => ({ configured: false, reason: "fixture" }),
  } as ApiClient;
  const cache = new SessionReadCache(
    raw,
    async () => alice,
    () => time,
    disk.storage,
  );
  return {
    cache,
    request,
    disk,
    now: () => time,
    advance: (ms: number) => {
      time += ms;
    },
  };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 150));
const calls = (f: ReturnType<typeof fixture>) =>
  f.request.mock.calls
    .map(([options]) => options.path as string)
    .filter((path) => path.startsWith("/v1/") && !path.includes("synthetic"));

describe("write invalidation scope", () => {
  it("maps writes to the cached reads they can change", () => {
    expect(affectedReads("POST", "/v1/food-entries")).toEqual([
      "/v1/food-entries",
      "/v1/energy/summary",
    ]);
    expect(affectedReads("POST", "/v1/recurring-meals/x/skip")).toContain(
      "/v1/food-entries",
    );
    expect(affectedReads("PUT", "/v1/workouts/x/sets/y")).toContain(
      "/v1/workouts",
    );
    expect(affectedReads("POST", "/v1/bouldering/sessions")).toContain(
      "/v1/workouts",
    );
    expect(affectedReads("POST", "/v1/community/routines/x/import")).toContain(
      "/v1/workouts",
    );
    expect(affectedReads("PUT", "/v1/profile")).toContain("/v1/goals/active");
    expect(
      affectedReads("POST", "/v1/energy/weekly-review/x/decision"),
    ).toContain("/v1/goals/active");
    expect(affectedReads("DELETE", "/v1/coach/conversations/x")).toEqual([
      "/v1/coach/conversations",
    ]);
    // A consent grant can save the birth year used for energy targets.
    expect(affectedReads("PUT", "/v1/account/ai-consent")).toEqual(
      expect.arrayContaining([
        "/v1/coach/conversations",
        "/v1/profile",
        "/v1/energy/summary",
      ]),
    );
    expect(affectedReads("POST", "/v1/food-entries/draft/text")).toEqual([]);
    expect(affectedReads("POST", "/v1/feedback")).toEqual([]);
    // Coach tools can log meals and edit workouts.
    expect(affectedReads("POST", "/v1/coach/conversations/x/messages")).toBe(
      "all",
    );
    expect(affectedReads("DELETE", "/v1/account")).toBe("all");
    expect(affectedReads("POST", "/v1/something-new")).toBe("all");
    // Prefixes match whole segments only.
    expect(affectedReads("POST", "/v1/workoutsx")).toBe("all");
  });

  it("keeps unrelated reads after logging a meal, in memory and on the device", async () => {
    const f = fixture();
    for (const options of [meals, mealTotals, workouts, profile])
      await f.cache.request(options);
    await settle();
    await f.cache.request({ method: "POST", path: "/v1/food-entries" });
    expect(f.disk.paths()).toEqual(["/v1/profile", "/v1/workouts?limit=200"]);
    f.request.mockClear();
    for (const options of [meals, mealTotals, workouts, profile])
      await f.cache.request(options);
    expect(calls(f)).toEqual([meals.path, mealTotals.path]);
    expect(f.cache.peek(workouts, alice)).toEqual(success);
  });

  it("does not send a write when the device copy cannot be replaced", async () => {
    const f = fixture();
    await f.cache.request(meals);
    f.request.mockClear();
    vi.mocked(f.disk.storage.replace!).mockRejectedValueOnce(
      new Error("synthetic keychain locked"),
    );
    const result = await f.cache.request({
      method: "POST",
      path: "/v1/food-entries",
    });
    expect(result.ok).toBe(false);
    expect(f.request).not.toHaveBeenCalled();
  });

  it("forgets the affected reads even when the write fails", async () => {
    const f = fixture();
    await f.cache.request(meals);
    await f.cache.request(workouts);
    f.request.mockRejectedValueOnce(new Error("synthetic lost response"));
    await f.cache.request({ method: "DELETE", path: "/v1/food-entries/x" });
    expect(f.cache.peek(meals, alice)).toBeNull();
    expect(f.cache.peek(workouts, alice)).toEqual(success);
  });

  it("still clears everything for Coach messages and unknown writes", async () => {
    for (const path of ["/v1/coach/conversations/x/messages", "/v1/new"]) {
      const f = fixture();
      await f.cache.request(workouts);
      await f.cache.request(chats);
      await settle();
      await f.cache.request({ method: "POST", path });
      expect(f.cache.peek(workouts, alice)).toBeNull();
      expect(f.disk.paths()).toEqual([]);
    }
  });

  it("does not let a read that started before the write cache an old value", async () => {
    const f = fixture();
    let resolve!: (value: typeof success) => void;
    f.request.mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const before = f.cache.request(meals);
    await vi.waitFor(() => expect(f.request).toHaveBeenCalledTimes(1));
    await f.cache.request({ method: "POST", path: "/v1/food-entries" });
    resolve({ ok: true, value: { revoked: true } });
    // The retired read retries and returns the post-write value.
    expect(await before).toEqual(success);
    expect(f.cache.peek(meals, alice)).toEqual(success);
  });
});

describe("read lifetimes", () => {
  it("keeps goals and exercises for thirty minutes and other reads, including the profile, for five", async () => {
    const f = fixture();
    const goals = read("/v1/goals/active");
    const exercises = read("/v1/exercises?limit=200");
    const all = [profile, goals, exercises, workouts, meals];
    for (const options of all) await f.cache.request(options);
    f.advance(10 * 60_000);
    f.request.mockClear();
    for (const options of all) await f.cache.request(options);
    await settle();
    expect(calls(f).sort()).toEqual(
      [meals.path, profile.path, workouts.path].sort(),
    );
    f.advance(21 * 60_000);
    f.request.mockClear();
    await f.cache.request(goals);
    await settle();
    expect(calls(f)).toEqual([goals.path]);
  });
});

describe("relaunch from saved display data", () => {
  it("treats a record saved within its lifetime as fresh and older ones as saved", async () => {
    const disk = memoryStorage();
    const f = fixture(disk);
    disk.put([
      { path: workouts.path, value: success.value, savedAt: f.now() - 60_000 },
      { path: meals.path, value: success.value, savedAt: f.now() - 90_000 },
    ]);
    expect(await f.cache.request(workouts)).toEqual(success);
    expect(await f.cache.request(meals)).toEqual({
      ...success,
      savedAt: f.now() - 90_000,
    });
    // Only the expired meal list is revalidated.
    await vi.waitFor(() => expect(calls(f)).toEqual([meals.path]));
  });

  it("revalidates saved records after an explicit refresh instead of serving them as fresh", async () => {
    const f = fixture();
    await f.cache.request(profile);
    await settle();
    f.advance(1000);
    // Pull-to-refresh calls invalidateSessionReads(), which clears memory.
    f.cache.clear();
    f.request.mockClear();
    expect(await f.cache.request(profile)).toEqual({
      ...success,
      savedAt: f.now() - 1000,
    });
    await vi.waitFor(() => expect(calls(f)).toEqual([profile.path]));
  });

  it("keeps launch freshness when auth restoring clears before anything loaded", async () => {
    const disk = memoryStorage();
    const f = fixture(disk);
    disk.put([
      { path: profile.path, value: success.value, savedAt: f.now() - 60_000 },
    ]);
    f.cache.clear();
    expect(await f.cache.request(profile)).toEqual(success);
    await settle();
    expect(calls(f)).toEqual([]);
  });

  it("never replaces a newer kept record with an older saved one", async () => {
    const disk = memoryStorage();
    const f = fixture(disk);
    await f.cache.request(workouts);
    disk.put([
      {
        path: workouts.path,
        value: { revoked: true },
        savedAt: f.now() - 60_000,
      },
    ]);
    // An interrupted hydration is retried after returning from background.
    f.cache.setForeground(false);
    f.cache.setForeground(true);
    expect(await f.cache.request(workouts)).toEqual(success);
  });
});

describe("conditional revalidation", () => {
  const tagged = { ...success, etag: '"sha256:abc"' };
  it("revalidates a stale record with its validator and keeps the value on 304", async () => {
    const f = fixture();
    f.request.mockResolvedValueOnce(tagged);
    expect(await f.cache.request(workouts)).toEqual(success);
    f.advance(5 * 60_000);
    f.request.mockResolvedValueOnce({
      ok: true,
      value: undefined,
      notModified: true,
    });
    // The saved copy shows at once while the validator revalidates it.
    expect(await f.cache.request(workouts)).toMatchObject(success);
    expect(f.request.mock.calls.at(-1)![0].ifNoneMatch).toBe('"sha256:abc"');
    await settle();
    // Fresh again, and the validator is saved on the device.
    f.request.mockClear();
    expect(await f.cache.request(workouts)).toEqual(success);
    expect(f.request).not.toHaveBeenCalled();
    // The validator stays in memory only.
    await settle();
    const saved = await f.disk.storage.load("alice");
    expect(saved.find((r) => r.path === workouts.path)).not.toHaveProperty(
      "etag",
    );
  });

  it("does not cache a 304 that arrives after a write forgot the record", async () => {
    const f = fixture();
    f.request.mockResolvedValueOnce(tagged);
    await f.cache.request(workouts);
    f.advance(5 * 60_000);
    let resolve!: (value: unknown) => void;
    f.request.mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const stale = f.cache.request(workouts);
    await vi.waitFor(() =>
      expect(f.request.mock.calls.at(-1)![0].ifNoneMatch).toBe('"sha256:abc"'),
    );
    await f.cache.request({ method: "POST", path: "/v1/workouts" });
    resolve({ ok: true, value: undefined, notModified: true });
    await stale;
    await settle();
    expect(f.cache.peek(workouts, alice)).toBeNull();
  });

  it("sends no validator after a write forgot the record, and treats an unexpected 304 as a failure", async () => {
    const f = fixture();
    f.request.mockResolvedValueOnce(tagged);
    await f.cache.request(workouts);
    await f.cache.request({ method: "POST", path: "/v1/workouts" });
    f.request.mockResolvedValueOnce({
      ok: true,
      value: undefined,
      notModified: true,
    });
    const result = await f.cache.request(workouts);
    expect(f.request.mock.calls.at(-1)![0].ifNoneMatch).toBeUndefined();
    expect(result.ok).toBe(false);
  });

  it("never sends a validator for records loaded from the device", async () => {
    // A saved value may have been parsed by an older app build's schema, so
    // an unchanged server tag must not confirm it.
    const disk = memoryStorage();
    const f = fixture(disk);
    disk.put([
      {
        path: workouts.path,
        value: success.value,
        savedAt: f.now() - 10 * 60_000,
      },
    ]);
    await f.cache.request(workouts);
    await vi.waitFor(() => expect(f.request).toHaveBeenCalled());
    expect(f.request.mock.calls.at(-1)![0].ifNoneMatch).toBeUndefined();
  });
});
