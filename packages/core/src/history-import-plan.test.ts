import { describe, expect, it } from "vitest";
import type { ParsedHistory } from "./history-import";
import {
  buildHistoryImportPlan,
  chunkHistoryImportPlan,
  historyImportCheckItems,
  type HistoryExerciseMapping,
} from "./history-import-plan";
import {
  createFileImportedRunSummary,
  isImportedRunSummary,
  readRunSummary,
  reviseImportedRunSummary,
  sameImportedRunMetrics,
} from "./running";

const set = (
  patch: Partial<
    ParsedHistory["workouts"][number]["exercises"][number]["sets"][number]
  > = {},
) => ({
  setType: "normal" as const,
  repetitions: 5,
  loadKg: 80,
  durationSeconds: null,
  distanceMeters: null,
  perceivedExertion: null,
  ...patch,
});

const parsed: ParsedHistory = {
  format: "hevy",
  workouts: [
    {
      externalId: "2026-10-20T06:00:00.000Z",
      name: "Push",
      startedAt: "2026-10-20T06:00:00.000Z",
      completedAt: "2026-10-20T07:00:00.000Z",
      notes: null,
      exercises: [
        { sourceName: "Bench Press (Barbell)", sets: [set(), set()] },
        {
          sourceName: "Wall Angels",
          sets: [set({ repetitions: null, loadKg: null, durationSeconds: 60 })],
        },
      ],
    },
    {
      externalId: "2026-10-21T06:00:00.000Z",
      name: "Only angels",
      startedAt: "2026-10-21T06:00:00.000Z",
      completedAt: "2026-10-21T06:30:00.000Z",
      notes: "x",
      exercises: [
        {
          sourceName: "wall angels",
          sets: [set({ repetitions: null, loadKg: null, durationSeconds: 45 })],
        },
      ],
    },
  ],
  runs: [],
  issues: [],
  skippedActivities: {},
  unitsFromFile: true,
};

const mappings = (
  angels: HistoryExerciseMapping["target"],
): HistoryExerciseMapping[] => [
  {
    sourceName: "Bench Press (Barbell)",
    target: { kind: "catalog", catalogId: "barbell-bench-press" },
  },
  { sourceName: "Wall Angels", target: angels },
];

describe("buildHistoryImportPlan", () => {
  it("maps catalog and custom exercises into prefixed workout records", () => {
    const result = buildHistoryImportPlan(
      parsed,
      mappings({ kind: "custom", name: "  Wall   Angels " }),
    );
    if (!result.ok) throw new Error(result.error.kind);
    const { plan } = result;
    expect(plan.exercises).toEqual([
      {
        key: "catalog:barbell-bench-press",
        kind: "catalog",
        catalogId: "barbell-bench-press",
        name: "Barbell Bench Press",
        trackingMode: "load_reps",
      },
      {
        key: "custom:wall angels",
        kind: "custom",
        name: "Wall Angels",
        trackingMode: "duration",
      },
    ]);
    expect(plan.workouts.map((w) => w.key)).toEqual([
      "hevy:2026-10-20T06:00:00.000Z",
      "hevy:2026-10-21T06:00:00.000Z",
    ]);
    expect(plan.workouts[0]?.sets.map((s) => s.exerciseKey)).toEqual([
      "catalog:barbell-bench-press",
      "catalog:barbell-bench-press",
      "custom:wall angels",
    ]);
    expect(plan.skippedSets).toBe(0);
  });

  it("drops skipped exercises and workouts left empty", () => {
    const result = buildHistoryImportPlan(parsed, mappings({ kind: "skip" }));
    if (!result.ok) throw new Error(result.error.kind);
    expect(result.plan.workouts).toHaveLength(1);
    expect(result.plan.workouts[0]?.sets).toHaveLength(2);
    expect(result.plan.skippedSets).toBe(2);
  });

  it("refuses missing, unknown, duplicate and invalid mappings", () => {
    const kind = (m: HistoryExerciseMapping[]) => {
      const result = buildHistoryImportPlan(parsed, m);
      return result.ok ? "ok" : result.error.kind;
    };
    expect(kind(mappings({ kind: "skip" }).slice(0, 1))).toBe(
      "missing_mapping",
    );
    expect(
      kind([
        ...mappings({ kind: "skip" }),
        { sourceName: "Nope", target: { kind: "skip" } },
      ]),
    ).toBe("unknown_exercise");
    expect(
      kind([
        ...mappings({ kind: "skip" }),
        { sourceName: "WALL ANGELS", target: { kind: "skip" } },
      ]),
    ).toBe("unknown_exercise");
    expect(
      kind(mappings({ kind: "catalog", catalogId: "not-a-real-id" })),
    ).toBe("unknown_catalog");
    expect(kind(mappings({ kind: "custom", name: "   " }))).toBe(
      "invalid_custom_name",
    );
    expect(kind(mappings({ kind: "custom", name: "x".repeat(121) }))).toBe(
      "invalid_custom_name",
    );
    expect(
      kind(mappings({ kind: "custom", name: "barbell bench press" })),
    ).toBe("custom_name_is_catalog");
  });

  it("chunks records in order", () => {
    const result = buildHistoryImportPlan(parsed, mappings({ kind: "skip" }));
    if (!result.ok) throw new Error(result.error.kind);
    const plan = {
      ...result.plan,
      workouts: Array.from({ length: 5 }, () => result.plan.workouts[0]!),
    };
    expect(
      chunkHistoryImportPlan(plan, 2).map((c) => c.workouts.length),
    ).toEqual([2, 2, 1]);
    // Two sets per workout: a budget of 3 sets allows one workout per chunk.
    expect(
      chunkHistoryImportPlan(plan, 200, 3).map((c) => c.workouts.length),
    ).toEqual([1, 1, 1, 1, 1]);
    expect(
      chunkHistoryImportPlan(plan, 200, 4).map((c) => c.workouts.length),
    ).toEqual([2, 2, 1]);
  });
});

