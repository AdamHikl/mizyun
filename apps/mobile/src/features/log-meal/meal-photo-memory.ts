import type { StoredMealPhoto } from "./meal-photo-retention";

// Signed URLs are remembered in memory only, per account/token generation,
// so revisiting a screen reuses the same URL (and the in-memory decoded image)
// instead of fetching and downloading again.
const REUSE_MARGIN_MS = 30_000;
const MAX_REMEMBERED_PHOTOS = 200;
const rememberedPhotos = new Map<string, StoredMealPhoto>();
// Bumped when memory is forgotten so reads started earlier cannot refill it.
let generation = 0;

export const mealPhotoMemoryGeneration = (): number => generation;
const principalOf = (scope: string) => scope.slice(0, scope.lastIndexOf(":"));

export function rememberedPhoto(
  scope: string,
  assetId?: string | null,
): StoredMealPhoto | null {
  const photo = rememberedPhotos.get(scope);
  if (!photo) return null;
  // A replaced photo must not reuse the previous asset's URL.
  if (assetId && photo.assetId !== assetId) {
    rememberedPhotos.delete(scope);
    return null;
  }
  if (Date.parse(photo.expiresAt) - REUSE_MARGIN_MS > Date.now()) return photo;
  rememberedPhotos.delete(scope);
  return null;
}

export function rememberPhoto(
  scope: string,
  photo: StoredMealPhoto | null,
  startedGeneration = generation,
) {
  rememberedPhotos.delete(scope);
  if (!photo || startedGeneration !== generation) return;
  // Entries for an earlier account/token can never be read again.
  const principal = principalOf(scope);
  for (const key of rememberedPhotos.keys())
    if (principalOf(key) !== principal) rememberedPhotos.delete(key);
  rememberedPhotos.set(scope, photo);
  for (const key of rememberedPhotos.keys()) {
    if (rememberedPhotos.size <= MAX_REMEMBERED_PHOTOS) break;
    rememberedPhotos.delete(key);
  }
}

// A recent visuals confirmation for the same account/token lets a refocused
// screen render at once while the focused request revalidates it.
const CONFIRMATION_REUSE_MS = 10 * 60_000;
let visualsConfirmation: { scope: string; at: number } | null = null;

export function confirmMealVisuals(scope: string, enabled: boolean): void {
  if (enabled) visualsConfirmation = { scope, at: Date.now() };
  else if (visualsConfirmation?.scope === scope) visualsConfirmation = null;
}

export function mealVisualsRecentlyConfirmed(scope: string): boolean {
  return (
    visualsConfirmation?.scope === scope &&
    Date.now() - visualsConfirmation.at < CONFIRMATION_REUSE_MS
  );
}

/** Clears remembered signed URLs and visuals confirmation. */
export function forgetMealVisualMemory(): void {
  generation++;
  rememberedPhotos.clear();
  visualsConfirmation = null;
}
