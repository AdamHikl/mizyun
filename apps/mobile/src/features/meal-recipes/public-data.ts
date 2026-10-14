import { recipeSessionStore, type RecipeSessionStore } from "./recipe-storage";
import {
  clearIngredientReview,
  type IngredientReviewStore,
} from "./ingredient-review-storage";
import { retireIngredientReviews } from "./ingredient-review-lifecycle";
export {
  exportIngredientReview,
  clearIngredientReview,
  type IngredientReviewStore,
  type IngredientReviewRecovery,
} from "./ingredient-review-storage";
export {
  retireIngredientReviews,
  getIngredientReviewGeneration,
  subscribeRecipeConsentGrant,
  notifyRecipeConsentGrant,
} from "./ingredient-review-lifecycle";
export async function clearRecipeIngredientData(
  userId: string,
  options: {
    readonly store?: IngredientReviewStore;
    readonly sessionStore?: RecipeSessionStore;
    readonly cleanupPhotos?: (userId: string) => Promise<boolean>;
  } = {},
): Promise<void> {
  const cleanup =
    options.cleanupPhotos ??
    (async (owner: string) => {
      const { getDefaultIngredientPhotoAdapter } =
        await import("./ingredient-review-composition");
      return getDefaultIngredientPhotoAdapter().cleanupForUser(owner);
    });
  const retirement = retireIngredientReviews(userId, "account");
  // Invalidate writes already queued before asynchronous native cleanup finishes.
  const initialErasure = clearIngredientReview(userId, options.store);
  const results = await Promise.allSettled([
    initialErasure,
    (options.sessionStore ?? recipeSessionStore).clear(userId),
    retirement.then((ok) => {
      if (!ok) throw new Error("Ingredient cleanup unavailable");
    }),
    cleanup(userId).then((ok) => {
      if (!ok) throw new Error("Ingredient cleanup unavailable");
    }),
  ]);
  // Retired account controllers cannot persist new recovery after this final erasure.
  const erased = await Promise.allSettled([
    clearIngredientReview(userId, options.store),
    (options.sessionStore ?? recipeSessionStore).clear(userId),
  ]);
  if ([...results, ...erased].some((r) => r.status === "rejected"))
    throw new Error("Local recipe ingredient cleanup is incomplete.");
}

export {
  recipeSessionStore,
  type RecipeSessionStore,
  type RecipeSession,
} from "./recipe-storage";