describe("historyImportCheckItems", () => {
  it("lists workouts and runs with their local run day", () => {
    const items = historyImportCheckItems(
      {
        ...parsed,
        format: "strava",
        workouts: [],
        runs: [
          {
            externalId: "1001",
            name: "Run",
            startedAt: "2026-10-01T22:30:00.000Z",
            durationSeconds: 1800,
            distanceMeters: 5000,
            environment: "outdoor",
          },
        ],
      },
      "Europe/Bratislava",
    );
    expect(items).toEqual([
      {
        key: "strava:1001",
        kind: "run",
        startedAt: "2026-10-01T22:30:00.000Z",
        completedAt: "2026-10-01T23:00:00.000Z",
        activityDate: "2026-10-02",
      },
    ]);
  });
});

describe("file-imported runs", () => {
  const summary = createFileImportedRunSummary({
    externalId: "1001",
    startedAt: "2026-10-01T22:30:00.400Z",
    recordingTimezone: "Europe/Bratislava",
    durationSeconds: 1800,
    distanceMeters: 5012.37,
    environment: "outdoor",
  });

  it("keeps a second-precision observed start and a Strava origin", () => {
    expect(summary).toMatchObject({
      activityDate: "2026-10-02",
      startedAt: "2026-10-01T22:30:00Z",
      durationBasis: "elapsed",
      origin: { kind: "file_import", format: "strava", externalId: "1001" },
    });
    expect(isImportedRunSummary(summary)).toBe(true);
    expect(sameImportedRunMetrics(summary, summary)).toBe(true);
    expect(
      reviseImportedRunSummary(
        summary,
        { environment: "treadmill", perceivedExertion: 5 },
        2,
      ),
    ).toMatchObject({ environment: "treadmill", durationSeconds: 1800 });
  });

  it("rejects malformed file-import origins and active duration", () => {
    const details = (patch: Record<string, unknown>) => ({
      activityType: "running",
      runSummary: { ...summary, ...patch },
    });
    expect(readRunSummary(details({}))).not.toBeNull();
    expect(
      readRunSummary(
        details({ origin: { ...summary.origin, format: "garmin" } }),
      ),
    ).toBeNull();
    expect(
      readRunSummary(details({ origin: { ...summary.origin, extra: 1 } })),
    ).toBeNull();
    expect(readRunSummary(details({ durationBasis: "active" }))).toBeNull();
    expect(
      sameImportedRunMetrics(summary, {
        ...summary,
        origin: { kind: "file_import", format: "strava", externalId: "1002" },
      }),
    ).toBe(false);
  });
});
