import type { ApiClient } from "@mizyun/api-client";
import {
  CURRENT_HEALTH_DATA_CONSENT_VERSION,
  healthDataConsentResponseSchema,
  isHealthDataConsentCurrent,
  type HealthDataConsent,
  type HealthDataConsentResponse,
} from "@mizyun/contracts";

/**
 * Health-data consent client (PRIV-01). The server record is authoritative;
 * the device keeps the last answer it saw so an offline launch does not ask
 * again. A cached grant never outlives a newer explanation version.
 */
export interface ConsentCacheStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<unknown>;
  deleteItemAsync(key: string): Promise<unknown>;
}

/**
 * `unavailable`: neither the server nor this device could say, so the app
 * offers a retry instead of a consent step it cannot save.
 */
export type HealthDataConsentStatus = "granted" | "required" | "unavailable";

export interface LoadedHealthDataConsent {
  readonly status: HealthDataConsentStatus;
  /** True when the server answered; false when the device cache was used. */
  readonly confirmedByServer: boolean;
  /** The user has previously withdrawn. */
  readonly withdrawn: boolean;
}

const cacheKey = (userId: string): string =>
  `mizyun.health-data-consent.${userId}`;

const statusOf = (consent: HealthDataConsent): LoadedHealthDataConsent => ({
  status: isHealthDataConsentCurrent(consent) ? "granted" : "required",
  confirmedByServer: true,
  withdrawn: consent.revokedAt !== null,
});

const writeCache = async (
  store: ConsentCacheStore,
  userId: string,
  consent: HealthDataConsent,
): Promise<void> => {
  try {
    await store.setItemAsync(cacheKey(userId), JSON.stringify(consent));
  } catch {
    // The server keeps the record; a cache miss only means asking again.
  }
};

/** The last answer this device saw for the user, or null. */
export const readCachedHealthDataConsent = async (
  userId: string,
  store: ConsentCacheStore,
): Promise<LoadedHealthDataConsent | null> => {
  try {
    const raw = await store.getItemAsync(cacheKey(userId));
    const parsed = raw
      ? healthDataConsentResponseSchema.shape.consent.safeParse(JSON.parse(raw))
      : null;
    return parsed?.success
      ? { ...statusOf(parsed.data), confirmedByServer: false }
      : null;
  } catch {
    return null;
  }
};

/** Asks the server; on failure falls back to this device's last answer. */
export const loadHealthDataConsent = async (
  userId: string,
  client: ApiClient,
  store: ConsentCacheStore,
  /** Checked before caching the server answer; false drops a stale read. */
  isCurrent: () => boolean = () => true,
): Promise<LoadedHealthDataConsent> => {
  const result = await client
    .request<HealthDataConsentResponse>({
      method: "GET",
      path: "/v1/account/health-data-consent",
      schema: healthDataConsentResponseSchema,
      expectedUserId: userId,
    })
    .catch(() => null);
  if (result?.ok) {
    if (isCurrent()) await writeCache(store, userId, result.value.consent);
    return statusOf(result.value.consent);
  }
  return (
    (await readCachedHealthDataConsent(userId, store)) ?? {
      status: "unavailable",
      confirmedByServer: false,
      withdrawn: false,
    }
  );
};

export type SaveHealthDataConsentResult =
  | { readonly ok: true; readonly consent: LoadedHealthDataConsent }
  | { readonly ok: false; readonly message: string };

export const saveHealthDataConsent = async (
  userId: string,
  granted: boolean,
  client: ApiClient,
  store: ConsentCacheStore,
): Promise<SaveHealthDataConsentResult> => {
  const result = await client
    .request<HealthDataConsentResponse>({
      method: "PUT",
      path: "/v1/account/health-data-consent",
      body: { granted, consentVersion: CURRENT_HEALTH_DATA_CONSENT_VERSION },
      schema: healthDataConsentResponseSchema,
      expectedUserId: userId,
    })
    .catch(() => null);
  if (result?.ok) {
    await writeCache(store, userId, result.value.consent);
    return { ok: true, consent: statusOf(result.value.consent) };
  }
  if (result && result.error.kind === "http_error" && result.error.message) {
    return { ok: false, message: result.error.message };
  }
  return {
    ok: false,
    message:
      result?.error.kind === "network_error"
        ? "You're offline. Connect to the internet and try again."
        : "Couldn't save your choice. Try again.",
  };
};

/** Removes this device's cached answer (local account-data erasure). */
export const clearHealthDataConsentCache = async (
  userId: string,
  store: ConsentCacheStore,
): Promise<void> => {
  await store.deleteItemAsync(cacheKey(userId)).catch(() => undefined);
};
