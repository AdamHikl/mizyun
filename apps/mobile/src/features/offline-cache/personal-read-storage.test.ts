import { describe, expect, it, vi } from "vitest";
import type { StringStorage } from "@mizyun/adapter-supabase-mobile";
import { purgeOfflineCache } from "./offline-cache-storage";
import {
  createPersonalReadStorage,
  isPersonalDisplayPath,
  personalReadCacheKey,
  PERSONAL_READ_MAX_AGE_MS,
  PERSONAL_READ_MAX_BYTES,
  type PersonalReadRecord,
} from "./personal-read-storage";

const OWNER = "synthetic-owner";
const NOW = 1_800_000_000_000;
const record = (path = "/v1/profile", savedAt = NOW): PersonalReadRecord => ({
  path,
  savedAt,
  value: { display: "synthetic" },
});
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
function memory() {
  const values = new Map<string, string>();
  const store: StringStorage = {
    getItem: vi.fn(async (key) => values.get(key) ?? null),
    setItem: vi.fn(async (key, value) => {
      values.set(key, value);
    }),
    removeItem: vi.fn(async (key) => {
      values.delete(key);
    }),
  };
  return { values, store, cache: createPersonalReadStorage(store, () => NOW) };
}
const encoded = (records: unknown[], ownerId = OWNER, version = 1) =>
  JSON.stringify({ version, ownerId, records });

describe("personal display path boundary", () => {
  it.each([
    "/v1/profile",
    "/v1/goals/active",
    "/v1/energy/summary?utcOffsetMinutes=120",
    "/v1/exercises?limit=200",
    "/v1/body-measurements?limit=1",
    "/v1/food-entries?search=synthetic%20meal&cursor=a%2Fb%3D&limit=200",
    "/v1/food-entries/summary?date=2026-10-09&utcOffsetMinutes=-120",
    "/v1/workouts?from=2026-10-01&to=2026-10-09&kind=routine&limit=200",
    "/v1/runs?limit=50",
    "/v1/coach/conversations",
    "/v1/runs/synthetic-run",
    "/v1/workouts/synthetic-workout/sets",
    "/v1/coach/conversations/synthetic-thread",
  ])("allows %s", (path) => {
    expect(isPersonalDisplayPath(path)).toBe(true);
  });

  it.each([
    "/v1/community/feed",
    "/v1/auth/session",
    "/v1/ai/readiness",
    "/v1/food-entries/id/photo",
    "/v1/account",
    "/v1/profile/extra",
    "https://example.test/v1/profile",
    "//example.test/v1/profile",
    "/v1/profile/../account",
    "/v1/runs/..",
    "/v1/runs/%2e%2e",
    "/v1/runs/a%2Fb",
    "/v1/runs/a\\b",
    "/v1/profile#fragment",
    "/v1/profile?token=secret",
    "/v1/profile?",
    "/v1/runs?limit=10&limit=20",
    "/v1/runs?%6cimit=10",
    "/v1/runs?limit=20?token=x",
    "/v1/runs?limit=%ZZ",
    "/v1/food-entries?search=%00",
    "/v1/profile\n",
  ])("rejects %s", (path) => {
    expect(isPersonalDisplayPath(path)).toBe(false);
  });
});

