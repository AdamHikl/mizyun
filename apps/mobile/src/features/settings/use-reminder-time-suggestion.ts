import { useCallback, useEffect, useState } from "react";

import {
  decideReminderSuggestion,
  deviceTimeZone,
  dismissReminderSuggestion,
  loadDismissedSuggestion,
  loadRecentMealInstants,
  type ReminderSuggestionKind,
  type ReminderTimeSuggestion,
} from "./reminder-time-suggestion";
import type { MealInstant } from "@mizyun/core";

interface Loaded {
  readonly owner: string;
  readonly instants: readonly MealInstant[] | null;
  readonly dismissed: string | null;
}

/**
 * Learned-time suggestion for an enabled reminder. Compares against the SAVED
 * time (not an unsaved picker value) and never applies anything itself.
 */
export function useReminderTimeSuggestion(input: {
  readonly userId: string;
  readonly kind: ReminderSuggestionKind;
  readonly enabled: boolean;
  readonly saved: { readonly hour: number; readonly minute: number };
}): {
  readonly suggestion: ReminderTimeSuggestion | null;
  readonly dismiss: () => Promise<void>;
} {
  const { userId, kind, enabled, saved } = input;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [dismissedNow, setDismissedNow] = useState<string | null>(null);

  useEffect(() => {
    setLoaded(null);
    setDismissedNow(null);
    if (!enabled) return;
    let active = true;
    void Promise.all([
      loadRecentMealInstants().catch(() => null),
      loadDismissedSuggestion(userId, kind),
    ]).then(([instants, dismissed]) => {
      if (active) setLoaded({ owner: userId, instants, dismissed });
    });
    return () => {
      active = false;
    };
  }, [userId, kind, enabled]);

  const suggestion =
    enabled && loaded !== null && loaded.owner === userId
      ? decideReminderSuggestion({
          kind,
          instants: loaded.instants,
          saved,
          dismissed: dismissedNow ?? loaded.dismissed,
          timeZone: deviceTimeZone(),
        })
      : null;

  const dismiss = useCallback(async () => {
    if (suggestion === null) return;
    const clock = `${String(suggestion.hour).padStart(2, "0")}:${String(suggestion.minute).padStart(2, "0")}`;
    setDismissedNow(clock);
    await dismissReminderSuggestion(userId, kind, suggestion);
  }, [userId, kind, suggestion]);

  return { suggestion, dismiss };
}
