import type { ApiClient } from "@mizyun/api-client";
import {
  boulderAscentResponseSchema,
  mediaSignResponseSchema,
  type BoulderAscentPhotoLink,
  type BoulderAscentResponse,
  mediaUploadUrlResponseSchema,
  type BoulderAscentRecord,
  type MediaSignResponse,
  type MediaUploadUrlRequest,
  type MediaUploadUrlResponse,
} from "@mizyun/contracts";
import { mobileConfigResult } from "@/composition/mobile-config";
import { resolveUploadUrl } from "@/features/feedback/feedback-data";
import { toBoulderFailure } from "./client";
import {
  boulderPendingStore,
  enqueueFailureMessage,
  type BoulderPendingStore,
} from "./pending-ascents";
import { boulderUpdateBody, formFromAscent } from "./log-boulder-form";
import { DEFAULT_BOULDER_GRADE } from "./presentation";
import {
  localPhotoRecord,
  localPhotoUri,
  markLocalPhotoOrphaned,
  recordLocalPhotoBackup,
  removeLocalPhoto,
  saveLocalPhoto,
} from "@/features/private-photos/local-photo-library";
import { loadPhotoBackupEnabled } from "@/features/private-photos/photo-backup-preference";
import {
  beginBoulderPhotoSave,
  boulderPhotoDownloadSettled,
  clearBoulderPhotoReplaced,
  downloadBoulderBackup,
  isBoulderPhotoReplaced,
  markBoulderPhotoReplaced,
} from "./boulder-photo-display";

/**
 * A photo already resized to a 2048 px edge and re-encoded as JPEG on the
 * device. The re-encode is the metadata-removal step (ADR-0066 §5); Expo's
 * `exif: false` only controls what the picker returns to JavaScript.
 */
export interface PreparedBoulderPhoto {
  readonly uri: string;
  readonly mimeType: "image/jpeg";
  readonly byteSize: number;
  readonly width: number;
  readonly height: number;
}

export type BoulderPhotoUploader = (
  uploadUrl: string,
  photo: PreparedBoulderPhoto,
) => Promise<{ readonly ok: boolean; readonly status: number }>;

const MAX_BYTES = 15 * 1024 * 1024;

export const boulderPhotoProblem = (
  photo: PreparedBoulderPhoto,
): string | null => {
  if (!Number.isInteger(photo.byteSize) || photo.byteSize <= 0)
    return "The photo file is empty.";
  if (photo.byteSize > MAX_BYTES)
    return "The photo is larger than 15 MB after resizing.";
  if (
    !Number.isInteger(photo.width) ||
    !Number.isInteger(photo.height) ||
    Math.min(photo.width, photo.height) < 16 ||
    Math.max(photo.width, photo.height) > 8192
  )
    return "The photo dimensions are not supported.";
  return null;
};

const uploadNativeFile: BoulderPhotoUploader = async (uploadUrl, photo) => {
  const [{ fetch: expoFetch }, { File }] = await Promise.all([
    import("expo/fetch"),
    import("expo-file-system"),
  ]);
  return expoFetch(uploadUrl, {
    method: "PUT",
    headers: {
      "cache-control": "max-age=0",
      "content-type": photo.mimeType,
      "x-upsert": "false",
    },
    body: new File(photo.uri),
  });
};

/**
 * Pins every request to one account: the API client refuses to send (or to
 * return) when the signed-in user is not `userId` or `isCurrent()` turned
 * false, so an account switch never moves bytes or links between accounts.
 */
export const fencedBoulderClient = (
  client: ApiClient,
  userId: string,
  isCurrent: () => boolean,
): ApiClient => ({
  status: () => client.status(),
  request: (options) =>
    client.request({ ...options, expectedUserId: userId, isCurrent }),
});

/**
 * Pinned to the account only (no `isCurrent`), for clean-up deletes: they run
 * exactly when `isCurrent()` has just turned false (backgrounded, backup
 * turned off) and must still remove this account's unlinked asset. The
 * signed-in user check still refuses them after an account switch.
 */
export const accountBoulderClient = (
  client: ApiClient,
  userId: string,
): ApiClient => ({
  status: () => client.status(),
  request: (options) => client.request({ ...options, expectedUserId: userId }),
});

/** Best effort: a failed delete leaves an orphan that export lists and erasure sweeps. */
export async function deleteBoulderPhoto(
  client: ApiClient,
  assetId: string,
): Promise<boolean> {
  try {
    const result = await client.request<void>({
      method: "DELETE",
      path: `/v1/media/${encodeURIComponent(assetId)}`,
    });
    return result.ok;
  } catch {
    return false;
  }
}

