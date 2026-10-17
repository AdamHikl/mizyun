import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@mizyun/api-client";
import {
  buildPastWorkoutRequest,
  isPastWorkoutDraft,
  releasePendingPastWorkout,
  releasePendingPastWorkoutLocally,
  localInstant,
  parsePastWorkoutForm,
  sendPastWorkout,
  type PastWorkoutDraft,
  type PastWorkoutForm,
} from "./past-workout";

const OP = "11111111-1111-4111-8111-111111111111";
const BENCH = "22222222-2222-4222-8222-222222222222";
const ROW = "33333333-3333-4333-8333-333333333333";
const USER = "44444444-4444-4444-8444-444444444444";
const NOW = new Date(2026, 9, 17, 12, 0);

const form = (patch: Partial<PastWorkoutForm> = {}): PastWorkoutForm => ({
  name: "Push",
  date: "2026-10-15",
  startTime: "18:30",
  durationMinutes: "60",
  notes: "",
  unitSystem: "metric",
  exercises: [
    {
      key: "e1",
      exerciseId: BENCH,
      name: "Bench press",
      catalogId: "bench-press",
      sets: [
        { key: "s1", setType: "warmup", reps: "10", load: "40" },
        { key: "s2", setType: "normal", reps: "8", load: "80" },
      ],
    },
    {
      key: "e2",
      exerciseId: ROW,
      name: "Row",
      sets: [{ key: "s3", setType: "normal", reps: "12", load: "" }],
    },
  ],
  ...patch,
});

const pendingDraft = (): PastWorkoutDraft => {
  const parsed = parsePastWorkoutForm(form(), OP, NOW);
  if (!parsed.ok) throw new Error(parsed.message);
  return { version: 1, form: form(), pending: parsed.pending };
};

/** A minimal server: idempotent workout create by operation id, sets unique by sequence. */
const fakeServer = () => {
  const workouts = new Map<string, Record<string, unknown>>();
  const sets = new Map<string, Record<string, unknown>[]>();
  let failSetAt: number | null = null;
  let loseNextCreateResponse = false;
  let counter = 0;
  const request = vi.fn(
    async (options: { method: string; path: string; body?: unknown }) => {
      const body = options.body as Record<string, unknown> | undefined;
      if (options.method === "POST" && options.path === "/v1/workouts") {
        let workout = [...workouts.values()].find(
          (w) => w.clientOperationId === body?.clientOperationId,
        );
        if (!workout) {
          workout = {
            ...body,
            id: `${++counter}`.padStart(8, "0") + OP.slice(8),
          };
          workouts.set(workout.id as string, workout);
          sets.set(workout.id as string, []);
        }
        if (loseNextCreateResponse) {
          loseNextCreateResponse = false;
          return { ok: false, error: { kind: "network_error", cause: "lost" } };
        }
        return { ok: true, value: { workout } };
      }
      const match = /^\/v1\/workouts\/([^/]+)(\/sets)?$/.exec(options.path);
      const id = match?.[1] ?? "";
      if (!workouts.has(id))
        return { ok: false, error: { kind: "http_error", status: 404 } };
      if (options.method === "DELETE") {
        workouts.delete(id);
        sets.delete(id);
        return { ok: true, value: undefined };
      }
      const list = sets.get(id) ?? [];
      if (options.method === "GET")
        return { ok: true, value: { workoutSets: [...list] } };
      if (failSetAt === body?.sequence) {
        failSetAt = null;
        return { ok: false, error: { kind: "network_error", cause: "drop" } };
      }
      if (list.some((s) => s.sequence === body?.sequence))
        return { ok: false, error: { kind: "http_error", status: 409 } };
      const saved = { ...body, id: `set-${list.length}`, workoutId: id };
      list.push(saved);
      return { ok: true, value: { workoutSet: saved } };
    },
  );
  const client = {
    request,
    status: () => ({ configured: true }),
  } as unknown as ApiClient;
  return {
    client,
    request,
    workouts,
    sets,
    failSetOnce: (sequence: number) => (failSetAt = sequence),
    loseNextCreateResponse: () => (loseNextCreateResponse = true),
  };
};

const memoryStore = () => {
  let value: PastWorkoutDraft | null = null;
  return {
    get value() {
      return value;
    },
    load: vi.fn(async () => value),
    save: vi.fn(async (_u: string, d: PastWorkoutDraft) => {
      value = JSON.parse(JSON.stringify(d)) as PastWorkoutDraft;
      return true;
    }),
    clear: vi.fn(async () => {
      value = null;
      return true;
    }),
  };
};

