import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@mizyun/api-client";
import type { Workout } from "@mizyun/contracts";
import { withWorkoutLifecycle } from "@mizyun/core";
import { processWorkout, type ProcessedWorkout } from "./workouts-hub-data";
import {
  deriveRoutineSuggestion,
  findRepeatableWorkout,
  planRepeat,
  repeatLabel,
  saveSuggestedRoutine,
  startRepeatSessionWith,
} from "./workout-repeat";

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const workout = (
  n: number,
  patch: Partial<Workout>,
  details: Record<string, unknown>,
): Workout => ({
  id: uuid(n),
  userId: uuid(900),
  name: "One-time Workout",
  startedAt: "2026-10-01T10:00:00.000Z",
  completedAt: null,
  notes: null,
  source: "manual",
  details,
  createdAt: "2026-10-01T10:00:00.000Z",
  updatedAt: "2026-10-01T10:00:00.000Z",
  ...patch,
});
const processed = (
  w: Workout,
  names: string[],
  extra: Partial<ProcessedWorkout> = {},
): ProcessedWorkout => ({
  workout: w,
  status: w.completedAt ? "completed" : "planned",
  displayDate: "Mon, Oct 5",
  plannedExercises: names.map((name) => ({ name, catalogId: `cat_${name}` })),
  sets: [],
  completedSetCount: 0,
  totalVolumeKg: 0,
  exerciseSummaries: names.map((name, i) => ({
    exerciseId: `id_${name}`,
    exerciseName: name,
    setCount: 3 + i,
    topLoadKg: 100,
  })),
  durationMinutes: 30,
  ...extra,
});
const oneTime = (n: number, day: string, names: string[]) =>
  processed(
    workout(
      n,
      {
        completedAt: `${day}T10:00:00.000Z`,
        startedAt: `${day}T09:00:00.000Z`,
      },
      withWorkoutLifecycle(
        {
          sessionMode: "one_time",
          sessionExercises: names.map((name) => ({
            name,
            targetLoad: "80 kg",
          })),
        },
        { kind: "session" },
      ),
    ),
    names.map((name) => name),
  );

describe("repeat last workout", () => {
  it("picks the most recent completed strength workout", () => {
    const a = oneTime(1, "2026-10-01", ["Squat", "Bench"]);
    const b = oneTime(2, "2026-10-08", ["Row", "Curl"]);
    expect(findRepeatableWorkout([a, b])?.workout.id).toBe(uuid(2));
    expect(findRepeatableWorkout([])).toBeNull();
    expect(repeatLabel(b)).toBe("Repeat last workout");
  });

  it("starts the source routine when the session came from one that still exists", () => {
    const routine = processed(
      workout(
        5,
        { name: "Push" },
        withWorkoutLifecycle({}, { kind: "routine" }),
      ),
      ["Bench"],
    );
    const session = processed(
      workout(
        6,
        { name: "Push", completedAt: "2026-10-08T10:00:00.000Z" },
        withWorkoutLifecycle({}, { kind: "session", routineId: uuid(5) }),
      ),
      ["Bench"],
    );
    expect(planRepeat(session, [routine])).toMatchObject({
      kind: "routine",
      routine: { id: uuid(5) },
    });
    expect(planRepeat(session, [])).toMatchObject({
      kind: "seed",
      oneTime: false,
    });
  });

  it("seeds the same exercises in order without copying stale loads", async () => {
    const source = oneTime(2, "2026-10-08", ["Row", "Curl", "Squat"]);
    const plan = planRepeat(source, []);
    expect(plan.kind).toBe("seed");
    if (plan.kind !== "seed") return;
    const request = vi.fn().mockResolvedValue({
      ok: true,
      value: { workout: source.workout },
    });
    const result = await startRepeatSessionWith(
      { request } as unknown as ApiClient,
      plan,
      uuid(321),
      new Date("2026-10-15T08:00:00.000Z"),
    );
    expect(result.ok).toBe(true);
    const call = request.mock.calls[0]?.[0];
    expect(call.method).toBe("POST");
    expect(call.body.clientOperationId).toBe(uuid(321));
    const details = call.body.details as Record<string, unknown>;
    expect(details.sessionMode).toBe("one_time");
    expect(details.workoutLifecycle).toEqual({ kind: "session" });
    const seeded = details.sessionExercises as Record<string, unknown>[];
    expect(seeded.map((e) => e.name)).toEqual(["Row", "Curl", "Squat"]);
    expect(seeded.every((e) => !("targetLoad" in e))).toBe(true);
  });

  it("keeps planned set counts for non-one-time sources", () => {
    const session = processed(
      workout(
        6,
        { completedAt: "2026-10-08T10:00:00.000Z" },
        withWorkoutLifecycle({}, { kind: "session", routineId: uuid(77) }),
      ),
      ["Bench"],
      {
        plannedExercises: [
          {
            name: "Bench",
            targetSets: 4,
            targetReps: "6-8",
            targetLoad: "90 kg",
          },
        ],
      },
    );
    const plan = planRepeat(session, []);
    expect(plan).toMatchObject({
      kind: "seed",
      exercises: [{ name: "Bench", targetSets: 4, repsMin: 6, repsMax: 8 }],
    });
    expect(JSON.stringify(plan)).not.toContain("90 kg");
  });
});

