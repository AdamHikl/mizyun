import type { ApiClient, ApiError } from "@mizyun/api-client";
import type {
  AuthorSharedActivityDto,
  MealSharePreviewDto,
} from "@mizyun/contracts";
import type { Result } from "@mizyun/core";
import { publishMealActivity } from "./community-client";

/** Only the allowlisted, deliberately previewed projection crosses this boundary. */
export async function saveMealShare(
  client: ApiClient,
  input: {
    mealId: string;
    preview: MealSharePreviewDto;
    includeNutrition: boolean;
    operationId: string;
    enrollmentGeneration: number;
    existingActivityId?: string | null;
  },
): Promise<Result<AuthorSharedActivityDto, ApiError>> {
  if (
    input.preview.mealId !== input.mealId ||
    input.enrollmentGeneration !== input.preview.enrollmentGeneration ||
    (input.existingActivityId &&
      input.existingActivityId !== input.preview.existingActivity?.id)
  ) {
    return {
      ok: false,
      error: {
        kind: "http_error",
        status: 409,
        code: "STALE_PREVIEW",
        message: "Reload the meal preview before sharing.",
      },
    };
  }
  const details = input.preview.mealDetails;
  return publishMealActivity(client, {
    mealId: input.mealId,
    sharedDay: input.preview.sharedDay,
    includeNutrition: input.includeNutrition,
    expectedMealDetails: {
      name: details.name,
      caloriesKcal: input.includeNutrition ? details.caloriesKcal : null,
      proteinG: input.includeNutrition ? details.proteinG : null,
      carbsG: input.includeNutrition ? details.carbsG : null,
      fatG: input.includeNutrition ? details.fatG : null,
    },
    operationId: input.operationId,
    enrollmentGeneration: input.enrollmentGeneration,
    expectedVersion: input.preview.existingActivity?.version ?? 0,
    expectedRevoked: input.preview.existingActivity?.revokedAt != null,
  });
}
