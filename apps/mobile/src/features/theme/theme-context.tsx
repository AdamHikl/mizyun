import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Appearance, useColorScheme as useRNColorScheme } from "react-native";
import {
  loadThemePreference,
  resolveColorScheme,
  saveThemePreference,
  type ThemePreference,
  type ThemeStore,
} from "./theme-preference";

export type { ThemePreference } from "./theme-preference";

export interface ThemePreferenceContextValue {
  readonly preference: ThemePreference;
  readonly resolvedScheme: "light" | "dark";
  readonly setPreference: (preference: ThemePreference) => Promise<boolean>;
  readonly isReady: boolean;
}

export const ThemePreferenceContext =
  createContext<ThemePreferenceContextValue | null>(null);

export interface ThemePreferenceProviderProps {
  readonly children: React.ReactNode;
  readonly store?: ThemeStore;
  readonly initialPreference?: ThemePreference;
}

export function ThemePreferenceProvider({
  children,
  store,
  initialPreference,
}: ThemePreferenceProviderProps) {
  const [preference, setPreferenceState] = useState<ThemePreference>(
    initialPreference ?? "auto",
  );
  const [isReady, setIsReady] = useState<boolean>(
    initialPreference !== undefined,
  );
  const systemScheme = useRNColorScheme();

  useEffect(() => {
    let active = true;
    void loadThemePreference(store).then((loaded) => {
      if (active) {
        setPreferenceState(loaded);
        setIsReady(true);
        try {
          Appearance.setColorScheme(loaded === "auto" ? "unspecified" : loaded);
        } catch {
          // Native Appearance synchronization is best effort
        }
      }
    });
    return () => {
      active = false;
    };
  }, [store]);

  const setPreference = useCallback(
    async (nextPref: ThemePreference) => {
      setPreferenceState(nextPref);
      try {
        Appearance.setColorScheme(
          nextPref === "auto" ? "unspecified" : nextPref,
        );
      } catch {
        // Native Appearance synchronization is best effort
      }
      return await saveThemePreference(nextPref, store);
    },
    [store],
  );

  const resolvedScheme = useMemo(
    () => resolveColorScheme(preference, systemScheme),
    [preference, systemScheme],
  );

  const contextValue = useMemo<ThemePreferenceContextValue>(
    () => ({
      preference,
      resolvedScheme,
      setPreference,
      isReady,
    }),
    [preference, resolvedScheme, setPreference, isReady],
  );

  return (
    <ThemePreferenceContext.Provider value={contextValue}>
      {children}
    </ThemePreferenceContext.Provider>
  );
}

export function useThemePreference(): ThemePreferenceContextValue {
  const context = useContext(ThemePreferenceContext);
  const systemScheme = useRNColorScheme();
  if (!context) {
    return {
      preference: "auto",
      resolvedScheme: systemScheme === "dark" ? "dark" : "light",
      setPreference: async () => false,
      isReady: true,
    };
  }
  return context;
}
