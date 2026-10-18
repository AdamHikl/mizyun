import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("expo-notifications", () => ({
  AndroidImportance: { DEFAULT: 3 },
  SchedulableTriggerInputTypes: { DAILY: "daily", DATE: "date" },
  setNotificationChannelAsync: vi.fn(),
  getPermissionsAsync: vi.fn(),
  requestPermissionsAsync: vi.fn(),
  scheduleNotificationAsync: vi.fn(),
  cancelScheduledNotificationAsync: vi.fn(),
}));
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn().mockResolvedValue(null),
  setItemAsync: vi.fn().mockResolvedValue(undefined),
  deleteItemAsync: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("@/composition/api-client", () => ({
  apiClient: { status: vi.fn(), request: vi.fn() },
  invalidateSessionReads: vi.fn(),
}));
vi.mock("@/features/running/public-data", () => ({ listRuns: vi.fn() }));

import type { ApiClient } from "@mizyun/api-client";
import { listRuns } from "@/features/running/public-data";
import { fetchTodayTraining } from "./today-training-data";

const now = new Date(2026, 9, 18, 18, 0);
const todayAt = (hour: number): string =>
  new Date(2026, 9, 18, hour, 0).toISOString();
const yesterdayAt = (hour: number): string =>
  new Date(2026, 9, 17, hour, 0).toISOString();

const sessionDetails = { workoutLifecycle: { kind: "session" } };

interface FakeWorkout {
  id: string;
  completedAt: string | null;
  details: Record<string, unknown>;
}
const workout = (
  id: string,
  completedAt: string | null,
  details: Record<string, unknown> = sessionDetails,
): FakeWorkout => ({ id, completedAt, details });

const set = (exerciseId: string, completed: boolean) => ({
  exerciseId,
  completedAt: completed ? todayAt(17) : null,
});

type Reply = { ok: true; value: unknown } | { ok: false; error: unknown };
const failure: Reply = { ok: false, error: { kind: "network_error" } };

const makeClient = (routes: Record<string, Reply>) => {
  const request = vi.fn(async (options: { path: string }) => {
    const reply = routes[options.path];
    return reply ?? failure;
  });
  const client = { status: vi.fn(), request } as unknown as ApiClient;
  return { client, request };
};

const workoutsReply = (workouts: FakeWorkout[]): Reply => ({
  ok: true,
  value: { workouts },
});
const WORKOUTS = "/v1/workouts?limit=200";
const EXERCISES = "/v1/exercises?limit=200";

const mockedListRuns = vi.mocked(listRuns);
const noRuns = { ok: true as const, value: { runs: [], nextCursor: null } };

