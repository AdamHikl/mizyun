import { describe, expect, it } from "vitest";

import {
  displayWeightToKilograms,
  kilogramsToDisplayWeight,
  parseDisplayWeightToKilograms,
  parseTargetLoadToDisplay,
  parseTargetLoadToKilograms,
  weightUnitLabel,
} from "./weight-units";

describe("weight unit boundaries", () => {
  it("keeps metric values canonical", () => {
    expect(displayWeightToKilograms(72.5, "metric")).toBe(72.5);
  });

  it("converts pounds only at the storage boundary", () => {
    expect(displayWeightToKilograms(160, "imperial")).toBe(72.575);
    expect(kilogramsToDisplayWeight(100, "imperial")).toBe(220.5);
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

describe("target load parsing", () => {
  describe("parseTargetLoadToDisplay", () => {
    it("handles plain numeric strings assuming active unitSystem", () => {
      expect(parseTargetLoadToDisplay("80", "metric")).toBe("80");
      expect(parseTargetLoadToDisplay("80", "imperial")).toBe("80");
      expect(parseTargetLoadToDisplay("140", "metric")).toBe("140");
      expect(parseTargetLoadToDisplay("225.5", "metric")).toBe("225.5");
      expect(parseTargetLoadToDisplay("225.5", "imperial")).toBe("225.5");
    });

    it("handles explicit kg under both metric and imperial unitSystem", () => {
      expect(parseTargetLoadToDisplay("80 kg", "metric")).toBe("80");
      expect(parseTargetLoadToDisplay("80kg", "metric")).toBe("80");
      expect(parseTargetLoadToDisplay("80 kg", "imperial")).toBe("176.4");
      expect(parseTargetLoadToDisplay("80kg", "imperial")).toBe("176.4");
    });

    it("handles explicit lb under both metric and imperial unitSystem", () => {
      expect(parseTargetLoadToDisplay("175 lbs", "imperial")).toBe("175");
      expect(parseTargetLoadToDisplay("175lb", "imperial")).toBe("175");
      expect(parseTargetLoadToDisplay("175 lb", "imperial")).toBe("175");
      expect(parseTargetLoadToDisplay("175 lbs", "metric")).toBe("79.4");
      expect(parseTargetLoadToDisplay("175lb", "metric")).toBe("79.4");
      expect(parseTargetLoadToDisplay("175 lb", "metric")).toBe("79.4");
    });

    it("handles number inputs", () => {
      expect(parseTargetLoadToDisplay(80, "metric")).toBe("80");
      expect(parseTargetLoadToDisplay(80, "imperial")).toBe("80");
      expect(parseTargetLoadToDisplay(225.5, "metric")).toBe("225.5");
    });

    it("returns null for empty, invalid, negative, or zero values", () => {
      expect(parseTargetLoadToDisplay("", "metric")).toBeNull();
      expect(parseTargetLoadToDisplay("   ", "metric")).toBeNull();
      expect(parseTargetLoadToDisplay(null, "metric")).toBeNull();
      expect(parseTargetLoadToDisplay(undefined, "metric")).toBeNull();
      expect(parseTargetLoadToDisplay("abc", "metric")).toBeNull();
      expect(parseTargetLoadToDisplay("0", "metric")).toBeNull();
      expect(parseTargetLoadToDisplay(0, "metric")).toBeNull();
      expect(parseTargetLoadToDisplay("-80", "metric")).toBeNull();
      expect(parseTargetLoadToDisplay(-80, "metric")).toBeNull();
      expect(parseTargetLoadToDisplay("-80 kg", "metric")).toBeNull();
      expect(parseTargetLoadToDisplay("-175 lbs", "imperial")).toBeNull();
    });
  });

  describe("parseTargetLoadToKilograms", () => {
    it("handles plain numeric strings converting to canonical kg", () => {
      expect(parseTargetLoadToKilograms("80", "metric")).toBe(80);
      expect(parseTargetLoadToKilograms("80", "imperial")).toBe(36.287);
      expect(parseTargetLoadToKilograms("140", "metric")).toBe(140);
      expect(parseTargetLoadToKilograms("225.5", "metric")).toBe(225.5);
      expect(parseTargetLoadToKilograms("225.5", "imperial")).toBe(102.285);
    });

    it("handles explicit kg under both metric and imperial unitSystem", () => {
      expect(parseTargetLoadToKilograms("80 kg", "metric")).toBe(80);
      expect(parseTargetLoadToKilograms("80kg", "metric")).toBe(80);
      expect(parseTargetLoadToKilograms("80 kg", "imperial")).toBe(80);
      expect(parseTargetLoadToKilograms("80kg", "imperial")).toBe(80);
    });

    it("handles explicit lb under both metric and imperial unitSystem", () => {
      expect(parseTargetLoadToKilograms("175 lbs", "imperial")).toBe(79.379);
      expect(parseTargetLoadToKilograms("175lb", "imperial")).toBe(79.379);
      expect(parseTargetLoadToKilograms("175 lb", "imperial")).toBe(79.379);
      expect(parseTargetLoadToKilograms("175 lbs", "metric")).toBe(79.379);
      expect(parseTargetLoadToKilograms("175lb", "metric")).toBe(79.379);
      expect(parseTargetLoadToKilograms("175 lb", "metric")).toBe(79.379);
    });

    it("handles number inputs", () => {
      expect(parseTargetLoadToKilograms(80, "metric")).toBe(80);
      expect(parseTargetLoadToKilograms(80, "imperial")).toBe(36.287);
      expect(parseTargetLoadToKilograms(225.5, "metric")).toBe(225.5);
    });

    it("returns null for empty, invalid, negative, or zero values", () => {
      expect(parseTargetLoadToKilograms("", "metric")).toBeNull();
      expect(parseTargetLoadToKilograms("   ", "metric")).toBeNull();
      expect(parseTargetLoadToKilograms(null, "metric")).toBeNull();
      expect(parseTargetLoadToKilograms(undefined, "metric")).toBeNull();
      expect(parseTargetLoadToKilograms("abc", "metric")).toBeNull();
      expect(parseTargetLoadToKilograms("0", "metric")).toBeNull();
      expect(parseTargetLoadToKilograms(0, "metric")).toBeNull();
      expect(parseTargetLoadToKilograms("-80", "metric")).toBeNull();
      expect(parseTargetLoadToKilograms(-80, "metric")).toBeNull();
      expect(parseTargetLoadToKilograms("-80 kg", "metric")).toBeNull();
      expect(parseTargetLoadToKilograms("-175 lbs", "imperial")).toBeNull();
    });
  });
});
