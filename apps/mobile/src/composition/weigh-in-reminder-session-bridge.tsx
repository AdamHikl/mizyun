import { useEffect } from "react";
import { AppState } from "react-native";

import { useAuth } from "@/features/auth/auth-context";
import { weighInReminderRuntime } from "./weigh-in-reminder-runtime";

/** Keeps the opt-in weigh-in schedule in step with the signed-in account. */
export function WeighInReminderSessionBridge() {
  const { session } = useAuth();
  const owner =
    session && session.accessToken !== "preview-token" ? session.user.id : null;
  useEffect(() => {
    void weighInReminderRuntime.setOwner(owner).catch(() => {});
    let previous = AppState.currentState;
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active" && previous !== "active")
        void weighInReminderRuntime.refresh().catch(() => {});
      previous = next;
    });
    return () => subscription.remove();
  }, [owner]);
  return null;
}
