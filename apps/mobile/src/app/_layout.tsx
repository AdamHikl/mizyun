import {
  DarkTheme,
  DefaultTheme,
  Stack,
  ThemeProvider,
  router,
  type Href,
  useRootNavigationState,
} from "expo-router";
import * as Notifications from "expo-notifications";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { parseDeepLinkFragment } from "@mizyun/identity";
import { useEffect, useState } from "react";
import { AppState, Linking } from "react-native";

import { AnimatedSplashOverlay } from "@/components/animated-icon";
import ActiveWorkoutMiniBar from "@/components/active-workout-mini-bar";
import { getAppVariant } from "@/composition/app-variant";
import {
  CommunityNotificationBridge,
  CommunityReadLifecycle,
  parseCommunityInvitationLink,
} from "@/features/community";
import { analyticsClient } from "@/composition/analytics-client";
import { apiClient, apiConfiguration } from "@/composition/api-client";
import { StartupDataBridge } from "@/composition/startup-data-bridge";
import {
  AuthProvider,
  SessionGate,
  useAuth,
} from "@/features/auth/auth-context";
import { registerDevicePushToken } from "@/features/beta-pro/beta-pro-client";
import { ThemePreferenceProvider } from "@/features/theme/theme-context";
import { ActiveWorkoutProvider } from "@/features/workouts";
import { useColorScheme } from "@/hooks/use-color-scheme";

SplashScreen.preventAutoHideAsync();

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const isLiveWorkout =
      notification.request.identifier === "active-workout-session";
    return {
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: !isLiveWorkout,
      shouldShowList: true,
    };
  },
});

function AnalyticsSessionBridge() {
  useEffect(() => {
    let previous = AppState.currentState;
    let backgroundedAt = 0;
    const INACTIVITY_THRESHOLD_MS = 30 * 60 * 1000;

    void analyticsClient.track({
      name: "app_session_started",
      properties: { entryPoint: "cold_start" },
    });

    const subscription = AppState.addEventListener("change", (next) => {
      if (previous === "active" && next !== "active") {
        backgroundedAt = Date.now();
      } else if (next === "active" && previous !== "active") {
        if (
          backgroundedAt > 0 &&
          Date.now() - backgroundedAt >= INACTIVITY_THRESHOLD_MS
        ) {
          void analyticsClient.track({
            name: "app_session_started",
            properties: { entryPoint: "foreground" },
          });
        }
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
  const { consumeDeepLink, explorePreview, session } = useAuth();
  const navigation = useRootNavigationState();
  const [pendingInvitation, setPendingInvitation] = useState<string | null>(
    null,
  );
  const invitationScheme = getAppVariant() === "dev" ? "mizyun-dev" : "mizyun";

  useEffect(() => {
    if (!pendingInvitation || !session || !navigation?.key) return;
    router.push(`/community/invite?token=${pendingInvitation}` as Href);
    setPendingInvitation(null);
  }, [pendingInvitation, session, navigation?.key]);

  useEffect(() => {
    let active = true;
    const handle = (rawUrl: string | null) => {
      if (!rawUrl) return;
      if (
        getAppVariant() === "dev" &&
        (rawUrl.includes("mizyun://preview") || rawUrl.includes("mizyun://dev"))
      ) {
        explorePreview();
        return;
      }
      const token = parseCommunityInvitationLink(rawUrl, invitationScheme);
      if (token) {
        setPendingInvitation(token);
        return;
      }
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
  }, [consumeDeepLink, explorePreview, invitationScheme]);

  return null;
}

function CoachNotificationBridge() {
  useEffect(() => {
    const open = (notification: Notifications.Notification) => {
      const data = notification.request.content.data ?? {};
      if (data.url !== "/coach") return;
      router.push({
        pathname: "/coach",
        params: {
          ...(typeof data.prompt === "string" ? { prompt: data.prompt } : {}),
          ...(data.autoSend === "true" || data.autoSend === true
            ? { autoSend: "true" }
            : {}),
        },
      });
    };
    const initial = Notifications.getLastNotificationResponse();
    if (initial?.notification) {
      const data = initial.notification.request.content.data ?? {};
      if (data.url === "/coach") {
        open(initial.notification);
        Notifications.clearLastNotificationResponse();
      }
    }
    const subscription = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        open(response.notification);
      },
    );
    return () => subscription.remove();
  }, []);
  return null;
}

function WorkoutNotificationBridge() {
  useEffect(() => {
    const open = (notification: Notifications.Notification) => {
      const data = notification.request.content.data ?? {};
      if (data.url !== "/log-workout") return;
      router.push({
        pathname: "/log-workout",
        params: {
          ...(typeof data.workoutId === "string"
            ? { workoutId: data.workoutId }
            : {}),
        },
      });
    };
    const initial = Notifications.getLastNotificationResponse();
    if (initial?.notification) {
      const data = initial.notification.request.content.data ?? {};
      if (data.url === "/log-workout") {
        open(initial.notification);
        Notifications.clearLastNotificationResponse();
      }
    }
    const subscription = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        open(response.notification);
      },
    );
    return () => subscription.remove();
  }, []);
  return null;
}

function MealNotificationBridge() {
  useEffect(() => {
    const open = (notification: Notifications.Notification) => {
      const data = notification.request.content.data ?? {};
      if (data.url === "/meals") {
        router.push({
          pathname: "/meals",
          params: {
            ...(typeof data.source === "string" ? { source: data.source } : {}),
          },
        } as Href);
        return;
      }
      if (data.url === "/log-meal") {
        router.push({
          pathname: "/log-meal",
          params: {
            ...(typeof data.source === "string" ? { source: data.source } : {}),
          },
        });
        return;
      }
    };
    const initial = Notifications.getLastNotificationResponse();
    if (initial?.notification) {
      const data = initial.notification.request.content.data ?? {};
      if (data.url === "/log-meal" || data.url === "/meals") {
        open(initial.notification);
        Notifications.clearLastNotificationResponse();
      }
    }
    const subscription = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        open(response.notification);
      },
    );
    return () => subscription.remove();
  }, []);
  return null;
}

