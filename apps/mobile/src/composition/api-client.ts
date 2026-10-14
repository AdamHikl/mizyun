import {
  DisabledApiClient,
  HttpApiClient,
  type ApiClient,
  type ApiConfigurationStatus,
  type RequestOptions,
} from "@mizyun/api-client";
import type { AuthClient, AuthSession } from "@mizyun/identity";

import { authClient } from "./auth-client";
import { mobileConfigResult } from "./mobile-config";
import { CommunityReadCache } from "@/features/community/state/read-cache";
import { SessionReadCache } from "./session-read-cache";
import { createPersonalReadStorage } from "@/features/offline-cache/personal-read-storage";

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
export const sessionReadCache = new SessionReadCache(
  selectApiClient(
    configResult.ok ? configResult.value.apiUrl : null,
    authClient,
  ),
  () => authClient.getSession(),
  () => Date.now(),
  // Construct the encrypted adapter only when a read/write actually needs it.
  // Composition imports remain safe before native storage initialization.
  {
    load: (userId) => createPersonalReadStorage().load(userId),
    save: (userId, records) =>
      createPersonalReadStorage().save(userId, records),
    purge: (userId) => createPersonalReadStorage().purge(userId),
    generation: (userId) => createPersonalReadStorage().generation!(userId),
  },
);
export const invalidateSessionReads = (): void => sessionReadCache.clear();
export const getSessionReadVersion = (): string => sessionReadCache.version();
export const peekSessionRead = <T>(
  options: RequestOptions,
  session: AuthSession | null,
) => sessionReadCache.peek<T>(options, session);
export const communityReadCache = new CommunityReadCache(sessionReadCache, () =>
  authClient.getSession(),
);
export const apiClient: ApiClient = communityReadCache;

export { apiConfiguration };
