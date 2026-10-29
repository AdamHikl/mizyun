import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@mizyun/api-client";
import type { AuthSession } from "@mizyun/identity";
import { unpublishActivityResponseSchema as schema } from "@mizyun/contracts";
import type {
  PersonalReadRecord,
  PersonalReadStorage,
} from "@/features/offline-cache/personal-read-storage";
import { createPersonalReadStorage } from "@/features/offline-cache/personal-read-storage";
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

  it("keeps the affected reads only as saved display data after a lost non-delete write", async () => {
    const f = fixture();
    await f.cache.request(meals);
    await f.cache.request(workouts);
    f.request.mockRejectedValueOnce(new Error("synthetic lost response"));
    await f.cache.request({ method: "PATCH", path: "/v1/food-entries/x" });
    // Never fresh again: shown as saved, and the next read refetches it.
    expect(f.cache.peek(meals, alice)).toEqual({
      ...success,
      savedAt: f.now(),
    });
    expect(f.cache.peek(workouts, alice)).toEqual(success);
    f.request.mockClear();
    await f.cache.request(meals);
    await vi.waitFor(() => expect(calls(f)).toEqual([meals.path]));
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

describe("offline writes and saved training data (device-first set queue)", () => {
  // The real encrypted-snapshot adapter over an in-memory store, so records
  // pass the same disk validation as on a phone. A new cache over the same
  // store is an app restart.
  function device(owner: AuthSession) {
    const values = new Map<string, string>();
    let time = new Date(2026, 9, 3, 12).getTime();
    const store = {
      getItem: vi.fn(async (key: string) => values.get(key) ?? null),
      setItem: vi.fn(async (key: string, value: string) => {
        values.set(key, value);
      }),
      removeItem: vi.fn(async (key: string) => {
        values.delete(key);
      }),
    };
    const launch = (request = vi.fn().mockResolvedValue(success)) => {
      const storage = createPersonalReadStorage(store, () => time);
      const cache = new SessionReadCache(
        {
          request,
          status: () => ({ configured: false, reason: "fixture" }),
        } as ApiClient,
        async () => owner,
        () => time,
        storage,
      );
      return { cache, request, storage };
    };
    return {
      launch,
      store,
      saved: () => [...values.values()].join(""),
      now: () => time,
      advance: (ms: number) => {
        time += ms;
      },
    };
  }
  const offlineResult = {
    ok: false as const,
    error: { kind: "network_error" as const, cause: "synthetic offline" },
  };
  const setWrite = {
    method: "POST" as const,
    path: "/v1/workouts/w1/sets",
    body: { clientOperationId: "synthetic" },
  };
  const sets = read("/v1/workouts/w1/sets");
  const owner = (id: string) =>
    ({ user: { id }, accessToken: `token-${id}` }) as AuthSession;

  it("keeps saved workouts across offline set replays and a restart", async () => {
    const phone = device(owner("offline-owner"));
    const online = phone.launch();
    for (const options of [workouts, sets]) await online.cache.request(options);
    await settle();
    // Airplane mode: each set replay (log, timer, foreground) fails to send.
    online.request.mockResolvedValue(offlineResult);
    phone.advance(60_000);
    for (let attempt = 0; attempt < 2; attempt++)
      expect(await online.cache.request(setWrite)).toEqual(offlineResult);
    await settle();
    // Force-quit and reopen, still offline.
    phone.advance(60_000);
    const relaunched = phone.launch(vi.fn().mockResolvedValue(offlineResult));
    const savedAt = phone.now() - 120_000;
    expect(await relaunched.cache.request(workouts)).toEqual({
      ...success,
      savedAt,
    });
    expect(await relaunched.cache.request(sets)).toEqual({
      ...success,
      savedAt,
    });
  });

  it("shows saved data to a read that failed offline while a set replay was pending", async () => {
    const phone = device(owner("racing-owner"));
    const online = phone.launch();
    await online.cache.request(workouts);
    await settle();
    phone.advance(60_000);
    // Opening the logger offline: the replay is in flight when it reads.
    const relaunched = phone.launch(vi.fn().mockResolvedValue(offlineResult));
    let fail!: (value: typeof offlineResult) => void;
    relaunched.request.mockReturnValueOnce(
      new Promise((done) => {
        fail = done;
      }),
    );
    const write = relaunched.cache.request(setWrite);
    await vi.waitFor(() =>
      expect(relaunched.request).toHaveBeenCalledWith(
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const reading = relaunched.cache.request(workouts);
    await vi.waitFor(() =>
      expect(relaunched.request).toHaveBeenCalledWith(
        expect.objectContaining({ path: workouts.path }),
      ),
    );
    fail(offlineResult);
    expect(await write).toEqual(offlineResult);
    expect(await reading).toEqual({
      ...success,
      savedAt: phone.now() - 60_000,
    });
  });

  it("never serves a snapshot kept across an unanswered write as fresh", async () => {
    const phone = device(owner("unanswered-owner"));
    const online = phone.launch();
    await online.cache.request(workouts);
    await settle();
    online.request.mockResolvedValue(offlineResult);
    await online.cache.request(setWrite);
    // Same process: display-only, and the read revalidates in the background.
    online.request.mockClear();
    online.request.mockResolvedValue(success);
    expect(await online.cache.request(workouts)).toEqual({
      ...success,
      savedAt: phone.now(),
    });
    await vi.waitFor(() => expect(online.request).toHaveBeenCalledTimes(1));
    // A lost response just before a force-quit: a relaunch well inside the
    // read lifetime still shows it as saved and revalidates it.
    online.request.mockResolvedValue(offlineResult);
    phone.advance(1000);
    await online.cache.request(setWrite);
    await settle();
    const relaunched = phone.launch();
    expect(await relaunched.cache.request(workouts)).toEqual({
      ...success,
      savedAt: phone.now() - 1000,
    });
    await vi.waitFor(() => expect(relaunched.request).toHaveBeenCalledTimes(1));
  });

  it.each([
    ["a success", success],
    [
      "an API rejection",
      {
        ok: false as const,
        error: { kind: "http_error" as const, status: 404, code: "NOT_FOUND" },
      },
    ],
  ])(
    "forgets what a write changed once the server answers with %s",
    async (_, answer) => {
      const account = owner(`answered-${answer.ok}`);
      const phone = device(account);
      const online = phone.launch();
      await online.cache.request(workouts);
      await online.cache.request(profile);
      await settle();
      online.request.mockResolvedValueOnce(answer);
      await online.cache.request({ method: "DELETE", path: "/v1/workouts/w1" });
      // Neither memory nor the device keeps the deleted workout's list.
      expect(online.cache.peek(workouts, account)).toBeNull();
      expect(
        (await online.storage.load(account.user.id)).map((r) => r.path),
      ).toEqual([profile.path]);
      online.request.mockClear();
      await online.cache.request(workouts);
      expect(online.request).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ["a workout", "/v1/workouts/w1", workouts],
    ["a Coach conversation", "/v1/coach/conversations/c1", chats],
  ])(
    "never keeps a saved copy of %s deleted offline",
    async (_, path, list) => {
      const phone = device(owner(`deleting-${path.split("/")[2]}`));
      const online = phone.launch();
      await online.cache.request(list);
      await settle();
      online.request.mockResolvedValue(offlineResult);
      expect(await online.cache.request({ method: "DELETE", path })).toEqual(
        offlineResult,
      );
      expect(online.cache.peek(list, owner("x"))).toBeNull();
      await settle();
      const relaunched = phone.launch(vi.fn().mockResolvedValue(offlineResult));
      expect(await relaunched.cache.request(list)).toEqual(offlineResult);
    },
  );

  it.each([
    ["a gateway 502", { kind: "http_error", status: 502, code: "BAD_GATEWAY" }],
    ["the API's retryable 503", { kind: "http_error", status: 503, code: "X" }],
    ["a 408 timeout", { kind: "http_error", status: 408, code: "TIMEOUT" }],
    ["a 429 rate limit", { kind: "http_error", status: 429, code: "LIMIT" }],
    ["an unsent no_session", { kind: "no_session" }],
    ["an unsent context change", { kind: "context_changed" }],
  ] as const)(
    "keeps saved workouts when a set replay gets %s",
    async (label, error) => {
      const phone = device(owner(`unknown-${label.replace(/\W/g, "")}`));
      const online = phone.launch();
      await online.cache.request(workouts);
      await settle();
      online.request.mockResolvedValue({ ok: false, error });
      await online.cache.request(setWrite);
      await settle();
      const relaunched = phone.launch(vi.fn().mockResolvedValue(offlineResult));
      expect(await relaunched.cache.request(workouts)).toEqual({
        ...success,
        savedAt: phone.now(),
      });
    },
  );

  it("purges an unreadable device copy and still sends the write before launch hydration", async () => {
    const phone = device(owner("unreadable-owner"));
    const online = phone.launch();
    await online.cache.request(workouts);
    await settle();
    expect(phone.saved()).toBeTruthy();
    const relaunched = phone.launch(vi.fn().mockResolvedValue(offlineResult));
    phone.store.getItem.mockRejectedValueOnce(new Error("key invalidated"));
    // A lost device key must not block every early write as "offline".
    expect(await relaunched.cache.request(setWrite)).toEqual(offlineResult);
    expect(relaunched.request).toHaveBeenCalledOnce();
    // No unmarked copy is left that could relaunch as fresh.
    expect(
      await relaunched.storage.load(owner("unreadable-owner").user.id),
    ).toEqual([]);
  });

  it("returns the offline failure, not a sign-out, when a write outlasts every retry", async () => {
    vi.useFakeTimers();
    try {
      const phone = device(owner("outlasted-owner"));
      const online = phone.launch();
      await online.cache.request(workouts);
      await vi.advanceTimersByTimeAsync(150);
      const relaunched = phone.launch(
        vi.fn(async (options: { method: string }) =>
          options.method === "GET"
            ? offlineResult
            : new Promise<never>(() => {}),
        ) as never,
      );
      void relaunched.cache.request(setWrite);
      await vi.waitFor(() => expect(relaunched.request).toHaveBeenCalled());
      const reading = relaunched.cache.request(workouts);
      await vi.advanceTimersByTimeAsync(11_000);
      expect(await reading).toEqual(offlineResult);
      expect(
        relaunched.request.mock.calls.filter(
          ([options]) => options.path === workouts.path,
        ),
      ).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("answers a read with nothing saved at once during a write", async () => {
    const phone = device(owner("unsaved-owner"));
    const online = phone.launch(vi.fn().mockResolvedValue(offlineResult));
    // Hydrates (nothing saved) before the write starts.
    await online.cache.request(profile);
    online.request.mockImplementation(async (options: { method: string }) =>
      options.method === "GET" ? offlineResult : new Promise(() => {}),
    );
    void online.cache.request(setWrite);
    await vi.waitFor(() =>
      expect(online.request).toHaveBeenCalledWith(
        expect.objectContaining({ method: "POST" }),
      ),
    );
    expect(await online.cache.request(meals)).toEqual(offlineResult);
  });

  it("forgets what an answered write changed even when an overlapping write is lost", async () => {
    const account = owner("overlapping-owner");
    const phone = device(account);
    const online = phone.launch();
    await online.cache.request(workouts);
    await settle();
    let lose!: (value: typeof offlineResult) => void;
    online.request.mockReturnValueOnce(
      new Promise((done) => {
        lose = done;
      }),
    );
    const lost = online.cache.request(setWrite);
    await vi.waitFor(() => expect(online.request).toHaveBeenCalledTimes(2));
    online.request.mockResolvedValueOnce(success);
    await online.cache.request({ method: "PATCH", path: "/v1/workouts/w1" });
    lose(offlineResult);
    await lost;
    await settle();
    expect(online.cache.peek(workouts, account)).toBeNull();
    expect(await online.storage.load(account.user.id)).toEqual([]);
    const relaunched = phone.launch(vi.fn().mockResolvedValue(offlineResult));
    expect(await relaunched.cache.request(workouts)).toEqual(offlineResult);
  });

  it("never writes back after an account cleanup during an answered write", async () => {
    const account = owner("cleaned-owner");
    const phone = device(account);
    const online = phone.launch();
    await online.cache.request(workouts);
    await settle();
    let answer!: (value: typeof success) => void;
    online.request.mockReturnValueOnce(
      new Promise((done) => {
        answer = done;
      }),
    );
    const write = online.cache.request(setWrite);
    await vi.waitFor(() => expect(online.request).toHaveBeenCalledTimes(2));
    await online.storage.purge(account.user.id);
    answer(success);
    await write;
    await settle();
    expect(phone.saved()).toBe("");
  });

  it("returns an answered write without waiting for the device rewrite", async () => {
    const phone = device(owner("prompt-owner"));
    const online = phone.launch();
    await online.cache.request(workouts);
    await settle();
    online.request.mockResolvedValueOnce(success);
    // The pre-send rewrite completes; the cleanup after the answer stalls.
    phone.store.setItem
      .mockImplementationOnce(async () => {})
      .mockImplementationOnce(() => new Promise(() => {}));
    expect(await online.cache.request(setWrite)).toEqual(success);
  });
});
