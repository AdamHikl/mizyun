import { describe, expect, it } from "vitest";

import {
  STANDARD_PLATES,
  barbellTotal,
  platesForTarget,
} from "./barbell-plates.js";

const perSide = (loadout: ReturnType<typeof platesForTarget>) =>
  Object.fromEntries(
    (loadout?.plates ?? [])
      .filter((p) => p.perSide > 0)
      .map((p) => [p.plate, p.perSide]),
  );

describe("barbellTotal", () => {
  it("adds the bar and both sides", () => {
    expect(
      barbellTotal(20, [
        { plate: 20, perSide: 1 },
        { plate: 2.5, perSide: 1 },
      ]),
    ).toBe(65);
    expect(barbellTotal(45, [{ plate: 45, perSide: 2 }])).toBe(225);
  });
  it("is exact for fractional plates", () => {
    expect(barbellTotal(20, [{ plate: 1.25, perSide: 3 }])).toBe(27.5);
  });
  it("ignores negative and fractional counts", () => {
    expect(
      barbellTotal(20, [
        { plate: 25, perSide: -1 },
        { plate: 10, perSide: 1.9 },
      ]),
    ).toBe(40);
  });
});

describe("platesForTarget", () => {
  it("loads kg targets exactly", () => {
    const loadout = platesForTarget(102.5, 20, STANDARD_PLATES.kg);
    expect(loadout?.total).toBe(102.5);
    expect(loadout?.shortBy).toBe(0);
    expect(perSide(loadout)).toEqual({ 25: 1, 15: 1, 1.25: 1 });
  });
  it("loads lb targets exactly", () => {
    const loadout = platesForTarget(315, 45, STANDARD_PLATES.lb);
    expect(perSide(loadout)).toEqual({ 45: 3 });
    expect(loadout?.shortBy).toBe(0);
  });
  it("prefers the fewest plates for the same total", () => {
    expect(perSide(platesForTarget(165, 45, STANDARD_PLATES.lb))).toEqual({
      35: 1,
      25: 1,
    });
    expect(perSide(platesForTarget(215, 45, STANDARD_PLATES.lb))).toEqual({
      45: 1,
      35: 1,
      5: 1,
    });
  });
  it("rejects targets above the cap", () => {
    expect(platesForTarget(1e9, 20, STANDARD_PLATES.kg, 1000)).toBeNull();
    expect(platesForTarget(1000, 20, STANDARD_PLATES.kg, 1000)?.shortBy).toBe(
      0,
    );
  });
  it("rounds down to the closest loadable weight", () => {
    const loadout = platesForTarget(101, 20, STANDARD_PLATES.kg);
    expect(loadout?.total).toBe(100);
    expect(loadout?.shortBy).toBe(1);
  });
  it("returns an empty bar for a target equal to the bar", () => {
    const loadout = platesForTarget(20, 20, STANDARD_PLATES.kg);
    expect(loadout?.total).toBe(20);
    expect(perSide(loadout)).toEqual({});
  });
  it("rejects targets below the bar and invalid input", () => {
    expect(platesForTarget(15, 20, STANDARD_PLATES.kg)).toBeNull();
    expect(platesForTarget(Number.NaN, 20, STANDARD_PLATES.kg)).toBeNull();
    expect(platesForTarget(100, -5, STANDARD_PLATES.kg)).toBeNull();
  });
  it("ignores duplicate, unsorted and non-positive denominations", () => {
    const loadout = platesForTarget(60, 20, [5, 0, 20, 20, -10]);
    expect(perSide(loadout)).toEqual({ 20: 1 });
  });
});
