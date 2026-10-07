import { describe, expect, it } from "vitest";
import {
  runCreateSchema,
  runSummarySchema,
  runUpdateSchema,
  runListQuerySchema,
} from "./run";
const input = {
  clientOperationId: "f4760614-69ad-4fb4-8e10-c6d14ed1f9a3",
  activityDate: "2026-10-06",
  recordingTimezone: "Europe/Bratislava",
  durationSeconds: 1800,
};
describe("manual run boundary", () => {
  it("allows duration-only capture without invented distance/time", () => {
    const value = runCreateSchema.parse(input);
    expect(value.distanceMeters).toBeNull();
    expect(value.startedAt).toBeNull();
    expect(value.name).toBe("Run");
  });
  it.each([
    { durationSeconds: 0 },
    { durationSeconds: 86401 },
    { durationSeconds: 1.5 },
    { distanceMeters: 0 },
    { distanceMeters: -1 },
    { activityDate: "2026-02-30" },
    { activityDate: "2026-13-01" },
    { recordingTimezone: "Unknown/Zone" },
    { userId: "injected" },
  ])("rejects invalid facts or client authority %j", (patch) =>
    expect(runCreateSchema.safeParse({ ...input, ...patch }).success).toBe(
      false,
    ),
  );
  it("requires a revision for conditional edits", () => {
    expect(runUpdateSchema.safeParse(input).success).toBe(false);
    expect(
      runUpdateSchema.safeParse({ ...input, expectedRevision: 1 }).success,
    ).toBe(true);
  });
  it("rejects contradictory precision and extra provenance", () => {
    const summary = {
      version: 1,
      activityDate: input.activityDate,
      recordingTimezone: input.recordingTimezone,
      timePrecision: "day",
      startedAt: null,
      durationSeconds: 1800,
      durationBasis: "elapsed",
      distanceMeters: null,
      environment: "unspecified",
      perceivedExertion: null,
      origin: { kind: "manual" },
      timestampEnvelope: "date_anchor",
      revision: 1,
    };
    expect(runSummarySchema.safeParse(summary).success).toBe(true);
    expect(
      runSummarySchema.safeParse({
        ...summary,
        startedAt: "2026-10-06T10:00:00Z",
      }).success,
    ).toBe(false);
    expect(
      runSummarySchema.safeParse({
        ...summary,
        origin: { kind: "manual", provider: "healthkit" },
      }).success,
    ).toBe(false);
  });
  it("rejects reversed dates and excessive list pages", () => {
    expect(
      runListQuerySchema.safeParse({ from: "2026-10-07", to: "2026-10-06" })
        .success,
    ).toBe(false);
    expect(runListQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
  });
});
