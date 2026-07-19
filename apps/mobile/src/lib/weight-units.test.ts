import { describe, expect, it } from "vitest";

import {
  displayWeightToKilograms,
  parseDisplayWeightToKilograms,
  weightUnitLabel,
} from "./weight-units";

describe("weight unit boundaries", () => {
  it("keeps metric values canonical", () => {
    expect(displayWeightToKilograms(72.5, "metric")).toBe(72.5);
  });

  it("converts pounds only at the storage boundary", () => {
    expect(displayWeightToKilograms(160, "imperial")).toBe(72.575);
  });

  it("rejects blank, non-numeric, and non-positive display values", () => {
    expect(parseDisplayWeightToKilograms("", "metric")).toBeNull();
    expect(parseDisplayWeightToKilograms("abc", "metric")).toBeNull();
    expect(parseDisplayWeightToKilograms("0", "imperial")).toBeNull();
  });

  it("uses the matching display label", () => {
    expect(weightUnitLabel("metric")).toBe("kg");
    expect(weightUnitLabel("imperial")).toBe("lb");
  });
});
