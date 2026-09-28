import { useContext, useEffect, useState } from "react";
import { useColorScheme as useRNColorScheme } from "react-native";

import { ThemePreferenceContext } from "@/features/theme/theme-context";

/**
 * To support static rendering, this value needs to be re-calculated on the client side for web
 */
export function useColorScheme(): "light" | "dark" {
  const [hasHydrated, setHasHydrated] = useState(false);
  const context = useContext(ThemePreferenceContext);

  useEffect(() => {
    setHasHydrated(true);
  }, []);

  const system = useRNColorScheme();
  if (context) {
    return context.resolvedScheme;
  }

  if (hasHydrated) {
    return system === "dark" ? "dark" : "light";
  }

  return "light";
}
