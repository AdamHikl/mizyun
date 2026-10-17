import { addLocalDays } from "@mizyun/core";
import {
  entryLocalDate,
  fetchFoodHistory,
  isoLocalDate,
} from "../log-meal/meal-lifecycle-data";

/** Local days of history read for the card (covers the week plus a gap). */
export const LOGGING_HISTORY_DAYS = 28;
const MAX_PAGES = 5;

export interface LoggingHistory {
  readonly today: string;
  /** Distinct local dates with at least one confirmed meal entry. */
  readonly loggedDates: readonly string[];
}

/**
 * Distinct local dates with logged meals for roughly the last four weeks, or
 * null when the history could not be read completely. A failed or partial read
 * is unknown and must never be presented as "0 days".
 */
export const loadLoggingHistory = async (
  now: Date = new Date(),
  fetchHistory: typeof fetchFoodHistory = fetchFoodHistory,
): Promise<LoggingHistory | null> => {
  const today = isoLocalDate(now);
  const from = addLocalDays(today, -(LOGGING_HISTORY_DAYS - 1));
  const dates = new Set<string>();
  let cursor: string | null = null;
  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const result = await fetchHistory({
        from,
        to: today,
        cursor,
        limit: 200,
      });
      if (result.message !== null) return null;
      for (const entry of result.entries)
        if (entry.confirmedByUser) dates.add(entryLocalDate(entry));
      cursor = result.nextCursor ?? null;
      if (cursor === null) break;
    }
  } catch {
    return null;
  }
  // Pages still remaining: the read is incomplete.
  if (cursor !== null) return null;
  return { today, loggedDates: [...dates].sort() };
};
