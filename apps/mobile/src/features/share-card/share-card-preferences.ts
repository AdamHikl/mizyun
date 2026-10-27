import * as SecureStore from "expo-secure-store";
import { shareCardGymName } from "@mizyun/core";

/** Per-user, on-device only. The gym name is stored only when asked to. */
export interface ShareCardPreferences {
  readonly rememberGymName: boolean;
  readonly gymName: string | null;
  readonly scheme: "light" | "dark" | null;
}

export const DEFAULT_SHARE_CARD_PREFERENCES: ShareCardPreferences = {
  rememberGymName: false,
  gymName: null,
  scheme: null,
};

export interface ShareCardPreferencesStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<unknown>;
}

export const shareCardPreferencesKey = (userId: string): string =>
  `mizyun.share-card.${userId}`;

export async function loadShareCardPreferences(
  userId: string,
  store: ShareCardPreferencesStore = SecureStore,
): Promise<ShareCardPreferences> {
  try {
    const raw = await store.getItemAsync(shareCardPreferencesKey(userId));
    if (raw === null) return DEFAULT_SHARE_CARD_PREFERENCES;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null)
      return DEFAULT_SHARE_CARD_PREFERENCES;
    const rec = parsed as Record<string, unknown>;
    const remember = rec.rememberGymName === true;
    return {
      rememberGymName: remember,
      gymName:
        remember && typeof rec.gymName === "string"
          ? shareCardGymName(rec.gymName)
          : null,
      scheme:
        rec.scheme === "light" || rec.scheme === "dark" ? rec.scheme : null,
    };
  } catch {
    return DEFAULT_SHARE_CARD_PREFERENCES;
  }
}

/** Best effort: a failed write only means the field starts empty next time. */
export async function saveShareCardPreferences(
  userId: string,
  preferences: ShareCardPreferences,
  store: ShareCardPreferencesStore = SecureStore,
): Promise<void> {
  const value: ShareCardPreferences = {
    rememberGymName: preferences.rememberGymName,
    gymName: preferences.rememberGymName
      ? shareCardGymName(preferences.gymName)
      : null,
    scheme: preferences.scheme,
  };
  try {
    await store.setItemAsync(
      shareCardPreferencesKey(userId),
      JSON.stringify(value),
    );
  } catch {
    // Ignored; see above.
  }
}
