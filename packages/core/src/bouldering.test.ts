import { describe, expect, it } from "vitest";

import {
  boulderGradePyramid,
  boulderHardestSendTimeline,
  boulderingShareDetails,
  boulderSessionAchievements,
  isBoulderSend,
  readBoulderSession,
  summariseBoulderSession,
  validBoulderAttempts,
  type BoulderAscentCore,
  type BoulderResult,
  type BoulderSessionHistoryEntry,
} from "./bouldering.js";
import { FONT_GRADES, type FontGrade } from "./bouldering-grades.js";

const ascent = (
  grade: FontGrade,
  result: BoulderResult,
  attempts: number | null = result === "flash" ? 1 : null,
  sessionId = "s",
): BoulderAscentCore => ({
  id: `${sessionId}-${grade}-${result}-${Math.random()}`,
  sessionId,
  gradeRank: FONT_GRADES.indexOf(grade),
  grade,
  result,
  attempts,
});

const entry = (
  sessionId: string,
  activityDate: string,
  ascents: BoulderAscentCore[],
  opts: { completed?: boolean; startedAt?: string } = {},
): BoulderSessionHistoryEntry => {
  const startedAt = opts.startedAt ?? `${activityDate}T18:00:00.000Z`;
  return {
    sessionId,
    activityDate,
    startedAt,
    completedAt:
      opts.completed === false ? null : `${activityDate}T19:00:00.000Z`,
    ascents,
  };
};

describe("validBoulderAttempts", () => {
  it("flash requires exactly 1", () => {
    expect(validBoulderAttempts("flash", 1)).toBe(true);
    for (const v of [null, 0, 2, 99])
      expect(validBoulderAttempts("flash", v)).toBe(false);
  });
  it("sent allows null or 2-99 integers", () => {
    for (const v of [null, 2, 3, 99])
      expect(validBoulderAttempts("sent", v)).toBe(true);
    for (const v of [0, 1, 100, 2.5, -3, Number.NaN])
      expect(validBoulderAttempts("sent", v)).toBe(false);
  });
  it("not_yet allows null or 1-99 integers", () => {
    for (const v of [null, 1, 50, 99])
      expect(validBoulderAttempts("not_yet", v)).toBe(true);
    for (const v of [0, 100, 1.5, -1])
      expect(validBoulderAttempts("not_yet", v)).toBe(false);
  });
  it("identifies sends", () => {
    expect(isBoulderSend("flash")).toBe(true);
    expect(isBoulderSend("sent")).toBe(true);
    expect(isBoulderSend("not_yet")).toBe(false);
  });
});

describe("readBoulderSession", () => {
  const valid = () => ({
    activityType: "bouldering",
    workoutLifecycle: { kind: "session" },
    boulderSession: {
      version: 1,
      gradeScale: "font",
      recordingTimezone: "Europe/London",
      activityDate: "2026-10-16",
      gymName: "The Climbing Hangar",
    },
  });
  it("accepts the exact shape", () => {
    expect(readBoulderSession(valid())).toEqual(valid().boulderSession);
    const noGym = valid();
    noGym.boulderSession.gymName = null as never;
    expect(readBoulderSession(noGym)?.gymName).toBeNull();
  });
  it("rejects malformed shapes", () => {
    const v2 = valid();
    (v2.boulderSession as { version: number }).version = 2;
    expect(readBoulderSession(v2)).toBeNull();
    expect(readBoulderSession({ ...valid(), extra: 1 })).toBeNull();
    const extra = valid();
    (extra.boulderSession as Record<string, unknown>).more = 1;
    expect(readBoulderSession(extra)).toBeNull();
    const badDate = valid();
    badDate.boulderSession.activityDate = "2026-02-30";
    expect(readBoulderSession(badDate)).toBeNull();
    const badLife = { ...valid(), workoutLifecycle: { kind: "session", x: 1 } };
    expect(readBoulderSession(badLife)).toBeNull();
    const untrimmed = valid();
    untrimmed.boulderSession.gymName = " Gym ";
    expect(readBoulderSession(untrimmed)).toBeNull();
    const longGym = valid();
    longGym.boulderSession.gymName = "x".repeat(61);
    expect(readBoulderSession(longGym)).toBeNull();
    const emptyTz = valid();
    emptyTz.boulderSession.recordingTimezone = "";
    expect(readBoulderSession(emptyTz)).toBeNull();
  });
  it("rejects running and legacy details", () => {
    expect(
      readBoulderSession({ activityType: "running", runSummary: {} }),
    ).toBeNull();
    expect(readBoulderSession({})).toBeNull();
  });
});

