import {
  getIngredientReviewGeneration,
  notifyRecipeConsentGrant,
  retireIngredientReviews,
} from "@/features/meal-recipes/public-data";
import { clearTailoredStretchPlan } from "@/features/evening-stretch/public-ai-cleanup";
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
const localConsentWrites = new Map<string, Promise<unknown>>();
const serializeLocalConsent = <T>(
  userId: string,
  operation: () => Promise<T>,
): Promise<T> => {
  const pending = (localConsentWrites.get(userId) ?? Promise.resolve())
    .catch(() => undefined)
    .then(operation);
  localConsentWrites.set(userId, pending);
  void pending
    .finally(() => {
      if (localConsentWrites.get(userId) === pending)
        localConsentWrites.delete(userId);
    })
    .catch(() => undefined);
  return pending;
};
const writeCurrentConsent = (
  userId: string,
  status: AiConsentStatus,
  store: SecureStoreClient,
  generation: number,
): Promise<boolean> =>
  serializeLocalConsent(userId, async () => {
    if (generation !== getIngredientReviewGeneration(userId)) return false;
    await store.setItemAsync(consentKey(userId), JSON.stringify(status));
    if (generation !== getIngredientReviewGeneration(userId)) {
      // The native write cannot be cancelled. Remove its retired result before a
      // queued revocation/deletion or a newer explicit grant can touch this key.
      await store.deleteItemAsync(consentKey(userId));
      return false;
    }
    return true;
  });

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
  const generation = getIngredientReviewGeneration(userId);
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
          await writeCurrentConsent(userId, remoteStatus, store, generation);
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

export interface SaveAiConsentResult {
  readonly ok: boolean;
  readonly error?: string;
}

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
  birthYear?: number,
): Promise<SaveAiConsentResult> => {
  const generation = getIngredientReviewGeneration(userId);
  const isCurrent = () => generation === getIngredientReviewGeneration(userId);
  const changedResult: SaveAiConsentResult = {
    ok: false,
    error: "Your session or AI consent changed. Please try again.",
  };
  let remoteGrantSaved = false;
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
          ...(birthYear !== undefined ? { birthYear } : {}),
        },
        schema: aiConsentResponseSchema,
        expectedUserId: userId,
        isCurrent,
      });
      if (!res.ok) {
        let errorMessage = "Failed to save AI consent.";
        if (res.error.kind === "http_error") {
          errorMessage = res.error.message || errorMessage;
        } else if (res.error.kind === "not_configured") {
          errorMessage = res.error.reason;
        } else if (
          res.error.kind === "no_session" ||
          res.error.kind === "session_expired"
        ) {
          errorMessage = "Your session has expired. Please sign in again.";
        } else if (res.error.kind === "network_error") {
          errorMessage =
            "Network error. Please check your internet connection.";
        }
        return {
          ok: false,
          error: errorMessage,
        };
      }
      if (!isCurrent()) return changedResult;
      consentedAt = res.value.consent.consentedAt;
      remoteGrantSaved =
        granted &&
        confirmedAdult &&
        res.value.consent.granted &&
        res.value.consent.confirmedAdult &&
        res.value.consent.consentVersion === CURRENT_AI_CONSENT_VERSION &&
        res.value.consent.revokedAt === null;
    } catch (err) {
      return {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : "Failed to connect to the server. Please check your internet connection.",
      };
    }
  }

  try {
    if (!isCurrent()) return changedResult;
    const status: AiConsentStatus = {
      granted,
      confirmedAdult,
      consentedAt,
      consentVersion: CURRENT_AI_CONSENT_VERSION,
    };
    if (!(await writeCurrentConsent(userId, status, store, generation)))
      return changedResult;
    if (!isCurrent()) return changedResult;
    if (remoteGrantSaved) notifyRecipeConsentGrant(userId);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Failed to save consent locally on device.",
    };
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
  // Abort local photo work immediately, including when remote revocation fails.
  const recipeCleanup = retireIngredientReviews(userId);
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
    await serializeLocalConsent(userId, () =>
      store.deleteItemAsync(consentKey(userId)),
    );
    // Revoked: forget today's AI-tailored stretch so Home shows Mizyun's picks.
    await clearTailoredStretchPlan(userId, store);
    return await recipeCleanup;
  } catch {
    return false;
  }
};