describe("parsePastWorkoutForm", () => {
  it("creates an already-completed one-time session with remembered local times", () => {
    const parsed = parsePastWorkoutForm(form(), OP, NOW);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const built = buildPastWorkoutRequest(form(), parsed.pending);
    if (!built.ok) throw new Error(built.message);
    const request = built.request;
    const start = new Date(2026, 9, 15, 18, 30);
    expect(request.workout).toMatchObject({
      clientOperationId: OP,
      name: "Push",
      startedAt: start.toISOString(),
      completedAt: new Date(start.getTime() + 3_600_000).toISOString(),
      details: {
        sessionMode: "one_time",
        entryMode: "past",
        workoutLifecycle: { kind: "session" },
        sessionExercises: [
          { name: "Bench press", catalogId: "bench-press", restSeconds: 90 },
          { name: "Row", restSeconds: 90 },
        ],
      },
    });
    // Remembered times are not observed: no Health export marker.
    expect(request.workout.details).not.toHaveProperty("healthExportOrigin");
    expect(
      request.sets.map((s) => [s.sequence, s.exerciseId, s.setType]),
    ).toEqual([
      [1, BENCH, "warmup"],
      [2, BENCH, "normal"],
      [3, ROW, "normal"],
    ]);
    expect(request.sets[2]).not.toHaveProperty("loadKg");
    expect(
      request.sets.every((s) => s.completedAt === request.workout.completedAt),
    ).toBe(true);
  });

  it("rejects a workout that would end in the future", () => {
    const result = parsePastWorkoutForm(
      form({ date: "2026-10-17", startTime: "11:30", durationMinutes: "45" }),
      OP,
      NOW,
    );
    expect(result).toMatchObject({ ok: false });
    expect(
      parsePastWorkoutForm(
        form({ date: "2026-10-17", startTime: "11:00", durationMinutes: "60" }),
        OP,
        NOW,
      ).ok,
    ).toBe(true);
  });

  it("rejects malformed dates, times, durations and empty sets", () => {
    expect(parsePastWorkoutForm(form({ date: "2026-02-30" }), OP, NOW).ok).toBe(
      false,
    );
    expect(parsePastWorkoutForm(form({ startTime: "25:00" }), OP, NOW).ok).toBe(
      false,
    );
    expect(
      parsePastWorkoutForm(form({ durationMinutes: "0" }), OP, NOW).ok,
    ).toBe(false);
    expect(
      parsePastWorkoutForm(form({ durationMinutes: "721" }), OP, NOW).ok,
    ).toBe(false);
    expect(parsePastWorkoutForm(form({ exercises: [] }), OP, NOW)).toEqual({
      ok: false,
      message: "Add at least one exercise with a set.",
    });
    const blank = form();
    const exercises = [
      {
        ...blank.exercises[0]!,
        sets: [{ key: "x", setType: "normal" as const, reps: "", load: "" }],
      },
    ];
    expect(parsePastWorkoutForm(form({ exercises }), OP, NOW)).toMatchObject({
      ok: false,
      message: "Bench press set 1: enter reps or weight, or remove the set.",
    });
  });

  it("accepts plain or comma decimals only", () => {
    for (const load of ["1e2", "0x10", "1.000.5", "-5", "5 kg"]) {
      const base = form();
      const exercises = [
        {
          ...base.exercises[0]!,
          sets: [{ key: "x", setType: "normal" as const, reps: "5", load }],
        },
      ];
      expect(parsePastWorkoutForm(form({ exercises }), OP, NOW).ok).toBe(false);
    }
    const base = form();
    const exercises = [
      {
        ...base.exercises[0]!,
        sets: [
          { key: "x", setType: "normal" as const, reps: "5", load: "62,5" },
          { key: "y", setType: "normal" as const, reps: "5", load: ".5" },
          { key: "z", setType: "normal" as const, reps: "5", load: "20." },
        ],
      },
    ];
    const parsed = parsePastWorkoutForm(form({ exercises }), OP, NOW);
    const built =
      parsed.ok && buildPastWorkoutRequest(form({ exercises }), parsed.pending);
    expect(
      built && built.ok && built.request.sets.map((x) => x.loadKg),
    ).toEqual([62.5, 0.5, 20]);
  });

  it("replays frozen instants even if the form's wall time would now resolve differently", () => {
    const parsed = parsePastWorkoutForm(form(), OP, NOW);
    if (!parsed.ok) throw new Error(parsed.message);
    const shifted = {
      ...parsed.pending,
      startedAt: "2026-10-15T10:00:00.000Z",
    };
    const built = buildPastWorkoutRequest(form(), shifted);
    expect(built.ok && built.request.workout.startedAt).toBe(
      "2026-10-15T10:00:00.000Z",
    );
    // The stored pending stays small: no request bodies are persisted.
    expect(Object.keys(parsed.pending).sort()).toEqual([
      "completedAt",
      "operationId",
      "startedAt",
      "workoutId",
    ]);
  });

  it("stores imperial weights as kilograms", () => {
    const parsed = parsePastWorkoutForm(
      form({ unitSystem: "imperial" }),
      OP,
      NOW,
    );
    const built =
      parsed.ok &&
      buildPastWorkoutRequest(form({ unitSystem: "imperial" }), parsed.pending);
    expect(built && built.ok && built.request.sets[1]?.loadKg).toBeCloseTo(
      36.287,
      3,
    );
  });

  it("returns null for wall times that do not exist", () => {
    expect(localInstant("2026-13-01", "10:00")).toBeNull();
    expect(localInstant("2026-10-15", "7:5")).toBeNull();
    expect(localInstant("2026-10-15", "07:05")?.getMinutes()).toBe(5);
  });
});

