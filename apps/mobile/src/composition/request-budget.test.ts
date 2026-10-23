import { describe, expect, it, vi } from "vitest";
import type { ApiClient, RequestOptions } from "@mizyun/api-client";
import type { AuthSession } from "@mizyun/identity";
import type {
  PersonalReadRecord,
  PersonalReadStorage,
} from "@/features/offline-cache/personal-read-storage";
vi.mock(
  "@/features/workouts",
  () => import("../features/workouts/workouts-hub-data"),
);
import { preloadAppData } from "./startup-data";
import { SessionReadCache } from "./session-read-cache";

// Server request budget for the main app journeys. Each scenario counts the
// requests that reach the transport behind the shared read cache.

const alice = {
  user: { id: "alice" },
  accessToken: "token-1",
} as AuthSession;

function transport() {
  const request = vi.fn(async (options: RequestOptions) => {
    if (options.method !== "GET") return { ok: true, value: {} };
    if (options.path.startsWith("/v1/runs"))
      return { ok: true, value: { runs: [], nextCursor: null } };
    if (options.path.startsWith("/v1/workouts"))
      return { ok: true, value: { workouts: [] } };
    if (options.path.startsWith("/v1/exercises"))
      return { ok: true, value: { exercises: [] } };
    if (options.path.startsWith("/v1/body-measurements"))
      return { ok: true, value: { bodyMeasurements: [] } };
    if (options.path.startsWith("/v1/food-entries?"))
      return { ok: true, value: { foodEntries: [] } };
    if (options.path === "/v1/coach/status")
      return { ok: true, value: { ready: true } };
    if (options.path === "/v1/coach/conversations")
      return { ok: true, value: { conversations: [{ id: "chat" }] } };
    return { ok: true, value: {} };
  });
  return {
    request,
    status: () => ({ configured: false, reason: "fixture" }),
  } as unknown as ApiClient & { request: typeof request };
}

function memoryStorage(): PersonalReadStorage {
  const saved = new Map<string, ReadonlyArray<PersonalReadRecord>>();
  const generations = new Map<string, number>();
  return {
    generation: (userId) => generations.get(userId) ?? 0,
    load: async (userId) => saved.get(userId) ?? [],
    save: async (userId, records) => {
      saved.set(userId, records);
    },
    replace: async (userId, records) => {
      saved.set(userId, records);
    },
    purge: async (userId) => {
      generations.set(userId, (generations.get(userId) ?? 0) + 1);
      saved.delete(userId);
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

function app(storage = memoryStorage(), start = new Date(2026, 9, 3, 12)) {
  let session: AuthSession = alice;
  let time = start.getTime();
  const raw = transport();
  const cache = new SessionReadCache(
    raw,
    async () => session,
    () => time,
    storage,
  );
  const preload = async () => {
    await preloadAppData(cache, session, () => true, new Date(time), 1990);
    await settle();
  };
  const count = async (step: () => Promise<unknown>) => {
    raw.request.mockClear();
    await step();
    return raw.request.mock.calls.length;
  };
  return {
    cache,
    storage,
    preload,
    count,
    advance: (ms: number) => {
      time += ms;
    },
    rotate: (accessToken: string) => {
      session = { ...session, accessToken };
    },
  };
}

describe("server request budget", () => {
  it("records requests per journey", async () => {
    const a = app();
    const coldStart = await a.count(a.preload);

    // The app goes to the background for 30 seconds and returns.
    const resume = await a.count(async () => {
      a.cache.setForeground(false);
      a.advance(30_000);
      a.cache.setForeground(true);
      await a.preload();
    });

    // Routine same-account access-token refresh.
    const tokenRefresh = await a.count(async () => {
      a.rotate("token-2");
      await a.preload();
    });

    // Log a meal, then revisit every tab.
    const mealWrite = await a.count(async () => {
      await a.cache.request({ method: "POST", path: "/v1/food-entries" });
      await a.preload();
    });

    // Relaunch two minutes later from the saved display data.
    const b = app(a.storage, new Date(2026, 9, 3, 12, 2));
    const relaunch = await b.count(b.preload);

    // Back to the first app after ten minutes in the background.
    const resumeLater = await a.count(async () => {
      a.cache.setForeground(false);
      a.advance(10 * 60_000);
      a.cache.setForeground(true);
      await a.preload();
    });

    const budget = {
      coldStart,
      resume,
      tokenRefresh,
      mealWrite,
      relaunch,
      resumeLater,
    };
    console.info("request budget", JSON.stringify(budget));
    // Baseline on ac3cb898 was 19 / 19 / 19 / 20 / 19 / 19 (the old cache
    // cleared on background, so every resume repeated the full preload).
    // Phase 1 (targeted invalidation, keep across background/token) gave
    // 19 / 2 / 2 / 8 / 11; phase 2 (shared body list, no unused meal warm,
    // thirty-minute goals/exercises) gives the values below.
    expect(budget).toEqual({
      coldStart: 17,
      resume: 2,
      tokenRefresh: 2,
      mealWrite: 7,
      relaunch: 10,
      resumeLater: 15,
    });
  });
});
