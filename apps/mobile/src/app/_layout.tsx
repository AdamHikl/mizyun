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
import { useEffect, useRef, useState } from "react";
import { AppState, Linking } from "react-native";

import { AnimatedSplashOverlay } from "@/components/animated-icon";
import ActiveWorkoutMiniBar from "@/components/active-workout-mini-bar";
import { getAppVariant } from "@/composition/app-variant";
import { parseAppAuthCallback } from "@/features/auth/app-auth-link";
import {
  CommunityNotificationBridge,
  CommunityReadLifecycle,
  parseCommunityInvitationLink,
} from "@/features/community";
import { analyticsClient } from "@/composition/analytics-client";
import { AnalyticsConsentReminderBridge } from "@/composition/analytics-consent-reminder-bridge";
import { apiClient, apiConfiguration } from "@/composition/api-client";
import { HealthExportSessionBridge } from "@/composition/health-export-session-bridge";
import { RecipeSessionPruneBridge } from "@/features/meal-recipes";
import { StartupDataBridge } from "@/composition/startup-data-bridge";
import { MealNotificationRouter } from "@/features/log-meal/meal-notification-router";
import { WEEKLY_REVIEW_ROUTE } from "@/features/weekly-review/weekly-review-notification";
import { FirstMealReminderSessionBridge } from "@/composition/first-meal-reminder-session-bridge";
import { WeighInReminderSessionBridge } from "@/composition/weigh-in-reminder-session-bridge";
import { WeighInNotificationRouter } from "@/features/log-weight/weigh-in-notification-router";
import {
  AuthProvider,
  SessionGate,
  useAuth,
} from "@/features/auth/auth-context";
import { registerDevicePushToken } from "@/features/beta-pro/beta-pro-client";
import { ThemePreferenceProvider } from "@/features/theme/theme-context";
import { ActiveWorkoutProvider } from "@/features/workouts";
import { Colors } from "@/constants/theme";
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
      const payload = parseAppAuthCallback(rawUrl, invitationScheme);

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

function WeeklyReviewNotificationBridge() {
  const { session } = useAuth();
  const navigation = useRootNavigationState();
  const pending = useRef<{ id: string; owner: string | null } | null>(null);
  const handled = useRef(new Set<string>());
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const receive = (notification: Notifications.Notification) => {
      const data = notification.request.content.data ?? {};
      if (data.url !== WEEKLY_REVIEW_ROUTE) return;
      const id = notification.request.identifier;
      if (handled.current.has(id)) return;
      pending.current = {
        id,
        owner: typeof data.userId === "string" ? data.userId : null,
      };
      setRevision((current) => current + 1);
    };
    const initial = Notifications.getLastNotificationResponse();
    if (initial?.notification) receive(initial.notification);
    const subscription = Notifications.addNotificationResponseReceivedListener(
      (response) => receive(response.notification),
    );
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    const next = pending.current;
    if (!next || !navigation?.key || !session) return;
    // A notification scheduled by another account is never opened for this one.
    if (next.owner !== null && next.owner !== session.user.id) {
      pending.current = null;
      handled.current.add(next.id);
      return;
    }
    pending.current = null;
    handled.current.add(next.id);
    Notifications.clearLastNotificationResponse();
    router.push(WEEKLY_REVIEW_ROUTE as Href);
  }, [session?.user.id, navigation?.key, revision]);
  return null;
}

function MealNotificationBridge() {
  const { session } = useAuth();
  const navigation = useRootNavigationState();
  const [revision, setRevision] = useState(0);
  const bridge = useRef<MealNotificationRouter | null>(null);
  if (!bridge.current)
    bridge.current = new MealNotificationRouter({
      push: (route) => router.push(route as Href),
      clear: () => Notifications.clearLastNotificationResponse(),
    });
  useEffect(() => {
    const receive = (notification: Notifications.Notification) => {
      bridge.current!.receive({
        id: notification.request.identifier,
        data: notification.request.content.data ?? {},
      });
      setRevision((current) => current + 1);
    };
    const initial = Notifications.getLastNotificationResponse();
    if (initial?.notification) receive(initial.notification);
    const subscription = Notifications.addNotificationResponseReceivedListener(
      (response) => receive(response.notification),
    );
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    bridge.current!.flush(
      session && session.accessToken !== "preview-token"
        ? session.user.id
        : null,
      Boolean(navigation?.key),
    );
  }, [session?.user.id, session?.accessToken, navigation?.key, revision]);
  return null;
}

