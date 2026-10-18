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
export const mealPhotoScope = (
  owner: string,
  accessToken: string,
  entryId: string,
): string => `${owner}:${accessToken}:${entryId}`;
const reads = new Map<string, Promise<unknown>>();
// The signed-in account/token; writes for any other principal are late.
let activePrincipal: string | null = null;

/** Records the current session so stale reads cannot evict its entries. */
export function setMealPhotoPrincipal(
  owner: string | null,
  accessToken: string | null,
): void {
  activePrincipal = owner && accessToken ? `${owner}:${accessToken}` : null;
  for (const key of rememberedPhotos.keys())
    if (principalOf(key) !== activePrincipal) rememberedPhotos.delete(key);
  for (const key of reads.keys())
    if (principalOf(key) !== activePrincipal) reads.delete(key);
}

/** The read already in flight for this scope, if any. */
export function inFlightPhotoRead<T>(scope: string): Promise<T> | null {
  return (reads.get(scope) as Promise<T> | undefined) ?? null;
}

/** Joins an in-flight read for the same scope instead of signing twice. */
export function sharedPhotoRead<T>(
  scope: string,
  read: () => Promise<T>,
): Promise<T> {
  const existing = reads.get(scope);
  if (existing) return existing as Promise<T>;
  const promise: Promise<T> = read().finally(() => {
    if (reads.get(scope) === promise) reads.delete(scope);
  });
  reads.set(scope, promise);
  return promise;
}
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
  if (activePrincipal !== null && principalOf(scope) !== activePrincipal)
    return;
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
// Keyed by account, so a refreshed token does not re-run denied prefetches.
let visualsDenial: string | null = null;

export function confirmMealVisuals(
  scope: string,
  owner: string,
  enabled: boolean,
): void {
  if (enabled) {
    visualsConfirmation = { scope, at: Date.now() };
    if (visualsDenial === owner) visualsDenial = null;
  } else {
    if (visualsConfirmation?.scope === scope) visualsConfirmation = null;
    visualsDenial = owner;
  }
}

/** True after this account's latest capability check failed or was denied. */
export function mealVisualsDenied(owner: string): boolean {
  return visualsDenial === owner;
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
  reads.clear();
  visualsConfirmation = null;
  visualsDenial = null;
}
