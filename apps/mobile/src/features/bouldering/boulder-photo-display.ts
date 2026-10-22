import {
  downloadLocalPhoto,
  localPhotoRecord,
  localPhotoUri,
  recordLocalPhotoBackup,
  removeLocalPhoto,
} from "@/features/private-photos/local-photo-library";

/** Same ceiling as uploads (15 MiB); a larger download is not kept. */
export const MAX_BOULDER_PHOTO_BYTES = 15 * 1024 * 1024;

/**
 * Server photos that a newer device photo has replaced for an ascent, until
 * the server stops referencing them. Keeps the old backup from being shown
 * or downloaded over the new device copy while the change waits to sync.
 * The durable unlink/link edit covers app restarts.
 */
const replaced = new Map<string, string>();
const downloads = new Map<string, Promise<unknown>>();
/** Ascents with a new device photo being kept, with a nesting count. */
const saving = new Map<string, number>();
const slot = (owner: string, ascentId: string) => `${owner}:${ascentId}`;

export const markBoulderPhotoReplaced = (
  owner: string,
  ascentId: string,
  oldAssetId: string,
): void => {
  replaced.set(slot(owner, ascentId), oldAssetId);
};

export const clearBoulderPhotoReplaced = (
  owner: string,
  ascentId: string,
): void => {
  replaced.delete(slot(owner, ascentId));
};

export const isBoulderPhotoReplaced = (
  owner: string,
  ascentId: string,
  assetId: string,
): boolean => replaced.get(slot(owner, ascentId)) === assetId;

/**
 * The device copy to show for an ascent (ADR-0079), or null when the device
 * has none or it no longer matches the server's photo. A device-only copy
 * shows whenever the server has no photo for the ascent.
 */
export const deviceBoulderPhotoUri = (
  owner: string,
  ascentId: string,
  photoAssetId: string | null,
): string | null => {
  if (!owner) return null;
  const record = localPhotoRecord(owner, "boulder", ascentId);
  if (!record) return null;
  if (
    photoAssetId === null ||
    record.assetId === photoAssetId ||
    replaced.get(slot(owner, ascentId)) === photoAssetId
  ) {
    return localPhotoUri(owner, "boulder", ascentId);
  }
  return null;
};

/** True when this ascent's server photo must be signed because no device copy matches. */
export const needsSignedBoulderPhoto = (
  owner: string,
  ascentId: string,
  photoAssetId: string | null,
): photoAssetId is string =>
  !!owner &&
  photoAssetId !== null &&
  deviceBoulderPhotoUri(owner, ascentId, photoAssetId) === null;

export interface BoulderPhotoSource {
  readonly uri: string;
  /** Device copies are never cached again; signed private URLs stay in memory only. */
  readonly cachePolicy: "none" | "memory";
}

export const boulderPhotoSource = (
  owner: string,
  ascentId: string,
  photoAssetId: string | null,
  signedUrls: Readonly<Record<string, string>>,
): BoulderPhotoSource | null => {
  const device = deviceBoulderPhotoUri(owner, ascentId, photoAssetId);
  if (device) return { uri: device, cachePolicy: "none" };
  const signed = photoAssetId ? signedUrls[photoAssetId] : undefined;
  return signed ? { uri: signed, cachePolicy: "memory" } : null;
};

/**
 * Keeps a server-backed boulder photo on the device after it was signed, so
 * later views need no network. One download per ascent at a time (a new
 * device photo waits for it); never overwrites a newer device photo that
 * replaced this backup. True when the device copy now matches `assetId`.
 */
export async function downloadBoulderBackup(
  owner: string,
  ascentId: string,
  assetId: string,
  signedUrl: string,
): Promise<boolean> {
  const key = slot(owner, ascentId);
  if (!owner) return false;
  await downloads.get(key);
  // A new device photo is being kept for this ascent: never start a download.
  if (saving.has(key) || replaced.get(key) === assetId) return false;
  if (localPhotoRecord(owner, "boulder", ascentId)?.assetId === assetId)
    return true;
  let task = downloads.get(key);
  if (!task) {
    task = downloadLocalPhoto(owner, "boulder", ascentId, signedUrl, {
      assetId,
      maxBytes: MAX_BOULDER_PHOTO_BYTES,
    })
      .catch(() => null)
      .finally(() => {
        if (downloads.get(key) === task) downloads.delete(key);
      });
    downloads.set(key, task);
  }
  await task;
  return localPhotoRecord(owner, "boulder", ascentId)?.assetId === assetId;
}

/** Fire-and-forget form used after signing a thumbnail. */
export function keepBoulderBackupOnDevice(
  owner: string,
  ascentId: string,
  assetId: string,
  signedUrl: string,
): void {
  const key = slot(owner, ascentId);
  if (
    !owner ||
    downloads.has(key) ||
    saving.has(key) ||
    replaced.get(key) === assetId
  )
    return;
  if (!needsSignedBoulderPhoto(owner, ascentId, assetId)) return;
  void downloadBoulderBackup(owner, ascentId, assetId, signedUrl);
}

/**
 * After a synced edit returns the ascent without a server photo, a device
 * record that still names a backup is stale: clear it so the backup sync
 * uploads the device copy again instead of believing it is backed up.
 * Skipped while another edit for the ascent waits (it may link a photo).
 */
export const reconcileBoulderBackupRecord = (
  owner: string,
  ascent: { readonly id: string; readonly photoAssetId: string | null },
  stillPending: boolean,
): boolean => {
  if (!owner || stillPending || ascent.photoAssetId !== null) return false;
  const record = localPhotoRecord(owner, "boulder", ascent.id);
  if (!record || record.assetId === null) return false;
  return recordLocalPhotoBackup(owner, "boulder", ascent.id, null);
};

/** Lets a new device photo wait for a backup download so it is never overwritten. */
export const boulderPhotoDownloadSettled = async (
  owner: string,
  ascentId: string,
): Promise<void> => {
  const key = slot(owner, ascentId);
  for (let task = downloads.get(key); task; task = downloads.get(key))
    await task;
};

/**
 * Blocks backup downloads for an ascent while a new device photo is being
 * kept, so a download that was waiting can't resume and land over it.
 * Returns the function that ends the block.
 */
export const beginBoulderPhotoSave = (
  owner: string,
  ascentId: string,
): (() => void) => {
  const key = slot(owner, ascentId);
  saving.set(key, (saving.get(key) ?? 0) + 1);
  return () => {
    const left = (saving.get(key) ?? 1) - 1;
    if (left > 0) saving.set(key, left);
    else saving.delete(key);
  };
};

/** A deleted boulder or removed photo: drop the device copy for that ascent. */
export const forgetBoulderPhoto = (
  owner: string,
  ascentId: string,
): boolean => {
  replaced.delete(slot(owner, ascentId));
  return removeLocalPhoto(owner, "boulder", ascentId);
};

/** Test-only reset. */
export const resetBoulderPhotoDisplayForTests = (): void => {
  replaced.clear();
  downloads.clear();
  saving.clear();
};
