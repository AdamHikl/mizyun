import { useEffect } from "react";
import { AppState } from "react-native";

import { useAuth } from "@/features/auth/auth-context";
import { eveningStretchRuntime } from "@/features/evening-stretch";

/** Keeps tonight's stretch reminder in step with the signed-in account. */
export function EveningStretchSessionBridge() {
  const { session } = useAuth();
  const owner =
    session && session.accessToken !== "preview-token" ? session.user.id : null;
  useEffect(() => {
    void eveningStretchRuntime.setOwner(owner).catch(() => {});
    let previous = AppState.currentState;
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active" && previous !== "active")
        void eveningStretchRuntime.refresh().catch(() => {});
      previous = next;
    });
    return () => subscription.remove();
  }, [owner]);
  return null;
}