describe("fetchTodayTraining", () => {
  beforeEach(() => {
    mockedListRuns.mockReset();
    mockedListRuns.mockResolvedValue(noRuns as never);
  });

  it("returns null when the workout list cannot be read", async () => {
    const { client } = makeClient({});
    await expect(fetchTodayTraining(client, now)).resolves.toBeNull();
  });

  it("counts only completed sets per exercise and maps ids to names", async () => {
    const { client } = makeClient({
      [WORKOUTS]: workoutsReply([workout("w1", todayAt(17))]),
      "/v1/workouts/w1/sets": {
        ok: true,
        value: {
          workoutSets: [
            set("e-squat", true),
            set("e-squat", true),
            set("e-squat", false),
            set("e-bench", true),
            set("e-ghost", false),
          ],
        },
      },
      [EXERCISES]: {
        ok: true,
        value: {
          exercises: [
            { id: "e-squat", name: "Back Squat" },
            { id: "e-bench", name: "Bench Press" },
            { id: "e-ghost", name: "Ghost" },
          ],
        },
      },
    });

    const result = await fetchTodayTraining(client, now);

    expect(result).toEqual({
      trained: true,
      input: {
        exercises: [
          { name: "Back Squat", setCount: 2 },
          { name: "Bench Press", setCount: 1 },
        ],
        activities: [],
      },
    });
  });

  it("sums sets across several finished sessions", async () => {
    const { client } = makeClient({
      [WORKOUTS]: workoutsReply([
        workout("w1", todayAt(9)),
        workout("w2", todayAt(17)),
      ]),
      "/v1/workouts/w1/sets": {
        ok: true,
        value: { workoutSets: [set("e-squat", true)] },
      },
      "/v1/workouts/w2/sets": {
        ok: true,
        value: { workoutSets: [set("e-squat", true), set("e-squat", true)] },
      },
      [EXERCISES]: {
        ok: true,
        value: { exercises: [{ id: "e-squat", name: "Back Squat" }] },
      },
    });

    const result = await fetchTodayTraining(client, now);

    expect(result?.input.exercises).toEqual([
      { name: "Back Squat", setCount: 3 },
    ]);
  });

  it("ignores yesterday, in-progress and routine template workouts", async () => {
    const { client, request } = makeClient({
      [WORKOUTS]: workoutsReply([
        workout("old", yesterdayAt(20)),
        workout("live", null),
        workout("routine", todayAt(8), {
          workoutLifecycle: { kind: "routine" },
        }),
      ]),
    });

    const result = await fetchTodayTraining(client, now);

    expect(result).toEqual({
      trained: false,
      input: { exercises: [], activities: [] },
    });
    // No set or exercise reads are made for ignored workouts.
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("reports running and bouldering workouts as activities without reading sets", async () => {
    const { client, request } = makeClient({
      [WORKOUTS]: workoutsReply([
        workout("run", todayAt(7), {
          ...sessionDetails,
          activityType: "running",
        }),
        workout("boulder", todayAt(12), {
          ...sessionDetails,
          activityType: "bouldering",
        }),
      ]),
    });

    const result = await fetchTodayTraining(client, now);

    expect(result?.trained).toBe(true);
    expect([...(result?.input.activities ?? [])].sort()).toEqual([
      "bouldering",
      "running",
    ]);
    expect(result?.input.exercises).toEqual([]);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("reports a run listed for today as running", async () => {
    mockedListRuns.mockResolvedValue({
      ok: true,
      value: { runs: [{ id: "r1" }], nextCursor: null },
    } as never);
    const { client } = makeClient({ [WORKOUTS]: workoutsReply([]) });

    const result = await fetchTodayTraining(client, now);

    expect(result).toEqual({
      trained: true,
      input: { exercises: [], activities: ["running"] },
    });
  });

  it("does not duplicate running when both a run and a running workout exist", async () => {
    mockedListRuns.mockResolvedValue({
      ok: true,
      value: { runs: [{ id: "r1" }], nextCursor: null },
    } as never);
    const { client } = makeClient({
      [WORKOUTS]: workoutsReply([
        workout("run", todayAt(7), {
          ...sessionDetails,
          activityType: "running",
        }),
      ]),
    });

    const result = await fetchTodayTraining(client, now);

    expect(result?.input.activities).toEqual(["running"]);
  });

  it("tolerates a failed run read", async () => {
    mockedListRuns.mockResolvedValue({
      ok: false,
      error: { kind: "network_error" },
    } as never);
    const { client } = makeClient({
      [WORKOUTS]: workoutsReply([
        workout("boulder", todayAt(12), {
          ...sessionDetails,
          activityType: "bouldering",
        }),
      ]),
    });

    const result = await fetchTodayTraining(client, now);

    expect(result).toEqual({
      trained: true,
      input: { exercises: [], activities: ["bouldering"] },
    });
  });

  it("reports unknown when the run read fails and nothing else counts", async () => {
    // A failed run list must not cancel the reminder of a run-only day.
    mockedListRuns.mockResolvedValue({
      ok: false,
      error: { kind: "network_error" },
    } as never);
    const { client } = makeClient({ [WORKOUTS]: workoutsReply([]) });

    expect(await fetchTodayTraining(client, now)).toBeNull();
  });

  it("queries runs for today's local date only", async () => {
    const { client } = makeClient({ [WORKOUTS]: workoutsReply([]) });

    await fetchTodayTraining(client, new Date(2026, 0, 5, 23, 59));

    expect(mockedListRuns).toHaveBeenCalledExactlyOnceWith(client, {
      from: "2026-01-05",
      to: "2026-01-05",
    });
  });

  it("still counts a finished session when its sets cannot be read", async () => {
    const { client } = makeClient({
      [WORKOUTS]: workoutsReply([workout("w1", todayAt(17))]),
    });

    const result = await fetchTodayTraining(client, now);

    expect(result).toEqual({
      trained: true,
      input: { exercises: [], activities: [] },
    });
  });

  it("still counts a finished session when the exercise names cannot be read", async () => {
    const { client } = makeClient({
      [WORKOUTS]: workoutsReply([workout("w1", todayAt(17))]),
      "/v1/workouts/w1/sets": {
        ok: true,
        value: { workoutSets: [set("e-squat", true)] },
      },
    });

    const result = await fetchTodayTraining(client, now);

    expect(result).toEqual({
      trained: true,
      input: { exercises: [], activities: [] },
    });
  });

  it("keeps the exercises whose names are known when others are unknown", async () => {
    const { client } = makeClient({
      [WORKOUTS]: workoutsReply([workout("w1", todayAt(17))]),
      "/v1/workouts/w1/sets": {
        ok: true,
        value: { workoutSets: [set("e-squat", true), set("e-gone", true)] },
      },
      [EXERCISES]: {
        ok: true,
        value: { exercises: [{ id: "e-squat", name: "Back Squat" }] },
      },
    });

    const result = await fetchTodayTraining(client, now);

    expect(result?.input.exercises).toEqual([
      { name: "Back Squat", setCount: 1 },
    ]);
  });

  it("does not read exercise names when no set was completed", async () => {
    const { client, request } = makeClient({
      [WORKOUTS]: workoutsReply([workout("w1", todayAt(17))]),
      "/v1/workouts/w1/sets": {
        ok: true,
        value: { workoutSets: [set("e-squat", false)] },
      },
    });

    const result = await fetchTodayTraining(client, now);

    expect(result?.trained).toBe(true);
    const paths = request.mock.calls.map(([options]) => options.path);
    expect(paths).not.toContain(EXERCISES);
  });
});
