import type { ApiClient, ApiError } from "@mizyun/api-client";
import { apiClient } from "@/composition/api-client";
import { mobileConfigResult } from "@/composition/mobile-config";
import {
  createFeedbackResponseSchema,
  createFeedbackSchema,
  listFeedbackResponseSchema,
  mediaUploadUrlResponseSchema,
  type CreateFeedbackInput,
  type CreateFeedbackResponse,
  type FeedbackItem,
  type ListFeedbackResponse,
  type MediaUploadUrlRequest,
  type MediaUploadUrlResponse,
} from "@mizyun/contracts";

const isLoopbackHost = (hostname: string): boolean =>
  hostname === "127.0.0.1" ||
  hostname === "localhost" ||
  hostname === "::1" ||
  hostname === "[::1]";

export const resolveUploadUrl = (
  uploadUrl: string,
  configuredSupabaseUrl?: string | null,
): string => {
  if (!configuredSupabaseUrl) {
    return uploadUrl;
  }

  try {
    const parsedUpload = new URL(uploadUrl);
    const parsedConfig = new URL(configuredSupabaseUrl);

    if (
      isLoopbackHost(parsedUpload.hostname) &&
      !isLoopbackHost(parsedConfig.hostname)
    ) {
      parsedUpload.protocol = parsedConfig.protocol;
      parsedUpload.hostname = parsedConfig.hostname;
      parsedUpload.port = parsedConfig.port;
      return parsedUpload.toString();
    }

    return uploadUrl;
  } catch {
    return uploadUrl;
  }
};

export interface PreparedFeedbackAttachment {
  readonly uri: string;
  readonly mimeType: string;
  readonly byteSize: number;
  readonly width: number;
  readonly height: number;
}

export type FeedbackAttachmentUploader = (
  uploadUrl: string,
  attachment: PreparedFeedbackAttachment,
) => Promise<{ readonly ok: boolean; readonly status: number }>;

const humanizeApiError = (error: ApiError, fallback: string): string => {
  switch (error.kind) {
    case "session_expired":
      return "Your session expired. Sign in again.";
    case "no_session":
      return "You're signed out. Sign in and try again.";
    case "network_error":
      return "Network unavailable. Try again when you're online.";
    case "http_error":
      if (typeof error.message === "string" && error.message.length > 0) {
        return error.message;
      }
      return fallback;
    case "validation_error":
      return "Please double-check the values and try again.";
    case "not_configured":
      return "The API isn't configured yet.";
    case "parse_error":
      return fallback;
  }
};

const uploadNativeFile: FeedbackAttachmentUploader = async (
  uploadUrl,
  attachment,
) => {
  const [{ fetch: expoFetch }, { File }] = await Promise.all([
    import("expo/fetch"),
    import("expo-file-system"),
  ]);
  return expoFetch(uploadUrl, {
    method: "PUT",
    headers: {
      "cache-control": "max-age=0",
      "content-type": attachment.mimeType || "image/jpeg",
      "x-upsert": "false",
    },
    body: new File(attachment.uri),
  });
};

const normalizeMimeType = (
  mimeType: string,
): "image/jpeg" | "image/png" | "image/webp" => {
  if (mimeType === "image/png") return "image/png";
  if (mimeType === "image/webp") return "image/webp";
  return "image/jpeg";
};

export const uploadFeedbackAttachment = async (
  attachment: PreparedFeedbackAttachment,
  client: ApiClient = apiClient,
  uploadFile: FeedbackAttachmentUploader = uploadNativeFile,
): Promise<
  | { readonly ok: true; readonly assetId: string }
  | { readonly ok: false; readonly message: string }
> => {
  const mimeType = normalizeMimeType(attachment.mimeType);
  const requestBody: MediaUploadUrlRequest = {
    purpose: "feedback",
    mimeType,
    byteSize: Math.max(1, attachment.byteSize || 1024),
    width: Math.min(8192, Math.max(16, attachment.width || 800)),
    height: Math.min(8192, Math.max(16, attachment.height || 600)),
    metadata: {},
  };

  const ticket = await client.request<MediaUploadUrlResponse>({
    method: "POST",
    path: "/v1/media/upload-url",
    body: requestBody,
    schema: mediaUploadUrlResponseSchema,
  });

  if (!ticket.ok) {
    return {
      ok: false,
      message: humanizeApiError(
        ticket.error,
        "Could not initialize photo upload.",
      ),
    };
  }

  try {
    const configuredUrl = mobileConfigResult.ok
      ? mobileConfigResult.value.supabaseConfig?.url
      : null;
    const targetUploadUrl = resolveUploadUrl(
      ticket.value.uploadUrl,
      configuredUrl,
    );
    const uploadRes = await uploadFile(targetUploadUrl, attachment);
    if (!uploadRes.ok) {
      throw new Error(`Upload failed with status ${uploadRes.status}`);
    }
    return { ok: true, assetId: ticket.value.assetId };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Photo upload failed.",
    };
  }
};

export const submitFeedback = async (
  body: CreateFeedbackInput,
): Promise<
  | { readonly ok: true; readonly feedback: FeedbackItem }
  | { readonly ok: false; readonly message: string }
> => {
  const parsed = createFeedbackSchema.safeParse(body);
  if (!parsed.success) {
    const message =
      parsed.error.issues[0]?.message ?? "Invalid feedback input.";
    return { ok: false, message };
  }

  const result = await apiClient.request<CreateFeedbackResponse>({
    method: "POST",
    path: "/v1/feedback",
    body: parsed.data,
    schema: createFeedbackResponseSchema,
  });

  if (result.ok) {
    return { ok: true, feedback: result.value.feedback };
  }

  return {
    ok: false,
    message: humanizeApiError(
      result.error,
      "Failed to submit feedback. Please try again.",
    ),
  };
};

export const loadUserFeedback = async (): Promise<
  | { readonly ok: true; readonly feedback: readonly FeedbackItem[] }
  | { readonly ok: false; readonly message: string }
> => {
  const result = await apiClient.request<ListFeedbackResponse>({
    method: "GET",
    path: "/v1/feedback",
    schema: listFeedbackResponseSchema,
  });

  if (result.ok) {
    return { ok: true, feedback: result.value.feedback };
  }

  return {
    ok: false,
    message: humanizeApiError(result.error, "Failed to load past feedback."),
  };
};
