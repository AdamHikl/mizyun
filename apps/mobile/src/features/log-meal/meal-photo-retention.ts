import { Directory, File, Paths } from "expo-file-system";
import {
  mealPhotoResponseSchema,
  mealPhotoReadResponseSchema,
  type MealPhotoReadResponse,
} from "@mizyun/contracts";
import Constants from "expo-constants";
import type { ApiClient } from "@mizyun/api-client";
import { apiClient } from "@/composition/api-client";
import { getAppVariant } from "@/composition/app-variant";
import {
  clearLoggingDraft,
  loadLoggingDraft,
  saveLoggingDraft,
} from "@/features/logging-draft-storage";
import { createOperationId, isValidOperationId } from "./meal-form";
import type { MealPhotoAssetInput } from "./meal-photo";

export const mealPhotoRetentionEnabled = () =>
  getAppVariant() === "dev" &&
  Constants.expoConfig?.extra?.enableMealPhotos === true;
export const MAX_RETAINED_MEAL_PHOTO_BYTES = 256 * 1024;
const retiredOwners = new Set<string>();
const photoDirectory = (owner: string) =>
  new Directory(Paths.document, "meal-photo-drafts", encodeURIComponent(owner));
const owned = (owner: string, uri: string) =>
  uri.startsWith(`${photoDirectory(owner).uri.replace(/\/+$/, "")}/`) &&
  !uri.includes("/../");
export const discardOwnedMealPhoto = (owner: string, uri: string): void => {
  if (!owned(owner, uri)) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    /* Cleanup can be retried later. */
  }
};

const copyMealPhotoFile = async (
  owner: string,
  source: File,
  destination: File,
): Promise<void> => {
  try {
    // Expo 57 copy is asynchronous. Keep the source until the native read finishes.
    await source.copy(destination);
    if (retiredOwners.has(owner)) throw new Error("Account data was cleared.");
    if (!destination.exists || destination.size <= 0)
      throw new Error("The photo could not be saved on this device.");
  } catch (cause) {
    discardOwnedMealPhoto(owner, destination.uri);
    throw cause;
  }
};

/** Copy a pixel-reencoded draft into durable app storage, never the camera library. */
export const persistMealPhotoSource = async (
  owner: string,
  asset: MealPhotoAssetInput,
): Promise<MealPhotoAssetInput> => {
  if (retiredOwners.has(owner)) throw new Error("Account data was cleared.");
  const { normalizeMealPhoto } = await import("./meal-photo");
  const normalized = await normalizeMealPhoto(asset);
  if (retiredOwners.has(owner)) {
    normalized.delete();
    throw new Error("Account data was cleared.");
  }
  const directory = photoDirectory(owner);
  directory.create({ intermediates: true, idempotent: true });
  const destination = new File(directory, `${createOperationId()}.jpg`);
  try {
    await copyMealPhotoFile(owner, normalized, destination);
    return { uri: destination.uri };
  } finally {
    if (normalized.exists) normalized.delete();
  }
};

export interface RetainedMealPhoto {
  readonly uri: string;
  readonly width: number;
  readonly height: number;
  readonly clientOperationId: string;
}
/** Decode first so dimensions are authoritative even for restored picker URIs. */
export const prepareRetainedMealPhoto = async (
  owner: string,
  asset: MealPhotoAssetInput,
): Promise<RetainedMealPhoto> => {
  if (retiredOwners.has(owner)) throw new Error("Account data was cleared.");
  const { ImageManipulator, SaveFormat } =
    await import("expo-image-manipulator");
  const original = ImageManipulator.manipulate(asset.uri);
  const decoded = await original.renderAsync();
  const context = ImageManipulator.manipulate(decoded);
  const edge = Math.min(640, Math.max(decoded.width, decoded.height));
  context.resize(
    decoded.width >= decoded.height
      ? { width: edge, height: null }
      : { width: null, height: edge },
  );
  // Always render through a fresh pixel surface. Native JPEG encoding does not copy EXIF/GPS.
  const rendered = await context.renderAsync();
  const directory = photoDirectory(owner);
  directory.create({ intermediates: true, idempotent: true });
  for (const compress of [0.7, 0.5, 0.3]) {
    const saved = await rendered.saveAsync({
      format: SaveFormat.JPEG,
      compress,
    });
    const file = new File(saved.uri);
    if (retiredOwners.has(owner)) {
      if (file.exists) file.delete();
      throw new Error("Account data was cleared.");
    }
    if (
      file.exists &&
      file.size > 0 &&
      file.size <= MAX_RETAINED_MEAL_PHOTO_BYTES
    ) {
      const destination = new File(
        directory,
        `${createOperationId()}-thumbnail.jpg`,
      );
      try {
        await copyMealPhotoFile(owner, file, destination);
      } finally {
        if (file.exists) file.delete();
      }
      return {
        uri: destination.uri,
        width: saved.width,
        height: saved.height,
        clientOperationId: createOperationId(),
      };
    }
    if (file.exists) file.delete();
  }
  throw new Error(
    "The photo could not be compressed. Your meal can still be saved.",
  );
};

