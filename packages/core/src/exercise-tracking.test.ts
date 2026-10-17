import { describe, expect, it, vi } from "vitest";
import {
  EXERCISE_CATALOG,
  findCatalogExercise,
  getExerciseFromCatalog,
} from "./exercise-catalog";
import {
  TIMED_ACTIVITY_IDS,
  bareDurationUnit,
  formatTrackedDuration,
  getCatalogTrackingMode,
  listTimedActivities,
  metresFromTrackedDistance,
  parseDurationInput,
  resolveExerciseTrackingMode,
  resolveTrackedDistanceUnit,
  trackedDistanceFromMetres,
} from "./exercise-tracking";

describe("exercise tracking modes", () => {
  it("measures swimming and cycling by time and distance, holds by time", () => {
    expect(resolveExerciseTrackingMode({ name: "Swimming" })).toBe(
      "duration_distance",
    );
    expect(resolveExerciseTrackingMode({ name: "outdoor cycling" })).toBe(
      "duration_distance",
    );
    expect(resolveExerciseTrackingMode({ name: "Forearm plank" })).toBe(
      "duration",
    );
    expect(resolveExerciseTrackingMode({ name: "Jump Rope" })).toBe("duration");
  });

  it("keeps strength, rep-based cardio and unknown custom exercises on load and reps", () => {
    for (const name of [
      "Barbell Bench Press",
      "Burpees",
      "Hanging Leg Raise",
      "Plank Knee Tuck",
      "My custom swim drill",
      "",
    ]) {
      expect(resolveExerciseTrackingMode({ name })).toBe("load_reps");
    }
  });

  it("builds its name index quickly on first use", async () => {
    vi.resetModules();
    const fresh = await import("./exercise-tracking");
    const started = performance.now();
    expect(fresh.resolveExerciseTrackingMode({ name: "Swimming" })).toBe(
      "duration_distance",
    );
    expect(performance.now() - started).toBeLessThan(100);
  });

  it("resolves every exact catalog name the same as a fresh lookup", () => {
    for (const exercise of EXERCISE_CATALOG) {
      const fresh = findCatalogExercise(exercise.name)!;
      expect(resolveExerciseTrackingMode({ name: exercise.name })).toBe(
        getCatalogTrackingMode(fresh),
      );
    }
  });

  it("uses only exact names, not the best fuzzy search hit", () => {
    // "swim" is an alias search hit, not an exact catalog name.
    expect(resolveExerciseTrackingMode({ name: "swim" })).toBe("load_reps");
    expect(resolveExerciseTrackingMode({ name: "  SWIMMING " })).toBe(
      "duration_distance",
    );
  });

  it("prefers a valid saved trackingMode, then a saved catalogId", () => {
    expect(
      resolveExerciseTrackingMode({
        name: "Barbell Bench Press",
        metadata: { trackingMode: "duration" },
      }),
    ).toBe("duration");
    expect(
      resolveExerciseTrackingMode({
        name: "Pool laps",
        metadata: { catalogId: "exercise-swimming" },
      }),
    ).toBe("duration_distance");
    expect(
      resolveExerciseTrackingMode({
        name: "Swimming",
        metadata: { trackingMode: "laps", catalogId: 42 },
      }),
    ).toBe("duration_distance");
  });

  it("references only active catalog ids", () => {
    const timed = EXERCISE_CATALOG.filter(
      (exercise) => getCatalogTrackingMode(exercise) !== "load_reps",
    );
    expect(timed.length).toBe(36);
    expect(listTimedActivities().map((exercise) => exercise.id)).toEqual([
      ...TIMED_ACTIVITY_IDS,
    ]);
    for (const id of TIMED_ACTIVITY_IDS) {
      expect(getCatalogTrackingMode(getExerciseFromCatalog(id)!)).not.toBe(
        "load_reps",
      );
    }
  });
});

describe("duration input", () => {
  it("parses minutes, mm:ss and h:mm:ss", () => {
    expect(parseDurationInput("45")).toBe(2700);
    expect(parseDurationInput(" 1:30 ")).toBe(90);
    expect(parseDurationInput("75:00")).toBe(4500);
    expect(parseDurationInput("1:05:09")).toBe(3909);
    expect(parseDurationInput("24:00:00")).toBe(86_400);
    expect(parseDurationInput("")).toBeNull();
  });

  it("reads a bare number as seconds for holds", () => {
    expect(parseDurationInput("45", "seconds")).toBe(45);
    expect(parseDurationInput("1:30", "seconds")).toBe(90);
    expect(bareDurationUnit("duration")).toBe("seconds");
    expect(bareDurationUnit("duration_distance")).toBe("minutes");
  });

  it("rejects zero, out-of-range and malformed values", () => {
    for (const raw of [
      "0",
      "0:00",
      "1:60",
      "1:60:00",
      "24:00:01",
      "1.5",
      "-5",
      "1:2:3:4",
      "abc",
      ":30",
    ]) {
      expect(parseDurationInput(raw)).toBe("invalid");
    }
  });

  it("formats under and over an hour", () => {
    expect(formatTrackedDuration(90)).toBe("1:30");
    expect(formatTrackedDuration(2700)).toBe("45:00");
    expect(formatTrackedDuration(3909)).toBe("1:05:09");
    expect(formatTrackedDuration(-3)).toBe("0:00");
  });
});

describe("tracked distance units", () => {
  it("uses pool/machine units for swimming, rowing and SkiErg, road units otherwise", () => {
    expect(resolveTrackedDistanceUnit({ name: "Swimming" }, "metric")).toBe(
      "m",
    );
    expect(resolveTrackedDistanceUnit({ name: "Swimming" }, "imperial")).toBe(
      "yd",
    );
    expect(
      resolveTrackedDistanceUnit({ name: "Rowing Machine" }, "metric"),
    ).toBe("m");
    expect(
      resolveTrackedDistanceUnit({ name: "Outdoor Cycling" }, "metric"),
    ).toBe("km");
    expect(resolveTrackedDistanceUnit({ name: "Walking" }, "imperial")).toBe(
      "mi",
    );
    expect(
      resolveTrackedDistanceUnit(
        { name: "Pool laps", metadata: { catalogId: "exercise-swimming" } },
        "metric",
      ),
    ).toBe("m");
  });

  it("converts to metres at 0.01 m and back for display", () => {
    expect(metresFromTrackedDistance(1500, "m")).toBe(1500);
    expect(metresFromTrackedDistance(500, "yd")).toBe(457.2);
    expect(metresFromTrackedDistance(25.5, "km")).toBe(25_500);
    expect(metresFromTrackedDistance(1, "mi")).toBe(1609.34);
    expect(trackedDistanceFromMetres(457.2, "yd")).toBe(500);
    expect(trackedDistanceFromMetres(25_500, "km")).toBe(25.5);
    expect(trackedDistanceFromMetres(1609.34, "mi")).toBe(1);
  });
});
