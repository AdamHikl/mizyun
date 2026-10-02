import { useCallback, useRef, useState } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";
import type { CommunityResponseSchema } from "@mizyun/contracts";
import { apiClient } from "@/composition/api-client";
import { useAuth } from "@/features/auth/auth-context";
import { scopeCommunityClient } from "../scoped-client";
const PROTECTED_RESULT_LIFETIME_MS = 10_000;
/** Foreground results expire independently of pending requests; refresh is always deliberate. */
export function useExpansionCommand<T>(
  path: string,
  schema: CommunityResponseSchema<T>,
  method: "GET" | "POST" = "POST",
) {
  const { session } = useAuth();
  const principal = session?.user.id ?? null;
  const epoch = useRef(0);
  const active = useRef(false);
  const identity = useRef(principal);
  identity.current = principal;
  const authority = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deadline = useRef<number | null>(null);
  const [snapshot, setSnapshot] = useState<{
    value: T;
    principal: string;
    expiresAt: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const discardResult = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    deadline.current = null;
    authority.current++;
    setSnapshot(null);
  }, []);
  const run = useCallback(
    async (body: Record<string, unknown>) => {
      if (!principal || identity.current !== principal || !active.current)
        return null;
      const id = ++epoch.current;
      const expiresAt = Date.now() + PROTECTED_RESULT_LIFETIME_MS;
      setBusy(true);
      setError(null);
      const client = scopeCommunityClient(
        apiClient,
        principal,
        () =>
          active.current &&
          identity.current === principal &&
          id === epoch.current &&
          Date.now() < expiresAt,
      );
      const result = await client.request<T>({
        method,
        path,
        ...(method === "POST" ? { body } : {}),
        schema,
      });
      if (
        id !== epoch.current ||
        identity.current !== principal ||
        !active.current
      )
        return null;
      setBusy(false);
      if (Date.now() >= expiresAt) {
        discardResult();
        setError("Refresh to check your current Community access.");
        return null;
      }
      if (!result.ok) {
        discardResult();
        setError(
          "This action is unavailable. Refresh or check your Community choices.",
        );
        return null;
      }
      discardResult();
      deadline.current = expiresAt;
      setSnapshot({ value: result.value, principal, expiresAt });
      setError(null);
      // This timer belongs to the delivered result, never to the request epoch.
      // Starting a slow refresh cannot extend the previous result's lifetime.
      timer.current = setTimeout(
        () => {
          discardResult();
          setError("Refresh to check your current Community access.");
        },
        Math.max(0, expiresAt - Date.now()),
      );
      return result.value;
    },
    [principal, path, schema, method, discardResult],
  );
  useFocusEffect(
    useCallback(() => {
      const clear = () => {
        active.current = false;
        epoch.current++;
        discardResult();
        setBusy(false);
        setError(null);
      };
      active.current = AppState.currentState === "active";
      const sub = AppState.addEventListener("change", (state) => {
        if (active.current === (state === "active")) return;
        clear();
        active.current = state === "active";
      });
      return () => {
        sub.remove();
        clear();
      };
    }, [principal, discardResult]),
  );
  const capture = () => {
    const captured = epoch.current;
    const capturedAuthority = authority.current;
    const expiresAt = deadline.current;
    return () =>
      active.current &&
      identity.current === principal &&
      captured === epoch.current &&
      capturedAuthority === authority.current &&
      (expiresAt === null || Date.now() < expiresAt);
  };
  const data =
    snapshot?.principal === principal && Date.now() < snapshot.expiresAt
      ? snapshot.value
      : null;
  return { data, error, busy, run, principal, capture };
}