export type BoulderPhotoUpload =
  | { readonly ok: true; readonly assetId: string }
  | { readonly ok: false; readonly message: string };

/** Upload ticket (private purpose `workout`) → PUT bytes → media asset id. */
export async function uploadBoulderPhoto(
  client: ApiClient,
  photo: PreparedBoulderPhoto,
  uploadFile: BoulderPhotoUploader = uploadNativeFile,
  isCurrent: () => boolean = () => true,
  /** Client for the clean-up delete; defaults to `client`. */
  cleanupClient: ApiClient = client,
): Promise<BoulderPhotoUpload> {
  const problem = boulderPhotoProblem(photo);
  if (problem) return { ok: false, message: problem };
  const body: MediaUploadUrlRequest = {
    purpose: "workout",
    mimeType: photo.mimeType,
    byteSize: photo.byteSize,
    width: photo.width,
    height: photo.height,
  };
  const ticket = await client.request<MediaUploadUrlResponse>({
    method: "POST",
    path: "/v1/media/upload-url",
    body,
    schema: mediaUploadUrlResponseSchema,
  });
  if (!ticket.ok)
    return { ok: false, message: toBoulderFailure(ticket.error).message };
  try {
    if (!isCurrent()) throw new Error("account changed");
    const configured = mobileConfigResult.ok
      ? mobileConfigResult.value.supabaseConfig?.url
      : null;
    const response = await uploadFile(
      resolveUploadUrl(ticket.value.uploadUrl, configured),
      photo,
    );
    if (!response.ok) throw new Error(`upload failed (${response.status})`);
    return { ok: true, assetId: ticket.value.assetId };
  } catch {
    // The ticket already created asset metadata; remove it so a failed
    // transfer never shows as a broken photo.
    await deleteBoulderPhoto(cleanupClient, ticket.value.assetId);
    return {
      ok: false,
      message: "The photo couldn't be uploaded. Your boulder is saved.",
    };
  }
}

/** Short-lived signed URL for a private thumbnail; null when unavailable. */
export async function signBoulderPhoto(
  client: ApiClient,
  assetId: string,
): Promise<string | null> {
  try {
    const result = await client.request<MediaSignResponse>({
      method: "POST",
      path: "/v1/media/sign",
      body: { assetId },
      schema: mediaSignResponseSchema,
    });
    return result.ok ? result.value.signedUrl : null;
  } catch {
    return null;
  }
}

export type AttachPhotoOutcome =
  /** Uploaded and the edit linking it is queued (Back up photos on). */
  | { readonly kind: "queued" }
  /** Kept on this device only; `backupPending` when an upload was tried and failed. */
  | { readonly kind: "kept_on_device"; readonly backupPending: boolean }
  /** Neither the device copy nor the backup worked; the screen offers Retry photo. */
  | { readonly kind: "upload_failed"; readonly message: string }
  | { readonly kind: "not_saved"; readonly message: string };

const NOT_KEPT =
  "The photo couldn't be kept with this boulder. Your boulder is saved; try the photo again.";

/**
 * Attaches a photo to a synced boulder (ADR-0079). The photo is always kept
 * in this account's device library under the ascent id first. Only when
 * "Back up photos" is on is it uploaded and linked by a durable edit. A newer
 * device-only photo unlinks (and so deletes) an older server backup, so the
 * server never shows a photo the phone has replaced.
 */
