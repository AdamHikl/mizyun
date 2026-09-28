import * as SecureStore from "expo-secure-store";

export type ThemePreference = "auto" | "light" | "dark";

export interface ThemeStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<unknown>;
  deleteItemAsync?(key: string): Promise<unknown>;
}

export const THEME_PREFERENCE_STORAGE_KEY = "mizyun.theme-preference";

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "auto" || value === "light" || value === "dark";
}

export async function loadThemePreference(
  store: ThemeStore = SecureStore,
): Promise<ThemePreference> {
  try {
    const raw = await store.getItemAsync(THEME_PREFERENCE_STORAGE_KEY);
    if (isThemePreference(raw)) {
      return raw;
    }
    return "auto";
  } catch {
    return "auto";
  }
}

export async function saveThemePreference(
  preference: ThemePreference,
  store: ThemeStore = SecureStore,
): Promise<boolean> {
  try {
    await store.setItemAsync(THEME_PREFERENCE_STORAGE_KEY, preference);
    return true;
  } catch {
    return false;
  }
}

export function resolveColorScheme(
  preference: ThemePreference,
  systemScheme: "light" | "dark" | "unspecified" | null | undefined,
): "light" | "dark" {
  if (preference === "light") return "light";
  if (preference === "dark") return "dark";
  return systemScheme === "dark" ? "dark" : "light";
}
