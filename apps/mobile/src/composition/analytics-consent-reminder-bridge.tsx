import { useCallback, useRef } from "react";
import { router, usePathname } from "expo-router";
import { AnalyticsConsentReminder } from "@/features/analytics";
import {
  workoutListResponseSchema,
  type WorkoutListResponse,
} from "@mizyun/contracts";
import { useAuth } from "@/features/auth/auth-context";
import { findIncompleteWorkout, useActiveWorkout } from "@/features/workouts";
import { analyticsClient, createApiTransport } from "./analytics-client";
import { apiClient } from "./api-client";

const transport = createApiTransport();

export function AnalyticsConsentReminderBridge() {
  const { session, profile, isOnboardingActive } = useAuth();
  const { activeWorkout } = useActiveWorkout();
  const pathname = usePathname();
  const ownerId =
    session && session.accessToken !== "preview-token" ? session.user.id : null;
  const sessionKey = ownerId ? `${ownerId}:${session?.accessToken}` : null;
  const currentSession = useRef(sessionKey);
  currentSession.current = sessionKey;
  const readConsent = useCallback(async () => {
    if (!sessionKey || currentSession.current !== sessionKey) return null;
    const local = await analyticsClient.getConsent();
    if (currentSession.current !== sessionKey) return null;
    if (local !== "unknown") return local;
    // The provider's initial null is not proof of idle: require a successful
    // read before presenting, including when its hydration is slow or fails.
    const workouts = await apiClient.request<WorkoutListResponse>({
      method: "GET",
      path: "/v1/workouts?limit=20",
      schema: workoutListResponseSchema,
    });
    if (
      currentSession.current !== sessionKey ||
      !workouts.ok ||
      findIncompleteWorkout(workouts.value.workouts)
    )
      return null;
    const result = await transport.getConsent();
    if (currentSession.current !== sessionKey || !result.ok || !result.data)
      return null;
    return result.data.granted
      ? "granted"
      : result.data.revision > 0
        ? "denied"
        : "unknown";
  }, [sessionKey]);

  return (
    <AnalyticsConsentReminder
      ownerId={ownerId}
      sessionKey={sessionKey}
      canPrompt={Boolean(
        ownerId &&
        profile?.displayName &&
        !isOnboardingActive &&
        !activeWorkout &&
        pathname === "/",
      )}
      readConsent={readConsent}
      openSettings={() => router.push("/account-settings/analytics")}
    />
  );
}
