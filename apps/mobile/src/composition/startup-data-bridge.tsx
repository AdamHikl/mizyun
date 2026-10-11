import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import * as Network from "expo-network";
import { useAuth } from "@/features/auth/auth-context";
import { apiClient, apiConfiguration, sessionReadCache } from "./api-client";
import { authClient } from "./auth-client";
import { preloadAppData } from "./startup-data";

export function StartupDataBridge() {
  const { session, profile } = useAuth();
  const birthYear = useRef(profile?.birthYear);
  birthYear.current = profile?.birthYear;
  const warmedBirthYear = useRef<number | null | undefined>(undefined);
  const warmCurrent = useRef<(() => void) | null>(null);
  useEffect(() => {
    let active = true;
    let generation = 0;
    let foreground = AppState.currentState === "active";
    const warm = () => {
      const run = generation;
      if (session && apiConfiguration.configured && foreground) {
        warmedBirthYear.current = birthYear.current;
        void preloadAppData(
          apiClient,
          session,
          () =>
            active && generation === run && AppState.currentState === "active",
          new Date(),
          birthYear.current,
        );
      }
    };
    warmCurrent.current = warm;
    sessionReadCache.setForeground(foreground);
    warm();
    const unsubscribe = authClient.subscribe((next) => {
      if (
        next?.user.id === session?.user.id &&
        next?.accessToken === session?.accessToken
      )
        return;
      generation++;
      sessionReadCache.clear();
    });
    const subscription = AppState.addEventListener("change", (state) => {
      const nextForeground = state === "active";
      if (nextForeground === foreground) return;
      foreground = nextForeground;
      generation++;
      sessionReadCache.setForeground(foreground);
      if (foreground) warm();
    });
    let unavailable = false;
    const network = Network.addNetworkStateListener((state) => {
      const wasUnavailable = unavailable;
      unavailable =
        state.isConnected === false || state.isInternetReachable === false;
      if (
        wasUnavailable &&
        !unavailable &&
        state.isConnected === true &&
        foreground
      )
        warm();
    });
    return () => {
      active = false;
      generation++;
      warmCurrent.current = null;
      unsubscribe();
      subscription.remove();
      network.remove();
      sessionReadCache.clear();
    };
  }, [session?.user.id, session?.accessToken]);
  // A profile arriving after auth enables eligible Community warming, without
  // retiring the personal reads that are already loading for the same session.
  useEffect(() => {
    if (warmedBirthYear.current !== profile?.birthYear) warmCurrent.current?.();
  }, [session?.user.id, session?.accessToken, profile?.birthYear]);
  return null;
}
