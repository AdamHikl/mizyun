import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";

import { apiClient } from "@/composition/api-client";
import { useAuth } from "@/features/auth/auth-context";
import {
  WeeklyReviewController,
  type WeeklyReviewState,
} from "./weekly-review-controller";
import type { CalorieAdjustmentDecision } from "@mizyun/contracts";

export interface UseWeeklyReviewOptions {
  /** Refresh dependent data (dashboard energy summary) after a decision. */
  readonly onDecided?: (
    decision: CalorieAdjustmentDecision["decision"],
  ) => void;
}

/** Owner-scoped controller for the signed-in account. */
export function useWeeklyReview(options: UseWeeklyReviewOptions = {}): {
  readonly controller: WeeklyReviewController | null;
  readonly state: WeeklyReviewState;
} {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const accessToken = session?.accessToken ?? null;
  const ownerKey = `${userId ?? ""}:${accessToken ?? ""}`;
  const owner = useRef(ownerKey);
  owner.current = ownerKey;
  const onDecided = useRef(options.onDecided);
  onDecided.current = options.onDecided;

  const controller = useMemo(() => {
    // The local explore preview has no real account or server data.
    if (userId === null || accessToken === "preview-token") return null;
    const created = ownerKey;
    return new WeeklyReviewController({
      client: apiClient,
      userId,
      utcOffsetMinutes: () => -new Date().getTimezoneOffset(),
      isCurrent: () => owner.current === created,
      onDecided: (decision) => onDecided.current?.(decision),
    });
  }, [ownerKey, userId, accessToken]);

  useEffect(() => {
    void controller?.load();
  }, [controller]);

  const state = useSyncExternalStore(
    controller?.subscribe ?? NOOP_SUBSCRIBE,
    () => controller?.state ?? EMPTY_STATE,
  );
  return { controller, state };
}

const NOOP_SUBSCRIBE = () => () => {};
const EMPTY_STATE: WeeklyReviewState = {
  phase: "loading",
  snapshot: null,
  submitting: null,
  liveTargetKcal: null,
  message: null,
  outcome: null,
};
