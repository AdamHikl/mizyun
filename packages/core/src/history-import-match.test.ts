import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getExerciseFromCatalog } from "./exercise-catalog";
import type { ParsedHistory } from "./history-import";
import {
  HISTORY_EXERCISE_ALIASES,
  matchHistoryExercise,
  summarizeHistoryExercises,
} from "./history-import-match";
import { parseHistoryFile } from "./history-import-parsers";

describe("matchHistoryExercise", () => {
  it("1. matches an exact catalog name", () => {
    expect(matchHistoryExercise("Barbell Bench Press")).toEqual({
      catalogId: "barbell-bench-press",
      name: "Barbell Bench Press",
      confidence: "exact",
    });
    expect(matchHistoryExercise("  barbell   bench press ")?.catalogId).toBe(
      "barbell-bench-press",
    );
  });

  it("2. reorders Name (Equipment) to Equipment Name", () => {
    expect(matchHistoryExercise("Bench Press (Barbell)")).toMatchObject({
      catalogId: "barbell-bench-press",
      confidence: "exact",
    });
    expect(
      matchHistoryExercise("Triceps Pushdown (Cable - Straight Bar)"),
    ).toMatchObject({ confidence: "exact" });
  });

  it("3. uses the catalog's common aliases", () => {
    expect(matchHistoryExercise("Cable Rows")).toMatchObject({
      catalogId: "seated-cable-row",
      confidence: "exact",
    });
  });

  it("4. matches token-normalized keys when unambiguous", () => {
    expect(matchHistoryExercise("Pull-Up")).toMatchObject({
      catalogId: "pull-up",
      confidence: "exact",
    });
    expect(matchHistoryExercise("Barbell Back Squats")).toMatchObject({
      catalogId: "barbell-squat",
      confidence: "exact",
    });
    expect(matchHistoryExercise("Squat Back Barbell")?.catalogId).toBe(
      "barbell-squat",
    );
  });

  it("5. resolves the explicit alias table", () => {
    expect(matchHistoryExercise("Squat (Barbell)")).toMatchObject({
      catalogId: "barbell-squat",
      confidence: "exact",
    });
    expect(matchHistoryExercise("Overhead Press (Barbell)")?.catalogId).toBe(
      "exercise-ohp",
    );
    expect(matchHistoryExercise("Treadmill")?.catalogId).toBe(
      "exercise-treadmill-running",
    );
    expect(
      matchHistoryExercise("Seated Cable Row - V Grip (Cable)")?.confidence,
    ).toBe("exact");
  });

  it("every alias target exists in the catalog and the name resolves to it", () => {
    for (const [name, id] of Object.entries(HISTORY_EXERCISE_ALIASES)) {
      const catalog = getExerciseFromCatalog(id);
      expect(catalog, `${name} -> ${id}`).not.toBeNull();
      const match = matchHistoryExercise(name);
      expect(match?.confidence, name).toBe("exact");
      expect(match?.catalogId, name).toBe(id);
    }
  });

  it("6. suggests a search hit and returns null when nothing matches", () => {
    const suggestion = matchHistoryExercise("Cable Fly Crossover Thing");
    if (suggestion) expect(suggestion.confidence).toBe("suggested");
    expect(matchHistoryExercise("zzzzqqqq")).toBeNull();
    expect(matchHistoryExercise("   ")).toBeNull();
  });

  it("is deterministic", () => {
    expect(matchHistoryExercise("Leg Extension (Machine)")).toEqual(
      matchHistoryExercise("Leg Extension (Machine)"),
    );
  });
});

describe("summarizeHistoryExercises", () => {
  it("counts sets and workouts, sorts, and infers tracking modes", () => {
    const content = readFileSync(
      new URL("../fixtures/history-import/hevy-kg.csv", import.meta.url),
      "utf8",
    );
    const parsed = parseHistoryFile(content, {
      timezone: "Europe/Bratislava",
      weightUnit: "kg",
      distanceUnit: "km",
      now: new Date("2026-10-26T12:00:00Z"),
    });
    const summary = summarizeHistoryExercises(parsed);
    expect(
      summary.map((s) => [s.sourceName, s.setCount, s.workoutCount]),
    ).toEqual([
      ["Bench Press (Barbell)", 4, 1],
      ["Squat (Barbell)", 2, 1],
      ["Plank", 1, 1],
      ["Treadmill", 1, 1],
    ]);
    expect(summary[0]?.trackingMode).toBe("load_reps");
    expect(summary[2]).toMatchObject({
      trackingMode: "duration",
      match: { catalogId: "front-plank", confidence: "exact" },
    });
    expect(summary[3]?.trackingMode).toBe("duration_distance");
  });

  it("infers the mode from the sets when there is no exact match", () => {
    const set = {
      setType: "normal",
      repetitions: null,
      loadKg: null,
      durationSeconds: 60,
      distanceMeters: 100,
      perceivedExertion: null,
    } as const;
    const parsed: ParsedHistory = {
      format: "generic",
      workouts: [
        {
          externalId: "a",
          name: "A",
          startedAt: "2026-10-01T00:00:00.000Z",
          completedAt: "2026-10-01T00:00:00.000Z",
          notes: null,
          exercises: [{ sourceName: "zzzzqqqq", sets: [set] }],
        },
        {
          externalId: "b",
          name: "B",
          startedAt: "2026-10-02T00:00:00.000Z",
          completedAt: "2026-10-02T00:00:00.000Z",
          notes: null,
          exercises: [
            {
              sourceName: "ZZZZQQQQ",
              sets: [set, { ...set, distanceMeters: null }],
            },
          ],
        },
      ],
      runs: [],
      issues: [],
      skippedActivities: {},
      unitsFromFile: true,
    };
    expect(summarizeHistoryExercises(parsed)).toEqual([
      {
        sourceName: "zzzzqqqq",
        setCount: 3,
        workoutCount: 2,
        trackingMode: "duration_distance",
        match: null,
      },
    ]);
  });
});
