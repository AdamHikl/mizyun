import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@mizyun/api-client";
import {
  boulderSessionListResponseSchema,
  workoutListResponseSchema,
  type BoulderSessionListResponse,
  type WorkoutListResponse,
} from "@mizyun/contracts";
import type { AuthSession } from "@mizyun/identity";

import { SessionReadCache } from "@/composition/session-read-cache";
import { createPersonalReadStorage } from "@/features/offline-cache/personal-read-storage";
import { readDashboardSnapshot } from "./dashboard-data";

const owner = {
  user: { id: "climber" },
  accessToken: "token-climber",
} as AuthSession;
const offline = {
  ok: false as const,
  error: { kind: "network_error" as const, cause: "synthetic offline" },
};

const workout = {
  id: "00000000-0000-4000-8000-00000000b001",
  userId: "00000000-0000-4000-8000-000000000001",
  name: "Leg day",
  startedAt: "2026-10-28T08:00:00.000Z",
  completedAt: "2026-10-28T09:00:00.000Z",
  notes: null,
  source: "manual" as const,
  details: {},
  createdAt: "2026-10-28T08:00:00.000Z",
  updatedAt: "2026-10-28T09:00:00.000Z",
};
const workoutList: WorkoutListResponse = { workouts: [workout] };
const boulderList: BoulderSessionListResponse = {
  nextCursor: null,
  sessions: [
    {
      id: "33333333-3333-4333-8333-333333333333",
      clientOperationId: "11111111-1111-4111-8111-111111111111",
      name: "Bouldering",
      notes: null,
      startedAt: "2026-10-29T17:00:00.000Z",
      completedAt: "2026-10-29T19:00:00.000Z",
      session: {
        version: 1,
        gradeScale: "font",
        recordingTimezone: "Europe/Bratislava",
        activityDate: "2026-10-29",
        gymName: null,
      },
      summary: {
        boulders: 4,
        sends: 3,
        flashes: 1,
        attempts: 7,
        attemptsComplete: true,
        topGrade: "6C",
      },
    },
  ],
};

const workoutsRead = {
  method: "GET" as const,
  path: "/v1/workouts?from=2026-10-26&to=2026-10-30&limit=200",
  schema: workoutListResponseSchema,
};
const bouldersRead = {
  method: "GET" as const,
  path: "/v1/bouldering/sessions?limit=50",
  schema: boulderSessionListResponseSchema,
};
const query = {
  date: "2026-10-30",
  fromIsoDate: "2026-10-26",
  toIsoDate: "2026-10-29",
  utcOffsetMinutes: 0,
  boulderingEnabled: true,
};

function phone() {
  const values = new Map<string, string>();
  let time = new Date(2026, 9, 30, 12).getTime();
  const store = {
    getItem: async (key: string) => values.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: async (key: string) => {
      values.delete(key);
    },
  };
  const launch = (request: ReturnType<typeof vi.fn>) => {
    const cache = new SessionReadCache(
      {
        request,
        status: () => ({ configured: false, reason: "fixture" }),
      } as ApiClient,
      async () => owner,
      () => time,
      createPersonalReadStorage(store, () => time),
    );
    return { cache, request };
  };
  return {
    launch,
    now: () => time,
    advance: (ms: number) => {
      time += ms;
    },
  };
}
const onlineRequest = (reads: Record<string, unknown>) =>
  vi.fn(async (options: { path: string }) => {
    const value = Object.entries(reads).find(([path]) =>
      options.path.startsWith(path),
    )?.[1];
    return value === undefined ? offline : { ok: true as const, value };
  });
const settle = () => new Promise((resolve) => setTimeout(resolve, 150));
const snapshotOf = (cache: SessionReadCache) =>
  readDashboardSnapshot(
    <T>(options: Parameters<typeof cache.peek>[0]) =>
      cache.peek<T>(options, owner),
    query,
  );

describe("Today training count offline", () => {
  it("restores the combined count with its saved time after a restart", async () => {
    const device = phone();
    const online = device.launch(
      onlineRequest({
        "/v1/workouts": workoutList,
        "/v1/bouldering/sessions": boulderList,
      }),
    );
    await online.cache.request(workoutsRead);
    await online.cache.request(bouldersRead);
    await settle();
    const savedAt = device.now();

    // Force-quit and reopen offline an hour later: both lists come from disk.
    device.advance(60 * 60_000);
    const relaunched = device.launch(vi.fn().mockResolvedValue(offline));
    await relaunched.cache.request(workoutsRead);
    await relaunched.cache.request(bouldersRead);
    expect(snapshotOf(relaunched.cache).workouts).toEqual({
      value: 2,
      savedAt,
    });
  });

  it("keeps the saved climbing list for display only after an unanswered climbing write", async () => {
    const device = phone();
    const online = device.launch(
      onlineRequest({ "/v1/bouldering/sessions": boulderList }),
    );
    await online.cache.request(bouldersRead);
    expect(online.cache.peek(bouldersRead, owner)).toEqual({
      ok: true,
      value: boulderList,
    });
    online.request.mockResolvedValue(offline);
    await online.cache.request({
      method: "POST",
      path: "/v1/bouldering/sessions/s1/finish",
      body: {},
    });
    await settle();
    // Never fresh again: the next read goes back to the server, and shows
    // the saved list only while that fails.
    online.request.mockClear();
    expect(await online.cache.request(bouldersRead)).toEqual({
      ok: true,
      value: boulderList,
      savedAt: device.now(),
    });
    await vi.waitFor(() => expect(online.request).toHaveBeenCalledTimes(1));
  });

  it("forgets the saved climbing list once the server answers a climbing write", async () => {
    const device = phone();
    const online = device.launch(
      onlineRequest({
        "/v1/bouldering/sessions": boulderList,
      }),
    );
    await online.cache.request(bouldersRead);
    await online.cache.request({
      method: "POST",
      path: "/v1/bouldering/sessions/s1/finish",
      body: {},
    });
    await settle();
    expect(online.cache.peek(bouldersRead, owner)).toBeNull();
  });

  it("withholds the total, rather than a count without climbs, while the climbing list was never saved", async () => {
    const device = phone();
    const online = device.launch(
      onlineRequest({ "/v1/workouts": workoutList }),
    );
    await online.cache.request(workoutsRead);
    await settle();
    device.advance(60 * 60_000);
    const relaunched = device.launch(vi.fn().mockResolvedValue(offline));
    await relaunched.cache.request(workoutsRead);
    expect(snapshotOf(relaunched.cache).workouts).toBeNull();
    // The strength-only reading is unchanged where bouldering is off.
    expect(
      readDashboardSnapshot(
        <T>(options: Parameters<typeof relaunched.cache.peek>[0]) =>
          relaunched.cache.peek<T>(options, owner),
        { ...query, boulderingEnabled: false },
      ).workouts?.value,
    ).toBe(1);
  });
});
