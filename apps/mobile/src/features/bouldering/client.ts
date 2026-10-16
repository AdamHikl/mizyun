import type { ApiClient, ApiError } from "@mizyun/api-client";
import {
  boulderActiveSessionResponseSchema,
  boulderAscentCreateSchema,
  boulderAscentResponseSchema,
  boulderAscentUpdateSchema,
  boulderFinishResponseSchema,
  boulderProgressResponseSchema,
  boulderRemovedResponseSchema,
  boulderSessionFinishSchema,
  boulderSessionListResponseSchema,
  boulderSessionResponseSchema,
  boulderSessionStartSchema,
  type BoulderActiveSessionResponse,
  type BoulderAscentCreate,
  type BoulderAscentRecord,
  type BoulderAscentResponse,
  type BoulderAscentUpdate,
  type BoulderFinishResponse,
  type BoulderProgressResponse,
  type BoulderProgressWindowValue,
  type BoulderSessionFinish,
  type BoulderSessionListResponse,
  type BoulderSessionResponse,
  type BoulderSessionStart,
} from "@mizyun/contracts";
import { apiClient } from "@/composition/api-client";

/** Stable client-side reading of every bouldering route failure. */
export type BoulderFailureKind =
  | "offline"
  | "disabled"
  | "conflict"
  | "removed"
  | "active_session"
  | "not_found"
  | "invalid"
  | "signed_out"
  | "context_changed"
  | "unavailable";

export interface BoulderFailure {
  readonly kind: BoulderFailureKind;
  readonly message: string;
}

export type BoulderResultOf<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: BoulderFailure };

const MESSAGES: Record<BoulderFailureKind, string> = {
  offline:
    "You're offline. Anything saved on this device will sync when you're back online.",
  disabled: "Bouldering is not available yet.",
  conflict: "This changed somewhere else. Showing the latest version.",
  removed: "This boulder was removed, so the waiting change was discarded.",
  active_session: "You already have a bouldering session in progress.",
  not_found: "This bouldering session is no longer available.",
  invalid: "Check the boulder details and try again.",
  signed_out: "Your session expired. Sign in and try again.",
  context_changed: "Your account changed. Reopen bouldering.",
  unavailable: "Bouldering couldn't be reached. Try again in a moment.",
};

export const boulderFailure = (kind: BoulderFailureKind): BoulderFailure => ({
  kind,
  message: MESSAGES[kind],
});

/** Maps an API error to a bouldering failure; route codes win over statuses. */
export const toBoulderFailure = (error: ApiError): BoulderFailure => {
  switch (error.kind) {
    case "network_error":
      return boulderFailure("offline");
    case "no_session":
    case "session_expired":
      return boulderFailure("signed_out");
    case "context_changed":
      return boulderFailure("context_changed");
    case "http_error":
      if (error.code === "FEATURE_DISABLED") return boulderFailure("disabled");
      if (error.code === "BOULDER_SESSION_ACTIVE")
        return boulderFailure("active_session");
      if (error.code === "BOULDER_REMOVED" || error.status === 410)
        return boulderFailure("removed");
      if (error.status === 409) return boulderFailure("conflict");
      if (error.status === 404) return boulderFailure("not_found");
      if (error.status === 400 || error.code === "VALIDATION_ERROR")
        return boulderFailure("invalid");
      if (error.status === 401) return boulderFailure("signed_out");
      return boulderFailure("unavailable");
    default:
      return boulderFailure("unavailable");
  }
};

const done = <T>(
  result: { ok: true; value: T } | { ok: false; error: ApiError },
): BoulderResultOf<T> =>
  result.ok
    ? { ok: true, value: result.value }
    : { ok: false, error: toBoulderFailure(result.error) };

const invalid = (): BoulderResultOf<never> => ({
  ok: false,
  error: boulderFailure("invalid"),
});

const id = (value: string) => encodeURIComponent(value);

export async function startBoulderSession(
  body: BoulderSessionStart,
  client: ApiClient = apiClient,
): Promise<BoulderResultOf<BoulderSessionResponse>> {
  const parsed = boulderSessionStartSchema.safeParse(body);
  if (!parsed.success) return invalid();
  return done(
    await client.request<BoulderSessionResponse>({
      method: "POST",
      path: "/v1/bouldering/sessions",
      body: parsed.data,
      schema: boulderSessionResponseSchema,
    }),
  );
}

