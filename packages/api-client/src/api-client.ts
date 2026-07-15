import type { Result } from "@mizyun/core";

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
   * Provider-neutral status of this client. Mirrors the shape of
   * `AuthConfigurationStatus` so the mobile composition root can render
   * the same disabled-state UI for both clients.
   */
  status(): ApiConfigurationStatus;
}