const isPendingPhoto = (value: unknown): value is RetainedMealPhoto => {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.uri === "string" &&
    isValidOperationId(record.clientOperationId) &&
    typeof record.width === "number" &&
    Number.isInteger(record.width) &&
    record.width >= 0 &&
    record.width <= 640 &&
    typeof record.height === "number" &&
    Number.isInteger(record.height) &&
    record.height >= 0 &&
    record.height <= 640
  );
};
export type StoredMealPhoto = NonNullable<MealPhotoReadResponse["photo"]>;
const retryKind = (entryId: string) => `meal-photo-${entryId}` as const;
const indexQueues = new Map<string, Promise<unknown>>();
const isRetryIndex = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");
const updateRetryIndex = (
  owner: string,
  entryId: string,
  add: boolean,
): Promise<boolean> => {
  const previous = indexQueues.get(owner) ?? Promise.resolve();
  const task = previous
    .catch(() => {})
    .then(async () => {
      const entries =
        (await loadLoggingDraft(owner, "meal-photo-index", isRetryIndex)) ?? [];
      if (add && retiredOwners.has(owner)) return false;
      const next = entries.filter((id) => id !== entryId);
      if (add) next.push(entryId);
      return saveLoggingDraft(owner, "meal-photo-index", next);
    });
  indexQueues.set(owner, task);
  void task.finally(() => {
    if (indexQueues.get(owner) === task) indexQueues.delete(owner);
  });
  return task;
};
/** Called only after successful account deletion; clears this owner's durable photo retries and files. */
export const clearAllMealPhotoRetries = async (
  owner: string,
  store?: Parameters<typeof clearLoggingDraft>[2],
): Promise<boolean> => {
  retiredOwners.add(owner);
  await indexQueues.get(owner);
  const entries =
    (await loadLoggingDraft(owner, "meal-photo-index", isRetryIndex, store)) ??
    [];
  const cleared = await Promise.all(
    entries.map((id) => clearLoggingDraft(owner, retryKind(id), store)),
  );
  const indexCleared = await clearLoggingDraft(
    owner,
    "meal-photo-index",
    store,
  );
  let filesCleared = true;
  try {
    const directory = photoDirectory(owner);
    if (directory.exists) directory.delete();
  } catch {
    filesCleared = false;
  }
  return cleared.every(Boolean) && indexCleared && filesCleared;
};
export const persistMealPhotoRetry = async (
  owner: string,
  entryId: string,
  photo: RetainedMealPhoto,
): Promise<boolean> => {
  if (
    retiredOwners.has(owner) ||
    !mealPhotoRetentionEnabled() ||
    !owned(owner, photo.uri)
  )
    return false;
  let retry = photo;
  if (photo.width === 0 || photo.height === 0) {
    const existing = await loadMealPhotoRetry(owner, entryId);
    if (existing) return updateRetryIndex(owner, entryId, true);
    try {
      const directory = photoDirectory(owner);
      directory.create({ intermediates: true, idempotent: true });
      const copy = new File(directory, `${createOperationId()}-retry.jpg`);
      await copyMealPhotoFile(owner, new File(photo.uri), copy);
      retry = { ...photo, uri: copy.uri };
    } catch {
      return false;
    }
  }
  // Index first: a crash or failed index write must never leave an unenumerable private retry.
  if (!(await updateRetryIndex(owner, entryId, true))) {
    if (retry.uri !== photo.uri) discardOwnedMealPhoto(owner, retry.uri);
    return false;
  }
  const saved = await saveLoggingDraft(owner, retryKind(entryId), retry);
  if (retiredOwners.has(owner)) {
    await clearLoggingDraft(owner, retryKind(entryId));
    discardOwnedMealPhoto(owner, retry.uri);
    return false;
  }
  if (!saved && retry.uri !== photo.uri)
    discardOwnedMealPhoto(owner, retry.uri);
  return saved;
};
/** Stage an independent copy before creating nutrition, using an expiring owner-authorized URL. */
export const prepareCopiedMealPhoto = async (
  owner: string,
  sourceEntryId: string,
  isCurrent: () => boolean,
  client: ApiClient = apiClient,
): Promise<RetainedMealPhoto> => {
  if (retiredOwners.has(owner) || !mealPhotoRetentionEnabled() || !isCurrent())
    throw new Error("Meal photo copy unavailable.");
  const result = await client.request<MealPhotoReadResponse>({
    method: "GET",
    path: `/v1/food-entries/${encodeURIComponent(sourceEntryId)}/photo`,
    expectedUserId: owner,
    isCurrent,
    schema: mealPhotoReadResponseSchema,
  });
  if (
    !result.ok ||
    !result.value.photo ||
    !isCurrent() ||
    retiredOwners.has(owner)
  )
    throw new Error("Meal photo copy unavailable.");
  const directory = photoDirectory(owner);
  directory.create({ intermediates: true, idempotent: true });
  const destination = new File(directory, `${createOperationId()}-copy.jpg`);
  try {
    await File.downloadFileAsync(result.value.photo.signedUrl, destination);
    if (
      !isCurrent() ||
      retiredOwners.has(owner) ||
      !destination.exists ||
      destination.size <= 0 ||
      destination.size > MAX_RETAINED_MEAL_PHOTO_BYTES
    )
      throw new Error("Meal photo copy unavailable.");
    return {
      uri: destination.uri,
      width: result.value.photo.width,
      height: result.value.photo.height,
      clientOperationId: createOperationId(),
    };
  } catch (cause) {
    discardOwnedMealPhoto(owner, destination.uri);
    throw cause;
  }
};
export const loadMealPhotoRetry = (owner: string, entryId: string) =>
  loadLoggingDraft(owner, retryKind(entryId), isPendingPhoto);
