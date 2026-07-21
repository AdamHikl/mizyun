import {
  DisabledApiClient,
  HttpApiClient,
  type ApiClient,
  type ApiConfigurationStatus,
} from "@mizyun/api-client";
import type { AuthClient } from "@mizyun/identity";

import { authClient } from "./auth-client";
import { mobileConfigResult } from "./mobile-config";

/**
 * Pure factory: pick the right `ApiClient` from the validated mobile
 * config. Exported so tests can exercise the two branches without pulling
 * in `react-native` via the `auth-client` import chain.
 *
 * `@mizyun/identity`'s `AuthClient` is type-only here so the factory does
 * not transitively require RN modules at test time. The runtime
 * composition root passes the concrete `authClient` after lazy-importing
 * the adapter.
 */
export const selectApiClient = (
  apiUrl: string | null,
  auth: AuthClient,
): ApiClient =>
  apiUrl
    ? new HttpApiClient({
        baseUrl: apiUrl,
        authClient: auth,
      })
    : new DisabledApiClient();

const configResult = mobileConfigResult;
const apiConfiguration: ApiConfigurationStatus =
  configResult.ok && configResult.value.apiUrl
    ? { configured: true, baseUrl: configResult.value.apiUrl }
    : // When the loader failed or `apiUrl` is null, surface the disabled
      // status with a reason. The exact reason string comes from the
      // `DisabledApiClient` itself so the UI stays in sync.
      { configured: false, reason: "" };

/**
 * Concrete `ApiClient` selected for this composition. The mobile loader
 * guarantees that whenever `apiConfiguration.configured === true`,
 * `apiUrl` is a non-empty string. The auth client is always provided so
 * the runtime flow remains uniform — when the auth client is
 * `DisabledAuthClient`, requests surface as `kind: "no_session"`.
 */
export const apiClient: ApiClient = selectApiClient(
  configResult.ok ? configResult.value.apiUrl : null,
  authClient,
);

export { apiConfiguration };
