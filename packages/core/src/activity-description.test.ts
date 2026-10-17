import { describe, expect, it } from "vitest";
import {
  draftActivityFromDescription,
  resolveActivityName,
  resolvedActivityLabel,
} from "./activity-description";

// Saturday 17 October 2026, 15:00 local.
const now = new Date(2026, 9, 17, 15, 0);
const draft = (text: string) => draftActivityFromDescription(text, now);
const ymd = (year: number, month: number, day: number) => ({
  year,
  month,
  day,
});

describe("resolveActivityName", () => {
  it("maps everyday words to catalog activities", () => {
    const result = resolveActivityName("swim");
    expect(result?.kind).toBe("catalog");
    if (result?.kind === "catalog") {
      expect(result.exercise.id).toBe("exercise-swimming");
    }
  });

  it("maps running words to running", () => {
    expect(resolveActivityName("Jogging")).toEqual({
      kind: "running",
      name: "Running",
    });
  });

  it("prefers the stationary bike over outdoor cycling", () => {
    const result = resolveActivityName("stationary bike");
    expect(result?.kind).toBe("catalog");
    if (result?.kind === "catalog") {
      expect(result.exercise.id).toBe("stationary-bike");
    }
  });

  it("keeps unknown activities as custom with the typed name", () => {
    expect(resolveActivityName("Padel")).toEqual({
      kind: "custom",
      name: "Padel",
    });
  });

  it("returns null for blank text", () => {
    expect(resolveActivityName("  ")).toBeNull();
  });

  it("labels resolved activities", () => {
    expect(resolvedActivityLabel({ kind: "running", name: "Running" })).toBe(
      "Running",
    );
    expect(resolvedActivityLabel({ kind: "custom", name: "Padel" })).toBe(
      "Padel",
    );
    const swim = resolveActivityName("swim");
    expect(swim && resolvedActivityLabel(swim)).toBeTruthy();
  });
});

describe("draftActivityFromDescription", () => {
  it("parses a full running description", () => {
    const result = draft("I ran for 45 minutes and 10km, yesterday at 19:00");
    expect(result.activity?.kind).toBe("running");
    expect(result.durationSeconds).toBe(2700);
    expect(result.distance).toEqual({ value: 10, unit: "km" });
    expect(result.date).toEqual(ymd(2026, 10, 16));
    expect(result.startTime).toEqual({ hour: 19, minute: 0 });
    expect(result.endedNow).toBe(false);
  });

  it("parses a swim that just ended", () => {
    const result = draft("I just went swimming for half an hour in the ocean");
    expect(result.activity?.kind).toBe("catalog");
    if (result.activity?.kind === "catalog") {
      expect(result.activity.exercise.id).toBe("exercise-swimming");
    }
    expect(result.durationSeconds).toBe(1800);
    expect(result.date).toEqual(ymd(2026, 10, 17));
    expect(result.startTime).toBeNull();
    expect(result.endedNow).toBe(true);
    expect(result.note).toBe("In the ocean");
  });

  describe("durations", () => {
    it.each([
      ["a run for an hour and a half", 5400],
      ["a run for 1h 20m", 4800],
      ["a run for 90 mins", 5400],
      ["a run for 1 hour 15 minutes", 4500],
      ["a run for 45:30", 2730],
    ])("%s -> %d s", (text, seconds) => {
      expect(draft(text).durationSeconds).toBe(seconds);
    });

    it("does not read the minutes of 1h 20m as a 20 m distance", () => {
      const result = draft("a run for 1h 20m");
      expect(result.durationSeconds).toBe(4800);
      expect(result.distance).toBeNull();
    });
  });

  describe("distances", () => {
    it.each([
      ["ran 5k", { value: 5, unit: "km" }],
      ["ran 3 miles", { value: 3, unit: "mi" }],
      ["swam 800m", { value: 800, unit: "m" }],
      ["ran a half marathon", { value: 21.0975, unit: "km" }],
      ["swam 500 yards", { value: 500, unit: "yd" }],
    ])("%s", (text, distance) => {
      expect(draft(text).distance).toEqual(distance);
    });
  });

  describe("dates", () => {
    it.each([
      ["ran 2 days ago", ymd(2026, 10, 15)],
      ["ran on monday", ymd(2026, 10, 12)],
      ["ran on 12 oct", ymd(2026, 10, 12)],
      ["ran on october 20", ymd(2025, 10, 20)],
      ["ran on 2026-10-01", ymd(2026, 10, 1)],
      ["ran last night", ymd(2026, 10, 16)],
    ])("%s", (text, date) => {
      expect(draft(text).date).toEqual(date);
    });

    it("treats last night as 19:00", () => {
      expect(draft("ran last night").startTime).toEqual({
        hour: 19,
        minute: 0,
      });
    });
  });

  describe("times", () => {
    it.each([
      ["ran yesterday at 7pm", { hour: 19, minute: 0 }],
      ["ran yesterday at 7:30 am", { hour: 7, minute: 30 }],
      ["ran yesterday at 19.15", { hour: 19, minute: 15 }],
    ])("%s", (text, time) => {
      expect(draft(text).startTime).toEqual(time);
    });

    it("leaves a bare 'at 7' unresolved", () => {
      expect(draft("ran yesterday at 7").startTime).toBeNull();
    });
  });

  describe("false positives", () => {
    it("does not read 'I am happy' as a distance or duration", () => {
      const result = draft("I am happy");
      expect(result.distance).toBeNull();
      expect(result.durationSeconds).toBeNull();
    });

    it("does not read 'as' as one second", () => {
      expect(draft("as").durationSeconds).toBeNull();
    });

    it("does not read 'decided' as a date", () => {
      expect(draft("I decided to go").date).toBeNull();
    });
  });

  it("detects the treadmill environment", () => {
    const result = draft("treadmill run");
    expect(result.environment).toBe("treadmill");
    expect(result.activity?.kind).toBe("running");
  });
});

