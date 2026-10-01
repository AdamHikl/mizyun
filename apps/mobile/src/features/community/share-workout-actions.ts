import type { ApiClient, ApiError } from "@mizyun/api-client";
import type {
  AuthorSharedActivityDto,
  WorkoutSharePreviewDto,
} from "@mizyun/contracts";
import type { Result } from "@mizyun/core";
import { publishWorkoutActivity } from "./community-client";

export async function saveWorkoutShare(
  client: ApiClient,
  input: {
    workoutId: string;
    preview: WorkoutSharePreviewDto;
    includeDuration: boolean;
    includeWorkoutDetails?: boolean;
    operationId: string;
    enrollmentGeneration: number;
    existingActivityId?: string | null;
  },
): Promise<Result<AuthorSharedActivityDto, ApiError>> {
  if (input.preview.workoutId !== input.workoutId) {
    return {
      ok: false,
      error: {
        kind: "http_error",
        status: 409,
        code: "STALE_PREVIEW",
        message: "Reload the workout preview before sharing.",
      },
    };
  }
  if (input.includeWorkoutDetails && !input.preview.workoutDetails) {
    return {
      ok: false,
      error: {
        kind: "http_error",
        status: 409,
        code: "STALE_PREVIEW",
        message: "Reload the workout details before sharing.",
      },
    };
  }
  const publication = {
    workoutId: input.workoutId,
    category: input.preview.category,
    sharedDay: input.preview.sharedDay,
    includeDuration: input.includeDuration,
    includeWorkoutDetails: input.includeWorkoutDetails ?? false,
    ...(input.includeWorkoutDetails && input.preview.workoutDetails
      ? { expectedWorkoutDetails: input.preview.workoutDetails }
      : {}),
    ...(input.includeDuration
      ? { expectedDurationSeconds: input.preview.durationSeconds ?? 0 }
      : {}),
    operationId: input.operationId,
    expectedVersion: input.preview.existingActivity?.version ?? 0,
    expectedRevoked: input.preview.existingActivity?.revokedAt != null,
    enrollmentGeneration: input.enrollmentGeneration,
  };
  return publishWorkoutActivity(client, publication);
}