describe("sendPastWorkout", () => {
  it("saves the workout and every set, then clears the draft", async () => {
    const server = fakeServer();
    const store = memoryStore();
    const result = await sendPastWorkout(
      USER,
      pendingDraft(),
      server.client,
      () => true,
      store,
    );
    expect(result.ok).toBe(true);
    expect(server.workouts.size).toBe(1);
    const [id] = [...server.workouts.keys()];
    expect(server.sets.get(id!)?.map((s) => s.sequence)).toEqual([1, 2, 3]);
    expect(store.clear).toHaveBeenCalled();
    expect(store.value).toBeNull();
  });

  it("does not send anything when the draft cannot be kept on the device", async () => {
    const server = fakeServer();
    const store = memoryStore();
    store.save.mockResolvedValueOnce(false);
    const result = await sendPastWorkout(
      USER,
      pendingDraft(),
      server.client,
      () => true,
      store,
    );
    expect(result.ok).toBe(false);
    expect(server.request).not.toHaveBeenCalled();
  });

  it("replays after a lost create response without duplicating the workout", async () => {
    const server = fakeServer();
    const store = memoryStore();
    server.loseNextCreateResponse();
    const first = await sendPastWorkout(
      USER,
      pendingDraft(),
      server.client,
      () => true,
      store,
    );
    expect(first.ok).toBe(false);
    expect(server.workouts.size).toBe(1);
    // App restart: resume from what was persisted.
    const restored = store.value!;
    expect(restored.pending?.workoutId).toBeNull();
    const second = await sendPastWorkout(
      USER,
      restored,
      server.client,
      () => true,
      store,
    );
    expect(second.ok).toBe(true);
    expect(server.workouts.size).toBe(1);
    expect([...server.sets.values()][0]).toHaveLength(3);
  });

  it("resumes a partial save without duplicating sets already stored", async () => {
    const server = fakeServer();
    const store = memoryStore();
    server.failSetOnce(3);
    const first = await sendPastWorkout(
      USER,
      pendingDraft(),
      server.client,
      () => true,
      store,
    );
    expect(first.ok).toBe(false);
    if (first.ok) return;
    expect(first.draft.pending?.workoutId).not.toBeNull();
    expect(store.value?.pending?.workoutId).toBe(
      first.draft.pending?.workoutId,
    );
    const second = await sendPastWorkout(
      USER,
      first.draft,
      server.client,
      () => true,
      store,
    );
    expect(second.ok).toBe(true);
    expect([...server.sets.values()][0]?.map((s) => s.sequence)).toEqual([
      1, 2, 3,
    ]);
    expect(server.workouts.size).toBe(1);
  });

  it("recreates the workout when the partial one was deleted elsewhere", async () => {
    const server = fakeServer();
    const store = memoryStore();
    server.failSetOnce(2);
    const first = await sendPastWorkout(
      USER,
      pendingDraft(),
      server.client,
      () => true,
      store,
    );
    if (first.ok) throw new Error("expected partial failure");
    server.workouts.clear();
    server.sets.clear();
    const second = await sendPastWorkout(
      USER,
      first.draft,
      server.client,
      () => true,
      store,
    );
    expect(second).toMatchObject({ ok: false });
    if (second.ok) return;
    expect(second.draft.pending?.workoutId).toBeNull();
    const third = await sendPastWorkout(
      USER,
      second.draft,
      server.client,
      () => true,
      store,
    );
    expect(third.ok).toBe(true);
    expect([...server.sets.values()][0]).toHaveLength(3);
  });

  it("stops and keeps the draft when the account changes mid-save", async () => {
    const server = fakeServer();
    const store = memoryStore();
    let current = true;
    server.request.mockImplementationOnce(async () => {
      current = false;
      return {
        ok: false,
        error: { kind: "context_changed", cause: "account switched" },
      };
    });
    const result = await sendPastWorkout(
      USER,
      pendingDraft(),
      server.client,
      () => current,
      store,
    );
    expect(result.ok).toBe(false);
    expect(store.clear).not.toHaveBeenCalled();
    expect(server.request).toHaveBeenCalledTimes(1);
  });
});

