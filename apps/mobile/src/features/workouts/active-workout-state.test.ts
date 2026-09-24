import { describe, expect, it } from "vitest";
import type { Workout } from "@mizyun/contracts";
import { withWorkoutLifecycle } from "@mizyun/core";
import {
  computeElapsedSeconds,
  computeRestRemainingSeconds,
  findIncompleteWorkout,
  formatStopwatch,
  isRestTimerActive,
  type RestTimerState,
} from "./active-workout-state";

const BASE_WORKOUT: Workout = {
  id: "00000000-0000-4000-8000-000000000001",
  userId: "00000000-0000-4000-8000-000000000000",
  name: "Upper Body",
  startedAt: "2026-09-24T10:00:00.000Z",
  completedAt: null,
  notes: null,
  source: "manual",
  details: withWorkoutLifecycle({}, { kind: "session" }),
  createdAt: "2026-09-24T10:00:00.000Z",
  updatedAt: "2026-09-24T10:00:00.000Z",
};

describe("active-workout-state", () => {
  describe("findIncompleteWorkout", () => {
    it("returns null when workouts list is empty", () => {
      expect(findIncompleteWorkout([])).toBeNull();
    });

    it("ignores completed workouts", () => {
      const completed: Workout = {
        ...BASE_WORKOUT,
        completedAt: "2026-09-24T10:45:00.000Z",
      };
      expect(findIncompleteWorkout([completed])).toBeNull();
    });

    it("ignores reusable routine templates", () => {
      const routine: Workout = {
        ...BASE_WORKOUT,
        details: withWorkoutLifecycle(
          { coachPlan: { exercises: [{ name: "Bench press", sets: 3 }] } },
          { kind: "routine" },
        ),
      };
      expect(findIncompleteWorkout([routine])).toBeNull();
    });

    it("finds the session matching today's date", () => {
      const yesterdayWorkout: Workout = {
        ...BASE_WORKOUT,
        id: "yesterday-id",
        startedAt: "2026-09-23T15:00:00.000Z",
      };
      const todayWorkout: Workout = {
        ...BASE_WORKOUT,
        id: "today-id",
        startedAt: "2026-09-24T09:00:00.000Z",
      };

      const result = findIncompleteWorkout(
        [yesterdayWorkout, todayWorkout],
        "2026-09-24",
      );
      expect(result?.id).toBe("today-id");
    });

    it("falls back to the earliest incomplete session when none matches today", () => {
      const olderWorkout: Workout = {
        ...BASE_WORKOUT,
        id: "older-id",
        startedAt: "2026-09-21T10:00:00.000Z",
      };
      const newerWorkout: Workout = {
        ...BASE_WORKOUT,
        id: "newer-id",
        startedAt: "2026-09-22T10:00:00.000Z",
      };

      const result = findIncompleteWorkout(
        [newerWorkout, olderWorkout],
        "2026-09-24",
      );
      expect(result?.id).toBe("older-id");
    });
  });

  describe("computeElapsedSeconds", () => {
    it("computes elapsed seconds accurately from startedAt timestamp", () => {
      const start = "2026-09-24T10:00:00.000Z";
      const now = new Date("2026-09-24T10:14:32.000Z").getTime();
      expect(computeElapsedSeconds(start, now)).toBe(14 * 60 + 32);
    });

    it("returns 0 if clock is before start or start is invalid", () => {
      const start = "2026-09-24T10:00:00.000Z";
      const past = new Date("2026-09-24T09:59:00.000Z").getTime();
      expect(computeElapsedSeconds(start, past)).toBe(0);
      expect(computeElapsedSeconds("invalid-date", Date.now())).toBe(0);
    });
  });

  describe("formatStopwatch", () => {
    it("formats minutes and seconds under an hour", () => {
      expect(formatStopwatch(0)).toBe("00:00");
      expect(formatStopwatch(5)).toBe("00:05");
      expect(formatStopwatch(65)).toBe("01:05");
      expect(formatStopwatch(3599)).toBe("59:59");
    });

    it("formats hours, minutes, and seconds for an hour or more", () => {
      expect(formatStopwatch(3600)).toBe("1:00:00");
      expect(formatStopwatch(3665)).toBe("1:01:05");
      expect(formatStopwatch(7200)).toBe("2:00:00");
    });

    it("clamps negative numbers to 00:00", () => {
      expect(formatStopwatch(-10)).toBe("00:00");
    });
  });

  describe("isRestTimerActive and computeRestRemainingSeconds", () => {
    const timer: RestTimerState = {
      endsAt: 100000,
      total: 60,
      exerciseName: "Bench Press",
    };

    it("detects active rest timer correctly", () => {
      expect(isRestTimerActive(timer, 95000)).toBe(true);
      expect(isRestTimerActive(timer, 100000)).toBe(false);
      expect(isRestTimerActive(timer, 105000)).toBe(false);
      expect(isRestTimerActive(null, 95000)).toBe(false);
    });

    it("computes remaining seconds correctly", () => {
      expect(computeRestRemainingSeconds(timer, 95000)).toBe(5);
      expect(computeRestRemainingSeconds(timer, 94200)).toBe(6);
      expect(computeRestRemainingSeconds(timer, 100000)).toBe(0);
      expect(computeRestRemainingSeconds(timer, 105000)).toBe(0);
      expect(computeRestRemainingSeconds(null, 95000)).toBe(0);
    });
  });
});
