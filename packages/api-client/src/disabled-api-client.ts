import type { MealRecipeSessionApi } from "./meal-recipe-session-api";
import { err, type Result } from "@mizyun/core";
import type {
  CoachMessageResponse,
  FoodDraftResponse,
  MealIllustrationResponse,
  MealIllustrationCapability,
} from "@mizyun/contracts";

import type { MealRecipeApi } from "./meal-recipe-api";
import type { ApiClient } from "./api-client";
import type { ApiConfigurationStatus, ApiError, RequestOptions } from "./types";

const REASON = "Mizyun API base URL has not been provided.";

/**
 * Test-double / disabled `ApiClient` for when `EXPO_PUBLIC_API_URL` is
 * absent or the mobile loader rejected the snapshot. Mirrors
 * `DisabledAuthClient` so the mobile composition root can pick either
 * based purely on whether the corresponding `MobileConfig` field is set.
 *
 * Every method returns a typed `Result`; the client never throws and
 * never touches `fetch` or `authClient`.
 */
export class DisabledApiClient implements ApiClient {
  readonly getMealRecipeSessionContext: MealRecipeSessionApi["context"] =
    async () => err({ kind: "not_configured", reason: REASON });
  readonly revalidateMealRecipes: MealRecipeSessionApi["revalidate"] =
    async () => err({ kind: "not_configured", reason: REASON });
  readonly getMealRecipeCapabilities: MealRecipeApi["capabilities"] =
    async () => err({ kind: "not_configured", reason: REASON });
  readonly suggestMealRecipes: MealRecipeApi["suggest"] = async () =>
    err({ kind: "not_configured", reason: REASON });
  readonly recognizeMealRecipeIngredients: MealRecipeApi["recognizeIngredients"] =
    async () => err({ kind: "not_configured", reason: REASON });

  status(): ApiConfigurationStatus {
    return { configured: false, reason: REASON };
  }

  // The method is `async` to keep the interface uniform with the real
  // `HttpApiClient`, even though no I/O actually happens here.
  async request<T>(_options: RequestOptions): Promise<Result<T, ApiError>> {
    return err({ kind: "not_configured", reason: REASON });
  }

  async ensureMealIllustration(): Promise<
    Result<MealIllustrationResponse, ApiError>
  > {
    return err({ kind: "not_configured", reason: REASON });
  }
  async getMealIllustrationCapability(): Promise<
    Result<MealIllustrationCapability, ApiError>
  > {
    return err({ kind: "not_configured", reason: REASON });
  }

  async draftFoodEntry(): Promise<Result<FoodDraftResponse, ApiError>> {
    return err({ kind: "not_configured", reason: REASON });
  }

  async draftCoachMealPhoto(): Promise<Result<CoachMessageResponse, ApiError>> {
    return err({ kind: "not_configured", reason: REASON });
  }
}
