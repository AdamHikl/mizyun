import { describe, expect, it } from "vitest";
import {
  clearRoutineSuggestionDismissals,
  dismissRoutineSuggestion,
  isRoutineSuggestionDismissed,
  loadDismissedRoutineSuggestions,
  routineSuggestionKeyFor,
} from "./workout-routine-suggestion-store";

const memoryStore = () => {
  const data = new Map<string, string>();
  return {
    data,
    getItemAsync: async (key: string) => data.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => {
      data.set(key, value);
    },
    deleteItemAsync: async (key: string) => {
      data.delete(key);
    },
  };
};
const sig = { signature: "ex-a|ex-b" };
const day = (iso: string) => new Date(`${iso}T12:00:00Z`);

describe("routine suggestion dismissals", () => {
  it("persists per exercise-set signature and expires after 30 days", async () => {
    const store = memoryStore();
    await dismissRoutineSuggestion("u1", sig, day("2026-10-01"), store);
    const early = await loadDismissedRoutineSuggestions(
      "u1",
      day("2026-10-30"),
      store,
    );
    expect(isRoutineSuggestionDismissed(early, sig)).toBe(true);
    expect(
      isRoutineSuggestionDismissed(early, { signature: "ex-a|ex-c" }),
    ).toBe(false);
    const late = await loadDismissedRoutineSuggestions(
      "u1",
      day("2026-11-01"),
      store,
    );
    expect(isRoutineSuggestionDismissed(late, sig)).toBe(false);
  });

  it("is scoped to the user and cleared on account cleanup", async () => {
    const store = memoryStore();
    await dismissRoutineSuggestion("u1", sig, day("2026-10-01"), store);
    const other = await loadDismissedRoutineSuggestions(
      "u2",
      day("2026-10-02"),
      store,
    );
    expect(other.size).toBe(0);
    expect(store.data.has(routineSuggestionKeyFor("u1"))).toBe(true);
    expect([...store.data.values()].join("")).not.toContain("ex-a");
    await clearRoutineSuggestionDismissals("u1", store);
    expect(store.data.size).toBe(0);
  });

  it("treats corrupt storage as no dismissals", async () => {
    const store = memoryStore();
    store.data.set(routineSuggestionKeyFor("u1"), "not json");
    const result = await loadDismissedRoutineSuggestions(
      "u1",
      day("2026-10-02"),
      store,
    );
    expect(result.size).toBe(0);
  });
});
