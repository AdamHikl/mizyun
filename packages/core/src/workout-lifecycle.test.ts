import { describe, expect, it } from "vitest";

import {
  isRoutineDetails,
  isSessionDetails,
  readWorkoutLifecycle,
  withWorkoutLifecycle,
} from "./workout-lifecycle.js";

describe("workout lifecycle metadata", () => {
  it("marks a routine without discarding its plan", () => {
    const details = withWorkoutLifecycle(
      { coachPlan: { exercises: [{ name: "Squat" }] } },
      { kind: "routine" },
    );

    expect(isRoutineDetails(details)).toBe(true);
    expect(isSessionDetails(details)).toBe(false);
    expect(details.coachPlan).toEqual({ exercises: [{ name: "Squat" }] });
  });

  it("records the source routine on a session copy", () => {
    const details = withWorkoutLifecycle(
      {},
      {
        kind: "session",
        routineId: "routine-123",
      },
    );

    expect(readWorkoutLifecycle(details)).toEqual({
      kind: "session",
      routineId: "routine-123",
    });
  });

  it("treats malformed or legacy details as unclassified", () => {
    expect(readWorkoutLifecycle(undefined)).toBeNull();
    expect(
      readWorkoutLifecycle({ workoutLifecycle: { kind: "other" } }),
    ).toBeNull();
  });
});