export const removeMealPhotoRetry = async (
  owner: string,
  entryId: string,
  discardBytes = true,
) => {
  const pending = await loadMealPhotoRetry(owner, entryId);
  const cleared = await clearLoggingDraft(owner, retryKind(entryId));
  if (cleared && pending && discardBytes)
    discardOwnedMealPhoto(owner, pending.uri);
  if (cleared) await updateRetryIndex(owner, entryId, false);
  return cleared;
};
export const uploadMealPhotoRetry = async (
  owner: string,
  entryId: string,
  isCurrent: () => boolean,
  client: ApiClient = apiClient,
): Promise<boolean> => {
  if (retiredOwners.has(owner) || !mealPhotoRetentionEnabled() || !isCurrent())
    return false;
  let photo = await loadMealPhotoRetry(owner, entryId);
  if (!photo || !owned(owner, photo.uri) || !isCurrent()) return false;
  try {
    if (photo.width === 0 || photo.height === 0) {
      const source = photo.uri;
      const prepared = await prepareRetainedMealPhoto(owner, { uri: source });
      if (!isCurrent()) {
        discardOwnedMealPhoto(owner, prepared.uri);
        return false;
      }
      photo = { ...prepared, clientOperationId: photo.clientOperationId };
      if (!(await persistMealPhotoRetry(owner, entryId, photo))) {
        discardOwnedMealPhoto(owner, prepared.uri);
        return false;
      }
      discardOwnedMealPhoto(owner, source);
    }
    const file = new File(photo.uri);
    if (
      !file.exists ||
      file.size <= 0 ||
      file.size > MAX_RETAINED_MEAL_PHOTO_BYTES
    )
      return false;
    const imageBase64 = await file.base64();
    if (!isCurrent()) return false;
    const result = await client.request({
      expectedUserId: owner,
      isCurrent,
      method: "POST",
      path: `/v1/food-entries/${encodeURIComponent(entryId)}/photo`,
      body: {
        clientOperationId: photo.clientOperationId,
        imageBase64,
        mimeType: "image/jpeg",
        width: photo.width,
        height: photo.height,
      },
      schema: mealPhotoResponseSchema,
    });
    if (!isCurrent() || !result.ok) return false;
    return removeMealPhotoRetry(owner, entryId);
  } catch {
    return false;
  }
};
export const fetchMealPhoto = (entryId: string) =>
  apiClient.request<MealPhotoReadResponse>({
    method: "GET",
    path: `/v1/food-entries/${encodeURIComponent(entryId)}/photo`,
    schema: mealPhotoReadResponseSchema,
  });
export const deleteMealPhoto = (entryId: string) =>
  apiClient.request<void>({
    method: "DELETE",
    path: `/v1/food-entries/${encodeURIComponent(entryId)}/photo`,
  });
