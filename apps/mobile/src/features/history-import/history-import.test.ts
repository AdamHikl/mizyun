import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@mizyun/api-client";
import { EXERCISE_CATALOG } from "@mizyun/core";
import {
  HISTORY_IMPORT_MAX_CONTENT,
  historyImportConfirmRequestSchema,
  type HistoryImportBatch,
  type HistoryImportPreview,
} from "@mizyun/contracts";

vi.mock("@/composition/api-client", () => ({
  apiClient: { request: vi.fn() },
}));

import {
  checkFileText,
  checkPickedFile,
  defaultUnits,
  stripByteOrderMark,
} from "./history-import-files";
import {
  buildConfirmRequest,
  buildMappings,
  checkCustomName,
  choiceLabel,
  defaultChoice,
  defaultChoices,
  mappingTotals,
  setsAndWorkoutsLabel,
} from "./history-import-mapping";
import {
  batchSubtitle,
  batchTitle,
  dateRangeLabel,
  hiddenIssueCount,
  importButtonLabel,
  issueCopy,
  issueLines,
  issuesSummary,
  previewCounts,
  resultSummary,
  skippedActivitiesMessage,
  unitsAssumedMessage,
} from "./history-import-copy";
import {
  confirmHistoryImport,
  importFailure,
  listHistoryImportBatches,
  previewHistoryImport,
  removeHistoryImportBatch,
} from "./history-import-data";

const preview = (
  patch: Partial<HistoryImportPreview> = {},
): HistoryImportPreview => ({
  format: "hevy",
  workouts: 2,
  sets: 9,
  runs: 0,
  firstStartedAt: "2026-01-05T08:00:00.000Z",
  lastStartedAt: "2026-02-10T08:00:00.000Z",
  alreadyImported: 0,
  overlapping: 0,
  unitsFromFile: true,
  exercises: [
    {
      sourceName: "Bench Press (Barbell)",
      setCount: 5,
      workoutCount: 2,
      trackingMode: "load_reps",
      match: {
        catalogId: "cat-bench",
        name: "Barbell Bench Press",
        confidence: "exact",
      },
    },
    {
      sourceName: "Curl",
      setCount: 3,
      workoutCount: 1,
      trackingMode: "load_reps",
      match: {
        catalogId: "cat-curl",
        name: "Dumbbell Curl",
        confidence: "suggested",
      },
    },
    {
      sourceName: "Zercher Hold of Doom",
      setCount: 1,
      workoutCount: 1,
      trackingMode: "load_reps",
      match: null,
    },
  ],
  issues: [{ line: 7, code: "invalid_date" }],
  issueCount: 3,
  skippedActivities: [],
  ...patch,
});

const CATALOG_NAME = EXERCISE_CATALOG[0]!.name;
const BATCH = "7d1f9a6e-35a6-4f61-9d5b-64ae7c0f8a11";

describe("picked file checks", () => {
  it("rejects zip archives with the activities.csv hint", () => {
    const r = checkPickedFile({ name: "export_123.ZIP", size: 100 });
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && r.message).toContain("activities.csv");
  });
  it("rejects files over the content cap before reading", () => {
    expect(
      checkPickedFile({ name: "a.csv", size: HISTORY_IMPORT_MAX_CONTENT + 1 }),
    ).toMatchObject({ ok: false });
    expect(
      checkPickedFile({ name: "a.csv", size: HISTORY_IMPORT_MAX_CONTENT }),
    ).toEqual({ ok: true });
  });
  it("accepts unknown sizes and rejects empty files", () => {
    expect(checkPickedFile({ name: "a.csv" })).toEqual({ ok: true });
    expect(checkPickedFile({ name: "a.csv", size: 0 })).toMatchObject({
      ok: false,
    });
    expect(checkFileText("  \n")).toMatchObject({ ok: false });
    expect(checkFileText("a,b")).toEqual({ ok: true });
    expect(
      checkFileText("x".repeat(HISTORY_IMPORT_MAX_CONTENT + 1)),
    ).toMatchObject({
      ok: false,
    });
  });
  it("strips a byte-order mark and defaults units from the profile", () => {
    expect(stripByteOrderMark("﻿date,exercise")).toBe("date,exercise");
    expect(stripByteOrderMark("date")).toBe("date");
    expect(defaultUnits("imperial")).toEqual({
      weightUnit: "lb",
      distanceUnit: "mi",
    });
    expect(defaultUnits(undefined)).toEqual({
      weightUnit: "kg",
      distanceUnit: "km",
    });
  });
});

