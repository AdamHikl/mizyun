import { useEffect } from "react";
import { AppState } from "react-native";
import type { FoodEntry } from "@mizyun/contracts";
import { useAuth } from "@/features/auth/auth-context";
import {
  mealPhotoMemoryGeneration,
  mealPhotoScope,
  mealVisualsDenied,
  rememberPhoto,
  rememberedPhoto,
  sharedPhotoRead,
} from "./meal-photo-memory";
import {
  fetchMealPhoto,
  mealPhotoRetentionEnabled,
} from "./meal-photo-retention";
import { keepMealBackupOnDevice } from "./meal-photo-download";
import { localPhotoRecord } from "@/features/private-photos/local-photo-library";

const MAX_PREFETCHED_PHOTOS = 24;

/**
 * Signs and downloads the newest backed-up meal thumbnails that this device
 * lacks into its local photo library (ADR-0079) as soon as the list arrives, in parallel with the visuals capability check, so rows can
 * show the photo on their first render. The server still enforces Pro access
 * on every read, and nothing here renders a photo by itself.
 */
export function usePrefetchMealPhotos(entries: ReadonlyArray<FoodEntry>) {
  const { session } = useAuth();
  const owner = session?.user.id ?? null;
  const token = session?.accessToken ?? null;
  const targets = entries
    .filter((entry) => entry.photoAssetId)
    .slice(0, MAX_PREFETCHED_PHOTOS)
    .map((entry) => `${entry.id}|${entry.photoAssetId}`)
    .join(",");
  useEffect(() => {
    if (!owner || !token || !targets || !mealPhotoRetentionEnabled()) return;
    // Like the capability check, do no photo work in the background.
    if (AppState.currentState !== "active" || mealVisualsDenied(owner)) return;
    let active = true;
    const started = mealPhotoMemoryGeneration();
    for (const target of targets.split(",")) {
      const [entryId, assetId] = target.split("|") as [string, string];
      const scope = mealPhotoScope(owner, token, entryId);
      if (localPhotoRecord(owner, "meal", entryId)?.assetId === assetId)
        continue;
      if (rememberedPhoto(scope, assetId)) continue;
      void sharedPhotoRead(scope, () => fetchMealPhoto(entryId))
        .then((response) => {
          const photo = response.ok ? response.value.photo : null;
          if (!photo || started !== mealPhotoMemoryGeneration()) return;
          rememberPhoto(scope, photo, started);
          if (!active) return;
          // Saved to the device once; later launches read the phone's copy.
          keepMealBackupOnDevice(owner, entryId, photo);
        })
        .catch(() => {});
    }
    return () => {
      active = false;
    };
  }, [owner, token, targets]);
}
