import { describe, expect, it } from "vitest";

import {
  completeInitialMealSearch,
  failMealSearchLoadMore,
  shouldShowNoMealSearchMatches,
  type MealSearchState,
} from "./meal-history-search-state";

const pending = (query = "rice"): MealSearchState => ({
  loading: true,
  loadingMore: false,
  groups: [],
  entries: [],
  nextCursor: null,
  query,
  sessionId: 1,
  error: null,
});

describe("meal history search state", () => {
  it("shows no-match only after a successful empty search", () => {
    expect(shouldShowNoMealSearchMatches(pending(), 0)).toBe(false);

    const failed = completeInitialMealSearch(pending(), "rice", 1, {
      groups: [],
      entries: [],
      message: "Search could not be completed.",
      nextCursor: null,
      cutoffDateIsPartial: false,
    });
    expect(failed?.error).toEqual({
      phase: "initial",
      message: "Search could not be completed.",
    });
    expect(shouldShowNoMealSearchMatches(failed, 0)).toBe(false);

    const empty = completeInitialMealSearch(pending(), "rice", 1, {
      groups: [],
      entries: [],
      message: null,
      nextCursor: null,
      cutoffDateIsPartial: false,
    });
    expect(shouldShowNoMealSearchMatches(empty, 0)).toBe(true);
  });

  it("preserves loaded results and the retry cursor after load-more failure", () => {
    const current: MealSearchState = {
      ...pending(),
      loading: false,
      loadingMore: true,
      groups: [
        {
          date: "2026-09-23",
          displayDate: "Today",
          entries: [],
          summary: {
            caloriesKcal: null,
            proteinG: null,
            carbohydrateG: null,
            fatG: null,
            entryCount: 0,
          },
        },
      ],
      nextCursor: "retry-cursor",
    };

    const failed = failMealSearchLoadMore(
      current,
      "rice",
      1,
      "More matches could not be loaded.",
    );
    expect(failed?.groups).toBe(current.groups);
    expect(failed?.entries).toBe(current.entries);
    expect(failed?.nextCursor).toBe("retry-cursor");
    expect(failed?.loadingMore).toBe(false);
    expect(failed?.error?.phase).toBe("load-more");
  });

  it("ignores a stale result from a previous query", () => {
    const current = pending("oats");
    expect(
      completeInitialMealSearch(current, "rice", 1, {
        groups: [],
        entries: [],
        message: "stale failure",
      }),
    ).toBe(current);
    expect(failMealSearchLoadMore(current, "rice", 1, "stale failure")).toBe(
      current,
    );
  });

  it("ignores an old response after an A to B to A search sequence", () => {
    const newRiceSession: MealSearchState = {
      ...pending("rice"),
      sessionId: 3,
    };

    expect(
      failMealSearchLoadMore(
        newRiceSession,
        "rice",
        1,
        "failure from old rice request",
      ),
    ).toBe(newRiceSession);
    expect(
      completeInitialMealSearch(newRiceSession, "rice", 1, {
        groups: [],
        entries: [],
        message: "old rice result",
      }),
    ).toBe(newRiceSession);
  });
});
