import {
  workoutResponseSchema,
  workoutPatchSchema,
  type CoachWorkoutEditProposal,
  type Workout,
  type WorkoutResponse,
} from "@mizyun/contracts";
import type { ApiClient } from "@mizyun/api-client";
import { apiClient } from "../../composition/api-client";

export interface WorkoutEditProposalApplyResult {
  readonly ok: boolean;
  readonly message?: string;
  readonly workout?: Workout;
}

export const applyWorkoutEditProposalWith = async (
  client: ApiClient,
  proposal: CoachWorkoutEditProposal,
): Promise<WorkoutEditProposalApplyResult> => {
  const body = workoutPatchSchema.parse({
    name: proposal.targetName,
    ...(proposal.notes ? { notes: proposal.notes } : {}),
    details: {
      coachPlan: {
        exercises: proposal.exercises.map((exercise) => ({
          catalogId: exercise.catalogId,
          name: exercise.name,
          movementPattern: exercise.movementPattern,
          sets: exercise.sets,
          repsMin: exercise.repsMin,
          repsMax: exercise.repsMax,
          durationMinutes: exercise.durationMinutes,
          restSeconds: exercise.restSeconds,
        })),
      },
    },
  });

  const result = await client.request<WorkoutResponse>({
    method: "PUT",
    path: `/v1/workouts/${encodeURIComponent(proposal.workoutId)}`,
    body,
    schema: workoutResponseSchema,
  });

  if (!result.ok) {
    return {
      ok: false,
      message: "Could not apply workout changes. Please try again.",
    };
  }

  return {
    ok: true,
    workout: result.value.workout,
  };
};

export const applyWorkoutEditProposal = (
  proposal: CoachWorkoutEditProposal,
): Promise<WorkoutEditProposalApplyResult> =>
  applyWorkoutEditProposalWith(apiClient, proposal);
