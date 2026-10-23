import { useCallback, useRef, useState } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";
import type { CommunityResponseSchema } from "@mizyun/contracts";
import { apiClient } from "@/composition/api-client";
import { useAuth } from "@/features/auth/auth-context";
import { scopeCommunityClient } from "../scoped-client";
import {
  humanizeCommunityError,
  isCommunityAccessDenial,
} from "../community-client";
import {
  COMMUNITY_READ_LIFETIME_MS,
  communityRenewalDelay,
  getCommunityReadDeadline,
  getCommunityReadEpoch,
  getCommunityResponseEpoch,
} from "../state/read-cache";
const RENEWAL_RETRY_MS = 500;

/** Foreground results expire independently of pending requests; refresh is always deliberate. */
export function useExpansionCommand<T>(
  path: string,
  schema: CommunityResponseSchema<T>,
  method: "GET" | "POST" = "POST",
  // POST bodies that are pure reads (never a mutation or discovery query) may
  // opt into silent renewal; GET reads always may.
  renewable?: (body: Record<string, unknown>) => boolean,
) {
  const { session } = useAuth();
  const principal = session?.user.id ?? null;
  const accessToken = session?.accessToken ?? null;
  const epoch = useRef(0);
  const active = useRef(false);
  const identity = useRef(principal);
  identity.current = principal;
  const token = useRef(accessToken);
  token.current = accessToken;
  const authority = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deadline = useRef<number | null>(null);
  const renewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busyRef = useRef(false);
  const lastBody = useRef<Record<string, unknown> | null>(null);
  const [snapshot, setSnapshot] = useState<{
    value: T;
    principal: string;
    accessToken: string | null;
    readEpoch: number;
    expiresAt: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  busyRef.current = busy;
  const [authorityDenied, setAuthorityDenied] = useState(false);
  const discardResult = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    if (renewTimer.current !== null) clearTimeout(renewTimer.current);
    renewTimer.current = null;
    deadline.current = null;
    authority.current++;
    setSnapshot(null);
  }, []);
  const runRef = useRef<
    (body: Record<string, unknown>, silent?: boolean) => Promise<T | null>
  >(async () => null);
  // Renew shortly before `expiresAt`, or retry a renewal that could not apply.
  // Nothing here extends `expiresAt`: only a fresh response re-arms the timers.
  const scheduleRenewal = useCallback((expiresAt: number, retry = false) => {
    if (renewTimer.current !== null) clearTimeout(renewTimer.current);
    renewTimer.current = null;
    const delay = retry ? RENEWAL_RETRY_MS : communityRenewalDelay(expiresAt);
    if (Date.now() + delay >= expiresAt) return;
    renewTimer.current = setTimeout(
      () => void runRef.current(lastBody.current ?? {}, true),
      delay,
    );
  }, []);
  // `silent` renews the displayed result without loading/error state or
  // clearing it. Only GET reads and POST bodies that `renewable` marks as pure
  // reads are renewed; a mutation or discovery query never is.
  const run = useCallback(
    async (body: Record<string, unknown>, silent = false) => {
      // A user action is in flight; try again shortly instead of dropping the
      // renewal, so the original deadline is not left to retire the screen.
      const retry = () => {
        if (deadline.current !== null) scheduleRenewal(deadline.current, true);
        return null;
      };
      if (silent && busyRef.current) return retry();
      if (
        !principal ||
        identity.current !== principal ||
        token.current !== accessToken ||
        !active.current
      )
        return null;
      const id = silent ? epoch.current : ++epoch.current;
      // An invalidation (a write, refresh or block) while this read is in
      // flight means the response may predate it.
      const startEpoch = getCommunityReadEpoch();
      let expiresAt = Date.now() + COMMUNITY_READ_LIFETIME_MS;
      if (!silent) {
        // Set synchronously: a renewal timer may fire before the next render.
        busyRef.current = true;
        setBusy(true);
        setError(null);
        setAuthorityDenied(false);
      }
      const client = scopeCommunityClient(
        apiClient,
        principal,
        () =>
          active.current &&
          identity.current === principal &&
          token.current === accessToken &&
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
        token.current !== accessToken ||
        !active.current
      )
        return null;
      if (silent && !result.ok && !isCommunityAccessDenial(result.error))
        return retry();
      if (silent && result.ok && startEpoch !== getCommunityReadEpoch())
        return retry();
      if (!silent) {
        busyRef.current = false;
        setBusy(false);
      }
      if (result.ok)
        expiresAt = Math.min(
          expiresAt,
          getCommunityReadDeadline(result.value) ?? expiresAt,
        );
      if (silent && result.ok && busyRef.current) return retry();
      if (silent && result.ok && Date.now() >= expiresAt) return null;
      if (Date.now() >= expiresAt) {
        discardResult();
        setError("Refresh to check your current Community access.");
        return null;
      }
      if (!result.ok) {
        discardResult();
        setAuthorityDenied(isCommunityAccessDenial(result.error));
        setError(
          humanizeCommunityError(
            result.error,
            "This action is unavailable. Try again.",
          ),
        );
        return null;
      }
      if (silent) {
        // Swap in place: keep the authority token so in-flight actions survive.
        if (timer.current !== null) clearTimeout(timer.current);
        if (renewTimer.current !== null) clearTimeout(renewTimer.current);
      } else discardResult();
      deadline.current = expiresAt;
      setSnapshot({
        value: result.value,
        principal,
        accessToken,
        readEpoch: getCommunityResponseEpoch(result.value) ?? startEpoch,
        expiresAt,
      });
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
      if (method === "GET" || renewable?.(body)) {
        lastBody.current = body;
        scheduleRenewal(expiresAt);
      }
      return result.value;
    },
    [
      principal,
      accessToken,
      path,
      schema,
      method,
      renewable,
      discardResult,
      scheduleRenewal,
    ],
  );
  runRef.current = run;
  useFocusEffect(
    useCallback(() => {
      const clear = () => {
        active.current = false;
        epoch.current++;
        discardResult();
        setBusy(false);
        setError(null);
        setAuthorityDenied(false);
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
    }, [principal, accessToken, discardResult]),
  );
  // The deadline is read when the intent is checked, so a silent renewal keeps
  // a selection made from the renewed list. Any discard bumps `authority`. An
  // item the renewed list no longer contains is still rejected by the server.
  const capture = () => {
    const captured = epoch.current;
    const capturedAuthority = authority.current;
    return () =>
      active.current &&
      identity.current === principal &&
      token.current === accessToken &&
      captured === epoch.current &&
      capturedAuthority === authority.current &&
      (deadline.current === null || Date.now() < deadline.current);
  };
  const data =
    snapshot?.principal === principal &&
    snapshot.accessToken === accessToken &&
    snapshot.readEpoch === getCommunityReadEpoch() &&
    Date.now() < snapshot.expiresAt
      ? snapshot.value
      : null;
  return { data, error, busy, authorityDenied, run, principal, capture };
}
