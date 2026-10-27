import { describe, expect, it } from "vitest";
import {
  boulderAscentCreateSchema,
  type BoulderAscentRecord,
  type BoulderFinishResponse,
  type BoulderSessionRecord,
} from "@mizyun/contracts";

import { toBoulderFailure } from "./client";
import {
  achievementText,
  ascentAccessibilityLabel,
  gradeSpoken,
  resultText,
  sessionHistorySubtitle,
  summaryStats,
} from "./presentation";
import { mergeBoulderRows, recallFinish, rememberFinish } from "./session-rows";
import { sessionGradeBars } from "./session-summary";

const SESSION = "33333333-3333-4333-8333-333333333333";

const session = (
  summary: Partial<BoulderSessionRecord["summary"]> = {},
): BoulderSessionRecord => ({
  id: SESSION,
  clientOperationId: "11111111-1111-4111-8111-111111111111",
  name: "Bouldering",
  notes: null,
  startedAt: "2026-10-16T08:00:00.000Z",
  completedAt: "2026-10-16T10:00:00.000Z",
  session: {
    version: 1,
    gradeScale: "font",
    recordingTimezone: "Europe/Bratislava",
    activityDate: "2026-10-16",
    gymName: null,
  },
  summary: {
    boulders: 4,
    sends: 3,
    flashes: 1,
    attempts: 7,
    attemptsComplete: true,
    topGrade: "6C",
    ...summary,
  },
});

let n = 0;
const ascent = (
  grade: string,
  rank: number,
  result: BoulderAscentRecord["result"],
  attempts: number | null,
): BoulderAscentRecord => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  sessionId: SESSION,
  sequence: n,
  gradeScale: "font",
  grade: grade as BoulderAscentRecord["grade"],
  gradeRank: rank,
  result,
  attempts,
  holdColour: null,
  note: null,
  photoAssetId: null,
  projectId: null,
  loggedAt: "2026-10-16T09:00:00.000Z",
  revision: 1,
  createdAt: "2026-10-16T09:00:00.000Z",
  updatedAt: "2026-10-16T09:00:00.000Z",
});

describe("bouldering copy", () => {
  it("formats results", () => {
    expect(resultText("flash", 1)).toBe("Flash");
    expect(resultText("sent", 4)).toBe("Sent · 4 attempts");
    expect(resultText("sent", null)).toBe("Sent");
    expect(resultText("not_yet", null)).toBe("Not yet");
    expect(resultText("not_yet", 1)).toBe("Not yet · 1 attempt");
  });

  it("formats achievements without streak language", () => {
    expect(
      achievementText({ kind: "personal_best", grade: "6C", gradeRank: 9 }),
    ).toBe("New personal best: 6C");
    expect(
      achievementText({ kind: "first_flash", grade: "6B+", gradeRank: 8 }),
    ).toBe("First flash at 6B+");
    expect(achievementText({ kind: "first_session" })).toBe(
      "First session logged",
    );
  });

  it("speaks grades and never relies on colour alone", () => {
    expect(gradeSpoken("6A+")).toBe("6A plus");
    expect(
      ascentAccessibilityLabel(
        {
          grade: "6A+",
          result: "sent",
          attempts: 3,
          holdColour: "red",
          photoAssetId: null,
          note: null,
        },
        true,
      ),
    ).toBe(
      "Grade 6A plus. Sent · 3 attempts. Red holds. Saved on this device, waiting to sync",
    );
  });

  it("shows server summary values and discloses unknown attempts", () => {
    const stats = summaryStats(
      session({ attempts: 5, attemptsComplete: false }).summary,
    );
    expect(stats.map((s) => [s.label, s.value])).toEqual([
      ["Sends", "3"],
      ["Flashes", "1"],
      ["Attempts", "5"],
      ["Top grade", "6C"],
    ]);
    expect(stats[2]!.accessibilityLabel).toContain("unknown for some");
    expect(
      summaryStats(
        session({ sends: 0, flashes: 0, topGrade: null }).summary,
      )[3]!.value,
    ).toBe("No sends");
  });

  it("writes a history subtitle", () => {
    expect(sessionHistorySubtitle(session())).toMatch(/Top 6C · 3 sends$/);
    expect(
      sessionHistorySubtitle(
        session({ sends: 0, topGrade: null, boulders: 1 }),
      ),
    ).toMatch(/No sends · 1 boulder$/);
  });
});

describe("summary bars", () => {
  it("counts sends per grade, hardest first, from the core pyramid rule", () => {
    const bars = sessionGradeBars(session(), [
      ascent("6A", 5, "flash", 1),
      ascent("6B", 7, "sent", 3),
      ascent("6B", 7, "sent", null),
      ascent("6C", 9, "not_yet", 2),
    ]);
    expect(bars.map((b) => [b.grade, b.sends, b.flashes])).toEqual([
      ["6B", 2, 0],
      ["6A", 1, 1],
    ]);
    expect(bars[0]!.fraction).toBe(1);
    expect(bars[1]!.fraction).toBe(0.5);
    expect(bars[1]!.accessibilityLabel).toBe("6A: 1 send, 1 flash");
  });
});

describe("session rows", () => {
  it("overlays waiting commands and appends local-only boulders", () => {
    const synced = ascent("6A", 5, "sent", 2);
    const rows = mergeBoulderRows(
      SESSION,
      [synced],
      [
        {
          kind: "create",
          sessionId: SESSION,
          queuedAt: "2026-10-16T09:10:00.000Z",
          body: boulderAscentCreateSchema.parse({
            clientOperationId: "88888888-8888-4888-8888-888888888888",
            grade: "6B",
            result: "flash",
            attempts: 1,
            holdColour: "red",
            note: null,
            photoAssetId: null,
          }),
        },
        {
          kind: "create",
          sessionId: "99999999-9999-4999-8999-999999999999",
          queuedAt: "2026-10-16T09:10:00.000Z",
          body: boulderAscentCreateSchema.parse({
            clientOperationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            grade: "7A",
            result: "flash",
            attempts: 1,
            holdColour: null,
            note: null,
            photoAssetId: null,
          }),
        },
      ],
    );
    expect(rows.map((r) => [r.grade, r.pending])).toEqual([
      ["6A", null],
      ["6B", "create"],
    ]);
  });

  it("keeps finish results per account only", () => {
    const response = {
      session: session(),
      ascents: [],
      achievements: [{ kind: "first_session" }],
    } as BoulderFinishResponse;
    rememberFinish("account-a", response);
    expect(recallFinish("account-a", SESSION)).toBe(response);
    expect(recallFinish("account-b", SESSION)).toBeNull();
    rememberFinish("account-b", response);
    expect(recallFinish("account-a", SESSION)).toBeNull();
  });
});

describe("error mapping", () => {
  it("maps route codes", () => {
    const http = (status: number, code: string) =>
      toBoulderFailure({ kind: "http_error", status, code, message: code })
        .kind;
    expect(http(503, "FEATURE_DISABLED")).toBe("disabled");
    expect(http(409, "BOULDER_SESSION_ACTIVE")).toBe("active_session");
    expect(http(409, "CONFLICT")).toBe("conflict");
    expect(http(410, "BOULDER_REMOVED")).toBe("removed");
    expect(http(400, "VALIDATION_ERROR")).toBe("invalid");
    expect(http(503, "SERVICE_UNAVAILABLE")).toBe("unavailable");
    expect(http(413, "STORAGE_QUOTA_EXCEEDED")).toBe("storage_full");
    expect(toBoulderFailure({ kind: "network_error", cause: null }).kind).toBe(
      "offline",
    );
  });
});
