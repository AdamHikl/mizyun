import { forgetMealVisualMemory as forgetMemory } from "./meal-photo-memory";
export { createOperationId } from "./meal-form";
export {
  fetchFoodEntry,
  createFoodCopyPayload,
  clearFoodCopyPhotoStage,
} from "./meal-lifecycle-data";

export { clearAllMealPhotoRetries } from "./meal-photo-retention";

/** Forget remembered meal photo URLs, visuals confirmation and decoded images. */
export const forgetMealVisualMemory = (): void => {
  forgetMemory();
  // Keep native image SDKs out of data-only importers until needed.
  void import("expo-image")
    .then(({ Image }) => Image.clearMemoryCache())
    .catch(() => false);
};

export type {
  MealPhotoNormalizationOptions,
  MealPhotoAssetInput,
} from "./meal-photo";
/** Keep native image SDKs out of data-only importers until a photo is selected. */
export const normalizeMealPhoto: (typeof import("./meal-photo"))["normalizeMealPhoto"] =
  async (asset, options) => {
    const native = await import("./meal-photo");
    return native.normalizeMealPhoto(asset, options);
  };

export { stageRecipeMealDraft } from "./meal-draft-handoff";
export type {
  SelectedRecipeMeal,
  MealDraftHandoffResult,
} from "./meal-draft-handoff";

export { loadMealCompletionReceipt } from "../logging-draft-storage";
export type { MealCompletionReceipt } from "../logging-draft-storage";
