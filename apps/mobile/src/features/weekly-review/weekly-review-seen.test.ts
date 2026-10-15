import { beforeEach, describe, expect, it } from "vitest";

import {
  clearWeeklyReviewSeen,
  hasSeenThisSession,
  loadSeenProposalIds,
  markProposalSeen,
  markSeenThisSession,
  resetWeeklyReviewSessionSeen,
  resolvePopupToOpen,
  shouldShowWeeklyReviewPopup,
  weeklyReviewSeenKey,
  type WeeklyReviewSeenStore,
} from "./weekly-review-seen";

const memoryStore = (): WeeklyReviewSeenStore & {
  data: Map<string, string>;
} => {
  const data = new Map<string, string>();
  return {
    data,
    getItemAsync: async (key) => data.get(key) ?? null,
    setItemAsync: async (key, value) => void data.set(key, value),
    deleteItemAsync: async (key) => void data.delete(key),
  };
};

describe("weekly review seen state", () => {
  beforeEach(() => resetWeeklyReviewSessionSeen());

  it("is scoped per user", async () => {
    const store = memoryStore();
    await markProposalSeen("alice", "p1", store);
    expect(await loadSeenProposalIds("alice", store)).toEqual(["p1"]);
    expect(await loadSeenProposalIds("bob", store)).toEqual([]);
    expect(weeklyReviewSeenKey("alice")).not.toBe(weeklyReviewSeenKey("bob"));
  });

  it("shows a pending proposal once, then never again", async () => {
    const store = memoryStore();
    const proposal = { id: "p1", status: "pending" };
    expect(await shouldShowWeeklyReviewPopup("alice", proposal, store)).toBe(
      true,
    );
    markSeenThisSession("alice", "p1");
    await markProposalSeen("alice", "p1", store);
    expect(await shouldShowWeeklyReviewPopup("alice", proposal, store)).toBe(
      false,
    );
    // Persisted state survives an app restart (session set reset).
    resetWeeklyReviewSessionSeen();
    expect(await shouldShowWeeklyReviewPopup("alice", proposal, store)).toBe(
      false,
    );
    // Another account's identical proposal id is not suppressed.
    expect(await shouldShowWeeklyReviewPopup("bob", proposal, store)).toBe(
      true,
    );
  });

  it("never shows decided or missing proposals", async () => {
    const store = memoryStore();
    expect(
      await shouldShowWeeklyReviewPopup(
        "alice",
        { id: "p2", status: "accepted" },
        store,
      ),
    ).toBe(false);
    expect(await shouldShowWeeklyReviewPopup("alice", null, store)).toBe(false);
  });

  it("keeps the session set per owner", () => {
    markSeenThisSession("alice", "p1");
    expect(hasSeenThisSession("alice", "p1")).toBe(true);
    expect(hasSeenThisSession("bob", "p1")).toBe(false);
  });

  it("bounds stored ids, tolerates corrupt data and clears", async () => {
    const store = memoryStore();
    for (let i = 0; i < 40; i++) await markProposalSeen("a", `p${i}`, store);
    const ids = await loadSeenProposalIds("a", store);
    expect(ids.length).toBeLessThanOrEqual(24);
    expect(ids.at(-1)).toBe("p39");
    store.data.set(weeklyReviewSeenKey("a"), "{not json");
    expect(await loadSeenProposalIds("a", store)).toEqual([]);
    await markProposalSeen("a", "x", store);
    await clearWeeklyReviewSeen("a", store);
    expect(await loadSeenProposalIds("a", store)).toEqual([]);
  });

  it("does not open when the owner changes during the seen-state check", async () => {
    const base = memoryStore();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const slow: WeeklyReviewSeenStore = {
      ...base,
      getItemAsync: async (key) => {
        await gate;
        return base.getItemAsync(key);
      },
    };
    let owner = "alice";
    const pending = resolvePopupToOpen(
      "alice",
      { id: "p1", status: "pending" },
      () => owner === "alice",
      slow,
    );
    owner = "bob"; // account switch while the check is pending
    release();
    expect(await pending).toBeNull();
    expect(hasSeenThisSession("alice", "p1")).toBe(false);
    expect(base.data.size).toBe(0);
  });

  it("opens and records when the owner is unchanged", async () => {
    const store = memoryStore();
    expect(
      await resolvePopupToOpen(
        "alice",
        { id: "p1", status: "pending" },
        () => true,
        store,
      ),
    ).toBe("p1");
    expect(await loadSeenProposalIds("alice", store)).toEqual(["p1"]);
  });
});
