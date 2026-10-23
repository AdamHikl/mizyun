import { describe, expect, it } from "vitest";
import {
  buildTimedSetFields,
  entryDistanceUnit,
  entryTrackingMode,
  formatTimedSet,
  weightLoadableEntries,
} from "./timed-set-input";

describe("timed set input", () => {
  it("resolves modes from metadata, catalog id and name", () => {
    expect(entryTrackingMode({ name: "Swimming" }, [])).toBe(
      "duration_distance",
    );
    expect(entryTrackingMode({ name: "Bench Press" }, [])).toBe("load_reps");
    expect(
      entryTrackingMode({ id: "x", name: "My swim" }, [
        { id: "x", name: "My swim", metadata: { trackingMode: "duration" } },
      ]),
    ).toBe("duration");
  });

  it("keeps only weight-and-reps entries for the plate calculator", () => {
    const entries = [
      { id: "a", name: "Bench Press" },
      { id: "b", name: "Swimming" },
      { id: "c", name: "My hold" },
    ];
    const saved = [
      { id: "c", name: "My hold", metadata: { trackingMode: "duration" } },
    ];
    expect(weightLoadableEntries(entries, saved).map((e) => e.id)).toEqual([
      "a",
    ]);
  });

  it("converts yards to metres and rejects bad values", () => {
    expect(
      buildTimedSetFields(
        "duration_distance",
        { durationSeconds: "10:00", distanceMeters: "100" },
        "yd",
      ),
    ).toEqual({ ok: true, durationSeconds: "600", distanceMeters: "91.44" });
    expect(
      buildTimedSetFields(
        "duration_distance",
        { durationSeconds: "1:05:00", distanceMeters: "25,5" },
        "km",
      ),
    ).toEqual({ ok: true, durationSeconds: "3900", distanceMeters: "25500" });
    expect(
      buildTimedSetFields(
        "duration_distance",
        { durationSeconds: "45", distanceMeters: "1001" },
        "km",
      ).ok,
    ).toBe(false);
    expect(
      buildTimedSetFields(
        "duration_distance",
        { durationSeconds: "45", distanceMeters: "-3" },
        "m",
      ).ok,
    ).toBe(false);
    expect(
      buildTimedSetFields(
        "duration",
        { durationSeconds: "abc", distanceMeters: "" },
        "m",
      ).ok,
    ).toBe(false);
  });

  it("picks pool units for swimming and road units for cycling", () => {
    expect(entryDistanceUnit({ name: "Swimming" }, [], "metric")).toBe("m");
    expect(entryDistanceUnit({ name: "Swimming" }, [], "imperial")).toBe("yd");
    expect(
      entryDistanceUnit(
        { name: "Bike", catalogId: "exercise-outdoor-cycling" },
        [],
        "metric",
      ),
    ).toBe("km");
  });

  it("formats saved values in the display unit", () => {
    const set = { durationSeconds: 600, distanceMeters: 400 };
    expect(formatTimedSet(set, "m")).toBe("10:00 · 400 m");
    expect(formatTimedSet(set, "yd")).toBe("10:00 · 437 yd");
    expect(
      formatTimedSet({ durationSeconds: 3900, distanceMeters: 25_500 }, "km"),
    ).toBe("1:05:00 · 25.5 km");
  });
});