describe("summariseBoulderSession", () => {
  it("handles an empty session", () => {
    expect(summariseBoulderSession([])).toEqual({
      boulders: 0,
      sends: 0,
      flashes: 0,
      attempts: 0,
      attemptsComplete: true,
      topGradeRank: null,
    });
  });
  it("has no top grade without sends", () => {
    const s = summariseBoulderSession([ascent("6A", "not_yet", 3)]);
    expect(s.topGradeRank).toBeNull();
    expect(s.attempts).toBe(3);
    expect(s.attemptsComplete).toBe(true);
  });
  it("does not fabricate unknown attempts", () => {
    const s = summariseBoulderSession([
      ascent("6A", "flash"),
      ascent("6B", "sent", null),
      ascent("6C", "sent", 4),
      ascent("7A", "not_yet", null),
    ]);
    expect(s).toMatchObject({
      boulders: 4,
      sends: 3,
      flashes: 1,
      attempts: 5,
      attemptsComplete: false,
      topGradeRank: FONT_GRADES.indexOf("6C"),
    });
  });
});

describe("boulderSessionAchievements", () => {
  it("first session only when nothing earlier", () => {
    const cur = entry("c", "2026-10-16", [ascent("7A", "flash")], {
      completed: false,
    });
    expect(boulderSessionAchievements(cur, [cur])).toEqual([
      { kind: "first_session" },
    ]);
  });
  it("detects a personal best and a first flash", () => {
    const prev = entry("p", "2026-10-01", [
      ascent("6B", "sent", 3),
      ascent("6A", "flash"),
    ]);
    const cur = entry("c", "2026-10-16", [
      ascent("6C", "sent", 2),
      ascent("6B", "flash"),
    ]);
    expect(boulderSessionAchievements(cur, [prev, cur])).toEqual([
      { kind: "personal_best", gradeRank: 9, grade: "6C" },
      { kind: "first_flash", gradeRank: 7, grade: "6B" },
    ]);
  });
  it("no PB when equal and no first flash when repeated", () => {
    const prev = entry("p", "2026-10-01", [ascent("6B", "flash")]);
    const cur = entry("c", "2026-10-16", [ascent("6B", "flash")]);
    expect(boulderSessionAchievements(cur, [prev, cur])).toEqual([]);
  });
  it("only reports the hardest flash", () => {
    const prev = entry("p", "2026-10-01", [ascent("6A", "sent", 2)]);
    const cur = entry("c", "2026-10-16", [
      ascent("6A", "flash"),
      ascent("6A+", "flash"),
    ]);
    expect(boulderSessionAchievements(cur, [prev, cur])).toEqual([
      { kind: "personal_best", gradeRank: 6, grade: "6A+" },
      { kind: "first_flash", gradeRank: 6, grade: "6A+" },
    ]);
  });
  it("ignores later, active and same sessions", () => {
    const cur = entry("c", "2026-10-10", [ascent("6A", "sent", 2)]);
    const later = entry("l", "2026-10-20", [ascent("7A", "sent", 2)]);
    const active = entry("a", "2026-10-05", [ascent("7A", "sent", 2)], {
      completed: false,
    });
    expect(boulderSessionAchievements(cur, [cur, later, active])).toEqual([
      { kind: "first_session" },
    ]);
  });
  it("earlier sessions with no sends make a send a PB", () => {
    const prev = entry("p", "2026-10-01", [ascent("7A", "not_yet", 4)]);
    const cur = entry("c", "2026-10-16", [ascent("5", "sent", 2)]);
    expect(boulderSessionAchievements(cur, [prev, cur])).toEqual([
      { kind: "personal_best", gradeRank: 3, grade: "5" },
    ]);
  });
  it("no achievements for a no-send session after earlier sessions", () => {
    const prev = entry("p", "2026-10-01", [ascent("6A", "sent", 2)]);
    const cur = entry("c", "2026-10-16", [ascent("7A", "not_yet", 2)]);
    expect(boulderSessionAchievements(cur, [prev, cur])).toEqual([]);
  });
});