export async function getActiveBoulderSession(
  client: ApiClient = apiClient,
): Promise<BoulderResultOf<BoulderActiveSessionResponse>> {
  return done(
    await client.request<BoulderActiveSessionResponse>({
      method: "GET",
      path: "/v1/bouldering/sessions/active",
      schema: boulderActiveSessionResponseSchema,
    }),
  );
}

export async function getBoulderSession(
  sessionId: string,
  client: ApiClient = apiClient,
): Promise<BoulderResultOf<BoulderSessionResponse>> {
  return done(
    await client.request<BoulderSessionResponse>({
      method: "GET",
      path: `/v1/bouldering/sessions/${id(sessionId)}`,
      schema: boulderSessionResponseSchema,
    }),
  );
}

export async function listBoulderSessions(
  client: ApiClient = apiClient,
  options: { readonly cursor?: string; readonly limit?: number } = {},
): Promise<BoulderResultOf<BoulderSessionListResponse>> {
  const query = new URLSearchParams();
  if (options.limit !== undefined) query.set("limit", String(options.limit));
  if (options.cursor) query.set("cursor", options.cursor);
  const encoded = query.toString();
  const suffix = encoded ? `?${encoded}` : "";
  return done(
    await client.request<BoulderSessionListResponse>({
      method: "GET",
      path: `/v1/bouldering/sessions${suffix}`,
      schema: boulderSessionListResponseSchema,
    }),
  );
}

export async function finishBoulderSession(
  sessionId: string,
  body: BoulderSessionFinish,
  client: ApiClient = apiClient,
): Promise<BoulderResultOf<BoulderFinishResponse>> {
  const parsed = boulderSessionFinishSchema.safeParse(body);
  if (!parsed.success) return invalid();
  return done(
    await client.request<BoulderFinishResponse>({
      method: "POST",
      path: `/v1/bouldering/sessions/${id(sessionId)}/finish`,
      body: parsed.data,
      schema: boulderFinishResponseSchema,
    }),
  );
}

/** Deletes (discards) a session and its boulders. Idempotent on the server. */
export async function removeBoulderSession(
  sessionId: string,
  client: ApiClient = apiClient,
): Promise<BoulderResultOf<true>> {
  const result = await client.request<{ removed: true }>({
    method: "DELETE",
    path: `/v1/bouldering/sessions/${id(sessionId)}`,
    schema: boulderRemovedResponseSchema,
  });
  return result.ok ? { ok: true, value: true } : done(result);
}

export async function createBoulderAscent(
  sessionId: string,
  body: BoulderAscentCreate,
  client: ApiClient = apiClient,
): Promise<BoulderResultOf<BoulderAscentRecord>> {
  const parsed = boulderAscentCreateSchema.safeParse(body);
  if (!parsed.success) return invalid();
  const result = await client.request<BoulderAscentResponse>({
    method: "POST",
    path: `/v1/bouldering/sessions/${id(sessionId)}/ascents`,
    body: parsed.data,
    schema: boulderAscentResponseSchema,
  });
  return result.ok ? { ok: true, value: result.value.ascent } : done(result);
}

export async function updateBoulderAscent(
  ascentId: string,
  body: BoulderAscentUpdate,
  client: ApiClient = apiClient,
): Promise<BoulderResultOf<BoulderAscentRecord>> {
  const parsed = boulderAscentUpdateSchema.safeParse(body);
  if (!parsed.success) return invalid();
  const result = await client.request<BoulderAscentResponse>({
    method: "PUT",
    path: `/v1/bouldering/ascents/${id(ascentId)}`,
    body: parsed.data,
    schema: boulderAscentResponseSchema,
  });
  return result.ok ? { ok: true, value: result.value.ascent } : done(result);
}

/** Idempotent: deleting an already removed boulder also answers `removed`. */
export async function removeBoulderAscent(
  ascentId: string,
  client: ApiClient = apiClient,
): Promise<BoulderResultOf<true>> {
  const result = await client.request<{ removed: true }>({
    method: "DELETE",
    path: `/v1/bouldering/ascents/${id(ascentId)}`,
    schema: boulderRemovedResponseSchema,
  });
  return result.ok ? { ok: true, value: true } : done(result);
}

export async function getBoulderProgress(
  window: BoulderProgressWindowValue,
  client: ApiClient = apiClient,
): Promise<BoulderResultOf<BoulderProgressResponse>> {
  return done(
    await client.request<BoulderProgressResponse>({
      method: "GET",
      path: `/v1/bouldering/progress?window=${window}`,
      schema: boulderProgressResponseSchema,
    }),
  );
}
