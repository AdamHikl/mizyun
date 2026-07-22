import type { ApiClient, ApiError } from "@mizyun/api-client";
import {
  mediaCompareResponseSchema,
  mediaTimelineResponseSchema,
  mediaUploadUrlResponseSchema,
  type MediaCompareResponse,
  type MediaTimelineResponse,
  type MediaUploadUrlResponse,
  type MediaUploadUrlRequest,
} from "@mizyun/contracts";
import { err, ok, type Result, type UserId } from "@mizyun/core";

export interface MobilePrincipal {
  readonly userId: UserId;
  readonly accessToken: string;
}

export interface PreparedProgressPhoto {
  readonly uri: string;
  readonly mimeType: "image/jpeg";
  readonly byteSize: number;
  readonly width: number;
  readonly height: number;
  readonly capturedAt: string;
}

export type ProgressPhotoUploader = (
  uploadUrl: string,
  photo: PreparedProgressPhoto,
) => Promise<{ readonly ok: boolean; readonly status: number }>;

export type ProgressPhotoError =
  | ApiError
  | { readonly kind: "invalid_photo"; readonly message: string }
  | { readonly kind: "upload_error"; readonly message: string };

const MAX_BYTES = 15 * 1024 * 1024;

export const validatePreparedPhoto = (
  photo: PreparedProgressPhoto,
): ProgressPhotoError | null => {
  if (!Number.isInteger(photo.byteSize) || photo.byteSize <= 0) {
    return { kind: "invalid_photo", message: "The photo file is empty." };
  }
  if (photo.byteSize > MAX_BYTES) {
    return {
      kind: "invalid_photo",
      message: "The normalized photo is larger than 15 MB.",
    };
  }
  if (
    !Number.isInteger(photo.width) ||
    !Number.isInteger(photo.height) ||
    photo.width < 16 ||
    photo.height < 16 ||
    photo.width > 8192 ||
    photo.height > 8192
  ) {
    return {
      kind: "invalid_photo",
      message: "The photo dimensions are not supported.",
    };
  }
  return null;
};

export const fetchProgressTimeline = async (
  client: ApiClient,
  _principal: MobilePrincipal,
): Promise<Result<MediaTimelineResponse, ApiError>> =>
  client.request<MediaTimelineResponse>({
    method: "GET",
    path: "/v1/media/timeline?purpose=progress&limit=100",
    schema: mediaTimelineResponseSchema,
  });

export const compareProgressPhotos = async (
  client: ApiClient,
  _principal: MobilePrincipal,
  assetIdA: string,
  assetIdB: string,
): Promise<Result<MediaCompareResponse, ApiError>> =>
  client.request<MediaCompareResponse>({
    method: "POST",
    path: "/v1/media/compare",
    body: { assetIdA, assetIdB },
    schema: mediaCompareResponseSchema,
  });

export const deleteProgressPhoto = async (
  client: ApiClient,
  _principal: MobilePrincipal,
  assetId: string,
): Promise<Result<void, ApiError>> =>
  client.request<void>({ method: "DELETE", path: `/v1/media/${assetId}` });

const uploadNativeFile: ProgressPhotoUploader = async (uploadUrl, photo) => {
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

export const uploadProgressPhoto = async (
  client: ApiClient,
  principal: MobilePrincipal,
  photo: PreparedProgressPhoto,
  uploadFile: ProgressPhotoUploader = uploadNativeFile,
): Promise<Result<{ readonly assetId: string }, ProgressPhotoError>> => {
  const invalid = validatePreparedPhoto(photo);
  if (invalid !== null) return err(invalid);

  const requestBody: MediaUploadUrlRequest = {
    purpose: "progress",
    mimeType: photo.mimeType,
    byteSize: photo.byteSize,
    width: photo.width,
    height: photo.height,
    metadata: { capturedAt: photo.capturedAt },
  };
  const ticket = await client.request<MediaUploadUrlResponse>({
    method: "POST",
    path: "/v1/media/upload-url",
    body: requestBody,
    schema: mediaUploadUrlResponseSchema,
  });
  if (!ticket.ok) return err(ticket.error);

  try {
    const uploadResponse = await uploadFile(ticket.value.uploadUrl, photo);
    if (!uploadResponse.ok) {
      throw new Error(`signed upload failed (${uploadResponse.status})`);
    }
    return ok({ assetId: ticket.value.assetId });
  } catch (cause) {
    // The upload-ticket endpoint has already created metadata. Best-effort
    // cleanup prevents a failed transfer from appearing as a broken photo.
    await deleteProgressPhoto(client, principal, ticket.value.assetId);
    return err({
      kind: "upload_error",
      message: cause instanceof Error ? cause.message : "Photo upload failed.",
    });
  }
};

export const progressPhotoErrorMessage = (
  error: ProgressPhotoError,
): string => {
  switch (error.kind) {
    case "invalid_photo":
    case "upload_error":
      return error.message;
    case "http_error":
      return error.message;
    case "network_error":
      return "The network request failed. Your selected photo remains on this device.";
    case "not_configured":
      return error.reason;
    case "no_session":
    case "session_expired":
      return "Your session expired. Sign in and try again.";
    case "validation_error":
    case "parse_error":
      return "The photo service returned an unexpected response.";
  }
};
