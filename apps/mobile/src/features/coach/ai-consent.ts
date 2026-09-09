import * as SecureStore from "expo-secure-store";
import type { ApiClient } from "@mizyun/api-client";
import {
  CURRENT_AI_CONSENT_VERSION,
  aiConsentResponseSchema,
  type AiConsentResponse,
} from "@mizyun/contracts";

/**
 * Storage interface matching expo-secure-store methods.
 */
export interface SecureStoreClient {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<unknown>;
  deleteItemAsync(key: string): Promise<unknown>;
}

const consentKey = (userId: string): string => `mizyun.ai-consent.${userId}`;

export interface AiConsentStatus {
  readonly granted: boolean;
  readonly confirmedAdult: boolean;
  readonly consentedAt: string | null;
  readonly consentVersion?: string;
}

/**
 * Loads the user's recorded third-party AI sharing and adult eligibility consent status.
 * (REL-AUD-005 / Finding R5: explicit disclosure, adult eligibility, and permission).
 * Syncs with server /v1/account/ai-consent when apiClient is provided.
 */
export const loadAiConsent = async (
  userId: string,
  store: SecureStoreClient = SecureStore,
  apiClient?: ApiClient,
): Promise<AiConsentStatus> => {
  let localStatus: AiConsentStatus = {
    granted: false,
    confirmedAdult: false,
    consentedAt: null,
  };
  try {
    const raw = await store.getItemAsync(consentKey(userId));
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AiConsentStatus>;
      localStatus = {
        granted: parsed.granted === true,
        confirmedAdult: parsed.confirmedAdult === true,
        consentedAt:
          typeof parsed.consentedAt === "string" ? parsed.consentedAt : null,
        consentVersion:
          typeof parsed.consentVersion === "string"
            ? parsed.consentVersion
            : undefined,
      };
    }
  } catch {
    // ignore read error
  }

  if (localStatus.consentVersion !== CURRENT_AI_CONSENT_VERSION) {
    localStatus = {
      ...localStatus,
      granted: false,
    };
  }

  if (apiClient) {
    try {
      const res = await apiClient.request<AiConsentResponse>({
        method: "GET",
        path: "/v1/account/ai-consent",
        schema: aiConsentResponseSchema,
      });
      if (res.ok) {
        let remoteStatus: AiConsentStatus = {
          granted: res.value.consent.granted,
          confirmedAdult: res.value.consent.confirmedAdult,
          consentedAt: res.value.consent.consentedAt,
          consentVersion: res.value.consent.consentVersion,
        };
        if (remoteStatus.consentVersion !== CURRENT_AI_CONSENT_VERSION) {
          remoteStatus = {
            ...remoteStatus,
            granted: false,
          };
        }
        try {
          await store.setItemAsync(
            consentKey(userId),
            JSON.stringify(remoteStatus),
          );
        } catch {
          // ignore cache write error
        }
        return remoteStatus;
      }
    } catch {
      // ignore network/api error and fall back to local status
    }
  }

  return localStatus;
};

/**
 * Persists the user's explicit consent to third-party AI processing (Google Gemini).
 * Syncs with server /v1/account/ai-consent when apiClient is provided.
 */
export const saveAiConsent = async (
  userId: string,
  granted: boolean,
  confirmedAdult: boolean,
  store: SecureStoreClient = SecureStore,
  apiClient?: ApiClient,
): Promise<boolean> => {
  let consentedAt = granted ? new Date().toISOString() : null;
  if (apiClient) {
    try {
      const res = await apiClient.request<AiConsentResponse>({
        method: "PUT",
        path: "/v1/account/ai-consent",
        body: {
          granted,
          confirmedAdult,
          consentVersion: CURRENT_AI_CONSENT_VERSION,
        },
        schema: aiConsentResponseSchema,
      });
      if (!res.ok) {
        return false;
      }
      consentedAt = res.value.consent.consentedAt;
    } catch {
      return false;
    }
  }

  try {
    const status: AiConsentStatus = {
      granted,
      confirmedAdult,
      consentedAt,
      consentVersion: CURRENT_AI_CONSENT_VERSION,
    };
    await store.setItemAsync(consentKey(userId), JSON.stringify(status));
    return true;
  } catch {
    return false;
  }
};

/**
 * Revokes AI consent and clears stored consent status locally and on the server.
 */
export const revokeAiConsent = async (
  userId: string,
  store: SecureStoreClient = SecureStore,
  apiClient?: ApiClient,
): Promise<boolean> => {
  if (apiClient) {
    try {
      const res = await apiClient.request<AiConsentResponse>({
        method: "PUT",
        path: "/v1/account/ai-consent",
        body: {
          granted: false,
          confirmedAdult: false,
          consentVersion: CURRENT_AI_CONSENT_VERSION,
        },
        schema: aiConsentResponseSchema,
      });
      if (!res.ok) {
        return false;
      }
    } catch {
      return false;
    }
  }

  try {
    await store.deleteItemAsync(consentKey(userId));
    return true;
  } catch {
    return false;
  }
};