describe("exercise mapping", () => {
  it("preselects exact, suggested and custom targets", () => {
    const p = preview();
    const c = defaultChoices(p);
    expect(c["Bench Press (Barbell)"]).toEqual({
      kind: "catalog",
      catalogId: "cat-bench",
      name: "Barbell Bench Press",
      suggested: false,
    });
    expect(c["Curl"]).toMatchObject({ kind: "catalog", suggested: true });
    expect(c["Zercher Hold of Doom"]).toEqual({
      kind: "custom",
      name: "Zercher Hold of Doom",
    });
    expect(choiceLabel(c["Bench Press (Barbell)"]!)).toBe(
      "Matched: Barbell Bench Press",
    );
    expect(choiceLabel(c["Curl"]!)).toContain("Suggested — check");
    expect(mappingTotals(p, c)).toEqual({
      imported: 3,
      skipped: 0,
      custom: 1,
      unchecked: 1,
    });
  });
  it("uses the catalog entry when an unmatched name equals one exactly", () => {
    const choice = defaultChoice({
      sourceName: `  ${CATALOG_NAME.toLowerCase().replace(/ /g, "   ")} `,
      setCount: 1,
      workoutCount: 1,
      trackingMode: "load_reps",
      match: null,
    });
    expect(choice).toMatchObject({ kind: "catalog", suggested: false });
  });
  it("validates custom names", () => {
    expect(checkCustomName("   ")).toMatchObject({ ok: false });
    expect(checkCustomName("x".repeat(121))).toMatchObject({ ok: false });
    expect(checkCustomName(CATALOG_NAME)).toMatchObject({ ok: false });
    expect(checkCustomName("  Zercher   Hold ")).toEqual({
      ok: true,
      name: "Zercher Hold",
    });
  });
  it("builds exactly one mapping per preview exercise", () => {
    const p = preview();
    const choices = {
      ...defaultChoices(p),
      Curl: { kind: "skip" as const },
    };
    expect(buildMappings(p, choices)).toEqual([
      {
        sourceName: "Bench Press (Barbell)",
        target: { kind: "catalog", catalogId: "cat-bench" },
      },
      { sourceName: "Curl", target: { kind: "skip" } },
      {
        sourceName: "Zercher Hold of Doom",
        target: { kind: "custom", name: "Zercher Hold of Doom" },
      },
    ]);
    expect(setsAndWorkoutsLabel(p.exercises[2]!)).toBe("1 set in 1 workout");
    expect(setsAndWorkoutsLabel(p.exercises[0]!)).toBe("5 sets in 2 workouts");
  });
  it("builds a confirm request the contract accepts", () => {
    const p = preview();
    const request = buildConfirmRequest({
      preview: p,
      choices: defaultChoices(p),
      content: "date,exercise\n",
      fileName: "workouts.csv",
      timezone: "Europe/Bratislava",
      weightUnit: "lb",
      distanceUnit: "km",
      batchId: BATCH,
      skipOverlaps: false,
    });
    expect(historyImportConfirmRequestSchema.safeParse(request).success).toBe(
      true,
    );
    expect(request).toMatchObject({
      batchId: BATCH,
      weightUnit: "lb",
      skipOverlaps: false,
      fileName: "workouts.csv",
    });
    expect(
      buildConfirmRequest({
        preview: p,
        choices: defaultChoices(p),
        content: "x",
        fileName: null,
        timezone: "UTC",
        weightUnit: "kg",
        distanceUnit: "km",
        batchId: BATCH,
        skipOverlaps: true,
      }),
    ).not.toHaveProperty("fileName");
  });
});

