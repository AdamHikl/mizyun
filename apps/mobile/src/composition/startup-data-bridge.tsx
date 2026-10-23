import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import * as Network from "expo-network";
import { useAuth } from "@/features/auth/auth-context";
import { apiClient, apiConfiguration, sessionReadCache } from "./api-client";
import { authClient } from "./auth-client";
import { preloadAppData } from "./startup-data";

// A return to the app within this window repeats only the cached personal
// reads (usually served from memory), not the live Community and Coach checks.
const LIVE_WARM_INTERVAL_MS = 5 * 60_000;

export function StartupDataBridge() {
  const { session, profile } = useAuth();
  // The latest token for the same account; a refresh does not restart warming.
  const currentSession = useRef(session);
  currentSession.current = session;
  const birthYear = useRef(profile?.birthYear);
  birthYear.current = profile?.birthYear;
  const warmedBirthYear = useRef<number | null | undefined>(undefined);
  const warmCurrent = useRef<(() => void) | null>(null);
  useEffect(() => {
    let active = true;
    let generation = 0;
    let foreground = AppState.currentState === "active";
    let liveWarmedAt = Number.NEGATIVE_INFINITY;
    const warm = (resume = false) => {
      const run = generation;
      const current = currentSession.current;
      if (
        current &&
        current.user.id === session?.user.id &&
        apiConfiguration.configured &&
        foreground
      ) {
        const now = Date.now();
        const live = !resume || now - liveWarmedAt >= LIVE_WARM_INTERVAL_MS;
        if (live) liveWarmedAt = now;
        warmedBirthYear.current = birthYear.current;
        void preloadAppData(
          apiClient,
          current,
          () =>
            active && generation === run && AppState.currentState === "active",
          new Date(now),
          birthYear.current,
          live,
        );
      }
    };
    warmCurrent.current = warm;
    sessionReadCache.setForeground(foreground);
    warm();
    // Another account or sign-out clears the display records; a routine token
    // refresh for the same account keeps them (the cache re-checks owners).
    const unsubscribe = authClient.subscribe((next) => {
      if (next?.user.id === session?.user.id) return;
      generation++;
      sessionReadCache.clear();
    });
    const subscription = AppState.addEventListener("change", (state) => {
      const nextForeground = state === "active";
      if (nextForeground === foreground) return;
      foreground = nextForeground;
      generation++;
      sessionReadCache.setForeground(foreground);
      if (foreground) warm(true);
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
    // Keyed by account only: a token refresh must not clear or re-warm.
  }, [session?.user.id]);
  // A profile arriving after auth enables eligible Community warming, without
  // retiring the personal reads that are already loading for the same session.
  useEffect(() => {
    if (warmedBirthYear.current !== profile?.birthYear) warmCurrent.current?.();
  }, [session?.user.id, profile?.birthYear]);
  return null;
}
