import type { ApiClient } from "@mizyun/api-client";
import {
  mediaSignResponseSchema,
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
    await deleteBoulderPhoto(client, ticket.value.assetId);
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
  | { readonly kind: "queued" }
  | { readonly kind: "upload_failed"; readonly message: string }
  | { readonly kind: "not_saved"; readonly message: string };

/**
 * Attaches a photo to a synced boulder. Upload first; only a successful
 * upload queues the (durable) edit linking it. Any failure leaves the boulder
 * saved without the photo so the screen can offer Retry photo.
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
  readonly now?: () => Date;
}): Promise<AttachPhotoOutcome> {
  const store = input.store ?? boulderPendingStore;
  const upload = await uploadBoulderPhoto(
    input.client,
    input.photo,
    input.uploadFile,
  );
  if (!upload.ok) return { kind: "upload_failed", message: upload.message };
  if (!input.isCurrent()) {
    await deleteBoulderPhoto(input.client, upload.assetId);
    return { kind: "not_saved", message: enqueueFailureMessage("account") };
  }
  const body = boulderUpdateBody(
    formFromAscent(input.ascent, DEFAULT_BOULDER_GRADE),
    input.ascent,
    input.operationId,
    upload.assetId,
  );
  const write = body
    ? await store.enqueue(
        input.userId,
        {
          kind: "update",
          sessionId: input.ascent.sessionId,
          ascentId: input.ascent.id,
          body,
          replacedPhotoAssetId: input.ascent.photoAssetId,
          queuedAt: (input.now?.() ?? new Date()).toISOString(),
        },
        input.isCurrent,
      )
    : ({ ok: false, reason: "storage" } as const);
  if (!write.ok) {
    await deleteBoulderPhoto(input.client, upload.assetId);
    return {
      kind: "not_saved",
      message:
        "The photo couldn't be kept with this boulder. Your boulder is saved; try the photo again.",
    };
  }
  return { kind: "queued" };
}
