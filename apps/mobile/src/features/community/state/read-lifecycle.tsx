import { useEffect } from "react";
import { AppState } from "react-native";
import { communityReadCache } from "@/composition/api-client";

/** Global: clears snapshots even while every Community route is unfocused. */
export function CommunityReadLifecycle() {
  useEffect(() => {
    communityReadCache.setForeground(AppState.currentState === "active");
    const listener = AppState.addEventListener("change", (state) => {
      communityReadCache.setForeground(state === "active");
    });
    return () => {
      listener.remove();
      communityReadCache.setForeground(false);
    };
  }, []);
  return null;
}
