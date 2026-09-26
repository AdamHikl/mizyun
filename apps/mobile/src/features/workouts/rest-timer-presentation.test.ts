import { describe, expect, it } from "vitest";
import { restTimerNextAction } from "./rest-timer-presentation";
import type { RestTimerState } from "./active-workout-state";

const rest: RestTimerState = {
  endsAt: 100_000,
  total: 180,
  exerciseName: "Barbell Deadlift",
};

describe("restTimerNextAction", () => {
  it("shows the next exercise and its first set after the previous exercise is complete", () => {
    expect(
      restTimerNextAction({
        ...rest,
        nextExerciseName: "Weighted Pull Ups",
        nextSetSummary: "Target: 10 kg × 6 reps",
      }),
    ).toEqual({
      title: "Next: Weighted Pull Ups",
      detail: "Target: 10 kg × 6 reps",
    });
  });

  it("keeps the same exercise when another planned set remains", () => {
    expect(
      restTimerNextAction({
        ...rest,
        nextExerciseName: "Barbell Deadlift",
        nextSetSummary: "85 kg × 5 reps",
      }),
    ).toEqual({
      title: "Next: Barbell Deadlift",
      detail: "85 kg × 5 reps",
    });
  });

  it("follows the current workout summary when a set is deleted during rest", () => {
    expect(
      restTimerNextAction(
        {
          ...rest,
          nextExerciseName: "Weighted Pull Ups",
          nextSetSummary: "Set 1",
          allPlannedSetsCompleted: true,
        },
        {
          currentExerciseName: "Barbell Deadlift",
          nextSetSummary: "Set 3",
          allPlannedSetsCompleted: false,
        },
      ),
    ).toEqual({
      title: "Next: Barbell Deadlift",
      detail: "Set 3",
    });
  });

  it("prompts for completion after the final planned set", () => {
    expect(
      restTimerNextAction({ ...rest, allPlannedSetsCompleted: true }),
    ).toEqual({
      title: "All planned sets completed",
      detail: "Finish when ready",
    });
  });

  it("describes the completed exercise when restoring an older timer without next-action data", () => {
    expect(restTimerNextAction(rest)).toEqual({
      title: "Rest after Barbell Deadlift",
      detail: null,
    });
  });
});
