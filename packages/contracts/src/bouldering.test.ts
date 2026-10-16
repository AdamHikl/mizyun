import { describe, expect, it } from "vitest";

import {
  boulderAchievementSchema,
  boulderAscentCreateSchema,
  boulderAscentUpdateSchema,
  boulderProgressQuerySchema,
  boulderProjectArchiveSchema,
  boulderProjectListQuerySchema,
  boulderProjectListResponseSchema,
  boulderProjectRecordSchema,
  boulderProjectResponseSchema,
  boulderSessionDetailsSchema,
  boulderSessionFinishSchema,
  boulderSessionListQuerySchema,
  boulderSessionStartSchema,
  boulderSessionUpdateSchema,
  fontGradeSchema,
} from "./bouldering";

const id = "00000000-0000-4000-8000-000000000001";

describe("bouldering contracts", () => {
  it("normalises grades", () => {
    expect(fontGradeSchema.parse("6a+")).toBe("6A+");
    const r = fontGradeSchema.safeParse("V5");
    expect(r.success).toBe(false);
    if (!r.success)
      expect(r.error.issues[0]?.message).toBe("Choose a Font grade.");
  });
  it("parses session start with defaults and rejects bad zones", () => {
    const ok = boulderSessionStartSchema.parse({
      clientOperationId: id,
      recordingTimezone: "Europe/London",
    });
    expect(ok.gymName).toBeNull();
    expect(
      boulderSessionStartSchema.parse({
        clientOperationId: id,
        recordingTimezone: "Europe/London",
        gymName: "  Hangar ",
      }).gymName,
    ).toBe("Hangar");
    for (const tz of ["+02:00", "Nowhere/Bad", ""])
      expect(
        boulderSessionStartSchema.safeParse({
          clientOperationId: id,
          recordingTimezone: tz,
        }).success,
      ).toBe(false);
    expect(
      boulderSessionStartSchema.safeParse({
        clientOperationId: id,
        recordingTimezone: "UTC",
        gymName: "x".repeat(61),
      }).success,
    ).toBe(false);
    expect(
      boulderSessionStartSchema.safeParse({
        clientOperationId: id,
        recordingTimezone: "UTC",
        extra: 1,
      }).success,
    ).toBe(false);
  });
  it("finish and update schemas", () => {
    expect(
      boulderSessionFinishSchema.parse({ clientOperationId: id }).notes,
    ).toBeNull();
    expect(boulderSessionFinishSchema.safeParse({}).success).toBe(false);
    expect(
      boulderSessionFinishSchema.safeParse({
        clientOperationId: id,
        notes: "x".repeat(4001),
      }).success,
    ).toBe(false);
    expect(boulderSessionUpdateSchema.safeParse({}).success).toBe(false);
    expect(
      boulderSessionUpdateSchema.safeParse({ gymName: null }).success,
    ).toBe(true);
  });
  it("validates ascent attempts per result", () => {
    const base = { clientOperationId: id, grade: "6a" };
    const ok = (result: string, attempts: number | null | undefined) =>
      boulderAscentCreateSchema.safeParse({ ...base, result, attempts })
        .success;
    expect(ok("flash", 1)).toBe(true);
    expect(ok("flash", null)).toBe(false);
    expect(ok("flash", 2)).toBe(false);
    expect(ok("sent", undefined)).toBe(true);
    expect(ok("sent", 1)).toBe(false);
    expect(ok("sent", 2)).toBe(true);
    expect(ok("sent", 100)).toBe(false);
    expect(ok("sent", 2.5)).toBe(false);
    expect(ok("not_yet", 0)).toBe(false);
    expect(ok("not_yet", 1)).toBe(true);
    expect(ok("not_yet", 99)).toBe(true);
    const bad = boulderAscentCreateSchema.safeParse({
      ...base,
      result: "sent",
      attempts: 1,
    });
    if (!bad.success) expect(bad.error.issues[0]?.path).toEqual(["attempts"]);
  });
  it("normalises ascent fields", () => {
    const a = boulderAscentCreateSchema.parse({
      clientOperationId: id,
      grade: "6a+",
      result: "sent",
      note: "   ",
    });
    expect(a).toMatchObject({
      grade: "6A+",
      note: null,
      attempts: null,
      holdColour: null,
      photoAssetId: null,
      projectId: null,
    });
    expect(
      boulderAscentCreateSchema.safeParse({
        clientOperationId: id,
        grade: "6A",
        result: "sent",
        note: "x".repeat(281),
      }).success,
    ).toBe(false);
    expect(
      boulderAscentCreateSchema.safeParse({
        clientOperationId: id,
        grade: "6A",
        result: "sent",
        holdColour: "teal",
      }).success,
    ).toBe(false);
  });
  it("update requires a positive expectedRevision", () => {
    const base = { clientOperationId: id, grade: "6A", result: "not_yet" };
    expect(
      boulderAscentUpdateSchema.safeParse({ ...base, expectedRevision: 1 })
        .success,
    ).toBe(true);
    expect(
      boulderAscentUpdateSchema.safeParse({ ...base, expectedRevision: 0 })
        .success,
    ).toBe(false);
    expect(boulderAscentUpdateSchema.safeParse(base).success).toBe(false);
  });
  it("session details are strict", () => {
    const d = {
      version: 1,
      gradeScale: "font",
      recordingTimezone: "UTC",
      activityDate: "2026-10-16",
      gymName: null,
    };
    expect(boulderSessionDetailsSchema.safeParse(d).success).toBe(true);
    expect(
      boulderSessionDetailsSchema.safeParse({ ...d, version: 2 }).success,
    ).toBe(false);
    expect(boulderSessionDetailsSchema.safeParse({ ...d, x: 1 }).success).toBe(
      false,
    );
    expect(
      boulderSessionDetailsSchema.safeParse({
        ...d,
        activityDate: "2026-02-30",
      }).success,
    ).toBe(false);
  });
  it("queries apply defaults and bounds", () => {
    expect(boulderSessionListQuerySchema.parse({}).limit).toBe(20);
    expect(boulderSessionListQuerySchema.parse({ limit: "5" }).limit).toBe(5);
    expect(
      boulderSessionListQuerySchema.safeParse({ limit: "51" }).success,
    ).toBe(false);
    expect(boulderProgressQuerySchema.parse({}).window).toBe("90d");
    expect(boulderProgressQuerySchema.safeParse({ window: "7d" }).success).toBe(
      false,
    );
  });
  it("achievements union", () => {
    expect(
      boulderAchievementSchema.safeParse({ kind: "first_session" }).success,
    ).toBe(true);
    expect(
      boulderAchievementSchema.safeParse({
        kind: "personal_best",
        gradeRank: 9,
        grade: "6C",
      }).success,
    ).toBe(true);
    expect(
      boulderAchievementSchema.safeParse({ kind: "personal_best", grade: "6C" })
        .success,
    ).toBe(false);
  });
});

