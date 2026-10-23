import { useCallback, useRef, useState } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";
import { apiClient } from "@/composition/api-client";
import {
  confirmMealVisuals,
  mealVisualsRecentlyConfirmed,
} from "./meal-photo-memory";
import {
  forgetMealVisualsGrant,
  hasRecentMealVisualsGrant,
  rememberMealVisualsGrant,
} from "./meal-visuals-offline-grant";

const AUTHORITY_LEASE_MS = 30_000;
const REFRESH_INTERVAL_MS = 20_000;
const REQUEST_TIMEOUT_MS = 10_000;

// `offline` marks a lease from the offline grace: bundled icons only.
type Authority = { scope: string; expiresAt: number; offline: boolean };

/**
 * A request that failed before reaching the server: the sign-in refresh could
 * not reach Auth (supabase AuthRetryableFetchError, wrapped by the identity
 * adapter) or the transport itself failed.
 */
const unreachableError = (error: unknown): boolean => {
  for (let current = error, depth = 0; current && depth < 4; depth++) {
    if (
      current instanceof Error &&
      (current.name === "AuthRetryableFetchError" ||
        (current instanceof TypeError && /network/i.test(current.message)))
    )
      return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
};

/** Screen-owned, in-memory Pro authority; AI consent is a separate decision. */
export function useMealVisualCapability(
  userId: string | null,
  accessToken?: string,
): {
  enabled: boolean;
  /** True when display comes from the offline grace (bundled icons only). */
  offline: boolean;
  /** True only when the server confirmed meal visuals just now. */
  refresh: () => Promise<boolean>;
} {
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
  // Counts server answers, so a slower offline-grace read never reopens a
  // lease that a server answer closed after it started.
  const serverAnswers = useRef(0);

  const retire = useCallback(() => {
    requestGeneration.current++;
    controller.current?.abort();
    controller.current = null;
    clearTimeout(leaseTimer.current);
    setAuthority(null);
  }, []);

  const grant = useCallback(
    (offline = false) => {
      clearTimeout(leaseTimer.current);
      const expiresAt = Date.now() + AUTHORITY_LEASE_MS;
      setAuthority({ scope, expiresAt, offline });
      leaseTimer.current = setTimeout(() => {
        setAuthority((previous) =>
          previous?.scope === scope && previous.expiresAt === expiresAt
            ? null
            : previous,
        );
      }, AUTHORITY_LEASE_MS);
    },
    [scope],
  );
  // Offline grace: renew a bundled-icons lease when the server could not be
  // reached and it confirmed meal visuals on this device within 48 hours.
  const graceIfRecent = useCallback(
    async (valid: () => boolean): Promise<boolean> => {
      if (!userId || !(await hasRecentMealVisualsGrant(userId))) return false;
      if (!valid()) return false;
      grant(true);
      return true;
    },
    [userId, grant],
  );

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
        serverAnswers.current++;
        confirmMealVisuals(scope, userId, true);
        void rememberMealVisualsGrant(userId);
        grant();
        return true;
      }
      // The server could not be reached (timeout or transport failure):
      // bundled icons may keep showing for 48 hours after the last server
      // confirmation on this device (ADR-0053 amendment). Any server answer,
      // including errors, still closes the lease now.
      const unreachable =
        request.signal.aborted ||
        (response?.ok === false && response.error.kind === "network_error");
      if (unreachable && (await graceIfRecent(valid))) return false;
      if (!valid()) return false;
      if (!unreachable) serverAnswers.current++;
      // An explicit denial also ends offline display on this device.
      if (
        response?.ok === true ||
        (response?.ok === false &&
          (response.error.kind === "session_expired" ||
            (response.error.kind === "http_error" &&
              [401, 402, 403].includes(response.error.status))))
      )
        void forgetMealVisualsGrant(userId);
      confirmMealVisuals(scope, userId, false);
      clearTimeout(leaseTimer.current);
      setAuthority(null);
      return false;
    } catch (error) {
      const unreachable = unreachableError(error);
      if (unreachable && (await graceIfRecent(valid))) return false;
      if (!unreachable) serverAnswers.current++;
      if (valid()) {
        confirmMealVisuals(scope, userId, false);
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
  }, [scope, userId, retire, grant, graceIfRecent]);

  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      let interval: ReturnType<typeof setInterval> | undefined;
      const start = () => {
        clearInterval(interval);
        if (AppState.currentState !== "active") return;
        if (userId && mealVisualsRecentlyConfirmed(scope)) grant();
        // A cold offline launch shows icons from the device confirmation at
        // once instead of after the check times out; the check still runs.
        else if (userId) {
          const answers = serverAnswers.current;
          void graceIfRecent(
            () =>
              serverAnswers.current === answers &&
              currentScope.current === scope &&
              focused.current &&
              AppState.currentState === "active",
          );
        }
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
    }, [refresh, retire, grant, graceIfRecent, scope, userId]),
  );

  const active =
    userId !== null &&
    focused.current &&
    AppState.currentState === "active" &&
    authority?.scope === scope &&
    authority.expiresAt > Date.now();
  return {
    offline: active && authority!.offline,
    enabled: active,
    refresh,
  };
}
