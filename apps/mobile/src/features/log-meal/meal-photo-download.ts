import { downloadLocalPhoto } from "@/features/private-photos/local-photo-library";
import {
  MAX_RETAINED_MEAL_PHOTO_BYTES,
  type StoredMealPhoto,
} from "./meal-photo-retention";

const downloads = new Map<string, Promise<unknown>>();

/**
 * Saves a server-backed meal photo to this device the first time it is read,
 * so later views come from the phone (ADR-0079). One download per photo.
 */
export function keepMealBackupOnDevice(
  owner: string,
  entryId: string,
  photo: StoredMealPhoto | null,
): void {
  if (!photo) return;
  const key = `${owner}:${entryId}:${photo.assetId}`;
  if (downloads.has(key)) return;
  const task = downloadLocalPhoto(owner, "meal", entryId, photo.signedUrl, {
    assetId: photo.assetId,
    maxBytes: MAX_RETAINED_MEAL_PHOTO_BYTES,
  })
    .catch(() => null)
    .finally(() => downloads.delete(key));
  downloads.set(key, task);
}
