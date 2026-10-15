import { useEffect, useMemo, useRef } from "react";
import { AppState, Platform } from "react-native";
import { router, type Href } from "expo-router";
import { apiClient } from "@/composition/api-client";
import { useAuth } from "@/features/auth/auth-context";
import { isTransientCommunityError } from "../community-client";
import { scopeCommunityClient } from "../scoped-client";
import { notificationDestinationPath } from "./controller";
import {
  resolveCommunityNotification,
  readCommunityNotification,
} from "./notification-client";
import { communityPushLifecycle } from "./push-native";
import {
  COMMUNITY_TAP_TRANSIENT,
  CommunityTapController,
} from "./tap-controller";

/** Mount once inside the signed-in navigation root. Never trusts a push URL or target. */
export function CommunityNotificationBridge() {
  const { session } = useAuth();
  const current = useRef(session);
  current.current = session;
  const clearLast = useRef(() => {});
  const taps = useMemo(
    () =>
      new CommunityTapController({
        resolve: async (principal, eventId, valid) => {
          const result = await resolveCommunityNotification(
            scopeCommunityClient(apiClient, principal, valid),
            eventId,
          );
          if (result.ok) return notificationDestinationPath(result.value);
          // Offline is not a denial: say so instead of "unavailable".
          return isTransientCommunityError(result.error)
            ? COMMUNITY_TAP_TRANSIENT
            : null;
        },
        markRead: async (principal, eventId, valid) =>
          (
            await readCommunityNotification(
              scopeCommunityClient(apiClient, principal, valid),
              eventId,
            )
          ).ok,
        isPrincipalCurrent: (principal) =>
          current.current?.user.id === principal,
        navigate: (path) => router.push(path as Href),
        clearLastResponse: () => clearLast.current(),
      }),
    [],
  );
  useEffect(() => {
    taps.setPrincipal(session?.user.id ?? null);
    void communityPushLifecycle
      .setPrincipal(session)
      .then(() => {
        if (
          current.current?.user.id === session?.user.id &&
          AppState.currentState === "active"
        )
          void communityPushLifecycle.refreshToken();
      })
      .catch(() => undefined);
  }, [session, taps]);
  useEffect(() => {
    if (Platform.OS === "web") return;
    let mounted = true;
    let removeListeners = () => {};
    taps.setForeground(AppState.currentState === "active");
    void import("expo-notifications")
      .then((Notifications) => {
        if (!mounted) return;
        clearLast.current = () => Notifications.clearLastNotificationResponse();
        const receive = (
          response: import("expo-notifications").NotificationResponse | null,
        ) => {
          if (mounted)
            taps.receive(response?.notification.request.content.data);
        };
        const responseListener =
          Notifications.addNotificationResponseReceivedListener(receive);
        // Listener contains a native token; fetch Expo token instead of forwarding it.
        const tokenListener = Notifications.addPushTokenListener(() => {
          if (mounted && current.current && AppState.currentState === "active")
            void communityPushLifecycle.refreshToken();
        });
        const stateListener = AppState.addEventListener("change", (state) => {
          if (!mounted) return;
          taps.setForeground(state === "active");
          if (state === "active" && current.current)
            void communityPushLifecycle.refreshToken();
        });
        removeListeners = () => {
          responseListener.remove();
          tokenListener.remove();
          stateListener.remove();
        };
        receive(Notifications.getLastNotificationResponse());
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
      taps.stop();
      removeListeners();
      clearLast.current = () => {};
    };
  }, [taps]);
  return null;
}
