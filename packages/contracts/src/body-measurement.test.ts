import { describe, expect, it } from "vitest";
import { bodyMeasurementCreateSchema } from "./body-measurement";

describe("body measurement create identity", () => {
  const payload = {
    clientOperationId: "11111111-1111-4111-8111-111111111111",
    measuredAt: "2026-10-08T10:00:00Z",
    weightKg: 72,
  };
  it("accepts a keyed fixed-time command and the older unkeyed shape", () => {
    expect(bodyMeasurementCreateSchema.parse(payload)).toEqual(payload);
    expect(bodyMeasurementCreateSchema.parse({ weightKg: 72 })).toEqual({
      weightKg: 72,
    });
  });
  it("rejects a malformed identity or keyed command without its original time", () => {
    expect(
      bodyMeasurementCreateSchema.safeParse({
        ...payload,
        clientOperationId: "bad",
      }).success,
    ).toBe(false);
    expect(
      bodyMeasurementCreateSchema.safeParse({
        clientOperationId: payload.clientOperationId,
        weightKg: 72,
      }).success,
    ).toBe(false);
  });

  it("rejects precision beyond PostgreSQL numeric(6,3) before a keyed create", () => {
    expect(
      bodyMeasurementCreateSchema.safeParse({ ...payload, weightKg: 72.1234 })
        .success,
    ).toBe(false);
    expect(
      bodyMeasurementCreateSchema.parse({ ...payload, weightKg: 72.123 })
        .weightKg,
    ).toBe(72.123);
  });
});
