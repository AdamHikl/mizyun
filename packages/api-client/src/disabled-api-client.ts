import { err, type Result } from "@mizyun/core";
import type { FoodDraftResponse } from "@mizyun/contracts";

import type { ApiClient } from "./api-client";
import type { ApiConfigurationStatus, ApiError, RequestOptions } from "./types";

const REASON = "Mizyun API base URL has not been provided.";

/**
 * Test-double / disabled `ApiClient` for when `EXPO_PUBLIC_API_URL` is
 * absent or the mobile loader rejected the snapshot. Mirrors
 * `DisabledAuthClient` so the mobile composition root can pick either
 * based purely on whether the corresponding `MobileConfig` field is set.
 *
 * Every method returns a typed `Result`; the client never throws and
 * never touches `fetch` or `authClient`.
 */
export class DisabledApiClient implements ApiClient {
  status(): ApiConfigurationStatus {
    return { configured: false, reason: REASON };
  }

  // The method is `async` to keep the interface uniform with the real
  // `HttpApiClient`, even though no I/O actually happens here.
  async request<T>(_options: RequestOptions): Promise<Result<T, ApiError>> {
    return err({ kind: "not_configured", reason: REASON });
  }

  async draftFoodEntry(): Promise<Result<FoodDraftResponse, ApiError>> {
    return err({ kind: "not_configured", reason: REASON });
  }
}