describe("save as routine suggestion", () => {
  const sessions = [
    oneTime(1, "2026-10-01", ["Squat", "Bench"]),
    oneTime(2, "2026-10-08", ["Bench", "Squat"]),
    oneTime(3, "2026-10-13", ["Squat", "Bench"]),
  ];
  const now = new Date("2026-10-15T12:00:00Z");

  it("suggests a repeated one-time set and builds routine exercises", () => {
    const resolved = deriveRoutineSuggestion(
      { completed: sessions, activeAndPlanned: [] },
      now,
    );
    expect(resolved?.name).toBe("Squat + Bench");
    expect(resolved?.exercises.map((e) => e.name)).toEqual(["Squat", "Bench"]);
    expect(resolved?.exercises.every((e) => e.targetLoad === undefined)).toBe(
      true,
    );
  });

  it("is suppressed by a matching routine or a dismissal", () => {
    const routine = processed(
      workout(50, {}, withWorkoutLifecycle({}, { kind: "routine" })),
      ["Bench", "Squat"],
    );
    expect(
      deriveRoutineSuggestion(
        { completed: sessions, activeAndPlanned: [routine] },
        now,
      ),
    ).toBeNull();
    expect(
      deriveRoutineSuggestion(
        { completed: sessions, activeAndPlanned: [] },
        now,
        () => true,
      ),
    ).toBeNull();
  });

  it("creates the routine only through the explicit save call", async () => {
    const resolved = deriveRoutineSuggestion(
      { completed: sessions, activeAndPlanned: [] },
      now,
    )!;
    const request = vi.fn().mockResolvedValue({
      ok: true,
      value: { workout: sessions[0]!.workout },
    });
    expect(request).not.toHaveBeenCalled();
    const result = await saveSuggestedRoutine(resolved, uuid(555), {
      request,
    } as unknown as ApiClient);
    expect(result.ok).toBe(true);
    const call = request.mock.calls[0]?.[0];
    expect(call).toMatchObject({ method: "POST", path: "/v1/workouts" });
    expect(call.body.details.workoutLifecycle).toEqual({ kind: "routine" });
    expect(call.body.name).toBe("Squat + Bench");
    expect(call.body.clientOperationId).toBe(uuid(555));
  });

  it("suppresses the suggestion once the saved routine is reloaded (round trip)", async () => {
    const resolved = deriveRoutineSuggestion(
      { completed: sessions, activeAndPlanned: [] },
      now,
    )!;
    let stored: Workout | null = null;
    const request = vi.fn().mockImplementation(async ({ body }) => {
      stored = workout(60, { name: body.name }, body.details);
      return { ok: true, value: { workout: stored } };
    });
    await saveSuggestedRoutine(resolved, uuid(556), {
      request,
    } as unknown as ApiClient);
    const reloaded = processWorkout(stored!, [], []);
    expect(reloaded.plannedExercises.map((e) => e.name)).toEqual([
      "Squat",
      "Bench",
    ]);
    expect(
      deriveRoutineSuggestion(
        { completed: sessions, activeAndPlanned: [reloaded] },
        now,
      ),
    ).toBeNull();
  });
});