function WeighInNotificationBridge() {
  const { session } = useAuth();
  const navigation = useRootNavigationState();
  const [revision, setRevision] = useState(0);
  const bridge = useRef<WeighInNotificationRouter | null>(null);
  if (!bridge.current)
    bridge.current = new WeighInNotificationRouter({
      push: (route) => router.push(route as Href),
      clear: () => Notifications.clearLastNotificationResponse(),
    });
  useEffect(() => {
    const receive = (notification: Notifications.Notification) => {
      bridge.current!.receive({
        id: notification.request.identifier,
        data: notification.request.content.data ?? {},
      });
      setRevision((current) => current + 1);
    };
    const initial = Notifications.getLastNotificationResponse();
    if (initial?.notification) receive(initial.notification);
    const subscription = Notifications.addNotificationResponseReceivedListener(
      (response) => receive(response.notification),
    );
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    bridge.current!.flush(
      session && session.accessToken !== "preview-token"
        ? session.user.id
        : null,
      Boolean(navigation?.key),
    );
  }, [session?.user.id, session?.accessToken, navigation?.key, revision]);
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
  const colors = Colors[colorScheme];
  const base = colorScheme === "dark" ? DarkTheme : DefaultTheme;
  const navigationTheme = {
    ...base,
    colors: {
      ...base.colors,
      primary: colors.primary,
      background: colors.background,
      card: colors.background,
      text: colors.text,
      border: colors.separator,
    },
  };
  return (
    <ThemeProvider value={navigationTheme}>
      <StatusBar style={colorScheme === "dark" ? "light" : "dark"} />
      <AnimatedSplashOverlay />
      <AnalyticsSessionBridge />
      <AuthProvider>
        <CommunityReadLifecycle />
        <DeepLinkBridge />
        <FirstMealReminderSessionBridge />
        <WeighInReminderSessionBridge />
        <SessionGate>
          <StartupDataBridge />
          <RecipeSessionPruneBridge />
          <HealthExportSessionBridge />
          <PushRegistrationBridge />
          <CommunityNotificationBridge />
          <CoachNotificationBridge />
          <WorkoutNotificationBridge />
          <MealNotificationBridge />
          <WeighInNotificationBridge />
          <WeeklyReviewNotificationBridge />
          <ActiveWorkoutProvider>
            <AnalyticsConsentReminderBridge />
            <Stack
              screenOptions={{
                headerBackTitle: "Back",
                headerShadowVisible: false,
                headerTitleStyle: { fontWeight: "600" },
              }}
            >
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen
                name="meal-recipes"
                options={{ title: "What can I cook?" }}
              />
              <Stack.Screen
                name="log-meal"
                options={{ title: "Log a meal", presentation: "modal" }}
              />
              <Stack.Screen
                name="log-workout"
                options={{ title: "Log workout", presentation: "modal" }}
              />
              <Stack.Screen
                name="log-run"
                options={{ title: "Log run", presentation: "modal" }}
              />
              <Stack.Screen
                name="log-activity"
                options={{ title: "Log activity", presentation: "modal" }}
              />
              <Stack.Screen
                name="log-past-workout"
                options={{ title: "Log past workout", presentation: "modal" }}
              />
              <Stack.Screen
                name="import-runs"
                options={{ title: "Import runs", presentation: "modal" }}
              />
              <Stack.Screen name="run/[id]" options={{ title: "Run" }} />
              <Stack.Screen
                name="bouldering/session"
                options={{ title: "Bouldering" }}
              />
              <Stack.Screen
                name="bouldering/[id]"
                options={{ title: "Bouldering session" }}
              />
              <Stack.Screen
                name="bouldering/summary/[id]"
                options={{ title: "Session summary" }}
              />
              <Stack.Screen
                name="bouldering/progress"
                options={{ title: "Bouldering progress" }}
              />
              <Stack.Screen
                name="log-weight"
                options={{ title: "Log weight", presentation: "modal" }}
              />
              <Stack.Screen
                name="edit-meal"
                options={{ title: "Edit meal", presentation: "modal" }}
              />
              <Stack.Screen
                name="feedback"
                options={{ title: "Feedback", presentation: "modal" }}
              />
              <Stack.Screen name="body" options={{ title: "Body progress" }} />
              <Stack.Screen
                name="energy-setup"
                options={{ title: "Energy inputs" }}
              />
              <Stack.Screen
                name="weekly-review"
                options={{ title: "Weekly check-in" }}
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
              <Stack.Screen name="community" options={{ headerShown: false }} />
              <Stack.Screen name="settings" options={{ title: "Settings" }} />
            </Stack>

            <ActiveWorkoutMiniBar />
          </ActiveWorkoutProvider>
        </SessionGate>
      </AuthProvider>
    </ThemeProvider>
  );
}
