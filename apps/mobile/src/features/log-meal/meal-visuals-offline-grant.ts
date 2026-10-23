import * as SecureStore from "expo-secure-store";

/**
 * The last time the server confirmed meal visuals (Pro) for an account on
 * this device (ADR-0053 amendment, 2026-10-23). When the capability check
 * cannot reach the server, bundled meal icons may keep showing for up to
 * 48 hours after that confirmation. A server denial forgets it. Saved
 * photos and generated illustrations stay enforced by the server.
 */
export interface MealVisualsGrantStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<unknown>;
  deleteItemAsync(key: string): Promise<unknown>;
}

export const MEAL_VISUALS_OFFLINE_GRACE_MS = 48 * 60 * 60_000;
// A confirmation every 20 seconds does not need a keychain write each time.
const REWRITE_AFTER_MS = 60 * 60_000;

export const mealVisualsGrantKeyFor = (userId: string): string =>
  `mizyun.meal-visuals.last-grant.${userId}`;

// Last known confirmation time per account; null when there is none.
const known = new Map<string, number | null>();

const parse = (raw: string | null): number | null => {
  if (raw === null || !/^\d{1,16}$/.test(raw)) return null;
  const at = Number(raw);
  return Number.isSafeInteger(at) ? at : null;
};

export async function rememberMealVisualsGrant(
  userId: string,
  now = Date.now(),
  store: MealVisualsGrantStore = SecureStore,
): Promise<void> {
  const previous = known.get(userId);
  if (typeof previous === "number" && now - previous < REWRITE_AFTER_MS) return;
  known.set(userId, now);
  try {
    await store.setItemAsync(mealVisualsGrantKeyFor(userId), String(now));
  } catch {
    // Only offline display is affected; the online check still works.
  }
}

export async function forgetMealVisualsGrant(
  userId: string,
  store: MealVisualsGrantStore = SecureStore,
): Promise<void> {
  known.set(userId, null);
  try {
    await store.deleteItemAsync(mealVisualsGrantKeyFor(userId));
  } catch {
    // The in-memory denial still blocks offline display for this session.
  }
}

/** True when the server confirmed meal visuals for this account within 48 hours. */
export async function hasRecentMealVisualsGrant(
  userId: string,
  now = Date.now(),
  store: MealVisualsGrantStore = SecureStore,
): Promise<boolean> {
  let at = known.get(userId);
  if (at === undefined) {
    try {
      at = parse(await store.getItemAsync(mealVisualsGrantKeyFor(userId)));
    } catch {
      at = null;
    }
    // A denial or confirmation recorded while reading wins.
    if (!known.has(userId)) known.set(userId, at);
    at = known.get(userId) ?? null;
  }
  return (
    typeof at === "number" &&
    at <= now &&
    now - at < MEAL_VISUALS_OFFLINE_GRACE_MS
  );
}

/** Test seam: forget the in-memory copies. */
export function resetMealVisualsGrantMemory(): void {
  known.clear();
}
