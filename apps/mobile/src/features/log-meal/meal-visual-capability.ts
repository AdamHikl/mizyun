import { useCallback, useRef, useState } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";
import { apiClient } from "@/composition/api-client";
import {
  confirmMealVisuals,
  mealVisualsRecentlyConfirmed,
} from "./meal-photo-memory";

const AUTHORITY_LEASE_MS = 30_000;
const REFRESH_INTERVAL_MS = 20_000;
const REQUEST_TIMEOUT_MS = 10_000;

type Authority = { scope: string; expiresAt: number };

/** Screen-owned, in-memory Pro authority; AI consent is a separate decision. */
export function useMealVisualCapability(
  userId: string | null,
  accessToken?: string,
): { enabled: boolean; refresh: () => Promise<boolean> } {
  const scope = JSON.stringify([userId, accessToken ?? null]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const focused = useRef(false);
  const requestGeneration = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const leaseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const [authority, setAuthority] = useState<Authority | null>(null);

  const retire = useCallback(() => {
    requestGeneration.current++;
    controller.current?.abort();
    controller.current = null;
    clearTimeout(leaseTimer.current);
    setAuthority(null);
  }, []);

  const grant = useCallback(() => {
    clearTimeout(leaseTimer.current);
    const expiresAt = Date.now() + AUTHORITY_LEASE_MS;
    setAuthority({ scope, expiresAt });
    leaseTimer.current = setTimeout(() => {
      setAuthority((previous) =>
        previous?.scope === scope && previous.expiresAt === expiresAt
          ? null
          : previous,
      );
    }, AUTHORITY_LEASE_MS);
  }, [scope]);

  const refresh = useCallback(async (): Promise<boolean> => {
    // Old callbacks cannot retire or refresh the new account's authority.
    if (currentScope.current !== scope) return false;
    if (!userId || !focused.current || AppState.currentState !== "active") {
      retire();
      return false;
    }
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    const generation = ++requestGeneration.current;
    const valid = () =>
      currentScope.current === scope &&
      requestGeneration.current === generation &&
      focused.current &&
      AppState.currentState === "active";
    const isCurrent = () => valid() && !request.signal.aborted;
    let abortListener: (() => void) | undefined;
    const aborted = new Promise<null>((resolve) => {
      abortListener = () => resolve(null);
      request.signal.addEventListener("abort", abortListener, { once: true });
    });
    const timeout = setTimeout(() => request.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await Promise.race([
        apiClient.request<{ mealVisuals: boolean }>({
          method: "GET",
          path: "/v1/food-entries/visuals/capability",
          expectedUserId: userId,
          isCurrent,
          signal: request.signal,
        }),
        aborted,
      ]);
      if (!valid()) return false;
      const enabled =
        !request.signal.aborted &&
        response?.ok === true &&
        response.value?.mealVisuals === true;
      if (enabled) {
        confirmMealVisuals(scope, true);
        grant();
      } else {
        confirmMealVisuals(scope, false);
        clearTimeout(leaseTimer.current);
        setAuthority(null);
      }
      return enabled;
    } catch {
      if (valid()) {
        confirmMealVisuals(scope, false);
        clearTimeout(leaseTimer.current);
        setAuthority(null);
      }
      return false;
    } finally {
      clearTimeout(timeout);
      if (abortListener)
        request.signal.removeEventListener("abort", abortListener);
      if (controller.current === request) controller.current = null;
    }
  }, [scope, userId, retire, grant]);

  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      let interval: ReturnType<typeof setInterval> | undefined;
      const start = () => {
        clearInterval(interval);
        if (AppState.currentState !== "active") return;
        if (userId && mealVisualsRecentlyConfirmed(scope)) grant();
        void refresh();
        interval = setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
      };
      const subscription = AppState.addEventListener("change", (state) => {
        if (state === "active") start();
        else {
          clearInterval(interval);
          retire();
        }
      });
      start();
      return () => {
        focused.current = false;
        clearInterval(interval);
        subscription.remove();
        retire();
      };
    }, [refresh, retire, grant, scope, userId]),
  );

  return {
    enabled:
      userId !== null &&
      focused.current &&
      AppState.currentState === "active" &&
      authority?.scope === scope &&
      authority.expiresAt > Date.now(),
    refresh,
  };
}
