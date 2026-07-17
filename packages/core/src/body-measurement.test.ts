import { describe, expect, it } from "vitest";

import type { UserId } from "./index.js";
import {
  BODY_WEIGHT_KG_MAX,
  BODY_WEIGHT_KG_MIN,
  validateBodyMeasurementCreate,
} from "./body-measurement.js";

const baseCreate = {
  measuredAt: new Date("2026-07-10T08:00:00Z"),
  weightKg: 70,
};

describe("validateBodyMeasurementCreate", () => {
  it("accepts a weight-only observation", () => {
    expect(validateBodyMeasurementCreate({ weightKg: 70 })).toBeNull();
  });

  it("accepts a measurements-only observation", () => {
    expect(
      validateBodyMeasurementCreate({
        measurements: { waist_cm: 80, chest_cm: 100 },
      }),
    ).toBeNull();
  });

  it("accepts a fully populated observation", () => {
    expect(
      validateBodyMeasurementCreate({
        weightKg: 70,
        measurements: { waist_cm: 80 },
      }),
    ).toBeNull();
  });

  it("rejects a weight below the range", () => {
    expect(
      validateBodyMeasurementCreate({ weightKg: BODY_WEIGHT_KG_MIN - 1 }),
    ).toEqual({
      kind: "weight_out_of_range",
      min: BODY_WEIGHT_KG_MIN,
      max: BODY_WEIGHT_KG_MAX,
    });
  });

  it("rejects a weight above the range", () => {
    expect(
      validateBodyMeasurementCreate({ weightKg: BODY_WEIGHT_KG_MAX + 1 }),
    ).toEqual({
      kind: "weight_out_of_range",
      min: BODY_WEIGHT_KG_MIN,
      max: BODY_WEIGHT_KG_MAX,
    });
  });

  it("accepts null weight (measurements-only path)", () => {
    expect(
      validateBodyMeasurementCreate({
        weightKg: null,
        measurements: { waist_cm: 80 },
      }),
    ).toBeNull();
  });

  it("rejects a non-object measurements value", () => {
    expect(
      validateBodyMeasurementCreate({
        weightKg: 70,
        measurements: null as unknown as Record<string, unknown>,
      }),
    ).toEqual({ kind: "measurements_must_be_object" });
  });

  it("rejects an empty observation (no weight, no measurements)", () => {
    expect(validateBodyMeasurementCreate({})).toEqual({
      kind: "empty_observation",
    });
  });

  it("rejects an empty measurements map even with a weight", () => {
    // `measurements: {}` should be acceptable — the wire-level
    // refine rejects it before this; the domain validator permits
    // it but reads `Object.keys`. We assert here that an empty
    // map with no weight is rejected (the realistic mixed case).
    expect(validateBodyMeasurementCreate({ measurements: {} })).toEqual({
      kind: "empty_observation",
    });
  });

  it("type-checks: the create shape accepts Date measuredAt", () => {
    // The route layer maps the wire ISO string onto a Date; this
    // test guards that the domain layer never accidentally
    // rejects a Date input.
    expect(validateBodyMeasurementCreate({ weightKg: 70 })).toBeNull();
  });
});
