import { useContext } from "react";
import { useColorScheme as useRNColorScheme } from "react-native";

import { ThemePreferenceContext } from "@/features/theme/theme-context";

export function useColorScheme(): "light" | "dark" {
  const context = useContext(ThemePreferenceContext);
  const system = useRNColorScheme();
  if (context) {
    return context.resolvedScheme;
  }
  return system === "dark" ? "dark" : "light";
}
