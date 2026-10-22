import type { ApiClient } from "@mizyun/api-client";
import {
  photoBackupListResponseSchema,
  type PhotoBackupListResponse,
} from "@mizyun/contracts";
import { apiClient } from "@/composition/api-client";
import {
  backUpLocalMealPhoto,
  ensureMealPhotoOnDevice,
} from "@/features/log-meal/public-data";
import {
  backUpDeviceBoulderPhoto,
  ensureBoulderPhotoOnDevice,
  removeBoulderPhotoBackup,
} from "@/features/bouldering/public-data";
import { listLocalPhotos, recordLocalPhotoBackup } from "./local-photo-library";
import { loadPhotoBackupEnabled } from "./photo-backup-preference";

/** Photos uploaded per sync run, so one launch never sends a whole library at once. */
const MAX_UPLOADS_PER_RUN = 20;
const failedKeys = new Set<string>();

const mealVisualsAllowed = async (
  owner: string,
  client: ApiClient,
  isCurrent: () => boolean,
): Promise<boolean> => {
  const result = await client.request<{ mealVisuals: boolean }>({
    method: "GET",
    path: "/v1/food-entries/visuals/capability",
    expectedUserId: owner,
    isCurrent,
  });
  return result.ok && result.value?.mealVisuals === true;
};

export interface BackupSyncResult {
  readonly uploaded: number;
  readonly pending: number;
}

/**
 * Uploads device-only photos while Back up photos is on (ADR-0079). Meal
 * backups need Pro; boulder backups do not. Failures stay device-only and are
 * tried again on the next run.
 */
export async function syncPhotoBackups(
  owner: string,
  options: { client?: ApiClient; isCurrent?: () => boolean } = {},
): Promise<BackupSyncResult> {
  const client = options.client ?? apiClient;
  const isCurrent = options.isCurrent ?? (() => true);
  if (!(await loadPhotoBackupEnabled(owner)) || !isCurrent())
    return { uploaded: 0, pending: 0 };
  // Photos that failed earlier (for example a meal deleted on another
  // device) go last, so they never block newer photos from backing up.
  const deviceOnly = listLocalPhotos(owner)
    .filter((record) => record.assetId === null && !record.orphaned)
    .sort(
      (a, b) =>
        Number(failedKeys.has(`${owner}:${a.key}`)) -
        Number(failedKeys.has(`${owner}:${b.key}`)),
    );
  let mealsAllowed: boolean | null = null;
  let uploaded = 0;
  let attempts = 0;
  for (const record of deviceOnly) {
    if (attempts >= MAX_UPLOADS_PER_RUN || !isCurrent()) break;
    // Turning backup off stops the run between photos.
    if (!(await loadPhotoBackupEnabled(owner))) break;
    if (record.kind === "meal") {
      mealsAllowed ??= await mealVisualsAllowed(owner, client, isCurrent).catch(
        () => false,
      );
      if (!mealsAllowed) continue;
    }
    attempts++;
    const ok =
      record.kind === "meal"
        ? await backUpLocalMealPhoto(owner, record.key, isCurrent, client)
        : await backUpDeviceBoulderPhoto({
            userId: owner,
            client,
            ascentId: record.key,
            isCurrent,
          });
    if (ok) {
      uploaded++;
      failedKeys.delete(`${owner}:${record.key}`);
    } else failedKeys.add(`${owner}:${record.key}`);
  }
  return { uploaded, pending: deviceOnly.length - uploaded };
}

export interface RemoveBackupsResult {
  readonly removed: number;
  /** Server copies kept because they could not be saved to this phone first. */
  readonly kept: number;
  readonly truncated: boolean;
}

/**
 * Removes every server backup of this account's meal and boulder photos,
 * saving each to this phone first. A photo that cannot be saved here (for
 * example a meal photo after Pro lapsed) keeps its server copy.
 */
export async function removePhotoBackups(
  owner: string,
  options: {
    client?: ApiClient;
    isCurrent?: () => boolean;
    onProgress?: (done: number, total: number) => void;
  } = {},
): Promise<RemoveBackupsResult | null> {
  const client = options.client ?? apiClient;
  const isCurrent = options.isCurrent ?? (() => true);
  const listed = await client.request<PhotoBackupListResponse>({
    method: "GET",
    path: "/v1/photo-backups",
    expectedUserId: owner,
    isCurrent,
    schema: photoBackupListResponseSchema,
  });
  if (!listed.ok || !isCurrent()) return null;
  const { meals, boulders } = listed.value;
  const total = meals.length + boulders.length;
  let removed = 0;
  let kept = 0;
  let done = 0;
  const step = () => options.onProgress?.(++done, total);
  for (const meal of meals) {
    if (!isCurrent()) return null;
    // A device copy recorded for a different backup is stale: the listed
    // backup is downloaded over it before anything is deleted.
    const local = await ensureMealPhotoOnDevice(
      owner,
      meal.entryId,
      isCurrent,
      client,
      meal.assetId,
    ).catch(() => null);
    if (!local) {
      kept++;
      step();
      continue;
    }
    const deleted = await client
      .request<void>({
        method: "DELETE",
        path: `/v1/food-entries/${encodeURIComponent(meal.entryId)}/photo`,
        expectedUserId: owner,
        isCurrent,
      })
      .catch(() => null);
    if (deleted?.ok) {
      recordLocalPhotoBackup(owner, "meal", meal.entryId, null);
      removed++;
    } else kept++;
    step();
  }
  for (const boulder of boulders) {
    if (!isCurrent()) return null;
    // Downloads go through the boulder screen's shared download, and a photo
    // replaced on this device is never overwritten by its older backup.
    const local = await ensureBoulderPhotoOnDevice({
      userId: owner,
      client,
      ascentId: boulder.ascentId,
      assetId: boulder.assetId,
      isCurrent,
    }).catch(() => false);
    const deleted =
      local &&
      (await removeBoulderPhotoBackup({
        userId: owner,
        client,
        ascentId: boulder.ascentId,
        isCurrent,
      }).catch(() => false));
    if (deleted) removed++;
    else kept++;
    step();
  }
  return { removed, kept, truncated: listed.value.truncated === true };
}
