import { describe, expect, it, vi } from "vitest";

import {
  isThemePreference,
  loadThemePreference,
  resolveColorScheme,
  saveThemePreference,
  THEME_PREFERENCE_STORAGE_KEY,
  type ThemeStore,
} from "./theme-preference";

describe("theme-preference", () => {
  describe("isThemePreference", () => {
    it("recognizes valid theme preferences", () => {
      expect(isThemePreference("auto")).toBe(true);
      expect(isThemePreference("light")).toBe(true);
      expect(isThemePreference("dark")).toBe(true);
    });

    it("rejects invalid theme preferences", () => {
      expect(isThemePreference("system")).toBe(false);
      expect(isThemePreference("solarized")).toBe(false);
      expect(isThemePreference("")).toBe(false);
      expect(isThemePreference(null)).toBe(false);
      expect(isThemePreference(undefined)).toBe(false);
      expect(isThemePreference(123)).toBe(false);
      expect(isThemePreference({})).toBe(false);
    });
  });

  describe("loadThemePreference", () => {
    it("returns 'auto' when storage is empty", async () => {
      const store: ThemeStore = {
        getItemAsync: vi.fn().mockResolvedValue(null),
        setItemAsync: vi.fn(),
      };

      const result = await loadThemePreference(store);
      expect(result).toBe("auto");
      expect(store.getItemAsync).toHaveBeenCalledWith(
        THEME_PREFERENCE_STORAGE_KEY,
      );
    });

    it("returns stored preference when valid", async () => {
      const storeLight: ThemeStore = {
        getItemAsync: vi.fn().mockResolvedValue("light"),
        setItemAsync: vi.fn(),
      };
      expect(await loadThemePreference(storeLight)).toBe("light");

      const storeDark: ThemeStore = {
        getItemAsync: vi.fn().mockResolvedValue("dark"),
        setItemAsync: vi.fn(),
      };
      expect(await loadThemePreference(storeDark)).toBe("dark");

      const storeAuto: ThemeStore = {
        getItemAsync: vi.fn().mockResolvedValue("auto"),
        setItemAsync: vi.fn(),
      };
      expect(await loadThemePreference(storeAuto)).toBe("auto");
    });

    it("falls back to 'auto' when stored value is invalid", async () => {
      const store: ThemeStore = {
        getItemAsync: vi.fn().mockResolvedValue("invalid-preference"),
        setItemAsync: vi.fn(),
      };

      const result = await loadThemePreference(store);
      expect(result).toBe("auto");
    });

    it("falls back to 'auto' on storage read error", async () => {
      const store: ThemeStore = {
        getItemAsync: vi
          .fn()
          .mockRejectedValue(new Error("Storage unavailable")),
        setItemAsync: vi.fn(),
      };

      const result = await loadThemePreference(store);
      expect(result).toBe("auto");
    });
  });

  describe("saveThemePreference", () => {
    it("persists preference to store", async () => {
      const setItemAsync = vi.fn().mockResolvedValue(undefined);
      const store: ThemeStore = {
        getItemAsync: vi.fn(),
        setItemAsync,
      };

      const ok = await saveThemePreference("dark", store);
      expect(ok).toBe(true);
      expect(setItemAsync).toHaveBeenCalledWith(
        THEME_PREFERENCE_STORAGE_KEY,
        "dark",
      );
    });

    it("returns false on store write error without throwing", async () => {
      const store: ThemeStore = {
        getItemAsync: vi.fn(),
        setItemAsync: vi.fn().mockRejectedValue(new Error("Disk full")),
      };

      const ok = await saveThemePreference("light", store);
      expect(ok).toBe(false);
    });
  });

  describe("resolveColorScheme", () => {
    it("returns light when preference is light regardless of system scheme", () => {
      expect(resolveColorScheme("light", "dark")).toBe("light");
      expect(resolveColorScheme("light", "light")).toBe("light");
      expect(resolveColorScheme("light", null)).toBe("light");
      expect(resolveColorScheme("light", undefined)).toBe("light");
    });

    it("returns dark when preference is dark regardless of system scheme", () => {
      expect(resolveColorScheme("dark", "light")).toBe("dark");
      expect(resolveColorScheme("dark", "dark")).toBe("dark");
      expect(resolveColorScheme("dark", null)).toBe("dark");
      expect(resolveColorScheme("dark", undefined)).toBe("dark");
    });

    it("follows system scheme when preference is auto", () => {
      expect(resolveColorScheme("auto", "dark")).toBe("dark");
      expect(resolveColorScheme("auto", "light")).toBe("light");
      expect(resolveColorScheme("auto", null)).toBe("light");
      expect(resolveColorScheme("auto", undefined)).toBe("light");
    });
  });
});
