import { useEffect } from "react";
import { AppState } from "react-native";
import { useAuth } from "@/features/auth/auth-context";
import { activateHealthExports } from "@/features/health-exports";
import { setHealthExportActive } from "@/features/health-exports";
import { authClient } from "./auth-client";
import { getAppVariant } from "./app-variant";

export function HealthExportSessionBridge() {
  const { session } = useAuth();
  const accountId =
    session &&
    session.accessToken !== "preview-token" &&
    getAppVariant() === "dev"
      ? session.user.id
      : null;
  useEffect(() => {
    activateHealthExports(accountId);
    setHealthExportActive(AppState.currentState === "active");
    const unsubscribe = authClient.subscribe((next) => {
      if (next?.user.id !== accountId) activateHealthExports(null);
    });
    const listener = AppState.addEventListener("change", (state) =>
      setHealthExportActive(state === "active"),
    );
    return () => {
      unsubscribe();
      listener.remove();
      activateHealthExports(null);
    };
  }, [accountId]);
  return null;
}