export async function attachBoulderPhoto(input: {
  readonly userId: string;
  readonly client: ApiClient;
  readonly ascent: BoulderAscentRecord;
  readonly photo: PreparedBoulderPhoto;
  readonly operationId: string;
  readonly isCurrent: () => boolean;
  readonly store?: BoulderPendingStore;
  readonly uploadFile?: BoulderPhotoUploader;
  readonly backupEnabled?: (userId: string) => Promise<boolean>;
  readonly now?: () => Date;
}): Promise<AttachPhotoOutcome> {
  const store = input.store ?? boulderPendingStore;
  const { userId, ascent } = input;
  const client = fencedBoulderClient(input.client, userId, input.isCurrent);
  const cleanup = accountBoulderClient(input.client, userId);
  const oldAssetId = ascent.photoAssetId;
  const accountChanged = {
    kind: "not_saved",
    message: enqueueFailureMessage("account"),
  } as const;
  const queueEdit = (photoAssetId: string | null) => {
    const body = boulderUpdateBody(
      formFromAscent(ascent, DEFAULT_BOULDER_GRADE),
      ascent,
      input.operationId,
      photoAssetId,
    );
    return body
      ? store.enqueue(
          userId,
          {
            kind: "update",
            sessionId: ascent.sessionId,
            ascentId: ascent.id,
            body,
            replacedPhotoAssetId: oldAssetId,
            queuedAt: (input.now?.() ?? new Date()).toISOString(),
          },
          input.isCurrent,
        )
      : Promise.resolve({ ok: false, reason: "storage" } as const);
  };

  // Mark first so no backup download can start for this ascent, then wait
  // for any already running so it can't land over the new photo.
  const endSave = beginBoulderPhotoSave(userId, ascent.id);
  if (oldAssetId) markBoulderPhotoReplaced(userId, ascent.id, oldAssetId);
  try {
    await boulderPhotoDownloadSettled(userId, ascent.id);
    return await attachAfterSettled();
  } finally {
    endSave();
  }
  async function attachAfterSettled(): Promise<AttachPhotoOutcome> {
    const saved = await saveLocalPhoto(
      userId,
      "boulder",
      ascent.id,
      input.photo.uri,
      { assetId: null, maxBytes: MAX_BYTES },
    ).catch(() => null);
    if (!saved) clearBoulderPhotoReplaced(userId, ascent.id);
    if (!input.isCurrent()) return accountChanged;

    const backup = await (input.backupEnabled ?? loadPhotoBackupEnabled)(
      userId,
    ).catch(() => false);
    if (!input.isCurrent()) return accountChanged;
    let uploadFailed = false;
    if (backup) {
      const upload = await uploadBoulderPhoto(
        client,
        input.photo,
        input.uploadFile,
        input.isCurrent,
        cleanup,
      );
      if (upload.ok) {
        if (!input.isCurrent()) {
          await deleteBoulderPhoto(cleanup, upload.assetId);
          return accountChanged;
        }
        const write = await queueEdit(upload.assetId);
        if (write.ok) {
          if (saved)
            recordLocalPhotoBackup(
              userId,
              "boulder",
              ascent.id,
              upload.assetId,
            );
          return { kind: "queued" };
        }
        await deleteBoulderPhoto(cleanup, upload.assetId);
        if (!saved) return { kind: "not_saved", message: NOT_KEPT };
      } else {
        uploadFailed = true;
        if (!saved) return { kind: "upload_failed", message: upload.message };
      }
    }
    if (!saved) return { kind: "not_saved", message: NOT_KEPT };
    if (oldAssetId) {
      // The device photo replaces the server backup: unlink it durably.
      const write = await queueEdit(null);
      if (!write.ok) {
        removeLocalPhoto(userId, "boulder", ascent.id);
        clearBoulderPhotoReplaced(userId, ascent.id);
        return {
          kind: "not_saved",
          message: input.isCurrent()
            ? NOT_KEPT
            : enqueueFailureMessage("account"),
        };
      }
    }
    return { kind: "kept_on_device", backupPending: uploadFailed };
  }
}

const ascentPhotoPath = (ascentId: string) =>
  `/v1/bouldering/ascents/${encodeURIComponent(ascentId)}/photo`;

export interface DevicePhotoMeasure {
  readonly byteSize: number;
  readonly width: number;
  readonly height: number;
}

const measureDevicePhoto = async (uri: string): Promise<DevicePhotoMeasure> => {
  const [{ ImageManipulator }, { File }] = await Promise.all([
    import("expo-image-manipulator"),
    import("expo-file-system"),
  ]);
  const image = await ImageManipulator.manipulate(uri).renderAsync();
  try {
    return {
      byteSize: new File(uri).size,
      width: image.width,
      height: image.height,
    };
  } finally {
    image.release();
  }
};

const pendingForAscent = async (
  store: BoulderPendingStore,
  userId: string,
  ascentId: string,
): Promise<boolean> => {
  try {
    const state = await store.load(userId);
    return state.commands.some(
      (c) => c.kind !== "create" && c.ascentId === ascentId,
    );
  } catch {
    // Unreadable waiting edits: never risk a revision bump under them.
    return true;
  }
};

/**
 * Background backup of a device-only boulder photo (ADR-0079): upload the
 * device copy, link it to the ascent, then record the backup. False when
 * there is nothing to back up, an edit for the ascent is still waiting to
 * sync (the link bumps the revision and would discard it), or any step
 * failed (the uploaded asset is deleted). A boulder that no longer exists
 * marks the device photo orphaned so the sync stops retrying it.
 */
