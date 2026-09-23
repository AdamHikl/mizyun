import type { FoodEntry } from "@mizyun/contracts";

import type { FoodDayGroup, FoodHistoryResult } from "./meal-lifecycle-data";

export interface MealSearchError {
  readonly phase: "initial" | "load-more";
  readonly message: string;
}

export interface MealSearchState {
  readonly loading: boolean;
  readonly loadingMore: boolean;
  readonly groups: ReadonlyArray<FoodDayGroup>;
  readonly entries: ReadonlyArray<FoodEntry>;
  readonly nextCursor: string | null;
  readonly query: string;
  readonly sessionId: number;
  readonly error: MealSearchError | null;
}

export const completeInitialMealSearch = (
  current: MealSearchState | null,
  query: string,
  sessionId: number,
  result: FoodHistoryResult,
): MealSearchState | null => {
  if (!current || current.query !== query || current.sessionId !== sessionId) {
    return current;
  }
  return {
    loading: false,
    loadingMore: false,
    groups: result.groups,
    entries: result.entries,
    nextCursor: result.nextCursor ?? null,
    query,
    sessionId,
    error:
      result.message === null
        ? null
        : { phase: "initial", message: result.message },
  };
};

export const failMealSearchLoadMore = (
  current: MealSearchState | null,
  query: string,
  sessionId: number,
  message: string,
): MealSearchState | null => {
  if (!current || current.query !== query || current.sessionId !== sessionId) {
    return current;
  }
  return {
    ...current,
    loadingMore: false,
    error: { phase: "load-more", message },
  };
};

export const shouldShowNoMealSearchMatches = (
  state: MealSearchState | null,
  displayedGroupCount: number,
): boolean =>
  state !== null &&
  !state.loading &&
  state.error === null &&
  displayedGroupCount === 0;
