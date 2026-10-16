import { describe, expect, it } from "vitest";
import {
  runCreateSchema,
  runSummarySchema,
  runUpdateSchema,
  runListQuerySchema,
  runImportSchema,
  runImportResponseSchema,
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
const imported = {
  clientOperationId: "f4760614-69ad-4fb4-8e10-c6d14ed1f9a4",
  provider: "health_connect",
  sourceAppId: "com.example.watch",
  sourceAppName: null,
  externalId: "hc-0001",
  startedAt: "2026-10-06T06:00:00Z",
  recordingTimezone: "Europe/Bratislava",
  durationSeconds: 1800,
  durationBasis: "active",
  distanceMeters: 5000,
  environment: "outdoor",
};
const importedSummary = {
  version: 1,
  activityDate: "2026-10-06",
  recordingTimezone: "Europe/Bratislava",
  timePrecision: "instant",
  startedAt: "2026-10-06T06:00:00Z",
  durationSeconds: 1800,
  durationBasis: "active",
  distanceMeters: 5000,
  environment: "outdoor",
  perceivedExertion: null,
  origin: {
    kind: "health_import",
    provider: "health_connect",
    sourceAppId: "com.example.watch",
    sourceAppName: null,
    externalId: "hc-0001",
  },
  timestampEnvelope: "observed",
  revision: 1,
};
describe("Health run import boundary", () => {
  it("accepts one selected provider workout", () => {
    expect(runImportSchema.parse(imported)).toEqual(imported);
    expect(runSummarySchema.safeParse(importedSummary).success).toBe(true);
  });
  it.each([
    { provider: "garmin" },
    { sourceAppId: "" },
    { externalId: "x".repeat(256) },
    { sourceAppName: "" },
    { sourceAppName: "x".repeat(201) },
    { startedAt: null },
    { durationBasis: "moving" },
    { distanceMeters: undefined },
    { environment: undefined },
    { name: "Client name" },
    { activityDate: "2026-10-06" },
    { perceivedExertion: 5 },
  ])("rejects invalid or forged import fields %j", (patch) =>
    expect(runImportSchema.safeParse({ ...imported, ...patch }).success).toBe(
      false,
    ),
  );
  it("enforces origin-specific summary rules", () => {
    expect(
      runSummarySchema.safeParse({
        ...importedSummary,
        timePrecision: "day",
        startedAt: null,
        timestampEnvelope: "date_anchor",
      }).success,
    ).toBe(false);
    expect(
      runSummarySchema.safeParse({
        ...importedSummary,
        origin: { kind: "manual" },
      }).success,
    ).toBe(false);
    expect(
      runSummarySchema.safeParse({
        ...importedSummary,
        origin: { ...importedSummary.origin, extra: true },
      }).success,
    ).toBe(false);
    expect(
      runSummarySchema.safeParse({
        ...importedSummary,
        origin: { kind: "manual" },
        durationBasis: "elapsed",
      }).success,
    ).toBe(true);
  });
  it("keeps imports opt-in on list and reports whether a copy was created", () => {
    expect(runListQuerySchema.parse({}).include).toBeUndefined();
    expect(runListQuerySchema.parse({ include: "imports" }).include).toBe(
      "imports",
    );
    expect(runListQuerySchema.safeParse({ include: "all" }).success).toBe(
      false,
    );
    expect(
      runImportResponseSchema.safeParse({
        created: true,
        run: {
          id: "f4760614-69ad-4fb4-8e10-c6d14ed1f9a5",
          userId: "f4760614-69ad-4fb4-8e10-c6d14ed1f9a6",
          clientOperationId: imported.clientOperationId,
          name: "Run",
          notes: null,
          summary: importedSummary,
          createdAt: "2026-10-06T07:00:00Z",
          updatedAt: "2026-10-06T07:00:00Z",
        },
      }).success,
    ).toBe(true);
  });
});

describe("run import timezones", () => {
  it("accepts only database-storable named zones", async () => {
    const { runImportSchema, isStorableRunTimezone } = await import("./run");
    expect(isStorableRunTimezone("Europe/Bratislava")).toBe(true);
    expect(isStorableRunTimezone("UTC")).toBe(true);
    for (const zone of ["+02:00", "GMT+0200", "Factory", "posix/Europe/Paris"])
      expect(isStorableRunTimezone(zone)).toBe(false);
    const body = {
      clientOperationId: "f4760614-69ad-4fb4-8e10-c6d14ed1f9a3",
      provider: "health_connect",
      sourceAppId: "com.example.app",
      sourceAppName: null,
      externalId: "session-1",
      startedAt: "2026-10-15T05:00:00.000Z",
      recordingTimezone: "+02:00",
      durationSeconds: 1800,
      durationBasis: "elapsed",
      distanceMeters: null,
      environment: "unspecified",
    };
    expect(runImportSchema.safeParse(body).success).toBe(false);
    expect(
      runImportSchema.safeParse({ ...body, recordingTimezone: "Europe/Prague" })
        .success,
    ).toBe(true);
  });
});
