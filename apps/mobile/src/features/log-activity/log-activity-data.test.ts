import { describe, expect, it } from "vitest";
import type { ApiClient, ApiError, RequestOptions } from "@mizyun/api-client";
import { listTimedActivities, readWorkoutLifecycle } from "@mizyun/core";
import type { Exercise, Workout, WorkoutSet } from "@mizyun/contracts";
import {
  resolveCustomExerciseWith,
  saveLoggedActivityWith,
  saveLoggedRunWith,
  type LogActivityPlan,
} from "./log-activity-data";

const NOW = "2026-10-17T10:00:00.000Z";
const swimming = listTimedActivities().find((a) => a.name === "Swimming")!;
const plan: LogActivityPlan = {
  ownerId: "u",
  operationId: "11111111-2222-4333-8444-555555555555",
  activity: swimming,
  startedAt: "2026-10-17T09:15:00.000Z",
  completedAt: NOW,
  durationSeconds: 2700,
  distanceMeters: 1500,
  notes: " easy ",
};
const exercise = (id: string, name: string): Exercise => ({
  id,
  userId: "u",
  name,
  instructions: null,
  metadata: {},
  createdAt: NOW,
  updatedAt: NOW,
});

function server(
  options: {
    exercises?: Exercise[];
    failOnce?: (o: RequestOptions) => ApiError | null;
  } = {},
) {
  const exercises = options.exercises ?? [];
  const workouts = new Map<string, Workout>();
  const sets: WorkoutSet[] = [];
  const log: RequestOptions[] = [];
  let failed = false;
  const client: ApiClient = {
    status: () => ({ configured: true, baseUrl: "https://x.test" }),
    request: async <T>(o: RequestOptions) => {
      log.push(o);
      const err = !failed ? options.failOnce?.(o) : null;
      if (err) {
        failed = true;
        return { ok: false as const, error: err };
      }
      const body = o.body as any;
      let value: unknown;
      if (o.path.startsWith("/v1/exercises?")) value = { exercises };
      else if (o.path === "/v1/exercises") {
        const created = exercise(
          `00000000-0000-4000-8000-00000000000${exercises.length + 1}`,
          body.name,
        );
        exercises.push(created);
        value = { exercise: created };
      } else if (o.path === "/v1/workouts") {
        const w: Workout = workouts.get(body.clientOperationId) ?? {
          id: `w-${workouts.size + 1}`,
          userId: "u",
          name: body.name,
          startedAt: body.startedAt,
          completedAt: body.completedAt,
          notes: body.notes ?? null,
          source: "manual",
          details: body.details,
          createdAt: NOW,
          updatedAt: NOW,
        };
        workouts.set(body.clientOperationId, w);
        value = { workout: w };
      } else if (o.method === "GET") value = { workoutSets: sets };
      else {
        const s = { id: `s-${sets.length + 1}`, ...body } as WorkoutSet;
        sets.push(s);
        value = { workoutSet: s };
      }
      return { ok: true as const, value: value as T };
    },
  };
  return { client, workouts, sets, exercises, log };
}
const net: ApiError = { kind: "network_error", cause: "offline" } as ApiError;

