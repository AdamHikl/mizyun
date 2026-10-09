import { useCallback, useRef, useState } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";
import * as Network from "expo-network";
import { apiClient } from "@/composition/api-client";
import { useAuth } from "@/features/auth/auth-context";
import { selectMealIllustration } from "./meal-illustration-catalog";
import { MealIllustrationTile } from "./meal-illustration-tile";
import { loadAutomaticMealIllustration } from "./meal-illustration-loader";

export function AutomaticMealIllustration({
  entryId,
  name,
  allowGeneration,
}: {
  readonly entryId: string;
  readonly name: string;
  readonly allowGeneration: boolean;
}) {
  const { session } = useAuth();
  const owner = session?.user.id;
  const scope = `${owner ?? ""}:${session?.accessToken ?? ""}:${entryId}:${name}`;
  const current = useRef(scope);
  current.current = scope;
  const [generated, setGenerated] = useState<{
    scope: string;
    uri: string;
  } | null>(null);
  const matched = selectMealIllustration(name).matched;
  useFocusEffect(
    useCallback(() => {
      const capability =
        apiClient.getMealIllustrationCapability?.bind(apiClient);
      const ensure = apiClient.ensureMealIllustration?.bind(apiClient);
      if (!owner || !allowGeneration || matched || !capability || !ensure)
        return;
      let active = true;
      let controller: AbortController | undefined;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let running = false;
      let offline = false;
      const foreground = () =>
        AppState.currentState !== "background" &&
        AppState.currentState !== "inactive";
      const stop = () => {
        controller?.abort();
        clearTimeout(timeout);
        running = false;
      };
      const start = () => {
        if (!active || !foreground() || offline || running) return;
        stop();
        const request = new AbortController();
        controller = request;
        timeout = setTimeout(() => request.abort(), 90_000);
        running = true;
        void loadAutomaticMealIllustration({
          client: {
            getMealIllustrationCapability: capability,
            ensureMealIllustration: ensure,
          },
          entryId,
          owner,
          signal: request.signal,
          isCurrent: () => active && current.current === scope,
          onReady: (uri) => setGenerated({ scope, uri }),
        }).finally(() => {
          if (controller === request) {
            clearTimeout(timeout);
            running = false;
          }
        });
      };
      const appSubscription = AppState.addEventListener("change", (state) => {
        if (state === "active") start();
        else stop();
      });
      const networkSubscription = Network.addNetworkStateListener((state) => {
        offline =
          state.isConnected === false || state.isInternetReachable === false;
        if (offline) stop();
        else start();
      });
      start();
      return () => {
        active = false;
        stop();
        appSubscription.remove();
        networkSubscription.remove();
      };
    }, [scope, owner, allowGeneration, matched, entryId]),
  );
  return (
    <MealIllustrationTile
      name={name}
      uri={generated?.scope === scope ? generated.uri : undefined}
    />
  );
}