describe("boulderGradePyramid", () => {
  const sessions = (dates: string[]) =>
    dates.map((d, i) =>
      entry(`s${i}`, d, [ascent("6A", "sent", 2), ascent("6B", "flash")]),
    );
  it("30d includes today and the previous 29 days only", () => {
    const h = sessions(["2026-10-16", "2026-09-17", "2026-09-16"]);
    const p = boulderGradePyramid(h, "30d", "2026-10-16");
    expect(p.find((r) => r.grade === "6A")?.sends).toBe(2);
  });
  it("90d boundary", () => {
    const h = sessions(["2026-07-19", "2026-07-18"]);
    // 2026-10-16 minus 90 days = 2026-07-18 (excluded); 07-19 included
    expect(boulderGradePyramid(h, "90d", "2026-10-16")[0]).toMatchObject({
      sends: 1,
    });
  });
  it("all includes everything, sorted hardest first, only sends", () => {
    const h = [
      entry("a", "2020-01-01", [
        ascent("6A", "sent", 2),
        ascent("7A", "not_yet", 3),
      ]),
      entry("b", "2026-10-16", [ascent("6B", "flash")], { completed: false }),
    ];
    const p = boulderGradePyramid(h, "all", "2026-10-16");
    expect(p).toEqual([
      { gradeRank: 7, grade: "6B", sends: 1, flashes: 1 },
      { gradeRank: 5, grade: "6A", sends: 1, flashes: 0 },
    ]);
  });
  it("handles month/year boundaries and leap day", () => {
    const h = [entry("x", "2023-12-03", [ascent("6A", "sent", 2)])];
    expect(boulderGradePyramid(h, "30d", "2024-01-01")).toHaveLength(1); // 29 days back
    expect(boulderGradePyramid(h, "30d", "2024-01-02")).toHaveLength(0); // 30 days back
    const leap = [entry("y", "2024-02-29", [ascent("6A", "sent", 2)])];
    expect(boulderGradePyramid(leap, "30d", "2024-03-29")).toHaveLength(1); // 29 days back
    expect(boulderGradePyramid(leap, "30d", "2024-03-30")).toHaveLength(0); // 30 days back
  });
  it("excludes exactly 30 days back and includes 29", () => {
    const h = [entry("x", "2026-09-16", [ascent("6A", "sent", 2)])];
    expect(boulderGradePyramid(h, "30d", "2026-10-15")).toHaveLength(1); // 29
    expect(boulderGradePyramid(h, "30d", "2026-10-16")).toHaveLength(0); // 30
  });
});

describe("boulderHardestSendTimeline", () => {
  it("orders oldest to newest, marks PBs and skips active sessions", () => {
    const h = [
      entry("c", "2026-03-01", [ascent("6B", "sent", 2)]),
      entry("a", "2026-01-01", [ascent("6A", "sent", 2)]),
      entry("b", "2026-02-01", [ascent("5", "sent", 2)]),
      entry("d", "2026-04-01", [ascent("6B", "flash")]),
      entry("e", "2026-05-01", [ascent("5", "not_yet", 2)]),
      entry("f", "2026-06-01", [ascent("7A", "sent", 2)], { completed: false }),
    ];
    const t = boulderHardestSendTimeline(h);
    expect(t.map((e) => e.sessionId)).toEqual(["a", "b", "c", "d", "e"]);
    expect(t.map((e) => e.personalBest)).toEqual([
      false,
      false,
      true,
      false,
      false,
    ]);
    expect(t[4]).toMatchObject({ topGradeRank: null, topGrade: null });
  });
  it("applies the limit to the most recent sessions", () => {
    const h = Array.from({ length: 25 }, (_, i) =>
      entry(`s${i}`, `2026-01-${String(i + 1).padStart(2, "0")}`, [
        ascent("6A", "sent", 2),
      ]),
    );
    const t = boulderHardestSendTimeline(h, 20);
    expect(t).toHaveLength(20);
    expect(t[0]?.sessionId).toBe("s5");
    expect(t[19]?.sessionId).toBe("s24");
  });
  it("breaks same-date ties by startedAt", () => {
    const h = [
      entry("late", "2026-01-01", [], {
        startedAt: "2026-01-01T20:00:00.000Z",
      }),
      entry("early", "2026-01-01", [], {
        startedAt: "2026-01-01T08:00:00.000Z",
      }),
    ];
    expect(boulderHardestSendTimeline(h).map((e) => e.sessionId)).toEqual([
      "early",
      "late",
    ]);
  });
});

describe("boulderingShareDetails (ADR-0067)", () => {
  const ascents = [
    ascent("6B", "flash"),
    ascent("7A", "sent", 3),
    ascent("6B", "sent"),
    ascent("7B", "not_yet", 4),
  ];
  it("projects only the allowlisted snapshot", () => {
    const details = boulderingShareDetails("2026-10-16", ascents, false);
    expect(details).toEqual({
      activityDate: "2026-10-16",
      topGrade: "7A",
      sends: 3,
      flashes: 1,
      gradeBreakdown: null,
    });
    expect(Object.keys(details).sort()).toEqual([
      "activityDate",
      "flashes",
      "gradeBreakdown",
      "sends",
      "topGrade",
    ]);
  });
  it("lists sends per grade hardest first when opted in", () => {
    expect(
      boulderingShareDetails("2026-10-16", ascents, true).gradeBreakdown,
    ).toEqual([
      { grade: "7A", sends: 1 },
      { grade: "6B", sends: 2 },
    ]);
  });
  it("shares a session without sends", () => {
    expect(
      boulderingShareDetails("2026-10-16", [ascent("7B", "not_yet")], true),
    ).toEqual({
      activityDate: "2026-10-16",
      topGrade: null,
      sends: 0,
      flashes: 0,
      gradeBreakdown: [],
    });
  });
});
