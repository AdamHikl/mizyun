import { describe, expect, it } from "vitest";
import { canShareBoulderingSession, shareBoulderingHref } from "./share-gate";

const ready = {
  boulderingEnabled: true,
  communityEnrolled: true,
  completedAt: "2026-10-16T10:00:00.000Z",
  pendingChanges: 0,
};

describe("bouldering share gate", () => {
  it("offers sharing only for a finished, synced session with Community", () => {
    expect(canShareBoulderingSession(ready)).toBe(true);
    expect(
      canShareBoulderingSession({ ...ready, boulderingEnabled: false }),
    ).toBe(false);
    expect(
      canShareBoulderingSession({ ...ready, communityEnrolled: false }),
    ).toBe(false);
    expect(canShareBoulderingSession({ ...ready, completedAt: null })).toBe(
      false,
    );
    expect(canShareBoulderingSession({ ...ready, pendingChanges: 1 })).toBe(
      false,
    );
  });
  it("routes to the Community share screen with the session id", () => {
    expect(shareBoulderingHref("abc")).toEqual({
      pathname: "/community/share-bouldering",
      params: { sessionId: "abc" },
    });
  });
});
