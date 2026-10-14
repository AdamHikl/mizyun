import { randomUUID } from "expo-crypto";
import { createMealRecipeApi } from "@mizyun/api-client";
import { apiClient } from "@/composition/api-client";
import {
  createIngredientPhotoAdapter,
  type IngredientPhotoAdapter,
} from "./ingredient-photos";
import { IngredientReviewController } from "./ingredient-review-controller";
import { ingredientReviewStore } from "./ingredient-review-storage";
import { getIngredientReviewGeneration } from "./ingredient-review-lifecycle";
let defaultPhotos: IngredientPhotoAdapter | undefined;
export const getDefaultIngredientPhotoAdapter = (): IngredientPhotoAdapter =>
  (defaultPhotos ??= createIngredientPhotoAdapter());
/** Called by the future Meals/Coach host, never a silent background upload. */
export function createRecipeIngredientReviewController(
  userId: string,
  isCurrent: () => boolean,
): IngredientReviewController {
  const generation = getIngredientReviewGeneration(userId);
  return new IngredientReviewController({
    userId,
    api: createMealRecipeApi(apiClient),
    store: ingredientReviewStore,
    photos: getDefaultIngredientPhotoAdapter(),
    newId: randomUUID,
    isCurrent,
    isAiCurrent: () => generation === getIngredientReviewGeneration(userId),
  });
}
