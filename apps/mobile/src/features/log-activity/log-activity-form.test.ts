import { describe, expect, it } from "vitest";
import {
  listTimedActivities,
  resolveActivityName,
  trackedDistanceFromMetres,
} from "@mizyun/core";
import {
  activityDistanceUnit,
  activityTimes,
  activityTracksDistance,
  defaultStartTime,
  distanceFieldText,
  parseActivityForm,
  resolvedDistance,
  runCreateBody,
  toLocalDate,
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
  it("derives times from a start time exactly", () => {
    const now = new Date(2026, 9, 17, 20, 0, 0);
    const result = activityTimes(
      now,
      { year: 2026, month: 10, day: 16 },
      { hour: 19, minute: 0 },
      2700,
    );
    expect(result).toEqual({
      ok: true,
      startedAt: new Date(2026, 9, 16, 19, 0, 0).toISOString(),
      completedAt: new Date(2026, 9, 16, 19, 45, 0).toISOString(),
    });
  });
  it("rejects a start time that ends in the future", () => {
    const now = new Date(2026, 9, 17, 19, 30, 0);
    const result = activityTimes(
      now,
      { year: 2026, month: 10, day: 17 },
      { hour: 19, minute: 0 },
      2700,
    );
    expect(result.ok).toBe(false);
  });
  it("rejects a future date", () => {
    const now = new Date(2026, 9, 17, 10, 0, 0);
    const result = activityTimes(
      now,
      { year: 2026, month: 10, day: 18 },
      null,
      600,
    );
    expect(result).toMatchObject({ ok: false });
  });
  it("ends now for today without a time", () => {
    const now = new Date("2026-10-17T10:00:00.000Z");
    const result = activityTimes(now, toLocalDate(now), null, 600);
    expect(result).toEqual({
      ok: true,
      startedAt: "2026-10-17T09:50:00.000Z",
      completedAt: now.toISOString(),
    });
  });
  it("uses local noon for an earlier day without a time", () => {
    const now = new Date(2026, 9, 17, 10, 0, 0);
    const result = activityTimes(
      now,
      { year: 2026, month: 10, day: 15 },
      null,
      600,
    );
    expect(result).toEqual({
      ok: true,
      startedAt: new Date(2026, 9, 15, 12, 0, 0).toISOString(),
      completedAt: new Date(2026, 9, 15, 12, 10, 0).toISOString(),
    });
  });
  it("never ends a long earlier-day activity in the future", () => {
    const now = new Date(2026, 9, 17, 9, 0, 0);
    const long = activityTimes(
      now,
      { year: 2026, month: 10, day: 16 },
      null,
      23 * 3600,
    );
    expect(long).toMatchObject({ ok: true, completedAt: now.toISOString() });
    if (long.ok)
      expect(Date.parse(long.completedAt) - Date.parse(long.startedAt)).toBe(
        23 * 3600 * 1000,
      );
  });
  it("offers an hour before the current hour as the start time", () => {
    expect(defaultStartTime(new Date(2026, 9, 19, 19, 42))).toEqual({
      hour: 18,
      minute: 0,
    });
    expect(defaultStartTime(new Date(2026, 9, 19, 0, 20))).toEqual({
      hour: 0,
      minute: 0,
    });
  });
  it("writes drafted distance in the field unit", () => {
    expect(distanceFieldText({ value: 10, unit: "km" }, "km")).toBe("10");
    expect(distanceFieldText({ value: 800, unit: "m" }, "yd")).toBe(
      String(trackedDistanceFromMetres(800, "yd")),
    );
  });
  it("resolves distance tracking for running, custom and catalog", () => {
    expect(resolvedDistance(resolveActivityName("Running"), "metric")).toEqual({
      tracksDistance: true,
      unit: "km",
    });
    expect(
      resolvedDistance(resolveActivityName("Running"), "imperial"),
    ).toEqual({ tracksDistance: true, unit: "mi" });
    expect(resolvedDistance(resolveActivityName("Padel"), "metric")).toEqual({
      tracksDistance: true,
      unit: "km",
    });
    expect(resolvedDistance(resolveActivityName("Swimming"), "metric")).toEqual(
      { tracksDistance: true, unit: "m" },
    );
    expect(
      resolvedDistance(resolveActivityName("Jump Rope"), "metric"),
    ).toEqual(expect.objectContaining({ tracksDistance: false }));
    expect(resolvedDistance(null, "metric").tracksDistance).toBe(true);
  });
  describe("runCreateBody", () => {
    const input = {
      operationId: "11111111-2222-4333-8444-555555555555",
      now: new Date(2026, 9, 17, 20, 0, 0),
      date: { year: 2026, month: 10, day: 16 },
      startTime: null as { hour: number; minute: number } | null,
      durationSeconds: 2700,
      distanceMeters: 10000 as number | null,
      environment: "outdoor" as const,
      notes: "  felt good ",
      timeZone: "Europe/London",
    };
    it("keeps day precision without a start time", () => {
      const result = runCreateBody(input);
      expect(result).toMatchObject({
        ok: true,
        body: {
          clientOperationId: input.operationId,
          activityDate: "2026-10-16",
          recordingTimezone: "Europe/London",
          startedAt: null,
          durationSeconds: 2700,
          distanceMeters: 10000,
          environment: "outdoor",
          notes: "felt good",
        },
      });
    });
    it("records an exact instant with a start time", () => {
      const result = runCreateBody({
        ...input,
        startTime: { hour: 19, minute: 0 },
        notes: "",
      });
      expect(result).toMatchObject({
        ok: true,
        body: {
          startedAt: new Date(2026, 9, 16, 19, 0, 0).toISOString(),
          notes: null,
        },
      });
    });
    it("rejects a run that would end in the future", () => {
      expect(
        runCreateBody({ ...input, date: { year: 2026, month: 10, day: 18 } })
          .ok,
      ).toBe(false);
      expect(
        runCreateBody({
          ...input,
          date: { year: 2026, month: 10, day: 17 },
          startTime: { hour: 19, minute: 30 },
        }).ok,
      ).toBe(false);
    });
  });
});