describe("releasePendingPastWorkout", () => {
  it("discard deletes a workout whose create response was lost", async () => {
    const server = fakeServer();
    const store = memoryStore();
    server.loseNextCreateResponse();
    await sendPastWorkout(
      USER,
      pendingDraft(),
      server.client,
      () => true,
      store,
    );
    expect(server.workouts.size).toBe(1);
    const result = await releasePendingPastWorkout(
      USER,
      store.value!,
      "discard",
      server.client,
      () => true,
      store,
    );
    expect(result).toEqual({ ok: true, draft: null });
    expect(server.workouts.size).toBe(0);
    expect(store.value).toBeNull();
  });

  it("edit removes the partial server workout and keeps the form editable", async () => {
    const server = fakeServer();
    const store = memoryStore();
    server.failSetOnce(2);
    const first = await sendPastWorkout(
      USER,
      pendingDraft(),
      server.client,
      () => true,
      store,
    );
    if (first.ok) throw new Error("expected partial failure");
    const result = await releasePendingPastWorkout(
      USER,
      first.draft,
      "edit",
      server.client,
      () => true,
      store,
    );
    expect(result.ok).toBe(true);
    expect(server.workouts.size).toBe(0);
    expect(store.value?.pending).toBeNull();
    expect(store.value?.form.exercises).toHaveLength(2);
    // Saving the edited form creates exactly one new workout.
    const parsed = parsePastWorkoutForm(
      store.value!.form,
      "55555555-5555-4555-8555-555555555555",
      NOW,
    );
    if (!parsed.ok) throw new Error(parsed.message);
    const again = await sendPastWorkout(
      USER,
      { ...store.value!, pending: parsed.pending },
      server.client,
      () => true,
      store,
    );
    expect(again.ok).toBe(true);
    expect(server.workouts.size).toBe(1);
  });

  it("offers a warned device-only release when a rejected replay can't confirm server state", async () => {
    const server = fakeServer();
    const store = memoryStore();
    server.request.mockImplementation(async () => ({
      ok: false,
      error: { kind: "http_error", status: 422 },
    }));
    const draft = pendingDraft();
    const result = await releasePendingPastWorkout(
      USER,
      draft,
      "edit",
      server.client,
      () => true,
      store,
    );
    expect(result).toMatchObject({ ok: false, localRelease: true });
    expect(store.clear).not.toHaveBeenCalled();
    const local = await releasePendingPastWorkoutLocally(
      USER,
      draft,
      "edit",
      store,
    );
    expect(local.ok).toBe(true);
    expect(store.value?.pending).toBeNull();
  });

  it("is not stuck when the workout was edited in history after a lost response", async () => {
    const server = fakeServer();
    const store = memoryStore();
    server.loseNextCreateResponse();
    await sendPastWorkout(
      USER,
      pendingDraft(),
      server.client,
      () => true,
      store,
    );
    const draft = store.value!;
    server.request.mockImplementationOnce(async () => ({
      ok: false,
      error: { kind: "http_error", status: 409 },
    }));
    const result = await releasePendingPastWorkout(
      USER,
      draft,
      "discard",
      server.client,
      () => true,
      store,
    );
    expect(result).toMatchObject({ ok: false, localRelease: true });
    if (result.ok) return;
    expect(result.message).toContain("already in your history");
    const local = await releasePendingPastWorkoutLocally(
      USER,
      result.draft,
      "discard",
      store,
    );
    expect(local).toEqual({ ok: true, draft: null });
    // The user's edited history copy is kept.
    expect(server.workouts.size).toBe(1);
  });

  it("keeps a replay-learned id when the delete fails, so no device-only release orphans it", async () => {
    const server = fakeServer();
    const store = memoryStore();
    // The original create never reached the server.
    const draft = pendingDraft();
    let calls = 0;
    const real = server.request.getMockImplementation()!;
    server.request.mockImplementation(async (options) => {
      calls++;
      if (options.method === "DELETE")
        return { ok: false, error: { kind: "network_error", cause: "drop" } };
      return real(options);
    });
    const result = await releasePendingPastWorkout(
      USER,
      draft,
      "edit",
      server.client,
      () => true,
      store,
    );
    expect(calls).toBe(2);
    expect(result).toMatchObject({ ok: false, localRelease: false });
    if (result.ok) return;
    expect(result.draft.pending?.workoutId).not.toBeNull();
    expect(store.value?.pending?.workoutId).toBe(
      result.draft.pending?.workoutId,
    );
    expect(
      (
        await releasePendingPastWorkoutLocally(
          USER,
          result.draft,
          "edit",
          store,
        )
      ).ok,
    ).toBe(false);
    expect(server.workouts.size).toBe(1);
  });

  it("keeps a partly saved draft when offline and refuses a device-only release", async () => {
    const server = fakeServer();
    const store = memoryStore();
    server.failSetOnce(1);
    const first = await sendPastWorkout(
      USER,
      pendingDraft(),
      server.client,
      () => true,
      store,
    );
    if (first.ok) throw new Error("expected partial failure");
    server.request.mockImplementationOnce(async () => ({
      ok: false,
      error: { kind: "network_error", cause: "offline" },
    }));
    const result = await releasePendingPastWorkout(
      USER,
      first.draft,
      "discard",
      server.client,
      () => true,
      store,
    );
    expect(result).toMatchObject({ ok: false, localRelease: false });
    expect(store.clear).not.toHaveBeenCalled();
    expect(server.workouts.size).toBe(1);
    // A confirmed partial workout cannot be released on the device only.
    const local = await releasePendingPastWorkoutLocally(
      USER,
      first.draft,
      "discard",
      store,
    );
    expect(local.ok).toBe(false);
  });

  it("allows a device-only discard before any workout was confirmed", async () => {
    const store = memoryStore();
    const result = await releasePendingPastWorkoutLocally(
      USER,
      pendingDraft(),
      "discard",
      store,
    );
    expect(result).toEqual({ ok: true, draft: null });
  });
});

