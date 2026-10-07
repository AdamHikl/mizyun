import type { ApiClient, ApiError, RequestOptions } from "@mizyun/api-client";

import type { Result } from "@mizyun/core";

/** Bind every community request to the account that displayed its UI intent. */
export function scopeCommunityClient(
  client: ApiClient,
  expectedUserId: string | null | undefined,
  isCurrent: () => boolean,
): ApiClient {
  return {
    status: () => client.status(),
    async request<T>(options: RequestOptions): Promise<Result<T, ApiError>> {
      if (expectedUserId === null) {
        return { ok: false, error: { kind: "no_session" } };
      }
      if (!isCurrent())
        return { ok: false, error: { kind: "context_changed" } };
      const result = await client.request<T>({
        ...options,
        expectedUserId,
        isCurrent: () => isCurrent() && (options.isCurrent?.() ?? true),
      });
      if (!isCurrent())
        return {
          ok: false,
          error: result.ok
            ? { kind: "context_changed" }
            : { kind: "context_changed", cause: result.error },
        };
      return result;
    },
  };
}
