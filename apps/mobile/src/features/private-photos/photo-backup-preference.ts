import { useEffect, useState } from "react";
import * as SecureStore from "expo-secure-store";

/**
 * "Back up photos" (ADR-0079): off unless the account turned it on on this
 * device. Off means new meal and boulder photos stay only on the phone.
 */
export interface PhotoBackupStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<unknown>;
}

export const photoBackupKeyFor = (userId: string): string =>
  `mizyun.photo-backup.${userId}`;

const cache = new Map<string, boolean>();
const listeners = new Set<() => void>();

export const loadPhotoBackupEnabled = async (
  userId: string,
  store: PhotoBackupStore = SecureStore,
): Promise<boolean> => {
  const cached = cache.get(userId);
  if (cached !== undefined) return cached;
  try {
    const enabled =
      (await store.getItemAsync(photoBackupKeyFor(userId))) === "on";
    cache.set(userId, enabled);
    return enabled;
  } catch {
    // An unreadable preference must never upload private photos.
    return false;
  }
};

export const savePhotoBackupEnabled = async (
  userId: string,
  enabled: boolean,
  store: PhotoBackupStore = SecureStore,
): Promise<boolean> => {
  try {
    await store.setItemAsync(photoBackupKeyFor(userId), enabled ? "on" : "off");
    cache.set(userId, enabled);
    for (const listener of listeners) listener();
    return true;
  } catch {
    return false;
  }
};

/** The stored value for this account, or null while it loads. */
export const usePhotoBackupEnabled = (
  userId: string | null,
): boolean | null => {
  const [state, setState] = useState<{
    userId: string | null;
    enabled: boolean;
  } | null>(null);
  useEffect(() => {
    if (!userId) return;
    let active = true;
    const read = () =>
      void loadPhotoBackupEnabled(userId).then((enabled) => {
        if (active) setState({ userId, enabled });
      });
    read();
    listeners.add(read);
    return () => {
      active = false;
      listeners.delete(read);
    };
  }, [userId]);
  return state && state.userId === userId ? state.enabled : null;
};

/** Test-only reset of the in-memory cache. */
export const resetPhotoBackupPreferenceForTests = () => {
  cache.clear();
  listeners.clear();
};
