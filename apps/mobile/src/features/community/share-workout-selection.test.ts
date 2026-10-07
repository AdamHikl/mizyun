import { describe, expect, it } from "vitest";
import type { Workout } from "@mizyun/contracts";
import { selectableSharedWorkouts } from "./share-workout-selection";

describe("private Community source picker", () => {
  it("offers only the owner's saved completed sessions, excluding runs and routines", () => {
    const candidate = {
      id: "session",
      userId: "owner",
      completedAt: "2026-10-07T10:00:00Z",
      details: { workoutLifecycle: { kind: "session" } },
    } as unknown as Workout;
    const list = [
      candidate,
      { ...candidate, id: "another-account", userId: "other" },
      { ...candidate, id: "unfinished", completedAt: null },
      {
        ...candidate,
        id: "routine",
        details: { workoutLifecycle: { kind: "routine" } },
      },
      {
        ...candidate,
        id: "run",
        details: { ...candidate.details, runSummary: { distanceMeters: 5000 } },
      },
    ];
    expect(
      selectableSharedWorkouts(list as Workout[], "owner").map((w) => w.id),
    ).toEqual(["session"]);
    expect(selectableSharedWorkouts(list as Workout[], "signed-out")).toEqual(
      [],
    );
  });
});
