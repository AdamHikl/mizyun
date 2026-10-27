import type { ApiClient, ApiError } from "@mizyun/api-client";
import {
  historyImportBatchListResponseSchema,
  historyImportBatchResponseSchema,
  historyImportPreviewResponseSchema,
  historyImportRemovedResponseSchema,
  type HistoryImportBatch,
  type HistoryImportConfirmRequest,
  type HistoryImportPreview,
  type HistoryImportPreviewRequest,
  type HistoryImportRemovedResponse,
} from "@mizyun/contracts";
import { apiClient } from "@/composition/api-client";

export type ImportResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      message: string;
      /** True when no response arrived; re-sending the same request is safe. */
      retryable: boolean;
      /** The server refused because the file or batch changed (HTTP 409). */
      conflict: boolean;
    };

/** Maps an API error to user-facing copy. */
export function importFailure(error: ApiError): ImportResult<never> {
  if (error.kind === "network_error")
    return {
      ok: false,
      retryable: true,
      conflict: false,
      message: "No connection to Mizyun. Nothing was lost; try again.",
    };
  if (error.kind === "http_error") {
    if (error.status === 409)
      return {
        ok: false,
        retryable: false,
        conflict: true,
        message:
          "This import changed since the preview. Choose the file and preview it again.",
      };
    if (error.status === 404)
      return {
        ok: false,
        retryable: false,
        conflict: false,
        message: "This import is no longer available.",
      };
    if (error.status === 422 || error.status === 400)
      return {
        ok: false,
        retryable: false,
        conflict: false,
        message: error.message || "Mizyun couldn't read this file.",
      };
    if (error.status >= 500)
      return {
        ok: false,
        retryable: true,
        conflict: false,
        message: "Mizyun couldn't finish the import. Try again in a moment.",
      };
    if (error.status === 403 || error.status === 501)
      return {
        ok: false,
        retryable: false,
        conflict: false,
        message: "Importing history isn't available on this server.",
      };
  }
  return {
    ok: false,
    retryable: error.kind === "session_expired",
    conflict: false,
    message:
      error.kind === "session_expired" || error.kind === "no_session"
        ? "Your session expired. Sign in again and retry."
        : "Something went wrong. Try again.",
  };
}

export async function previewHistoryImport(
  body: HistoryImportPreviewRequest,
  client: ApiClient = apiClient,
): Promise<ImportResult<HistoryImportPreview>> {
  const result = await client.request({
    method: "POST",
    path: "/v1/history-imports/preview",
    body,
    schema: historyImportPreviewResponseSchema,
  });
  return result.ok
    ? {
        ok: true,
        value: (result.value as { preview: HistoryImportPreview }).preview,
      }
    : importFailure(result.error);
}

export async function confirmHistoryImport(
  body: HistoryImportConfirmRequest,
  client: ApiClient = apiClient,
): Promise<ImportResult<HistoryImportBatch>> {
  const result = await client.request({
    method: "POST",
    path: "/v1/history-imports",
    body,
    schema: historyImportBatchResponseSchema,
  });
  return result.ok
    ? { ok: true, value: (result.value as { batch: HistoryImportBatch }).batch }
    : importFailure(result.error);
}

export async function listHistoryImportBatches(
  client: ApiClient = apiClient,
): Promise<ImportResult<HistoryImportBatch[]>> {
  const result = await client.request({
    method: "GET",
    path: "/v1/history-imports",
    schema: historyImportBatchListResponseSchema,
  });
  return result.ok
    ? {
        ok: true,
        value: (result.value as { batches: HistoryImportBatch[] }).batches,
      }
    : importFailure(result.error);
}

export async function removeHistoryImportBatch(
  id: string,
  client: ApiClient = apiClient,
): Promise<ImportResult<HistoryImportRemovedResponse>> {
  const result = await client.request({
    method: "DELETE",
    path: `/v1/history-imports/${encodeURIComponent(id)}`,
    schema: historyImportRemovedResponseSchema,
  });
  return result.ok
    ? { ok: true, value: result.value as HistoryImportRemovedResponse }
    : importFailure(result.error);
}