describe("isPastWorkoutDraft", () => {
  it("still loads a pending draft that newer validation rejects, so it can be released", async () => {
    const draft = pendingDraft();
    const stricter = {
      ...draft,
      form: {
        ...draft.form,
        exercises: draft.form.exercises.map((e) => ({
          ...e,
          sets: e.sets.map((x) => ({ ...x, reps: "", load: "" })),
        })),
      },
    };
    expect(isPastWorkoutDraft(JSON.parse(JSON.stringify(stricter)))).toBe(true);
    const server = fakeServer();
    const store = memoryStore();
    const saved = await sendPastWorkout(
      USER,
      stricter,
      server.client,
      () => true,
      store,
    );
    expect(saved.ok).toBe(false);
    expect(server.request).not.toHaveBeenCalled();
    const released = await releasePendingPastWorkout(
      USER,
      stricter,
      "discard",
      server.client,
      () => true,
      store,
    );
    expect(released).toMatchObject({ ok: false, localRelease: true });
  });

  it("accepts persisted drafts and rejects malformed ones", () => {
    const draft = JSON.parse(JSON.stringify(pendingDraft())) as unknown;
    expect(isPastWorkoutDraft(draft)).toBe(true);
    expect(
      isPastWorkoutDraft({ version: 1, form: form(), pending: null }),
    ).toBe(true);
    expect(
      isPastWorkoutDraft({
        version: 1,
        form: { ...form(), unitSystem: "stone" },
        pending: null,
      }),
    ).toBe(false);
    expect(
      isPastWorkoutDraft({
        ...pendingDraft(),
        pending: { ...pendingDraft().pending, startedAt: "not a date" },
      }),
    ).toBe(false);
  });
});
