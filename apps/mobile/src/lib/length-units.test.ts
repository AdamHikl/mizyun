import { describe, expect, it } from "vitest";

import {
  centimetersToDisplayLength,
  displayLengthToCentimeters,
  lengthUnitLabel,
} from "./length-units";

describe("length unit boundaries", () => {
  it("converts inches to canonical centimeters", () => {
    expect(displayLengthToCentimeters(32, "imperial")).toBe(81.28);
  });

  it("keeps metric values unchanged", () => {
    expect(displayLengthToCentimeters(81.2, "metric")).toBe(81.2);
  });

  it("prefills imperial displays from canonical centimeters", () => {
    expect(centimetersToDisplayLength(177.8, "imperial")).toBe(70);
  });

  it("provides the selected display label", () => {
    expect(lengthUnitLabel("metric")).toBe("cm");
    expect(lengthUnitLabel("imperial")).toBe("in");
  });
});