describe("saveLoggedActivityWith", () => {
  it("creates exercise, completed first-party workout and one set", async () => {
    const s = server();
    const result = await saveLoggedActivityWith(s.client, plan);
    expect(result.ok).toBe(true);
    expect(s.exercises.map((e) => e.name)).toEqual(["Swimming"]);
    const created = s.log.find((o) => o.path === "/v1/workouts")!.body as any;
    expect(created).toMatchObject({
      clientOperationId: plan.operationId,
      name: "Swimming",
      startedAt: plan.startedAt,
      completedAt: plan.completedAt,
      notes: "easy",
    });
    expect(created.activityType).toBeUndefined();
    expect(readWorkoutLifecycle(created.details)).toEqual({ kind: "session" });
    // Estimated times and a strength type would be wrong in Health (ADR-0068).
    expect(created.details.healthExportOrigin).toBeUndefined();
    const exerciseBody = s.log.find((o) => o.path === "/v1/exercises")!
      .body as any;
    expect(exerciseBody.metadata).toEqual({
      catalogId: "exercise-swimming",
      trackingMode: "duration_distance",
    });
    expect(s.sets).toHaveLength(1);
    expect(s.sets[0]).toMatchObject({
      exerciseId: "00000000-0000-4000-8000-000000000001",
      durationSeconds: 2700,
      distanceMeters: 1500,
      completedAt: NOW,
    });
  });

  it("reuses an existing exercise and omits missing distance", async () => {
    const s = server({
      exercises: [exercise("00000000-0000-4000-8000-0000000000e1", "Swimming")],
    });
    await saveLoggedActivityWith(s.client, { ...plan, distanceMeters: null });
    expect(s.log.some((o) => o.path === "/v1/exercises")).toBe(false);
    expect(s.sets[0]).toMatchObject({
      exerciseId: "00000000-0000-4000-8000-0000000000e1",
    });
    expect(s.sets[0]).not.toHaveProperty("distanceMeters");
  });

  it("retry after a failed set write makes no second workout or set", async () => {
    const s = server({
      failOnce: (o) =>
        o.path.endsWith("/sets") && o.method === "POST" ? net : null,
    });
    const first = await saveLoggedActivityWith(s.client, plan);
    expect(first.ok).toBe(false);
    expect(first).toMatchObject({ workoutRequested: true, retryable: true });
    if (!first.ok) {
      expect(first.message).toContain("saved without its time");
      expect(first.message).toContain("Retry");
    }
    expect(s.workouts.size).toBe(1);
    const second = await saveLoggedActivityWith(s.client, plan);
    expect(second.ok).toBe(true);
    expect(s.workouts.size).toBe(1);
    expect(s.sets).toHaveLength(1);
    expect(s.exercises).toHaveLength(1);
  });

  it("treats a lost set response as done without duplicating the set", async () => {
    const s = server();
    await saveLoggedActivityWith(s.client, plan);
    await saveLoggedActivityWith(s.client, plan);
    expect(s.workouts.size).toBe(1);
    expect(s.sets).toHaveLength(1);
  });

  it("creates no workout when the exercise list cannot be read", async () => {
    const s = server({ failOnce: () => net });
    const result = await saveLoggedActivityWith(s.client, plan);
    expect(result.ok).toBe(false);
    expect(s.workouts.size).toBe(0);
  });

  it("fails closed on ambiguous saved exercises", async () => {
    const s = server({
      exercises: [exercise("a", "Swimming"), exercise("b", "swimming")],
    });
    const result = await saveLoggedActivityWith(s.client, plan);
    expect(result).toMatchObject({ ok: false, workoutRequested: false });
    expect(s.workouts.size).toBe(0);
    expect(s.exercises).toHaveLength(2);
  });

  it("fails closed when the saved list may be truncated", async () => {
    const many = Array.from({ length: 200 }, (_, i) =>
      exercise(`e${i}`, `Move ${i}`),
    );
    const s = server({ exercises: many });
    const result = await saveLoggedActivityWith(s.client, plan);
    expect(result).toMatchObject({ ok: false, workoutRequested: false });
    expect(s.workouts.size).toBe(0);
    expect(s.exercises).toHaveLength(200);
  });

  it("explains a payload conflict instead of retrying", async () => {
    const s = server({
      failOnce: (o) =>
        o.path === "/v1/workouts"
          ? ({ kind: "http_error", status: 409 } as ApiError)
          : null,
    });
    const result = await saveLoggedActivityWith(s.client, plan);
    expect(result).toMatchObject({
      ok: false,
      workoutRequested: true,
      retryable: false,
    });
  });
});