export async function backUpDeviceBoulderPhoto(input: {
  readonly userId: string;
  readonly client: ApiClient;
  readonly ascentId: string;
  readonly isCurrent: () => boolean;
  readonly uploadFile?: BoulderPhotoUploader;
  readonly measure?: (uri: string) => Promise<DevicePhotoMeasure>;
  readonly store?: BoulderPendingStore;
}): Promise<boolean> {
  const { userId, ascentId, isCurrent } = input;
  const store = input.store ?? boulderPendingStore;
  const client = fencedBoulderClient(input.client, userId, isCurrent);
  const cleanup = accountBoulderClient(input.client, userId);
  const uri = localPhotoUri(userId, "boulder", ascentId);
  const record = localPhotoRecord(userId, "boulder", ascentId);
  if (!uri || !record || record.assetId !== null || !isCurrent()) return false;
  if (await pendingForAscent(store, userId, ascentId)) return false;
  if (!isCurrent()) return false;
  let size: DevicePhotoMeasure;
  try {
    size = await (input.measure ?? measureDevicePhoto)(uri);
  } catch {
    return false;
  }
  if (!isCurrent()) return false;
  const upload = await uploadBoulderPhoto(
    client,
    { uri, mimeType: "image/jpeg", ...size },
    input.uploadFile,
    isCurrent,
    cleanup,
  );
  if (!upload.ok) return false;
  // Re-check after the bytes: the account or the waiting edits may have changed.
  if (!isCurrent() || (await pendingForAscent(store, userId, ascentId))) {
    await deleteBoulderPhoto(cleanup, upload.assetId);
    return false;
  }
  let linked = false;
  let gone = false;
  try {
    const body: BoulderAscentPhotoLink = { assetId: upload.assetId };
    const result = await client.request<BoulderAscentResponse>({
      method: "PUT",
      path: ascentPhotoPath(ascentId),
      body,
      schema: boulderAscentResponseSchema,
    });
    linked = result.ok && result.value.ascent.photoAssetId === upload.assetId;
    // The asset was just uploaded by this account, so a 404/410 here means
    // the boulder itself is gone.
    gone =
      !result.ok &&
      result.error.kind === "http_error" &&
      (result.error.status === 404 || result.error.status === 410);
  } catch {
    linked = false;
  }
  if (!linked) {
    await deleteBoulderPhoto(cleanup, upload.assetId);
    if (gone && isCurrent())
      markLocalPhotoOrphaned(userId, "boulder", ascentId);
    return false;
  }
  if (!isCurrent()) return false;
  return recordLocalPhotoBackup(userId, "boulder", ascentId, upload.assetId);
}

/** Removes an ascent's server photo backup; the device copy stays (ADR-0079). */
export async function removeBoulderPhotoBackup(input: {
  readonly userId: string;
  readonly client: ApiClient;
  readonly ascentId: string;
  readonly isCurrent: () => boolean;
}): Promise<boolean> {
  const { userId, ascentId, isCurrent } = input;
  if (!isCurrent()) return false;
  const client = fencedBoulderClient(input.client, userId, isCurrent);
  try {
    const result = await client.request<void>({
      method: "DELETE",
      path: ascentPhotoPath(ascentId),
    });
    if (!result.ok || !isCurrent()) return false;
  } catch {
    return false;
  }
  if (!localPhotoUri(userId, "boulder", ascentId)) return true;
  return recordLocalPhotoBackup(userId, "boulder", ascentId, null);
}

/**
 * Makes sure this server backup is on the device before the backup is
 * removed. True only when the device copy's recorded backup is `assetId`;
 * otherwise signs (account-fenced) and downloads it through the shared
 * per-ascent download, never over a newer device photo that replaced it.
 */
export async function ensureBoulderPhotoOnDevice(input: {
  readonly userId: string;
  readonly client: ApiClient;
  readonly ascentId: string;
  readonly assetId: string;
  readonly isCurrent: () => boolean;
}): Promise<boolean> {
  const { userId, ascentId, assetId, isCurrent } = input;
  if (!userId || !isCurrent()) return false;
  await boulderPhotoDownloadSettled(userId, ascentId);
  if (localPhotoRecord(userId, "boulder", ascentId)?.assetId === assetId)
    return true;
  if (isBoulderPhotoReplaced(userId, ascentId, assetId)) return false;
  const url = await signBoulderPhoto(
    fencedBoulderClient(input.client, userId, isCurrent),
    assetId,
  );
  if (!url || !isCurrent()) return false;
  return downloadBoulderBackup(userId, ascentId, assetId, url);
}
