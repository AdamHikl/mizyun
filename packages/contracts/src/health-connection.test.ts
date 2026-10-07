import { describe, expect, it } from "vitest";
import { bodyMeasurementSourceSchema } from "./body-measurement";
import { healthPreviewRecordSchema } from "./health-connection";

const weight = {
  kind: "weight",
  provider: "apple_health",
  externalId: "synthetic-weight-1",
  sourceAppId: "org.example.synthetic",
  sourceAppName: null,
  sourceTimeZone: null,
  measuredAt: "2026-10-06T12:30:00.000Z",
  weightKg: 74.12567,
};
const workout = {
  kind: "workout",
  provider: "health_connect",
  externalId: "synthetic-workout-1",
  sourceAppId: "org.example.synthetic",
  sourceAppName: "Synthetic fitness",
  sourceTimeZone: "Europe/Bratislava",
  startedAt: "2026-10-06T12:00:00.000Z",
  endedAt: "2026-10-06T12:30:00.000Z",
  activityType: "walking",
  durationSeconds: 1700.5,
};

describe("health preview contract", () => {
  it("accepts native canonical units, sub-second active duration and explicit null source fields", () => {
    expect(healthPreviewRecordSchema.parse(weight)).toEqual(weight);
    expect(healthPreviewRecordSchema.parse(workout)).toEqual(workout);
    expect(
      healthPreviewRecordSchema.parse({
        ...workout,
        sourceAppName: null,
        sourceTimeZone: "+02:00",
        activityType: "Strength training",
      }),
    ).toMatchObject({ sourceTimeZone: "+02:00", sourceAppName: null });
  });

  it.each(["sourceAppName", "sourceTimeZone", "sourceAppId", "externalId"])(
    "requires source field %s even when nullable",
    (key) => {
      const candidate: Record<string, unknown> = { ...weight };
      delete candidate[key];
      expect(healthPreviewRecordSchema.safeParse(candidate).success).toBe(
        false,
      );
    },
  );

  it.each([
    { userId: "attacker" },
    { allowedUses: ["coach", "developer_api", "account_save"] },
    { metadata: { source: "manual", eligibleForExport: true } },
    { source: "manual" },
    { weightLb: 160 },
  ])(
    "rejects unrecognized rights, ownership, provenance and units %j",
    (extra) => {
      expect(
        healthPreviewRecordSchema.safeParse({ ...weight, ...extra }).success,
      ).toBe(false);
    },
  );

  it.each([
    "2026-02-30T12:00:00Z",
    "2026-10-06T24:00:00Z",
    "2026-10-06T12:00:00+02:00",
    "2026-10-06T12:00Z",
    "not-a-time",
  ])("rejects noncanonical or invalid timestamp %s", (measuredAt) => {
    expect(
      healthPreviewRecordSchema.safeParse({ ...weight, measuredAt }).success,
    ).toBe(false);
  });

  it.each([NaN, Infinity, -Infinity, 0, 29.99, 250.01])(
    "rejects implausible weight %s",
    (weightKg) => {
      expect(
        healthPreviewRecordSchema.safeParse({ ...weight, weightKg }).success,
      ).toBe(false);
    },
  );

  it.each([NaN, Infinity, -1, 0, 86_401, 1801])(
    "rejects invalid or contradictory duration %s",
    (durationSeconds) => {
      expect(
        healthPreviewRecordSchema.safeParse({ ...workout, durationSeconds })
          .success,
      ).toBe(false);
    },
  );

  it("rejects negative chronology and oversize source/type strings", () => {
    expect(
      healthPreviewRecordSchema.safeParse({
        ...workout,
        endedAt: "2026-10-06T11:59:00Z",
      }).success,
    ).toBe(false);
    expect(
      healthPreviewRecordSchema.safeParse({
        ...weight,
        externalId: "x".repeat(257),
      }).success,
    ).toBe(false);
    expect(
      healthPreviewRecordSchema.safeParse({
        ...workout,
        activityType: "x".repeat(129),
      }).success,
    ).toBe(false);
  });

  it("preserves manual-only account measurement source", () => {
    expect(bodyMeasurementSourceSchema.options).toEqual(["manual"]);
    expect(bodyMeasurementSourceSchema.safeParse("apple_health").success).toBe(
      false,
    );
  });
});
