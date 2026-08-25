import { describe, expect, it } from "vitest";
import type { CoachWorkoutEditProposal, Workout } from "@mizyun/contracts";
import type { ApiClient, RequestOptions } from "@mizyun/api-client";
import { applyWorkoutEditProposalWith } from "./workout-edit-proposal";

const SAMPLE_PROPOSAL: CoachWorkoutEditProposal = {
  id: "00000000-0000-4000-8000-000000000001",
  kind: "workout_edit",
  workoutId: "00000000-0000-4000-8000-000000000002",
  targetName: "Full body (Updated)",
  notes: "Shoulder focus",
  exercises: [
    {
      catalogId: "incline-dumbbell-press",
      name: "Incline dumbbell press",
      movementPattern: "horizontal_push",
      sets: 3,
      repsMin: 8,
      repsMax: 12,
      durationMinutes: null,
      restSeconds: 90,
      progression: "double_progression",
    },
  ],
  summary: "Replaced Barbell bench press with Incline dumbbell press.",
};

const SAMPLE_WORKOUT: Workout = {
  id: "00000000-0000-4000-8000-000000000002",
  userId: "user-1",
  source: "manual",
  name: "Full body (Updated)",
  startedAt: "2026-08-27T12:00:00.000Z",
  completedAt: null,
  notes: "Shoulder focus",
  details: {
    coachPlan: {
      exercises: SAMPLE_PROPOSAL.exercises,
    },
  },
  createdAt: "2026-08-25T10:00:00.000Z",
  updatedAt: "2026-08-25T10:00:00.000Z",
};

describe("applyWorkoutEditProposalWith", () => {
  it("sends a PUT request with updated name, notes, and exercises", async () => {
    const requests: RequestOptions[] = [];
    const client: ApiClient = {
      request: async <T>(options: RequestOptions) => {
        requests.push(options);
        return {
          ok: true as const,
          value: { workout: SAMPLE_WORKOUT } as T,
        };
      },
      status: () => ({ configured: true, baseUrl: "https://example.test" }),
    };

    const result = await applyWorkoutEditProposalWith(client, SAMPLE_PROPOSAL);
    expect(result.ok).toBe(true);
    expect(result.workout?.name).toBe("Full body (Updated)");
    expect(requests[0]?.method).toBe("PUT");
    expect(requests[0]?.path).toBe(
      "/v1/workouts/00000000-0000-4000-8000-000000000002",
    );
    expect(requests[0]?.body).toMatchObject({
      name: "Full body (Updated)",
      notes: "Shoulder focus",
      details: {
        coachPlan: {
          exercises: [
            {
              catalogId: "incline-dumbbell-press",
              name: "Incline dumbbell press",
              movementPattern: "horizontal_push",
              sets: 3,
            },
          ],
        },
      },
    });
  });

  it("handles API failure cleanly", async () => {
    const client: ApiClient = {
      request: async () => ({
        ok: false as const,
        error: {
          kind: "http_error" as const,
          status: 500,
          code: "INTERNAL_ERROR",
          message: "Database error",
        },
      }),
      status: () => ({ configured: true, baseUrl: "https://example.test" }),
    };

    const result = await applyWorkoutEditProposalWith(client, SAMPLE_PROPOSAL);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Could not apply workout changes");
  });
});
