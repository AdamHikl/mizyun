import { describe, expect, it } from "vitest";
import { listTimedActivities } from "@mizyun/core";
import {
  activityDistanceUnit,
  activityTimes,
  activityTracksDistance,
  parseActivityForm,
} from "./log-activity-form";

const base = {
  minutes: "45",
  seconds: "",
  distance: "",
  unit: "m" as const,
  tracksDistance: true,
};
const by = (name: string) =>
  listTimedActivities().find((a) => a.name === name)!;

describe("log activity form", () => {
  it("parses duration and converts distance", () => {
    expect(parseActivityForm({ ...base, distance: "1500" })).toEqual({
      ok: true,
      durationSeconds: 2700,
      distanceMeters: 1500,
    });
    expect(
      parseActivityForm({
        ...base,
        minutes: "90",
        seconds: "30",
        distance: "2,5",
        unit: "km",
      }),
    ).toEqual({ ok: true, durationSeconds: 5430, distanceMeters: 2500 });
    expect(
      parseActivityForm({ ...base, distance: "100", unit: "yd" }),
    ).toMatchObject({
      distanceMeters: 91.44,
    });
  });
  it("rejects invalid values and ignores distance when untracked", () => {
    for (const bad of [
      { minutes: "", seconds: "" },
      { minutes: "0", seconds: "0" },
      { seconds: "75" },
      { minutes: "4x" },
      { minutes: "1441" },
      { distance: "abc" },
      { distance: "0" },
      { distance: "1000001" },
    ])
      expect(parseActivityForm({ ...base, ...bad }).ok).toBe(false);
    expect(
      parseActivityForm({ ...base, distance: "junk", tracksDistance: false }),
    ).toMatchObject({ ok: true, distanceMeters: null });
  });
  it("chooses units and distance tracking per activity", () => {
    expect(activityDistanceUnit(by("Swimming"), "metric")).toBe("m");
    expect(activityDistanceUnit(by("Swimming"), "imperial")).toBe("yd");
    expect(activityDistanceUnit(by("Outdoor Cycling"), "imperial")).toBe("mi");
    expect(activityDistanceUnit(by("Rowing Machine"), "metric")).toBe("m");
    expect(activityDistanceUnit(by("Walking"), "metric")).toBe("km");
    expect(activityTracksDistance(by("Swimming"))).toBe(true);
    expect(activityTracksDistance(by("Jump Rope"))).toBe(false);
  });
  it("derives times", () => {
    const now = new Date("2026-10-17T10:00:00.000Z");
    expect(activityTimes(now, 0, 600)).toEqual({
      startedAt: "2026-10-17T09:50:00.000Z",
      completedAt: now.toISOString(),
    });
    const past = activityTimes(now, 2, 600);
    expect(Date.parse(past.completedAt) - Date.parse(past.startedAt)).toBe(
      600_000,
    );
    expect(new Date(past.startedAt).getHours()).toBe(12);
  });
  it("never ends a long earlier-day activity in the future", () => {
    const now = new Date(2026, 9, 17, 9, 0, 0);
    const long = activityTimes(now, 1, 23 * 3600);
    expect(long.completedAt).toBe(now.toISOString());
    expect(Date.parse(long.completedAt) - Date.parse(long.startedAt)).toBe(
      23 * 3600 * 1000,
    );
  });
});