describe("review regressions", () => {
  it("reads 'day before yesterday' as two days ago", () => {
    expect(draft("ran 5k the day before yesterday").date).toEqual(
      ymd(2026, 10, 15),
    );
  });

  it("lets a named day win over 'just'", () => {
    const result = draft("I ran just under 10k last Friday");
    expect(result.date).toEqual(ymd(2026, 10, 16));
    expect(result.endedNow).toBe(false);
  });

  it("reads a thousands separator and keeps a decimal comma", () => {
    expect(draft("swam 1,500 m").distance).toEqual({ value: 1500, unit: "m" });
    expect(draft("ran 2,5 km").distance).toEqual({ value: 2.5, unit: "km" });
  });

  it("keeps a distance after an hours-only duration", () => {
    const result = draft("rode my bike 2h 30km");
    expect(result.durationSeconds).toBe(7200);
    expect(result.distance).toEqual({ value: 30, unit: "km" });
  });

  it("ignores pace and reads compound and 'for 20m' durations", () => {
    const paced = draft("ran 10 km at 5 min/km in 50 minutes");
    expect(paced.durationSeconds).toBe(3000);
    expect(paced.distance).toEqual({ value: 10, unit: "km" });
    expect(draft("walked for twenty-five minutes").durationSeconds).toBe(1500);
    expect(draft("walked for twenty five minutes").durationSeconds).toBe(1500);
    const forM = draft("ran for 20m");
    expect(forM.durationSeconds).toBe(1200);
    expect(forM.distance).toBeNull();
  });

  it("does not pick activities from common words and prefers the first mention", () => {
    expect(draft("three days in a row").activity).toBeNull();
    expect(draft("got a ride home").activity).toBeNull();
    const result = draft("swam then walked home");
    expect(
      result.activity?.kind === "catalog" && result.activity.exercise.id,
    ).toBe("exercise-swimming");
  });

  it("resolves catalog running names to runs and strength names away from activities", () => {
    expect(resolveActivityName("Treadmill Running")?.kind).toBe("running");
    expect(resolveActivityName("Jogging, Treadmill")?.kind).toBe("running");
    expect(resolveActivityName("Barbell Bench Press")?.kind).toBe("strength");
  });
  it("reads thousands touching the unit, metre distances after 'for' and 'in mm:ss'", () => {
    expect(draft("swam 1,500m").distance).toEqual({ value: 1500, unit: "m" });
    const rowed = draft("rowed 5,000m in 20 min");
    expect(rowed.distance).toEqual({ value: 5000, unit: "m" });
    expect(rowed.durationSeconds).toBe(1200);
    const swam = draft("swam for 400m");
    expect(swam.distance).toEqual({ value: 400, unit: "m" });
    expect(swam.durationSeconds).toBeNull();
    expect(draft("ran 10km in 45:30").durationSeconds).toBe(2730);
  });
});
