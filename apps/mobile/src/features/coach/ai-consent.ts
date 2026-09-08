import * as SecureStore from "expo-secure-store";

/**
 * Storage interface matching expo-secure-store methods.
 */
interface SecureStoreClient {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<unknown>;
  deleteItemAsync(key: string): Promise<unknown>;
}

const consentKey = (userId: string): string => `mizyun.ai-consent.${userId}`;

export interface AiConsentStatus {
  readonly granted: boolean;
  readonly confirmedAdult: boolean;
  readonly consentedAt: string | null;
}

/**
 * Loads the user's recorded third-party AI sharing and adult eligibility consent status.
 * (REL-AUD-005 / Finding R5: explicit disclosure, adult eligibility, and permission).
 */
export const loadAiConsent = async (
  userId: string,
  store: SecureStoreClient = SecureStore,
): Promise<AiConsentStatus> => {
  try {
    const raw = await store.getItemAsync(consentKey(userId));
    if (!raw) {
      return { granted: false, confirmedAdult: false, consentedAt: null };
    }
    const parsed = JSON.parse(raw) as Partial<AiConsentStatus>;
    return {
      granted: parsed.granted === true,
      confirmedAdult: parsed.confirmedAdult === true,
      consentedAt:
        typeof parsed.consentedAt === "string" ? parsed.consentedAt : null,
    };
  } catch {
    return { granted: false, confirmedAdult: false, consentedAt: null };
  }
};

/**
 * Persists the user's explicit consent to third-party AI processing (Google Gemini).
 */
export const saveAiConsent = async (
  userId: string,
  granted: boolean,
  confirmedAdult: boolean,
  store: SecureStoreClient = SecureStore,
): Promise<boolean> => {
  try {
    const status: AiConsentStatus = {
      granted,
      confirmedAdult,
      consentedAt: granted ? new Date().toISOString() : null,
    };
    await store.setItemAsync(consentKey(userId), JSON.stringify(status));
    return true;
  } catch {
    return false;
  }
};

/**
 * Revokes AI consent and clears stored consent status.
 */
export const revokeAiConsent = async (
  userId: string,
  store: SecureStoreClient = SecureStore,
): Promise<boolean> => {
  try {
    await store.deleteItemAsync(consentKey(userId));
    return true;
  } catch {
    return false;
  }
};