describe("encrypted personal read snapshot adapter", () => {
  it("uses one owner key and restores only that owner's versioned snapshot after restart", async () => {
    const { cache, store, values } = memory();
    await cache.save(OWNER, [record()]);
    expect([...values.keys()]).toEqual([personalReadCacheKey(OWNER)]);
    expect(JSON.parse(values.get(personalReadCacheKey(OWNER))!)).toEqual({
      version: 1,
      ownerId: OWNER,
      records: [record()],
    });
    expect(
      await createPersonalReadStorage(store, () => NOW).load(OWNER),
    ).toEqual([record()]);
    expect(await cache.load("other-owner")).toEqual([]);
    values.set(
      personalReadCacheKey("other-owner"),
      values.get(personalReadCacheKey(OWNER))!,
    );
    expect(await cache.load("other-owner")).toEqual([]);
  });

  it.each([
    "not json",
    "null",
    "[]",
    encoded([record()], OWNER, 2),
    JSON.stringify({ version: 1, ownerId: OWNER, records: "invalid" }),
    JSON.stringify({
      version: 1,
      ownerId: OWNER,
      records: [record()],
      token: "excluded",
    }),
  ])("rejects corrupt/incompatible envelope %s", async (json) => {
    const { cache, values } = memory();
    values.set(personalReadCacheKey(OWNER), json);
    expect(await cache.load(OWNER)).toEqual([]);
  });

  it("drops malformed, forbidden, expired and future records while retaining the 48h boundary", async () => {
    const { cache, values } = memory();
    const valid = record("/v1/profile", NOW - PERSONAL_READ_MAX_AGE_MS);
    values.set(
      personalReadCacheKey(OWNER),
      encoded([
        valid,
        record("/v1/runs", NOW - PERSONAL_READ_MAX_AGE_MS - 1),
        record("/v1/exercises", NOW + 1),
        record("/v1/community/feed"),
        record("/v1/runs", NaN),
        { path: "/v1/runs", savedAt: NOW },
        { ...record("/v1/workouts"), token: "excluded" },
        null,
      ]),
    );
    expect(await cache.load(OWNER)).toEqual([valid]);
    await cache.save(OWNER, [
      valid,
      record("/v1/runs", NOW + 1),
      record("/v1/community/feed"),
    ]);
    expect(await cache.load(OWNER)).toEqual([valid]);
  });

  it("expires an initially valid snapshot across a restart", async () => {
    const { cache, store } = memory();
    await cache.save(OWNER, [record()]);
    expect(
      await createPersonalReadStorage(
        store,
        () => NOW + PERSONAL_READ_MAX_AGE_MS + 1,
      ).load(OWNER),
    ).toEqual([]);
  });

  it("deduplicates paths by latest savedAt and evicts oldest records above 512", async () => {
    const { cache } = memory();
    const records = Array.from({ length: 520 }, (_, index) =>
      record(`/v1/runs/id-${index}`, NOW - index),
    );
    await cache.save(OWNER, [...records, record("/v1/runs/id-0", NOW - 10)]);
    const loaded = await cache.load(OWNER);
    expect(loaded).toHaveLength(512);
    expect(loaded[0]).toEqual(records[0]);
    expect(loaded.at(-1)).toEqual(records[511]);
  });

  it("caps UTF-8 bytes including envelope and keeps smaller recent records when a value is too large", async () => {
    const { cache, values } = memory();
    await cache.save(OWNER, [
      { ...record(), value: "😀".repeat(300_000) },
      { ...record("/v1/runs/a", NOW - 1), value: "😀".repeat(180_000) },
      { ...record("/v1/runs/b", NOW - 2), value: "😀".repeat(100_000) },
      record("/v1/exercises", NOW - 3),
    ]);
    const json = values.get(personalReadCacheKey(OWNER))!;
    expect(Buffer.byteLength(json, "utf8")).toBeLessThanOrEqual(
      PERSONAL_READ_MAX_BYTES,
    );
    expect((await cache.load(OWNER)).map((item) => item.path)).toEqual([
      "/v1/runs/a",
      "/v1/exercises",
    ]);
  });

  it("rejects oversized and excessive-record disk envelopes before returning data", async () => {
    const { cache, values } = memory();
    values.set(
      personalReadCacheKey(OWNER),
      encoded([{ ...record(), value: "x".repeat(PERSONAL_READ_MAX_BYTES) }]),
    );
    expect(await cache.load(OWNER)).toEqual([]);
    values.set(
      personalReadCacheKey(OWNER),
      encoded(Array.from({ length: 513 }, () => record())),
    );
    expect(await cache.load(OWNER)).toEqual([]);
  });

  it("detaches queued records and skips unserializable values", async () => {
    const { cache } = memory();
    const value = { display: "before" };
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const saving = cache.save(OWNER, [
      { ...record(), value },
      { ...record("/v1/runs/cycle"), value: cycle },
      { ...record("/v1/runs/undefined"), value: undefined },
    ]);
    value.display = "after";
    await saving;
    expect(await cache.load(OWNER)).toEqual([
      { ...record(), value: { display: "before" } },
    ]);
  });

  it("returns empty loads and resolves saves on native storage failures", async () => {
    const { cache, store } = memory();
    vi.mocked(store.getItem).mockRejectedValue(
      new Error("native read unavailable"),
    );
    vi.mocked(store.setItem).mockRejectedValue(
      new Error("native write unavailable"),
    );
    expect(await cache.load(OWNER)).toEqual([]);
    await expect(cache.save(OWNER, [record()])).resolves.toBeUndefined();
  });

  it("rejects a failed purge and remains usable after retry", async () => {
    const { cache, store, values } = memory();
    await cache.save(OWNER, [record()]);
    vi.mocked(store.removeItem).mockRejectedValueOnce(
      new Error("native deletion failed"),
    );
    await expect(cache.purge(OWNER)).rejects.toThrow("native deletion failed");
    expect(values.has(personalReadCacheKey(OWNER))).toBe(true);
    await cache.purge(OWNER);
    expect(await cache.load(OWNER)).toEqual([]);
    await cache.save(OWNER, [record()]);
    expect(await cache.load(OWNER)).toEqual([record()]);
  });

  it("fences queued obsolete saves and removes an already-running save before purge completes", async () => {
    const { cache, store, values } = memory();
    const started = deferred();
    const release = deferred();
    vi.mocked(store.setItem).mockImplementationOnce(async (key, value) => {
      started.resolve();
      await release.promise;
      values.set(key, value);
    });
    const active = cache.save(OWNER, [record()]);
    await started.promise;
    const obsolete = cache.save(OWNER, [record("/v1/runs/obsolete")]);
    const purge = createPersonalReadStorage(store, () => NOW).purge(OWNER);
    release.resolve();
    await Promise.all([active, obsolete, purge]);
    expect(store.setItem).toHaveBeenCalledTimes(1);
    expect(values.has(personalReadCacheKey(OWNER))).toBe(false);
    await cache.save(OWNER, [record("/v1/runs/fresh")]);
    expect(await cache.load(OWNER)).toEqual([record("/v1/runs/fresh")]);
  });

  it("retires an in-flight load when purge starts and serializes a fresh write after purge", async () => {
    const { cache, store, values } = memory();
    await cache.save(OWNER, [record()]);
    const started = deferred();
    const release = deferred();
    vi.mocked(store.getItem).mockImplementationOnce(async (key) => {
      const value = values.get(key) ?? null;
      started.resolve();
      await release.promise;
      return value;
    });
    const loading = cache.load(OWNER);
    await started.promise;
    const purge = cache.purge(OWNER);
    const fresh = cache.save(OWNER, [record("/v1/runs/fresh")]);
    release.resolve();
    expect(await loading).toEqual([]);
    await Promise.all([purge, fresh]);
    expect(await cache.load(OWNER)).toEqual([record("/v1/runs/fresh")]);
  });

  it("account cleanup shares the fence with blocked and queued personal saves", async () => {
    const { cache, store, values } = memory();
    const started = deferred();
    const release = deferred();
    vi.mocked(store.setItem).mockImplementationOnce(async (key, value) => {
      started.resolve();
      await release.promise;
      values.set(key, value);
    });
    const active = cache.save(OWNER, [record()]);
    await started.promise;
    const obsolete = cache.save(OWNER, [record("/v1/runs/obsolete")]);
    const cleanup = purgeOfflineCache(OWNER, store);
    release.resolve();
    await Promise.all([active, obsolete, cleanup]);
    expect(store.setItem).toHaveBeenCalledTimes(1);
    expect(values.has(personalReadCacheKey(OWNER))).toBe(false);
  });

  it("account cleanup reports a personal-read deletion failure", async () => {
    const { cache, store } = memory();
    await cache.save(OWNER, [record()]);
    vi.mocked(store.removeItem).mockImplementation(async (key) => {
      if (key === personalReadCacheKey(OWNER))
        throw new Error("native deletion failed");
    });
    await expect(purgeOfflineCache(OWNER, store)).rejects.toThrow(
      "Offline account cache cleanup is incomplete.",
    );
  });

  it("keeps purge generations after lanes drain so a previously scheduled callback can retire", async () => {
    const { cache, store, values } = memory();
    const scheduledGeneration = cache.generation!(OWNER);
    const scheduledSave = async () => {
      if (cache.generation!(OWNER) !== scheduledGeneration) return;
      await cache.save(OWNER, [record("/v1/runs/obsolete-timer")]);
    };
    await purgeOfflineCache(OWNER, store);
    expect(cache.generation!(OWNER)).toBe(scheduledGeneration + 1);
    expect(createPersonalReadStorage(store).generation!(OWNER)).toBe(
      scheduledGeneration + 1,
    );
    await scheduledSave();
    expect(values.has(personalReadCacheKey(OWNER))).toBe(false);
    await cache.save(OWNER, [record("/v1/runs/fresh")]);
    expect(await cache.load(OWNER)).toEqual([record("/v1/runs/fresh")]);
    await cache.purge(OWNER);
    expect(cache.generation!(OWNER)).toBe(scheduledGeneration + 2);
  });

  it("purges one owner without deleting another owner", async () => {
    const { cache } = memory();
    await cache.save(OWNER, [record()]);
    await cache.save("other-owner", [record("/v1/runs/other")]);
    await cache.purge(OWNER);
    expect(await cache.load(OWNER)).toEqual([]);
    expect(await cache.load("other-owner")).toEqual([record("/v1/runs/other")]);
  });

  it("rejects invalid cleanup owners and never touches storage for invalid read/write owners", async () => {
    const { cache, store } = memory();
    expect(await cache.load("../owner")).toEqual([]);
    await cache.save("", [record()]);
    await expect(cache.purge("../owner")).rejects.toThrow(
      "Invalid personal cache owner",
    );
    expect(store.getItem).not.toHaveBeenCalled();
    expect(store.setItem).not.toHaveBeenCalled();
    expect(store.removeItem).not.toHaveBeenCalled();
  });
});
