import { describe, expect, it } from "vitest";
import type { StoredWorkout, UserId } from "@mizyun/core";
import {
  extractPlannedExercisesFromWorkout,
  isAvailableRoutine,
  toRoutineSummary,
} from "./routines";

const USER_ID = "00000000-0000-4000-8000-000000000001" as UserId;
const BASE_DATE = new Date("2026-09-01T08:00:00.000Z");

const createWorkout = (
  overrides: Partial<StoredWorkout> = {},
): StoredWorkout => ({
  id: "w-1",
  userId: USER_ID,
  name: "Upper Body",
  source: "manual",
  startedAt: BASE_DATE,
  completedAt: null,
  notes: null,
  details: {},
  createdAt: BASE_DATE,
  updatedAt: BASE_DATE,
  ...overrides,
});

describe("routines module", () => {
  describe("extractPlannedExercisesFromWorkout", () => {
    it("returns empty array for empty, null, or invalid details", () => {
      expect(
        extractPlannedExercisesFromWorkout(
          createWorkout({ details: {} as Record<string, unknown> }),
        ),
      ).toEqual([]);

      expect(
        extractPlannedExercisesFromWorkout(
          createWorkout({
            details: null as unknown as Record<string, unknown>,
          }),
        ),
      ).toEqual([]);

      expect(
        extractPlannedExercisesFromWorkout(
          createWorkout({
            details: "invalid" as unknown as Record<string, unknown>,
          }),
        ),
      ).toEqual([]);
    });

    it("ignores non-object items in exercise lists", () => {
      const workout = createWorkout({
        details: {
          coachPlan: {
            exercises: [null, undefined, 123, "string", { name: "Push up" }],
          },
        },
      });

      const exercises = extractPlannedExercisesFromWorkout(workout);
      expect(exercises).toHaveLength(1);
      expect(exercises[0]?.name).toBe("Push up");
    });

    it("extracts from sessionExercises with highest precedence", () => {
      const workout = createWorkout({
        details: {
          sessionExercises: [
            {
              name: "Overhead Press",
              catalogId: "ohp",
              sets: 4,
              targetReps: "5",
              targetLoad: "60 kg",
            },
          ],
          coachPlan: {
            exercises: [
              {
                name: "Bench Press",
                sets: 3,
              },
            ],
          },
        },
      });

      const exercises = extractPlannedExercisesFromWorkout(workout);
      expect(exercises).toHaveLength(1);
      expect(exercises[0]?.name).toBe("Overhead Press");
      expect(exercises[0]?.targetLoad).toBe("60 kg");
    });

    it("extracts from coachPlan.exercises", () => {
      const workout = createWorkout({
        details: {
          coachPlan: {
            exercises: [
              {
                name: "Bench Press",
                catalogId: "bench-press",
                movementPattern: "horizontal_push",
                sets: 3,
                targetReps: "8-10",
                targetLoad: "80 kg",
                restSeconds: 120,
                notes: "Pause at bottom",
              },
            ],
          },
        },
      });

      expect(extractPlannedExercisesFromWorkout(workout)).toEqual([
        {
          name: "Bench Press",
          catalogId: "bench-press",
          movementPattern: "horizontal_push",
          targetSets: 3,
          targetReps: "8-10",
          targetLoad: "80 kg",
          restSeconds: 120,
          notes: "Pause at bottom",
        },
      ]);
    });

    it("extracts from coachPlan.session.exercises when coachPlan.exercises is absent", () => {
      const workout = createWorkout({
        details: {
          coachPlan: {
            session: {
              exercises: [
                {
                  name: "Overhead Press",
                  sets: 4,
                  repsMin: 6,
                  repsMax: 8,
                },
              ],
            },
          },
        },
      });

      expect(extractPlannedExercisesFromWorkout(workout)).toEqual([
        {
          name: "Overhead Press",
          targetSets: 4,
          targetReps: "6-8",
        },
      ]);
    });

    it("extracts from aiDraft.session.exercises", () => {
      const workout = createWorkout({
        details: {
          aiDraft: {
            session: {
              exercises: [
                {
                  name: "Deadlift",
                  targetSets: 3,
                  repsMin: 5,
                  repsMax: 5,
                  targetLoad: 140,
                },
              ],
            },
          },
        },
      });

      expect(extractPlannedExercisesFromWorkout(workout)).toEqual([
        {
          name: "Deadlift",
          targetSets: 3,
          targetReps: "5-5",
          targetLoad: "140",
        },
      ]);
    });

    it("extracts from aiDraft.exercises when session is absent", () => {
      const workout = createWorkout({
        details: {
          aiDraft: {
            exercises: [
              {
                name: "Pull Up",
                sets: 3,
                repsMax: 10,
              },
            ],
          },
        },
      });

      expect(extractPlannedExercisesFromWorkout(workout)).toEqual([
        {
          name: "Pull Up",
          targetSets: 3,
          targetReps: "10",
        },
      ]);
    });

    it("extracts from workoutProposal.session.exercises", () => {
      const workout = createWorkout({
        details: {
          workoutProposal: {
            session: {
              exercises: [
                {
                  name: "Squat",
                  targetSets: 5,
                  repsMin: 5,
                },
              ],
            },
          },
        },
      });

      expect(extractPlannedExercisesFromWorkout(workout)).toEqual([
        {
          name: "Squat",
          targetSets: 5,
          targetReps: "5",
        },
      ]);
    });

    it("extracts from workoutProposal.exercises when session is absent", () => {
      const workout = createWorkout({
        details: {
          workoutProposal: {
            exercises: [
              {
                name: "Barbell Row",
                sets: 4,
                durationMinutes: 15,
              },
            ],
          },
        },
      });

      expect(extractPlannedExercisesFromWorkout(workout)).toEqual([
        {
          name: "Barbell Row",
          targetSets: 4,
          targetReps: "15 min",
        },
      ]);
    });

    describe("exercise field parsing and defaults", () => {
      it("falls back to 'Exercise' when name is missing or empty", () => {
        const workout = createWorkout({
          details: {
            coachPlan: {
              exercises: [{}, { name: "   " }],
            },
          },
        });

        const exercises = extractPlannedExercisesFromWorkout(workout);
        expect(exercises[0]?.name).toBe("Exercise");
        expect(exercises[1]?.name).toBe("Exercise");
      });

      it("prefers targetSets over sets", () => {
        const workout = createWorkout({
          details: {
            coachPlan: {
              exercises: [
                {
                  name: "Dip",
                  targetSets: 4,
                  sets: 2,
                },
              ],
            },
          },
        });

        const exercises = extractPlannedExercisesFromWorkout(workout);
        expect(exercises[0]?.targetSets).toBe(4);
      });

      it("falls back to sets if targetSets is undefined or not a number", () => {
        const workout = createWorkout({
          details: {
            coachPlan: {
              exercises: [
                {
                  name: "Dip",
                  targetSets: null,
                  sets: 3,
                },
                {
                  name: "Pushdown",
                  sets: 4,
                },
              ],
            },
          },
        });

        const exercises = extractPlannedExercisesFromWorkout(workout);
        expect(exercises[0]?.targetSets).toBe(3);
        expect(exercises[1]?.targetSets).toBe(4);
      });

      it("handles targetReps as string or number", () => {
        const workout = createWorkout({
          details: {
            coachPlan: {
              exercises: [
                { name: "Ex 1", targetReps: "12-15" },
                { name: "Ex 2", targetReps: 10 },
              ],
            },
          },
        });

        const exercises = extractPlannedExercisesFromWorkout(workout);
        expect(exercises[0]?.targetReps).toBe("12-15");
        expect(exercises[1]?.targetReps).toBe("10");
      });

      it("formats rep ranges when targetReps is missing", () => {
        const workout = createWorkout({
          details: {
            coachPlan: {
              exercises: [
                { name: "Range", repsMin: 8, repsMax: 12 },
                { name: "Only Min", repsMin: 6 },
                { name: "Only Max", repsMax: 15 },
                { name: "Duration", durationMinutes: 20 },
                { name: "Duration String", durationMinutes: "25" },
              ],
            },
          },
        });

        const exercises = extractPlannedExercisesFromWorkout(workout);
        expect(exercises[0]?.targetReps).toBe("8-12");
        expect(exercises[1]?.targetReps).toBe("6");
        expect(exercises[2]?.targetReps).toBe("15");
        expect(exercises[3]?.targetReps).toBe("20 min");
        expect(exercises[4]?.targetReps).toBe("25 min");
      });

      it("stringifies targetLoad for number and trims string", () => {
        const workout = createWorkout({
          details: {
            coachPlan: {
              exercises: [
                { name: "Ex 1", targetLoad: 75.5 },
                { name: "Ex 2", targetLoad: " 50 kg " },
                { name: "Ex 3", targetLoad: null },
              ],
            },
          },
        });

        const exercises = extractPlannedExercisesFromWorkout(workout);
        expect(exercises[0]?.targetLoad).toBe("75.5");
        expect(exercises[1]?.targetLoad).toBe(" 50 kg ");
        expect(exercises[2]?.targetLoad).toBeUndefined();
      });

      it("omits optional fields when undefined, null, or invalid type", () => {
        const workout = createWorkout({
          details: {
            coachPlan: {
              exercises: [
                {
                  name: "Minimal",
                  catalogId: null,
                  movementPattern: 123,
                  targetSets: "not a number",
                  restSeconds: "none",
                  notes: null,
                },
              ],
            },
          },
        });

        const exercises = extractPlannedExercisesFromWorkout(workout);
        expect(exercises[0]).toEqual({
          name: "Minimal",
        });
      });
    });
  });

  describe("isAvailableRoutine", () => {
    it("returns true when completedAt is null and exercises exist", () => {
      const workout = createWorkout({
        completedAt: null,
        details: {
          coachPlan: {
            exercises: [{ name: "Squat", sets: 3 }],
          },
        },
      });

      expect(isAvailableRoutine(workout)).toBe(true);
    });

    it("returns false when completedAt is not null even if exercises exist", () => {
      const workout = createWorkout({
        completedAt: new Date("2026-09-01T09:00:00.000Z"),
        details: {
          coachPlan: {
            exercises: [{ name: "Squat", sets: 3 }],
          },
        },
      });

      expect(isAvailableRoutine(workout)).toBe(false);
    });

    it("returns false when completedAt is null but no exercises exist", () => {
      const workout = createWorkout({
        completedAt: null,
        details: {},
      });

      expect(isAvailableRoutine(workout)).toBe(false);
    });

    it("returns false for an active session copied from a routine", () => {
      const workout = createWorkout({
        details: {
          workoutLifecycle: { kind: "session", routineId: "routine-1" },
          coachPlan: { exercises: [{ name: "Squat", sets: 3 }] },
        },
      });

      expect(isAvailableRoutine(workout)).toBe(false);
    });
  });

  describe("toRoutineSummary", () => {
    it("returns RoutineSummary with ISO string startedAt and mapped exercises", () => {
      const workout = createWorkout({
        id: "routine-123",
        name: "Morning Leg Routine",
        startedAt: new Date("2026-09-02T06:30:00.000Z"),
        details: {
          coachPlan: {
            exercises: [
              { name: "Goblet Squat", sets: 3, repsMin: 10, repsMax: 12 },
              { name: "Walking Lunge", sets: 3, durationMinutes: 10 },
            ],
          },
        },
      });

      const summary = toRoutineSummary(workout);
      expect(summary).toEqual({
        id: "routine-123",
        name: "Morning Leg Routine",
        startedAt: "2026-09-02T06:30:00.000Z",
        exerciseCount: 2,
        exercises: [
          { name: "Goblet Squat", targetSets: 3, targetReps: "10-12" },
          { name: "Walking Lunge", targetSets: 3, targetReps: "10 min" },
        ],
      });
    });
  });
});
