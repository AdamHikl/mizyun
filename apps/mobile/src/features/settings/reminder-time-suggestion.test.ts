import { describe, expect, it, vi } from "vitest";

vi.mock("expo-secure-store", () => ({}));
vi.mock("../log-meal/meal-lifecycle-data", () => ({
  fetchFoodHistory: vi.fn(),
}));

import {
  clearReminderSuggestionDismissals,
  decideReminderSuggestion,
  dismissReminderSuggestion,
  loadDismissedSuggestion,
  loadRecentMealInstants,
  suggestionMessage,
} from "./reminder-time-suggestion";

const memoryStore = () => {
  const values = new Map<string, string>();
  return {
    values,
    getItemAsync: async (key: string) => values.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => {
      values.set(key, value);
    },
    deleteItemAsync: async (key: string) => {
      values.delete(key);
    },
  };
};
const NOW = new Date("2026-10-15T12:00:00Z");
const day = (offset: number, hh: number, mm = 0) =>
  new Date(Date.UTC(2026, 9, 14 - offset, hh, mm)).toISOString();
const week = [0, 1, 2, 3, 4].map((d) => day(d, 7, 45));

describe("decideReminderSuggestion", () => {
  const base = {
    kind: "first-meal" as const,
    instants: week,
    saved: { hour: 8, minute: 30 },
    dismissed: null,
    timeZone: "UTC",
    now: NOW,
  };
  it("suggests the learned time when it differs by at least 30 minutes", () => {
    const suggestion = decideReminderSuggestion(base);
    expect(suggestion).toEqual({
      hour: 7,
      minute: 30,
      usualHour: 7,
      usualMinute: 45,
    });
    expect(suggestionMessage("first-meal", suggestion!)).toBe(
      "You usually log your first meal around 07:45. Remind at 07:30?",
    );
  });
  it("stays quiet for sparse data, a close time, or unreadable history", () => {
    expect(
      decideReminderSuggestion({ ...base, instants: week.slice(0, 4) }),
    ).toBeNull();
    expect(
      decideReminderSuggestion({ ...base, saved: { hour: 7, minute: 45 } }),
    ).toBeNull();
    expect(decideReminderSuggestion({ ...base, instants: null })).toBeNull();
  });
  it("stays quiet for the exact time the user dismissed, not a new one", () => {
    expect(
      decideReminderSuggestion({ ...base, dismissed: "07:30" }),
    ).toBeNull();
    expect(
      decideReminderSuggestion({ ...base, dismissed: "07:00" }),
    ).not.toBeNull();
  });
  it("suggests an evening time from the last meals of completed days", () => {
    const evening = [1, 2, 3, 4, 5].map((d) => day(d, 20, 0));
    expect(
      decideReminderSuggestion({
        ...base,
        kind: "evening",
        instants: evening,
        saved: { hour: 20, minute: 30 },
      }),
    ).toMatchObject({ hour: 21, minute: 0 });
    expect(
      suggestionMessage("evening", {
        hour: 21,
        minute: 0,
        usualHour: 20,
        usualMinute: 0,
      }),
    ).toBe("You usually log your last meal around 20:00. Remind at 21:00?");
  });
});

describe("dismissal persistence", () => {
  it("is stored per user and kind and cleared with the account", async () => {
    const store = memoryStore();
    expect(await loadDismissedSuggestion("a", "first-meal", store)).toBeNull();
    await dismissReminderSuggestion(
      "a",
      "first-meal",
      { hour: 7, minute: 30 },
      store,
    );
    expect(await loadDismissedSuggestion("a", "first-meal", store)).toBe(
      "07:30",
    );
    expect(await loadDismissedSuggestion("a", "evening", store)).toBeNull();
    expect(await loadDismissedSuggestion("b", "first-meal", store)).toBeNull();
    await dismissReminderSuggestion(
      "a",
      "evening",
      { hour: 21, minute: 0 },
      store,
    );
    await clearReminderSuggestionDismissals("a", store);
    expect(store.values.size).toBe(0);
  });
  it("ignores corrupt values and reports a failed write", async () => {
    const store = memoryStore();
    store.values.set("mizyun.reminder-suggestion-dismissed.a.evening", "soon");
    expect(await loadDismissedSuggestion("a", "evening", store)).toBeNull();
    expect(
      await dismissReminderSuggestion(
        "a",
        "evening",
        { hour: 1, minute: 0 },
        {
          ...store,
          setItemAsync: async () => {
            throw new Error("locked");
          },
        },
      ),
    ).toBe(false);
  });
});

describe("loadRecentMealInstants", () => {
  const page = (
    ids: string[],
    nextCursor: string | null = null,
    message: string | null = null,
  ) => ({
    message,
    nextCursor,
    entries: ids.map((consumedAt, i) => ({
      consumedAt,
      confirmedByUser: i % 2 === 0,
    })),
  });
  it("keeps only confirmed meals, follows cursors and asks for the last two weeks", async () => {
    const fetchHistory = vi
      .fn()
      .mockResolvedValueOnce(page(["a", "b", "c"], "next"))
      .mockResolvedValueOnce(page(["d"]));
    const instants = await loadRecentMealInstants(
      new Date(2026, 9, 15, 12),
      fetchHistory as never,
    );
    expect(instants).toEqual(["a", "c", "d"]);
    expect(fetchHistory.mock.calls[0]![0]).toEqual({
      from: "2026-10-01",
      to: "2026-10-15",
      cursor: null,
      limit: 200,
    });
    expect(fetchHistory.mock.calls[1]![0].cursor).toBe("next");
  });
  it("returns null when history cannot be read", async () => {
    const fetchHistory = vi.fn().mockResolvedValue(page([], null, "Offline"));
    expect(
      await loadRecentMealInstants(new Date(), fetchHistory as never),
    ).toBeNull();
  });
});