describe("bouldering project contracts", () => {
  const project = {
    id,
    grade: "6B",
    gradeRank: 7,
    holdColour: "blue",
    status: "sent",
    firstLoggedAt: "2026-09-01T10:00:00.000Z",
    sentAt: "2026-09-09T10:00:00.000Z",
    sentAscentId: id,
    attempts: 9,
    attemptsComplete: true,
    sessions: 3,
    sentAfterSessions: 3,
    lastTriedAt: "2026-09-09T10:00:00.000Z",
    older: false,
  };

  it("lets only a create link a project", () => {
    const base = { clientOperationId: id, grade: "6A", result: "not_yet" };
    expect(
      boulderAscentCreateSchema.parse({ ...base, projectId: id }).projectId,
    ).toBe(id);
    expect(
      boulderAscentCreateSchema.safeParse({ ...base, projectId: "nope" })
        .success,
    ).toBe(false);
    expect(
      boulderAscentUpdateSchema.safeParse({
        ...base,
        expectedRevision: 1,
        projectId: id,
      }).success,
    ).toBe(false);
  });

  it("parses project records strictly", () => {
    expect(boulderProjectRecordSchema.parse(project)).toEqual(project);
    expect(
      boulderProjectRecordSchema.safeParse({ ...project, userId: id }).success,
    ).toBe(false);
    expect(
      boulderProjectRecordSchema.safeParse({ ...project, sentAfterSessions: 0 })
        .success,
    ).toBe(false);
    expect(
      boulderProjectRecordSchema.safeParse({ ...project, status: "done" })
        .success,
    ).toBe(false);
    expect(boulderProjectResponseSchema.safeParse({ project }).success).toBe(
      true,
    );
    expect(
      boulderProjectListResponseSchema.safeParse({ projects: [project] })
        .success,
    ).toBe(true);
  });

  it("defaults the list to open projects and validates the archive body", () => {
    expect(boulderProjectListQuerySchema.parse({})).toEqual({
      status: "open",
    });
    expect(boulderProjectListQuerySchema.parse({ status: "all" }).status).toBe(
      "all",
    );
    expect(
      boulderProjectListQuerySchema.safeParse({ status: "older" }).success,
    ).toBe(false);
    expect(boulderProjectArchiveSchema.parse({ archived: true })).toEqual({
      archived: true,
    });
    expect(boulderProjectArchiveSchema.safeParse({}).success).toBe(false);
    expect(
      boulderProjectArchiveSchema.safeParse({ archived: "yes" }).success,
    ).toBe(false);
  });
});
