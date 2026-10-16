import { describe, expect, it } from "vitest";

import {
  isOlderBoulderProject,
  summariseBoulderProject,
  type BoulderProjectLinkedAscent,
  type BoulderResult,
} from "./bouldering.js";

const linked = (
  id: string,
  sessionId: string,
  loggedAt: string,
  result: BoulderResult,
  attempts: number | null = result === "flash" ? 1 : null,
  sequence = 1,
): BoulderProjectLinkedAscent => ({
  id,
  sessionId,
  result,
  attempts,
  loggedAt,
  sequence,
});

describe("summariseBoulderProject", () => {
  it("counts sessions, attempts and the latest try for an open project", () => {
    const summary = summariseBoulderProject(
      [
        linked("a", "s1", "2026-09-01T10:00:00.000Z", "not_yet", 3),
        linked("b", "s2", "2026-09-08T10:00:00.000Z", "not_yet", 4),
        linked("c", "s2", "2026-09-08T10:30:00.000Z", "not_yet", 2, 2),
      ],
      null,
    );
    expect(summary).toEqual({
      attempts: 9,
      attemptsComplete: true,
      sessions: 2,
      sentAfterSessions: null,
      lastTriedAt: "2026-09-08T10:30:00.000Z",
    });
  });

  it("never guesses unknown attempts", () => {
    const summary = summariseBoulderProject(
      [
        linked("a", "s1", "2026-09-01T10:00:00.000Z", "not_yet", null),
        linked("b", "s2", "2026-09-02T10:00:00.000Z", "not_yet", 2),
      ],
      null,
    );
    expect(summary.attempts).toBe(2);
    expect(summary.attemptsComplete).toBe(false);
  });

  it("reports sent after N distinct sessions, inclusive of the sending one", () => {
    const ascents = [
      linked("a", "s1", "2026-09-01T10:00:00.000Z", "not_yet", 3),
      linked("b", "s1", "2026-09-01T10:20:00.000Z", "not_yet", 2, 2),
      linked("c", "s2", "2026-09-05T10:00:00.000Z", "not_yet", 4),
      linked("d", "s3", "2026-09-09T10:00:00.000Z", "sent", 2),
      // A repeat in a later session does not change "sent after".
      linked("e", "s4", "2026-09-12T10:00:00.000Z", "flash"),
    ];
    const summary = summariseBoulderProject(ascents, "d");
    expect(summary.sentAfterSessions).toBe(3);
    expect(summary.sessions).toBe(4);
    expect(summary.attempts).toBe(12);
    expect(summary.lastTriedAt).toBe("2026-09-12T10:00:00.000Z");
  });

  it("breaks equal logged_at ties by sequence like the database", () => {
    const at = "2026-09-01T10:00:00.000Z";
    const summary = summariseBoulderProject(
      [
        linked("b", "s1", at, "not_yet", 1, 2),
        linked("a", "s1", at, "sent", 2, 1),
      ],
      "a",
    );
    expect(summary.sentAfterSessions).toBe(1);
    expect(summary.lastTriedAt).toBe(at);
  });

  it("returns null sentAfterSessions when the sending boulder is not linked", () => {
    expect(
      summariseBoulderProject(
        [linked("a", "s1", "2026-09-01T10:00:00.000Z", "not_yet", 1)],
        "missing",
      ).sentAfterSessions,
    ).toBeNull();
  });

  it("handles a project with no linked boulders", () => {
    expect(summariseBoulderProject([], null)).toEqual({
      attempts: 0,
      attemptsComplete: true,
      sessions: 0,
      sentAfterSessions: null,
      lastTriedAt: null,
    });
  });
});

describe("isOlderBoulderProject", () => {
  const now = new Date("2026-10-16T12:00:00.000Z");
  it("is older only beyond 42 days", () => {
    expect(isOlderBoulderProject("2026-09-04T12:00:00.000Z", now)).toBe(false);
    expect(isOlderBoulderProject("2026-09-04T11:59:59.000Z", now)).toBe(true);
    expect(isOlderBoulderProject("2026-10-15T12:00:00.000Z", now)).toBe(false);
  });
});