describe("copy", () => {
  it("describes issues in plain language", () => {
    const p = preview();
    expect(issuesSummary(p)).toBe("3 rows skipped");
    expect(issuesSummary(preview({ issueCount: 0, issues: [] }))).toBeNull();
    expect(issueLines(p)[0]!.text).toBe(`Line 7: ${issueCopy("invalid_date")}`);
    expect(hiddenIssueCount(p)).toBe(2);
    expect(issueCopy("future")).toMatch(/future/);
  });
  it("summarises counts, date range and skipped Strava types", () => {
    expect(previewCounts(preview())).toBe("2 workouts · 9 sets");
    expect(
      previewCounts(preview({ workouts: 0, sets: 0, runs: 12, exercises: [] })),
    ).toBe("12 runs");
    expect(dateRangeLabel(preview(), "UTC")).toContain("–");
    expect(dateRangeLabel(preview({ firstStartedAt: null }), "UTC")).toBeNull();
    const strava = preview({
      format: "strava",
      workouts: 0,
      sets: 0,
      runs: 4,
      skippedActivities: [
        { type: "Ride", count: 12 },
        { type: "Swim", count: 1 },
      ],
    });
    expect(skippedActivitiesMessage(strava)).toContain("13 other activities");
    expect(skippedActivitiesMessage(preview())).toBeNull();
    expect(unitsAssumedMessage("kg", "km", false)).toContain("kg/km");
    expect(unitsAssumedMessage("kg", "mi", true)).not.toContain("kg");
  });
  it("labels the import button", () => {
    expect(importButtonLabel({ workouts: 1, runs: 0 })).toBe(
      "Import 1 workout",
    );
    expect(importButtonLabel({ workouts: 0, runs: 3 })).toBe("Import 3 runs");
    expect(importButtonLabel({ workouts: 2, runs: 1 })).toBe(
      "Import 2 workouts and 1 run",
    );
  });
  const batch = (
    patch: Partial<HistoryImportBatch> = {},
  ): HistoryImportBatch => ({
    id: BATCH,
    format: "strong",
    fileName: "strong.csv",
    status: "complete",
    workoutCount: 5,
    setCount: 30,
    runCount: 0,
    duplicateCount: 2,
    overlapCount: 1,
    firstStartedAt: null,
    lastStartedAt: null,
    createdAt: "2026-10-26T10:00:00.000Z",
    completedAt: "2026-10-26T10:00:05.000Z",
    ...patch,
  });
  it("summarises a finished batch", () => {
    expect(resultSummary(batch())).toBe(
      "Imported 5 workouts. Skipped: 2 already imported, 1 overlapped existing records.",
    );
    expect(
      resultSummary(
        batch({ workoutCount: 0, duplicateCount: 0, overlapCount: 0 }),
      ),
    ).toBe("Nothing new to import.");
    expect(batchTitle(batch())).toBe("Strong · 5 workouts");
    expect(batchSubtitle(batch({ status: "importing" }))).toContain(
      "not finished",
    );
  });
});

describe("api calls", () => {
  const client = (result: unknown) =>
    ({ request: vi.fn().mockResolvedValue(result) }) as unknown as ApiClient & {
      request: ReturnType<typeof vi.fn>;
    };
  const body = {
    content: "x",
    timezone: "UTC",
    weightUnit: "kg" as const,
    distanceUnit: "km" as const,
  };
  it("returns the preview and surfaces server messages", async () => {
    const p = preview();
    const ok = client({ ok: true, value: { preview: p } });
    expect(await previewHistoryImport(body, ok)).toEqual({
      ok: true,
      value: p,
    });
    expect(ok.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        path: "/v1/history-imports/preview",
      }),
    );
    const bad = client({
      ok: false,
      error: {
        kind: "http_error",
        status: 422,
        code: "VALIDATION_ERROR",
        message: "Not a Hevy file.",
      },
    });
    expect(await previewHistoryImport(body, bad)).toMatchObject({
      ok: false,
      message: "Not a Hevy file.",
      retryable: false,
    });
  });
  it("marks lost responses retryable and 409 as a conflict", async () => {
    expect(importFailure({ kind: "network_error", cause: 1 })).toMatchObject({
      retryable: true,
      conflict: false,
    });
    expect(
      importFailure({
        kind: "http_error",
        status: 409,
        code: "CONFLICT",
        message: "x",
      }),
    ).toMatchObject({ retryable: false, conflict: true });
    expect(
      importFailure({
        kind: "http_error",
        status: 503,
        code: "X",
        message: "x",
      }),
    ).toMatchObject({ retryable: true });
  });
  it("confirms, lists and removes through the batch routes", async () => {
    const p = preview();
    const request = buildConfirmRequest({
      preview: p,
      choices: defaultChoices(p),
      content: "x",
      fileName: null,
      timezone: "UTC",
      weightUnit: "kg",
      distanceUnit: "km",
      batchId: BATCH,
      skipOverlaps: true,
    });
    const batch = { id: BATCH };
    const c1 = client({ ok: true, value: { batch } });
    expect(await confirmHistoryImport(request, c1)).toEqual({
      ok: true,
      value: batch,
    });
    expect(c1.request.mock.calls[0]![0]).toMatchObject({
      path: "/v1/history-imports",
      body: request,
    });
    const c2 = client({ ok: true, value: { batches: [batch] } });
    expect(await listHistoryImportBatches(c2)).toEqual({
      ok: true,
      value: [batch],
    });
    const removed = { removed: true, workouts: 1, runs: 0, exercises: 0 };
    const c3 = client({ ok: true, value: removed });
    expect(await removeHistoryImportBatch(BATCH, c3)).toEqual({
      ok: true,
      value: removed,
    });
    expect(c3.request.mock.calls[0]![0]).toMatchObject({
      method: "DELETE",
      path: `/v1/history-imports/${BATCH}`,
    });
  });
});
