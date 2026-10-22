import { describe, expect, it } from "vitest";

import { formatBoulderDate } from "./presentation";
import {
  gradeSendsSummary,
  groupGradeSends,
  groupProjects,
  projectAccessibilityLabel,
  projectsSentInSession,
  projectSubtitle,
  pyramidRows,
  replaceProject,
  timelineColumns,
  timelineSummary,
  tryAgainProjects,
} from "./progress";
import {
  gradeSendsFixture,
  progressFixture,
  projectFixture,
} from "./progress-fixtures.test-support";

const id = (n: number) =>
  `88888888-8888-4888-8888-${String(n).padStart(12, "0")}`;

describe("pyramidRows", () => {
  it("orders hardest first, labels every bar and scales to the widest", () => {
    const rows = pyramidRows(progressFixture().pyramid);
    expect(rows.map((r) => r.grade)).toEqual(["6C+", "6B", "6A"]);
    expect(rows.map((r) => r.countLabel)).toEqual([
      "1",
      "7 · 3 flash",
      "10 · 4 flash",
    ]);
    expect(rows.map((r) => r.accessibilityLabel)).toEqual([
      "6C plus: 1 send, 0 flashes",
      "6B: 7 sends, 3 flashes",
      "6A: 10 sends, 4 flashes",
    ]);
    expect(rows[2]!.fraction).toBe(1);
    expect(rows[1]!.fraction).toBeCloseTo(0.7);
    expect(rows[1]!.flashFraction).toBeCloseTo(3 / 7);
  });

  it("drops grades without sends and sorts unordered input", () => {
    const rows = pyramidRows([
      { grade: "5", gradeRank: 3, sends: 2, flashes: 2 },
      { grade: "7A", gradeRank: 11, sends: 0, flashes: 0 },
      { grade: "6A", gradeRank: 5, sends: 1, flashes: 0 },
    ]);
    expect(rows.map((r) => r.grade)).toEqual(["6A", "5"]);
    expect(rows[1]!.flashFraction).toBe(1);
  });
});

describe("timelineColumns", () => {
  it("marks personal bests and sessions without sends", () => {
    const columns = timelineColumns(progressFixture().timeline);
    expect(columns.map((c) => c.grade)).toEqual(["6A", null, "6C+"]);
    expect(columns.map((c) => c.personalBest)).toEqual([false, false, true]);
    expect(columns[1]!.heightFraction).toBe(0);
    expect(columns[1]!.accessibilityLabel).toBe(
      `${formatBoulderDate("2026-09-27")}: No sends`,
    );
    expect(columns[2]!.accessibilityLabel).toBe(
      `${formatBoulderDate("2026-10-04")}: hardest send 6C plus, personal best`,
    );
    expect(columns[2]!.heightFraction).toBe(1);
    expect(columns[0]!.heightFraction).toBeCloseTo(0.25);
  });

  it("keeps only the last 20 sessions, oldest first", () => {
    const timeline = Array.from({ length: 25 }, (_, i) => ({
      sessionId: id(i),
      activityDate: `2026-08-${String(i + 1).padStart(2, "0")}`,
      topGrade: "6A" as const,
      personalBest: false,
    }));
    const columns = timelineColumns(timeline);
    expect(columns).toHaveLength(20);
    expect(columns[0]!.sessionId).toBe(id(5));
    expect(columns[19]!.sessionId).toBe(id(24));
  });

  it("summarises the timeline in one sentence", () => {
    const columns = timelineColumns(progressFixture().timeline);
    expect(timelineSummary(columns)).toBe(
      `Hardest send in each of the last 3 sessions. Hardest 6C plus on ${formatBoulderDate(
        "2026-10-04",
      )}. 1 personal best. 1 session with no sends.`,
    );
    expect(
      timelineSummary(
        timelineColumns([
          {
            sessionId: id(1),
            activityDate: "2026-10-01",
            topGrade: null,
            personalBest: false,
          },
        ]),
      ),
    ).toBe("Hardest send in each of the last 1 session. No sends.");
  });
});

describe("projects", () => {
  const open = projectFixture({ id: id(1) });
  const older = projectFixture({ id: id(2), older: true, grade: "6C" });
  const sent = projectFixture({
    id: id(3),
    status: "sent",
    sentAt: "2026-10-12T10:00:00.000Z",
    sentAscentId: id(30),
    sentAfterSessions: 3,
    sessions: 3,
  });
  const archived = projectFixture({ id: id(4), status: "archived" });

  it("groups open, older than six weeks, sent and archived", () => {
    const groups = groupProjects([older, sent, open, archived]);
    expect(groups.open).toEqual([open]);
    expect(groups.older).toEqual([older]);
    expect(groups.sent).toEqual([sent]);
    expect(groups.archived).toEqual([archived]);
    expect(tryAgainProjects([older, sent, open, archived])).toEqual([
      open,
      older,
    ]);
  });

  it("describes attempts, sessions and Sent after N sessions", () => {
    expect(projectSubtitle(open)).toBe("5 attempts · Tried in 2 sessions");
    expect(projectSubtitle(sent)).toBe("Sent after 3 sessions · 5 attempts");
    expect(
      projectSubtitle(projectFixture({ attemptsComplete: false, sessions: 1 })),
    ).toBe("5+ attempts · Tried in 1 session");
    expect(projectAccessibilityLabel(archived)).toBe(
      "Project 6B · Red. 5 attempts. Tried in 2 sessions. Archived",
    );
  });

  it("finds the projects a session sent and replaces an updated project", () => {
    expect(projectsSentInSession([open, sent], [id(30), id(31)])).toEqual([
      sent,
    ]);
    expect(projectsSentInSession([sent], [id(31)])).toEqual([]);
    const reopened = { ...archived, status: "open" as const };
    expect(replaceProject([open, archived], reopened)).toEqual([
      open,
      reopened,
    ]);
  });
});

describe("grade drill-down", () => {
  it("groups sends by session in the server's newest-first order", () => {
    const groups = groupGradeSends(gradeSendsFixture().sends);
    expect(groups.map((g) => [g.title, g.sends.length])).toEqual([
      [`${formatBoulderDate("2026-10-22")} · North Wall`, 2],
      [formatBoulderDate("2026-10-08"), 1],
    ]);
    expect(groups[0]!.sends.map((s) => s.ascent.sequence)).toEqual([1, 4]);
  });

  it("summarises with the row's own numbers", () => {
    const { sends } = gradeSendsFixture();
    expect(gradeSendsSummary(sends, "90d")).toBe(
      "3 sends in the last 90 days · 1 flash",
    );
    expect(gradeSendsSummary(sends.slice(0, 1), "all")).toBe("1 send in all");
  });
});
