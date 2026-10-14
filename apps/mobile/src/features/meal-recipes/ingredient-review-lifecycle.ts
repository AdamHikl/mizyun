/** Retire asynchronous recipe work before changing account/consent presentation. */
export type IngredientReviewRetirement = "ai" | "account";
const generations = new Map<string, number>();
const consentGrantListeners = new Map<string, Set<() => void>>();
/** Observe an explicit completed grant; loading cached/server consent never emits. */
export const subscribeRecipeConsentGrant = (
  userId: string,
  callback: () => void,
): (() => void) => {
  let set = consentGrantListeners.get(userId);
  if (!set) {
    set = new Set();
    consentGrantListeners.set(userId, set);
  }
  set.add(callback);
  return () => {
    set.delete(callback);
    if (!set.size && consentGrantListeners.get(userId) === set)
      consentGrantListeners.delete(userId);
  };
};
export const notifyRecipeConsentGrant = (userId: string): void => {
  const generation = getIngredientReviewGeneration(userId);
  const set = consentGrantListeners.get(userId);
  for (const callback of [...(set ?? [])]) {
    // A listener may synchronously revoke consent, retire an account or unmount.
    if (generation !== getIngredientReviewGeneration(userId)) break;
    if (!set?.has(callback)) continue;
    try {
      callback();
    } catch {
      // Presentation observers cannot turn a persisted consent save into failure.
    }
  }
};
const listeners = new Map<
  string,
  Set<(reason: IngredientReviewRetirement) => void | Promise<void>>
>();
export const getIngredientReviewGeneration = (userId: string): number =>
  generations.get(userId) ?? 0;
export const registerIngredientReviewRetirement = (
  userId: string,
  callback: (reason: IngredientReviewRetirement) => void | Promise<void>,
): (() => void) => {
  let set = listeners.get(userId);
  if (!set) {
    set = new Set();
    listeners.set(userId, set);
  }
  set.add(callback);
  return () => {
    set!.delete(callback);
    if (!set!.size) listeners.delete(userId);
  };
};
export const retireIngredientReviews = (
  userId: string,
  reason: IngredientReviewRetirement = "ai",
): Promise<boolean> => {
  generations.set(userId, getIngredientReviewGeneration(userId) + 1);
  // Invoke every callback synchronously before waiting for cleanup; aborts cannot
  // be deferred until after a new owner has already rendered.
  const tasks = [...(listeners.get(userId) ?? [])].map((callback) => {
    try {
      return Promise.resolve(callback(reason));
    } catch {
      return Promise.reject(new Error("Ingredient cleanup unavailable"));
    }
  });
  return Promise.allSettled(tasks).then((results) =>
    results.every((r) => r.status === "fulfilled"),
  );
};