function PushRegistrationBridge() {
  const { session } = useAuth();

  useEffect(() => {
    if (!session || !apiConfiguration.configured) return;
    let cancelled = false;

    void registerDevicePushToken(apiClient).then((token) => {
      if (token && !cancelled) {
        console.log(
          `[Push] Registered push token with server: ${token.slice(0, 16)}...`,
        );
      }
    });

    return () => {
      cancelled = true;
    };
  }, [session]);

  return null;
}

export default function TabLayout() {
  return (
    <ThemePreferenceProvider>
      <TabLayoutContent />
    </ThemePreferenceProvider>
  );
}

function TabLayoutContent() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
      <StatusBar style={colorScheme === "dark" ? "light" : "dark"} />
      <AnimatedSplashOverlay />
      <AnalyticsSessionBridge />
      <AuthProvider>
        <CommunityReadLifecycle />
        <DeepLinkBridge />
        <SessionGate>
          <StartupDataBridge />
          <PushRegistrationBridge />
          <CommunityNotificationBridge />
          <CoachNotificationBridge />
          <WorkoutNotificationBridge />
          <MealNotificationBridge />
          <ActiveWorkoutProvider>
            <Stack screenOptions={{ headerBackTitle: "Back" }}>
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen
                name="log-meal"
                options={{ title: "Log a meal", presentation: "modal" }}
              />
              <Stack.Screen
                name="log-workout"
                options={{ title: "Log workout", presentation: "modal" }}
              />
              <Stack.Screen
                name="log-weight"
                options={{ title: "Add weight", presentation: "modal" }}
              />
              <Stack.Screen
                name="edit-meal"
                options={{ title: "Edit meal", presentation: "modal" }}
              />
              <Stack.Screen
                name="feedback"
                options={{ title: "Feedback & Reviews", presentation: "modal" }}
              />
              <Stack.Screen name="body" options={{ title: "Body progress" }} />
              <Stack.Screen
                name="energy-setup"
                options={{ title: "Energy inputs" }}
              />
              <Stack.Screen
                name="progress-photos"
                options={{ title: "Progress photos" }}
              />
              <Stack.Screen
                name="onboarding"
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="auth/callback"
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="account-settings/category/[categoryId]"
                options={{ title: "Settings" }}
              />
              <Stack.Screen
                name="account-settings/[settingId]"
                options={{ title: "Settings" }}
              />
              <Stack.Screen
                name="community/inbox"
                options={{ title: "Community inbox" }}
              />
              <Stack.Screen
                name="community/notifications"
                options={{ title: "Community notifications" }}
              />
              <Stack.Screen name="settings" options={{ title: "Settings" }} />
              <Stack.Screen
                name="community/activity/[id]"
                options={{ title: "Shared activity" }}
              />
              <Stack.Screen
                name="community/relationships"
                options={{ title: "Your friends" }}
              />
              <Stack.Screen
                name="community/invite"
                options={{ title: "Friend Invitation", presentation: "modal" }}
              />
            </Stack>

            <ActiveWorkoutMiniBar />
          </ActiveWorkoutProvider>
        </SessionGate>
      </AuthProvider>
    </ThemeProvider>
  );
}
