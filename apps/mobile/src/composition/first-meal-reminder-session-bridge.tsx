import { useEffect } from "react";
import { AppState } from "react-native";
import { useAuth } from "@/features/auth/auth-context";
import { firstMealReminderLifecycle } from "./first-meal-reminder-runtime";

export function FirstMealReminderSessionBridge() {
  const { session } = useAuth();
  const owner =
    session && session.accessToken !== "preview-token" ? session.user.id : null;
  useEffect(() => {
    void firstMealReminderLifecycle.setOwner(owner).catch(() => {});
    let previous = AppState.currentState;
    const clockKey = () => {
      const now = new Date();
      return `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getTimezoneOffset()}`;
    };
    let clock = clockKey();
    const listener = AppState.addEventListener("change", (next) => {
      if (next === "active" && previous !== "active")
        void firstMealReminderLifecycle.refresh().catch(() => {});
      previous = next;
    });
    // Recheck midnight/time-zone changes while the user stays on any screen.
    const timer = setInterval(() => {
      const nextClock = clockKey();
      if (AppState.currentState === "active" && nextClock !== clock) {
        clock = nextClock;
        void firstMealReminderLifecycle.refresh().catch(() => {});
      }
    }, 60_000);
    return () => {
      listener.remove();
      clearInterval(timer);
    };
  }, [owner]);
  return null;
}
