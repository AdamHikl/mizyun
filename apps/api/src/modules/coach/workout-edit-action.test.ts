import { describe, expect, it } from "vitest";
import type { StoredWorkout } from "@mizyun/core";
import {
  buildWorkoutEditProposal,
  findTargetWorkout,
  isWorkoutEditProposalIntent,
} from "./workout-edit-action";

const NOW = new Date("2026-08-25T10:00:00.000Z");

const SAMPLE_WORKOUT_1: StoredWorkout = {
  id: "00000000-0000-4000-8000-000000000001",
  userId: "user-1" as any,
  source: "manual",
  name: "Full body",
  startedAt: new Date("2026-08-27T12:00:00.000Z"),
  completedAt: null,
  notes: "Coach plan",
  details: {
    coachPlan: {
      sessionIndex: 2,
      targetDay: "2026-08-27",
      exercises: [
        {
          catalogId: "barbell-bench-press",
          name: "Barbell bench press",
          movementPattern: "horizontal_push",
          sets: 3,
          repsMin: 8,
          repsMax: 12,
          durationMinutes: null,
          restSeconds: 90,
        },
        {
          catalogId: "front-plank",
          name: "Front plank",
          movementPattern: "core",
          sets: 3,
          repsMin: 12,
          repsMax: 15,
          durationMinutes: null,
          restSeconds: 90,
        },
      ],
    },
  },
  createdAt: NOW,
  updatedAt: NOW,
};

describe("workout-edit-action", () => {
  describe("isWorkoutEditProposalIntent", () => {
    it("recognizes exercise replacement phrases", () => {
      expect(
        isWorkoutEditProposalIntent(
          "Replace barbell bench press with incline dumbbell press in my workout",
        ),
      ).toBe(true);
      expect(isWorkoutEditProposalIntent("Swap front plank for dead bug")).toBe(
        true,
      );
      expect(
        isWorkoutEditProposalIntent(
          "Change my Thursday workout to focus on shoulders",
        ),
      ).toBe(true);
      expect(
        isWorkoutEditProposalIntent("Reduce workout volume to 3 sets"),
      ).toBe(true);
      expect(
        isWorkoutEditProposalIntent("Vymeň bench press za jednoručky"),
      ).toBe(true);
    });

    it("rejects generic questions", () => {
      expect(isWorkoutEditProposalIntent("How much protein in chicken?")).toBe(
        false,
      );
      expect(isWorkoutEditProposalIntent("What is my current weight?")).toBe(
        false,
      );
    });
  });

  describe("findTargetWorkout", () => {
    it("finds workout by explicit name", () => {
      const found = findTargetWorkout(
        [SAMPLE_WORKOUT_1],
        "edit my Full body workout",
      );
      expect(found?.id).toBe(SAMPLE_WORKOUT_1.id);
    });

    it("finds workout by day of week", () => {
      const found = findTargetWorkout(
        [SAMPLE_WORKOUT_1],
        "change my Thursday workout",
      );
      expect(found?.id).toBe(SAMPLE_WORKOUT_1.id);
    });
  });

  describe("buildWorkoutEditProposal", () => {
    it("builds a valid workout_edit proposal when replacing an exercise", () => {
      const proposal = buildWorkoutEditProposal(
        SAMPLE_WORKOUT_1,
        "Replace barbell bench press with Incline dumbbell press in my workout",
      );
      expect(proposal).not.toBeNull();
      expect(proposal?.kind).toBe("workout_edit");
      expect(proposal?.workoutId).toBe(SAMPLE_WORKOUT_1.id);
      expect(proposal?.exercises[0]?.name).toBe("Incline dumbbell press");
      expect(proposal?.exercises[0]?.movementPattern).toBe("horizontal_push");
      expect(proposal?.summary).toContain(
        "Replaced Barbell bench press with Incline dumbbell press",
      );
    });

    it("builds a valid workout_edit proposal when adjusting set count", () => {
      const proposal = buildWorkoutEditProposal(
        SAMPLE_WORKOUT_1,
        "Adjust workout to 4 sets per exercise",
      );
      expect(proposal).not.toBeNull();
      expect(proposal?.exercises.every((e) => e.sets === 4)).toBe(true);
      expect(proposal?.summary).toContain("4 sets per exercise");
    });
  });
});
