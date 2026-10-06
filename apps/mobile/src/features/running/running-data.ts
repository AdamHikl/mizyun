import type { ApiClient, ApiError } from "@mizyun/api-client";
import {
  runCreateSchema,
  runUpdateSchema,
  runResponseSchema,
  runListResponseSchema,
  runRemovedResponseSchema,
  type RunCreate,
  type RunUpdate,
  type RunRecord,
  type RunResponse,
  type RunListResponse,
} from "@mizyun/contracts";
import { apiClient } from "@/composition/api-client";
export type RunResult<T> =
  { ok: true; value: T } | { ok: false; message: string; conflict?: boolean };
const failure = (error: ApiError): RunResult<never> => ({
  ok: false,
  conflict: error.kind === "http_error" && error.status === 409,
  message:
    error.kind === "network_error"
      ? "You're offline. Your pending run is kept on this device. Retry when online."
      : error.kind === "http_error" && error.status === 409
        ? "This run changed on another device. Review the current run; your draft is kept."
        : error.kind === "http_error" && error.status === 404
          ? "This run is no longer available."
          : "The run could not be saved. Your draft is kept. Try again.",
});
export async function createRun(
  body: RunCreate,
  client: ApiClient = apiClient,
): Promise<RunResult<RunRecord>> {
  const parsed = runCreateSchema.safeParse(body);
  if (!parsed.success)
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Check your run details.",
    };
  const result = await client.request<RunResponse>({
    method: "POST",
    path: "/v1/runs",
    body: parsed.data,
    schema: runResponseSchema,
  });
  return result.ok
    ? { ok: true, value: result.value.run }
    : failure(result.error);
}
export async function updateRun(
  id: string,
  body: RunUpdate,
  client: ApiClient = apiClient,
): Promise<RunResult<RunRecord>> {
  const parsed = runUpdateSchema.safeParse(body);
  if (!parsed.success)
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Check your run details.",
    };
  const result = await client.request<RunResponse>({
    method: "PUT",
    path: `/v1/runs/${encodeURIComponent(id)}`,
    body: parsed.data,
    schema: runResponseSchema,
  });
  return result.ok
    ? { ok: true, value: result.value.run }
    : failure(result.error);
}
export async function getRun(
  id: string,
  client: ApiClient = apiClient,
): Promise<RunResult<RunRecord>> {
  const result = await client.request<RunResponse>({
    method: "GET",
    path: `/v1/runs/${encodeURIComponent(id)}`,
    schema: runResponseSchema,
  });
  return result.ok
    ? { ok: true, value: result.value.run }
    : failure(result.error);
}
export async function listRuns(
  client: ApiClient = apiClient,
  options: { cursor?: string; from?: string; to?: string } = {},
): Promise<RunResult<{ runs: RunRecord[]; nextCursor: string | null }>> {
  const query = new URLSearchParams({ limit: "50" });
  if (options.cursor) query.set("cursor", options.cursor);
  if (options.from) query.set("from", options.from);
  if (options.to) query.set("to", options.to);
  const result = await client.request<RunListResponse>({
    method: "GET",
    path: `/v1/runs?${query}`,
    schema: runListResponseSchema,
  });
  return result.ok ? { ok: true, value: result.value } : failure(result.error);
}
export async function removeRun(
  id: string,
  operationId: string,
  client: ApiClient = apiClient,
): Promise<RunResult<true>> {
  const result = await client.request<{ removed: true }>({
    method: "DELETE",
    path: `/v1/runs/${encodeURIComponent(id)}`,
    headers: { "Idempotency-Key": operationId },
    schema: runRemovedResponseSchema,
  });
  return result.ok ? { ok: true, value: true } : failure(result.error);
}
export async function cancelRunOperation(
  operationId: string,
  client: ApiClient = apiClient,
): Promise<RunResult<true>> {
  const result = await client.request<{ removed: true }>({
    method: "DELETE",
    path: `/v1/runs/operations/${encodeURIComponent(operationId)}`,
    schema: runRemovedResponseSchema,
  });
  return result.ok ? { ok: true, value: true } : failure(result.error);
}
