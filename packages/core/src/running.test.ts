import { describe, expect, it } from "vitest";
import {
  createRunSummary,
  runTimestampEnvelope,
  runningDate,
  formatRunPace,
  formatRunDuration,
  metresFromDistance,
  distanceFromMetres,
  readRunSummary,
  summarizeRuns,
} from "./running";
const input = {
  activityDate: "2026-10-06",
  recordingTimezone: "Europe/Bratislava",
  startedAt: null,
  durationSeconds: 1800,
  distanceMeters: 5000,
  environment: "outdoor" as const,
  perceivedExertion: null,
};
describe("running facts and transport", () => {
  it.each([
    "Europe/Bratislava",
    "Pacific/Kiritimati",
    "Etc/GMT+12",
    "America/New_York",
  ])("keeps day-only anchors and duration distinct in %s", (zone) => {
    const summary = createRunSummary({ ...input, recordingTimezone: zone });
    const result = runTimestampEnvelope(summary);
    expect(result.startedAt.getTime()).toBe(result.completedAt.getTime());
    expect(runningDate(result.startedAt, zone)).toBe(input.activityDate);
    expect(summary.startedAt).toBeNull();
    expect(summary.durationSeconds).toBe(1800);
  });
  it.each(["2026-03-29", "2026-10-25"])(
    "resolves local noon across DST on %s",
    (date) => {
      const summary = createRunSummary({ ...input, activityDate: date });
      const result = runTimestampEnvelope(summary);
      expect(runningDate(result.startedAt, input.recordingTimezone)).toBe(date);
    },
  );
  it("keeps an observed overnight end and start date truthful", () => {
    const summary = createRunSummary({
      ...input,
      startedAt: "2026-10-06T21:50:00Z",
    });
    const times = runTimestampEnvelope(summary);
    expect(times.completedAt.toISOString()).toBe("2026-10-06T22:20:00.000Z");
    expect(runningDate(times.completedAt, input.recordingTimezone)).toBe(
      "2026-10-07",
    );
  });
  it("rejects mismatched observed date and a nonexistent local day", () => {
    expect(() =>
      createRunSummary({ ...input, startedAt: "2026-10-05T10:00:00Z" }),
    ).toThrow();
    expect(() =>
      runTimestampEnvelope(
        createRunSummary({
          ...input,
          activityDate: "2011-12-30",
          recordingTimezone: "Pacific/Apia",
        }),
      ),
    ).toThrow();
  });
  it("does not leak other request fields into authoritative summary", () => {
    const summary = createRunSummary({
      ...input,
      notes: "not summary data",
    } as typeof input);
    expect(summary).not.toHaveProperty("notes");
  });
  it("returns unavailable for unsupported or invalid summaries", () => {
    expect(
      readRunSummary({
        activityType: "running",
        runSummary: { ...createRunSummary(input), version: 2 },
      }),
    ).toBeNull();
    expect(
      readRunSummary({
        activityType: "running",
        runSummary: { ...createRunSummary(input), distanceMeters: 0 },
      }),
    ).toBeNull();
  });
});
describe("running display and aggregation", () => {
  it("converts canonical quantities and rounds only final pace", () => {
    expect(metresFromDistance(1, "mi")).toBe(1609.34);
    expect(distanceFromMetres(1609.344, "mi")).toBe(1);
    expect(formatRunPace(1800, 5000, "km")).toBe("6:00 /km");
    expect(formatRunPace(1800, 5000, "mi")).toBe("9:39 /mi");
    expect(formatRunPace(359.6, 1000, "km")).toBe("6:00 /km");
  });
  it("does not invent missing pace and supports long durations", () => {
    expect(formatRunPace(1800, null, "km")).toBeNull();
    expect(formatRunPace(1800, 0, "km")).toBeNull();
    expect(formatRunDuration(5401)).toBe("1:30:01");
  });
  it("includes duration-only runs and reports incomplete distance", () => {
    const runs = [
      { summary: createRunSummary(input) },
      { summary: createRunSummary({ ...input, distanceMeters: null }) },
      { summary: createRunSummary({ ...input, activityDate: "2026-09-01" }) },
    ];
    expect(summarizeRuns(runs, "2026-10-05", "2026-10-11")).toEqual({
      count: 2,
      durationSeconds: 3600,
      distanceMeters: 5000,
      missingDistanceCount: 1,
    });
  });
});