describe("resolveCustomExerciseWith", () => {
  const padel = { custom: true as const, name: "Padel" };

  it("reuses a single exact case-insensitive match", async () => {
    const existing = {
      ...exercise("00000000-0000-4000-8000-0000000000e2", " padel "),
      metadata: { trackingMode: "duration_distance" },
    };
    const s = server({ exercises: [existing, exercise("x", "Squash")] });
    const result = await resolveCustomExerciseWith(s.client, padel);
    expect(result).toEqual({ ok: true, exercise: existing });
    expect(s.log.some((o) => o.method === "POST")).toBe(false);
  });

  it("refuses a same-named sets-and-reps exercise", async () => {
    const s = server({ exercises: [exercise("p", "Padel")] });
    const result = await resolveCustomExerciseWith(s.client, padel);
    expect(result).toMatchObject({ ok: false });
    expect(!result.ok && result.message).toMatch(/sets and reps/);
    expect(s.log.some((o) => o.method === "POST")).toBe(false);
  });

  it("fails closed on duplicate names", async () => {
    const s = server({
      exercises: [exercise("a", "Padel"), exercise("b", "PADEL")],
    });
    const result = await resolveCustomExerciseWith(s.client, padel);
    expect(result.ok).toBe(false);
    expect(s.exercises).toHaveLength(2);
  });

  it("fails closed when the saved list may be truncated", async () => {
    const many = Array.from({ length: 200 }, (_, i) =>
      exercise(`e${i}`, `Move ${i}`),
    );
    const s = server({ exercises: many });
    const result = await resolveCustomExerciseWith(s.client, padel);
    expect(result.ok).toBe(false);
    expect(s.exercises).toHaveLength(200);
  });

  it("creates the exercise with distance tracking metadata", async () => {
    const s = server();
    const result = await resolveCustomExerciseWith(s.client, {
      custom: true,
      name: "  Padel ",
    });
    expect(result.ok).toBe(true);
    const body = s.log.find((o) => o.path === "/v1/exercises")!.body as any;
    expect(body).toMatchObject({
      name: "Padel",
      metadata: { trackingMode: "duration_distance" },
    });
    expect(s.exercises.map((e) => e.name)).toEqual(["Padel"]);
  });

  it("saves a custom activity as a workout named after it", async () => {
    const s = server();
    const result = await saveLoggedActivityWith(s.client, {
      ...plan,
      activity: padel,
    });
    expect(result.ok).toBe(true);
    const created = s.log.find((o) => o.path === "/v1/workouts")!.body as any;
    expect(created.name).toBe("Padel");
    expect(s.sets).toHaveLength(1);
  });
});

describe("saveLoggedRunWith", () => {
  const runPlan = {
    ownerId: "u",
    body: {
      clientOperationId: "11111111-2222-4333-8444-555555555555",
      activityDate: "2026-10-16",
      recordingTimezone: "Europe/London",
      startedAt: null,
      durationSeconds: 2700,
      distanceMeters: 10000,
      environment: "outdoor",
      name: "Run",
      notes: null,
    },
  } as Parameters<typeof saveLoggedRunWith>[1];
  const runClient = (
    respond: (o: RequestOptions) => { ok: boolean; error?: ApiError },
  ) => {
    const log: RequestOptions[] = [];
    const client: ApiClient = {
      status: () => ({ configured: true, baseUrl: "https://x.test" }),
      request: async <T>(o: RequestOptions) => {
        log.push(o);
        const r = respond(o);
        return r.ok
          ? { ok: true as const, value: { run: {} } as T }
          : { ok: false as const, error: r.error! };
      },
    };
    return { client, log };
  };

  it("posts the exact body to /v1/runs", async () => {
    const c = runClient(() => ({ ok: true }));
    // The response schema is checked by the real client, not this fake.
    const result = await saveLoggedRunWith(c.client, runPlan);
    expect(result).toEqual({ ok: true });
    expect(c.log).toHaveLength(1);
    expect(c.log[0]).toMatchObject({
      method: "POST",
      path: "/v1/runs",
      body: runPlan.body,
    });
  });

  it("reports a network error as retryable with the request sent", async () => {
    const c = runClient(() => ({ ok: false, error: net }));
    const result = await saveLoggedRunWith(c.client, runPlan);
    expect(result).toMatchObject({
      ok: false,
      workoutRequested: true,
      retryable: true,
    });
    if (!result.ok) expect(result.message).toContain("Retry");
  });

  it("does not retry a 409 conflict", async () => {
    const c = runClient(() => ({
      ok: false,
      error: { kind: "http_error", status: 409 } as ApiError,
    }));
    const result = await saveLoggedRunWith(c.client, runPlan);
    expect(result).toMatchObject({
      ok: false,
      workoutRequested: true,
      retryable: false,
    });
    if (!result.ok) expect(result.message).toContain("different run");
  });
});
