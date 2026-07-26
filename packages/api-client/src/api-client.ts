import type { Result } from "@mizyun/core";
import type { FoodDraftResponse } from "@mizyun/contracts";

import type { ApiConfigurationStatus, ApiError, RequestOptions } from "./types";

/**
 * Provider-neutral API client interface. The composition root selects a
 * concrete implementation (`HttpApiClient` or `DisabledApiClient`); feature
 * code consumes the interface only. Replacing the transport (e.g. for a
 * web client or a different auth source) is a one-line change at the
 * composition root.
 */
export interface ApiClient {
  /**
   * Issue a request and return a typed `Result`. The body, when present,
   * is JSON-serialized; the response, when 2xx, is JSON-parsed and
   * optionally validated with the supplied Zod schema. Non-2xx responses
   * are normalized to `kind: "http_error"` (or `kind: "parse_error"` if
   * the body does not match `apiErrorSchema`).
   *
   * Never throws. `fetch` rejections surface as `kind: "network_error"`.
   */
  request<T>(options: RequestOptions): Promise<Result<T, ApiError>>;

  /**
   * VISION-001 — multipart upload of a meal photo + optional
   * `textHint` to the photo-draft endpoint. The HTTP layer is
   * JSON; the multipart boundary is built inside the concrete
   * client (see `HttpApiClient.draftFoodEntry`). Photo bytes
   * are transient — the route never persists them.
   *
   * Optional on the interface so test mocks for the (large
   * majority of) `request`-only paths don't have to implement
   * it. The real `HttpApiClient` always provides it.
   */
  draftFoodEntry?(input: {
    readonly photo: Blob;
    readonly mimeType: "image/jpeg" | "image/png" | "image/webp";
    readonly textHint?: string;
  }): Promise<Result<FoodDraftResponse, ApiError>>;

  /**
   * Provider-neutral status of this client. Mirrors the shape of
   * `AuthConfigurationStatus` so the mobile composition root can render
   * the same disabled-state UI for both clients.
   */
  status(): ApiConfigurationStatus;
}
