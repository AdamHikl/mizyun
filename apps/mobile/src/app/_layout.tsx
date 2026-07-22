import { DarkTheme, DefaultTheme, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { parseDeepLinkFragment } from "@mizyun/identity";
import { useEffect } from "react";
import { AppState, Linking, useColorScheme } from "react-native";

import { AnimatedSplashOverlay } from "@/components/animated-icon";
import { analyticsClient } from "@/composition/analytics-client";
import AppTabs from "@/components/app-tabs";
import {
  AuthProvider,
  SessionGate,
  useAuth,
} from "@/features/auth/auth-context";

SplashScreen.preventAutoHideAsync();

function AnalyticsSessionBridge() {
  useEffect(() => {
    let previous = AppState.currentState;
    void analyticsClient.track({
      name: "app_session_started",
      properties: { entryPoint: "cold_start" },
    });
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active" && previous !== "active") {
        void analyticsClient.track({
          name: "app_session_started",
          properties: { entryPoint: "foreground" },
        });
      }
      previous = next;
    });
    return () => subscription.remove();
  }, []);
  return null;
}

/**
 * Bridges the platform `Linking` API into the auth boundary.
 *
 * GoTrue's implicit flow delivers the session via the URL fragment
 * (`mizyun://auth/callback#access_token=...&refresh_token=...&type=...`).
 * The fragment survives deep-link routing in Expo Router because we
 * read the raw URL from `Linking.getInitialURL` (cold start) or
 * `Linking.addEventListener("url", ...)` (warm start).
 */
function DeepLinkBridge() {
  const { consumeDeepLink } = useAuth();

  useEffect(() => {
    let active = true;
    const handle = (rawUrl: string | null) => {
      if (!rawUrl) return;
      const payload = parseDeepLinkFragment(rawUrl);
      if (!payload) return;
      void consumeDeepLink(payload).catch(() => {
        // The auth boundary surfaces errors through its own state
        // (SessionGate shows the AuthScreen with the message). The
        // bridge does not need to rethrow.
      });
    };
    void Linking.getInitialURL().then((url) => {
      if (active) handle(url);
    });
    const subscription = Linking.addEventListener("url", (event) => {
      handle(event.url);
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, [consumeDeepLink]);

  return null;
}

export default function TabLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
      <AnimatedSplashOverlay />
      <AnalyticsSessionBridge />
      <AuthProvider>
        <DeepLinkBridge />
        <SessionGate>
          <AppTabs />
        </SessionGate>
      </AuthProvider>
    </ThemeProvider>
  );
}
