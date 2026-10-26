import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  HistoryImportFileError,
  type HistoryImportOptions,
  type ImportedWorkout,
  type ParsedHistory,
} from "./history-import";
import {
  detectHistoryFormat,
  parseHistoryFile,
} from "./history-import-parsers";

const fixture = (name: string): string =>
  readFileSync(
    new URL(`../fixtures/history-import/${name}`, import.meta.url),
    "utf8",
  );

const NOW = new Date("2026-10-26T12:00:00Z");
const base: HistoryImportOptions = {
  timezone: "Europe/Bratislava",
  weightUnit: "kg",
  distanceUnit: "km",
  now: NOW,
};
const opts = (
  patch: Partial<HistoryImportOptions> = {},
): HistoryImportOptions => ({
  ...base,
  ...patch,
});

const errorCode = (fn: () => unknown): string | null => {
  try {
    fn();
    return null;
  } catch (error) {
    return error instanceof HistoryImportFileError ? error.code : "other";
  }
};

const workoutNamed = (parsed: ParsedHistory, name: string): ImportedWorkout => {
  const found = parsed.workouts.find((w) => w.name === name);
  if (!found) throw new Error(`missing workout ${name}`);
  return found;
};

describe("detectHistoryFormat", () => {
  it("detects each format and rejects unknown headers", () => {
    const header = (name: string): string[] =>
      (fixture(name).replace(/^﻿/, "").split(/\r?\n/)[0] as string)
        .split(/[,;]/)
        .map((cell) => cell.replace(/"/g, ""));
    expect(detectHistoryFormat(header("hevy-kg.csv"))).toBe("hevy");
    expect(detectHistoryFormat(header("strong-comma.csv"))).toBe("strong");
    expect(detectHistoryFormat(header("strong-semicolon.csv"))).toBe("strong");
    expect(detectHistoryFormat(header("strava-activities.csv"))).toBe("strava");
    expect(detectHistoryFormat(header("generic.csv"))).toBe("generic");
    expect(detectHistoryFormat(["foo", "bar"])).toBeNull();
  });
});

describe("Hevy", () => {
  it("parses kg files with set types, timed sets and set_index order", () => {
    const parsed = parseHistoryFile(fixture("hevy-kg.csv"), opts());
    expect(parsed.format).toBe("hevy");
    expect(parsed.issues).toEqual([]);
    expect(parsed.unitsFromFile).toBe(true);
    expect(parsed.workouts.map((w) => w.name)).toEqual(["Leg Day", "Push Day"]);

    const leg = workoutNamed(parsed, "Leg Day");
    // 24 Oct 2026 is still CEST (UTC+2).
    expect(leg.startedAt).toBe("2026-10-24T16:00:00.000Z");
    expect(leg.completedAt).toBe("2026-10-24T17:00:00.000Z");
    expect(leg.externalId).toBe(leg.startedAt);
    expect(leg.notes).toBeNull();
    expect(leg.exercises).toHaveLength(1);
    expect(leg.exercises[0]?.sets.map((s) => [s.loadKg, s.setType])).toEqual([
      [90, "normal"],
      [100, "normal"],
    ]);

    const push = workoutNamed(parsed, "Push Day");
    // 26 Oct 2026 is CET (UTC+1).
    expect(push.startedAt).toBe("2026-10-26T06:30:00.000Z");
    expect(push.completedAt).toBe("2026-10-26T07:35:00.000Z");
    expect(push.notes).toBe("Felt strong");
    expect(push.exercises.map((e) => e.sourceName)).toEqual([
      "Bench Press (Barbell)",
      "Plank",
      "Treadmill",
    ]);
    const bench = push.exercises[0]?.sets ?? [];
    expect(bench.map((s) => s.setType)).toEqual([
      "warmup",
      "normal",
      "drop",
      "failure",
    ]);
    expect(bench[1]).toMatchObject({
      loadKg: 80,
      repetitions: 8,
      perceivedExertion: 8,
      durationSeconds: null,
    });
    expect(push.exercises[1]?.sets[0]).toEqual({
      setType: "normal",
      repetitions: null,
      loadKg: null,
      durationSeconds: 60,
      distanceMeters: null,
      perceivedExertion: null,
    });
    expect(push.exercises[2]?.sets[0]).toMatchObject({
      durationSeconds: 1500,
      distanceMeters: 5000,
    });
  });

  it("converts lbs and miles and reads several date formats", () => {
    const parsed = parseHistoryFile(fixture("hevy-lbs.csv"), opts());
    expect(parsed.issues).toEqual([]);
    expect(parsed.unitsFromFile).toBe(true);
    const upper = workoutNamed(parsed, "Upper");
    expect(upper.startedAt).toBe("2026-10-20T05:30:00.000Z");
    expect(upper.completedAt).toBe("2026-10-20T06:15:00.000Z");
    expect(upper.exercises[0]?.sets[0]?.loadKg).toBe(43.091);
    expect(upper.exercises[1]?.sets[0]).toMatchObject({
      distanceMeters: 2414.02,
      durationSeconds: 600,
    });
    const cardio = workoutNamed(parsed, "Cardio");
    expect(cardio.startedAt).toBe("2026-10-21T07:00:00.000Z");
    expect(cardio.exercises[0]?.sets[0]?.distanceMeters).toBe(4988.97);
  });

  it("falls back to the option units when the header names none", () => {
    const csv =
      "title,start_time,exercise_title,weight,reps,distance\n" +
      "A,2026-10-20 08:00,Squat,100,5,2\n";
    const kg = parseHistoryFile(csv, opts());
    expect(kg.unitsFromFile).toBe(false);
    expect(kg.workouts[0]?.exercises[0]?.sets[0]).toMatchObject({
      loadKg: 100,
      distanceMeters: 2000,
    });
    const lb = parseHistoryFile(
      csv,
      opts({ weightUnit: "lb", distanceUnit: "mi" }),
    );
    expect(lb.workouts[0]?.exercises[0]?.sets[0]).toMatchObject({
      loadKg: 45.359,
      distanceMeters: 3218.69,
    });
  });
});

describe("Strong", () => {
  it("parses the comma variant with W/D/F sets and skips Rest Timer rows", () => {
    const parsed = parseHistoryFile(fixture("strong-comma.csv"), opts());
    expect(parsed.format).toBe("strong");
    expect(parsed.unitsFromFile).toBe(false);
    // Only the all-zero squat row is an issue (line 8); Rest Timer is silent.
    expect(parsed.issues).toEqual([{ line: 8, code: "empty_set" }]);

    const lift = workoutNamed(parsed, "Evening Lift");
    expect(lift.startedAt).toBe("2026-10-22T16:00:00.000Z");
    expect(lift.completedAt).toBe("2026-10-22T17:05:00.000Z");
    expect(lift.notes).toBe("Good session");
    expect(lift.exercises.map((e) => e.sourceName)).toEqual([
      "Bench Press (Barbell)",
      "Plank",
    ]);
    const bench = lift.exercises[0]?.sets ?? [];
    expect(bench.map((s) => [s.setType, s.loadKg, s.repetitions])).toEqual([
      ["warmup", 40, 10],
      ["normal", 80, 8],
      ["drop", 60, 10],
      ["failure", 60, 12],
    ]);
    expect(bench[1]?.perceivedExertion).toBe(8);
    expect(bench[3]?.perceivedExertion).toBe(10);
    expect(lift.exercises[1]?.sets[0]).toEqual({
      setType: "normal",
      repetitions: null,
      loadKg: null,
      durationSeconds: 90,
      distanceMeters: null,
      perceivedExertion: null,
    });

    const run = workoutNamed(parsed, "Morning Run");
    expect(run.startedAt).toBe("2026-10-23T05:00:00.000Z");
    expect(run.completedAt).toBe("2026-10-23T05:45:00.000Z");
    expect(run.exercises[0]?.sets[0]).toMatchObject({
      distanceMeters: 5000,
      durationSeconds: 1500,
    });
  });

  it("uses the option units when the file has none", () => {
    const parsed = parseHistoryFile(
      fixture("strong-comma.csv"),
      opts({ weightUnit: "lb", distanceUnit: "mi" }),
    );
    const lift = workoutNamed(parsed, "Evening Lift");
    expect(lift.exercises[0]?.sets[1]?.loadKg).toBe(36.287);
    expect(
      workoutNamed(parsed, "Morning Run").exercises[0]?.sets[0]?.distanceMeters,
    ).toBe(8046.72);
  });

  it("parses the quoted semicolon variant with BOM, CRLF and decimal commas", () => {
    const content = fixture("strong-semicolon.csv");
    expect(content.charCodeAt(0)).toBe(0xfeff);
    expect(content).toContain("\r\n");
    const parsed = parseHistoryFile(content, opts());
    expect(parsed.format).toBe("strong");
    expect(parsed.issues).toEqual([]);
    expect(parsed.unitsFromFile).toBe(true);
    const leg = parsed.workouts[0] as ImportedWorkout;
    expect(leg.name).toBe("Leg Day");
    expect(leg.startedAt).toBe("2026-10-22T16:00:00.000Z");
    expect(leg.completedAt).toBe("2026-10-22T17:05:00.000Z");
    expect(leg.notes).toBe("Heavy");
    expect(leg.exercises[0]?.sets[0]).toMatchObject({
      loadKg: 82.5,
      repetitions: 5,
      perceivedExertion: 8.5,
    });
    expect(leg.exercises[1]?.sets[0]).toMatchObject({
      loadKg: 40,
      distanceMeters: 200,
    });
  });

  it("reads per-row Weight Unit and Distance Unit columns", () => {
    const parsed = parseHistoryFile(fixture("strong-units.csv"), opts());
    expect(parsed.issues).toEqual([]);
    expect(parsed.unitsFromFile).toBe(true);
    const sets = (parsed.workouts[0] as ImportedWorkout).exercises.map(
      (e) => e.sets,
    );
    expect(sets[0]?.map((s) => s.loadKg)).toEqual([61.235, 60]);
    expect(sets[1]?.map((s) => s.distanceMeters)).toEqual([5000, 1609.34]);
    expect(sets[2]?.[0]?.distanceMeters).toBe(50);
  });

  it("accepts durations of 55m, 45s and clock times", () => {
    const row = (duration: string): string =>
      `Date,Workout Name,Duration,Exercise Name,Set Order,Weight (kg),Reps\n2026-10-20 08:00:00,A,${duration},Squat,1,100,5\n`;
    const completed = (duration: string): string =>
      (parseHistoryFile(row(duration), opts()).workouts[0] as ImportedWorkout)
        .completedAt;
    expect(completed("55m")).toBe("2026-10-20T06:55:00.000Z");
    expect(completed("45s")).toBe("2026-10-20T06:00:45.000Z");
    expect(completed("01:05:00")).toBe("2026-10-20T07:05:00.000Z");
    expect(completed("")).toBe("2026-10-20T06:00:00.000Z");
  });
});

describe("Strava", () => {
  it("imports only runs, using the last Elapsed Time and Distance columns", () => {
    const parsed = parseHistoryFile(fixture("strava-activities.csv"), opts());
    expect(parsed.format).toBe("strava");
    expect(parsed.workouts).toEqual([]);
    expect(parsed.unitsFromFile).toBe(true);
    expect(parsed.skippedActivities).toEqual({ Ride: 2, Swim: 1 });
    expect(parsed.issues).toEqual([
      { line: 9, code: "duplicate" },
      { line: 10, code: "future" },
    ]);
    expect(parsed.runs).toEqual([
      {
        externalId: "1001",
        name: "Morning Run",
        startedAt: "2026-10-20T06:00:00.000Z",
        durationSeconds: 1850,
        distanceMeters: 5012.3,
        environment: "outdoor",
      },
      {
        externalId: "1002",
        name: "Hills, Hills, Hills",
        startedAt: "2026-10-21T17:30:00.000Z",
        durationSeconds: 3600,
        distanceMeters: 8000,
        environment: "outdoor",
      },
      {
        externalId: "1003",
        name: "Treadmill Session",
        startedAt: "2026-10-22T07:00:00.000Z",
        durationSeconds: 1200,
        distanceMeters: null,
        environment: "treadmill",
      },
      {
        externalId: "1004",
        name: "Run",
        startedAt: "2026-10-23T07:00:00.000Z",
        durationSeconds: 1851,
        distanceMeters: null,
        environment: "unspecified",
      },
    ]);
  });

  it("uses the option unit when Distance appears once", () => {
    const csv =
      'Activity ID,Activity Date,Activity Type,Elapsed Time,Distance\n1,"Oct 20, 2026, 6:00:00 AM",Run,1800,5.0\n';
    const km = parseHistoryFile(csv, opts());
    expect(km.unitsFromFile).toBe(false);
    expect(km.runs[0]?.distanceMeters).toBe(5000);
    const mi = parseHistoryFile(csv, opts({ distanceUnit: "mi" }));
    expect(mi.runs[0]?.distanceMeters).toBe(8046.72);
  });

  it("flags out-of-range and malformed runs", () => {
    const csv = [
      "Activity ID,Activity Date,Activity Type,Elapsed Time,Distance,Elapsed Time,Distance",
      '1,"Oct 20, 2026, 6:00:00 AM",Run,0,0,100000,1000',
      '2,"Oct 20, 2026, 6:00:00 AM",Run,0,0,0,1000',
      '3,"Oct 20, 2026, 6:00:00 AM",Run,0,0,1800,2000000',
      '4,"Oct 20, 2026, 6:00:00 AM",Run,0,0,abc,1000',
      "5,bad date,Run,0,0,1800,1000",
      '6,"Oct 20, 2026, 6:00:00 AM",Trail_Run,0,0,1800,1000',
    ].join("\n");
    const parsed = parseHistoryFile(csv, opts());
    expect(parsed.issues).toEqual([
      { line: 2, code: "out_of_range" },
      { line: 3, code: "out_of_range" },
      { line: 4, code: "out_of_range" },
      { line: 5, code: "invalid_number" },
      { line: 6, code: "invalid_date" },
    ]);
    expect(parsed.runs.map((r) => r.externalId)).toEqual(["6"]);
  });
});

describe("generic", () => {
  it("parses the Mizyun generic format", () => {
    const parsed = parseHistoryFile(fixture("generic.csv"), opts());
    expect(parsed.format).toBe("generic");
    expect(parsed.issues).toEqual([]);
    expect(parsed.unitsFromFile).toBe(true);
    expect(parsed.workouts).toHaveLength(2);
    const full = workoutNamed(parsed, "Full Body");
    // Date-only values mean 12:00 local (CEST on 19 Oct 2026).
    expect(full.startedAt).toBe("2026-10-19T10:00:00.000Z");
    expect(full.completedAt).toBe(full.startedAt);
    expect(full.externalId).toBe("2026-10-19T10:00:00.000Z|Full Body");
    expect(full.notes).toBe("Felt ok");
    expect(full.exercises.map((e) => e.sourceName)).toEqual([
      "Squat",
      "Plank",
      "Rowing Machine",
    ]);
    expect(full.exercises[0]?.sets.map((s) => s.setType)).toEqual([
      "warmup",
      "normal",
    ]);
    expect(full.exercises[0]?.sets[1]).toMatchObject({
      loadKg: 100,
      perceivedExertion: 7,
    });
    expect(full.exercises[1]?.sets[0]?.durationSeconds).toBe(90);
    expect(full.exercises[2]?.sets[0]).toMatchObject({
      durationSeconds: 480,
      distanceMeters: 2000,
    });
    const bench = workoutNamed(parsed, "Workout");
    expect(bench.startedAt).toBe("2026-10-21T16:00:00.000Z");
    expect(bench.exercises[0]?.sets[0]?.loadKg).toBe(83.915);
  });

  it("groups interleaved rows of one workout instead of flagging a duplicate", () => {
    const csv =
      "date,workout,exercise,reps,weight\n" +
      "2026-10-19,A,Squat,5,100\n" +
      "2026-10-20,B,Bench,5,80\n" +
      "2026-10-19,A,Squat,5,105\n";
    const parsed = parseHistoryFile(csv, opts());
    expect(parsed.issues).toEqual([]);
    expect(parsed.workouts).toHaveLength(2);
    expect(workoutNamed(parsed, "A").exercises[0]?.sets).toHaveLength(2);
  });

  it("merges repeated exercise names into the first position", () => {
    const csv =
      "date,workout,exercise,reps,weight\n" +
      "2026-10-20 08:00,A,Squat,5,100\n" +
      "2026-10-20 08:00,A,Bench,5,60\n" +
      "2026-10-20 08:00,A,  squat ,5,110\n";
    const workout = parseHistoryFile(csv, opts())
      .workouts[0] as ImportedWorkout;
    expect(workout.exercises.map((e) => e.sourceName)).toEqual([
      "Squat",
      "Bench",
    ]);
    expect(workout.exercises[0]?.sets.map((s) => s.loadKg)).toEqual([100, 110]);
  });
});

describe("malformed rows", () => {
  it("reports each issue code with the physical line, even after a multi-line field", () => {
    const parsed = parseHistoryFile(fixture("malformed.csv"), opts());
    expect(parsed.issues).toEqual([
      { line: 3, code: "invalid_date" },
      { line: 4, code: "invalid_number" },
      { line: 5, code: "out_of_range" },
      { line: 6, code: "malformed_row" },
      { line: 7, code: "empty_set" },
      { line: 9, code: "malformed_row" },
      { line: 12, code: "invalid_number" },
      { line: 13, code: "out_of_range" },
    ]);
    expect(parsed.workouts).toHaveLength(1);
    const day = parsed.workouts[0] as ImportedWorkout;
    expect(day.exercises.map((e) => e.sourceName)).toEqual([
      "Squat",
      "Deadlift",
    ]);
    expect(day.exercises[1]?.sets).toHaveLength(1);
  });

  it("rejects decimal commas outside semicolon files", () => {
    const csv = 'date,exercise,weight\n2026-10-19 10:00,Squat,"82,5"\n';
    const parsed = parseHistoryFile(csv, opts());
    expect(parsed.issues).toEqual([{ line: 2, code: "invalid_number" }]);
    expect(parsed.workouts).toEqual([]);
  });

  it("accepts short rows and empty extra cells", () => {
    const csv =
      "date,exercise,reps,weight\n2026-10-19 10:00,Squat,5\n2026-10-19 10:00,Bench,5,60,,\n";
    const parsed = parseHistoryFile(csv, opts());
    expect(parsed.issues).toEqual([]);
    expect(parsed.workouts[0]?.exercises).toHaveLength(2);
  });
});

describe("duplicates and future records", () => {
  it("skips a workout exported twice but keeps repeated identical sets", () => {
    const parsed = parseHistoryFile(fixture("duplicates.csv"), opts());
    expect(parsed.issues).toEqual([{ line: 5, code: "duplicate" }]);
    expect(parsed.workouts.map((w) => w.name)).toEqual(["Push", "Pull"]);
    expect(parsed.workouts[0]?.exercises[0]?.sets).toHaveLength(2);
    const sets = parsed.workouts[0]?.exercises[0]?.sets ?? [];
    expect(sets[0]).toEqual(sets[1]);
  });

  it("skips workouts that end after now", () => {
    const parsed = parseHistoryFile(
      fixture("strong-comma.csv"),
      opts({ now: new Date("2026-10-22T17:00:00Z") }),
    );
    // Evening Lift ends 17:05Z, after now; Morning Run is entirely in the future.
    expect(parsed.workouts).toEqual([]);
    expect(parsed.issues).toEqual([
      { line: 2, code: "future" },
      { line: 8, code: "empty_set" },
      { line: 9, code: "future" },
    ]);
  });
});

describe("time zones", () => {
  const start = (value: string, timezone: string): string =>
    (
      parseHistoryFile(
        `date,exercise,reps\n${value},Squat,5\n`,
        opts({ timezone }),
      ).workouts[0] as ImportedWorkout
    ).startedAt;

  it("converts local wall times across DST changes", () => {
    expect(start("2026-03-28 12:00", "Europe/Bratislava")).toBe(
      "2026-03-28T11:00:00.000Z",
    );
    expect(start("2026-03-29 12:00", "Europe/Bratislava")).toBe(
      "2026-03-29T10:00:00.000Z",
    );
    expect(start("2026-10-24 12:00", "Europe/Bratislava")).toBe(
      "2026-10-24T10:00:00.000Z",
    );
    expect(start("2026-10-25 12:00", "Europe/Bratislava")).toBe(
      "2026-10-25T11:00:00.000Z",
    );
    expect(start("2026-03-08 12:00", "America/New_York")).toBe(
      "2026-03-08T16:00:00.000Z",
    );
    expect(start("2026-01-10 12:00", "America/New_York")).toBe(
      "2026-01-10T17:00:00.000Z",
    );
  });

  it("honours explicit ISO offsets regardless of the option zone", () => {
    expect(start("2026-10-20T07:30:00+02:00", "America/New_York")).toBe(
      "2026-10-20T05:30:00.000Z",
    );
    expect(start("2026-10-20T07:30:00Z", "Asia/Tokyo")).toBe(
      "2026-10-20T07:30:00.000Z",
    );
  });
});

describe("limits and file errors", () => {
  it("rejects oversized and over-long files", () => {
    expect(
      errorCode(() =>
        parseHistoryFile(fixture("hevy-kg.csv"), opts(), undefined, {
          maxContentLength: 100,
        }),
      ),
    ).toBe("too_large");
    expect(
      errorCode(() =>
        parseHistoryFile(fixture("hevy-kg.csv"), opts(), undefined, {
          maxRows: 3,
        }),
      ),
    ).toBe("too_many_rows");
  });

  it("limits record counts", () => {
    expect(
      errorCode(() =>
        parseHistoryFile(fixture("hevy-kg.csv"), opts(), undefined, {
          maxWorkouts: 1,
        }),
      ),
    ).toBe("too_many_records");
    expect(
      errorCode(() =>
        parseHistoryFile(fixture("strava-activities.csv"), opts(), undefined, {
          maxRuns: 1,
        }),
      ),
    ).toBe("too_many_records");
  });

  it("keeps the first sets of an oversized workout", () => {
    const parsed = parseHistoryFile(fixture("hevy-kg.csv"), opts(), undefined, {
      maxSetsPerWorkout: 2,
    });
    expect(parsed.issues).toEqual([{ line: 2, code: "too_many_sets" }]);
    const push = workoutNamed(parsed, "Push Day");
    expect(push.exercises.map((e) => e.sets.length)).toEqual([2]);
  });

  it("flags oversize cells as malformed rows", () => {
    const parsed = parseHistoryFile(
      "date,exercise,reps,notes\n2026-10-20,Squat,5,ok\n2026-10-20,Bench,5,this note is far too long\n",
      opts(),
      undefined,
      { maxCellLength: 10 },
    );
    expect(parsed.issues).toEqual([{ line: 3, code: "malformed_row" }]);
    expect(parsed.workouts[0]?.exercises.map((e) => e.sourceName)).toEqual([
      "Squat",
    ]);
  });

  it("rejects invalid timezones, unknown formats, missing columns and empty files", () => {
    expect(
      errorCode(() =>
        parseHistoryFile(
          fixture("generic.csv"),
          opts({ timezone: "Mars/Olympus" }),
        ),
      ),
    ).toBe("invalid_timezone");
    expect(
      errorCode(() =>
        parseHistoryFile(fixture("generic.csv"), opts({ timezone: "+02:00" })),
      ),
    ).toBe("invalid_timezone");
    expect(errorCode(() => parseHistoryFile("foo,bar\n1,2\n", opts()))).toBe(
      "unknown_format",
    );
    expect(
      errorCode(() => parseHistoryFile(fixture("generic.csv"), opts(), "hevy")),
    ).toBe("missing_columns");
    expect(
      errorCode(() => parseHistoryFile("date,exercise\n\n\n", opts())),
    ).toBe("empty");
    expect(errorCode(() => parseHistoryFile("", opts()))).toBe("empty");
  });
});

describe("bounds the import RPC enforces", () => {
  it("skips workouts before 1970 or lasting more than two days as out_of_range", () => {
    const csv =
      "date,workout,exercise,reps,weight\n" +
      "1969-12-31,Old,Squat,5,100\n" +
      "2026-10-19,Ok,Squat,5,100\n";
    const parsed = parseHistoryFile(csv, opts());
    expect(parsed.workouts.map((w) => w.name)).toEqual(["Ok"]);
    expect(parsed.issues).toEqual([{ line: 2, code: "out_of_range" }]);

    const hevy =
      "title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_index,set_type,weight_kg,reps,distance_km,duration_seconds,rpe\n" +
      "Left running,2026-10-10 07:00,2026-10-13 07:00,,Bench Press (Barbell),,,0,normal,60,5,,,\n";
    const long = parseHistoryFile(hevy, opts());
    expect(long.workouts).toEqual([]);
    expect(long.issues).toEqual([{ line: 2, code: "out_of_range" }]);
  });

  it("skips Strava runs before 1970", () => {
    const csv =
      "Activity ID,Activity Date,Activity Name,Activity Type,Elapsed Time,Distance\n" +
      '1,"Dec 31, 1969, 7:00:00 AM",Old,Run,1800,5\n' +
      '2,"Oct 20, 2026, 7:00:00 AM",New,Run,1800,5\n';
    const parsed = parseHistoryFile(csv, opts());
    expect(parsed.runs.map((r) => r.externalId)).toEqual(["2"]);
    expect(parsed.issues).toEqual([{ line: 2, code: "out_of_range" }]);
  });
});
