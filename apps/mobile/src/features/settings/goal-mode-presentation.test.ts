import { describe, expect, it } from "vitest";

import { goalKindHasPace, paceChoicesFor } from "./goal-mode-presentation";

describe("goal mode presentation", () => {
  it("names bulk modes slowest to fastest with kg/week and %/week", () => {
    const choices = paceChoicesFor("bulk", 80, "metric");
    expect(choices.map((c) => c.pace)).toEqual([
      "gradual",
      "steady",
      "aggressive",
    ]);
    expect(choices.map((c) => c.modeLabel)).toEqual([
      "Lean bulk",
      "Standard bulk",
      "Aggressive bulk",
    ]);
    expect(choices[0]!.label).toBe("Lean bulk · ~0.1–0.2 kg/week");
    expect(choices[0]!.detail).toBe("~0.1–0.2 kg/week (0.1–0.25 %/week)");
  });

  it("names cut modes and uses magnitudes", () => {
    const choices = paceChoicesFor("cut", 80, "metric");
    expect(choices.map((c) => c.modeLabel)).toEqual([
      "Gradual cut",
      "Standard cut",
      "Aggressive cut",
    ]);
    expect(choices[1]!.label).toBe("Standard cut · ~0.4–0.6 kg/week");
  });

  it("respects the unit system", () => {
    const [lean] = paceChoicesFor("bulk", 80, "imperial");
    // 80 kg * 0.1-0.25% = 0.08-0.2 kg = 0.18-0.44 lb
    expect(lean!.label).toBe("Lean bulk · ~0.2–0.4 lb/week");
  });

  it("falls back to percent when the weight is unknown", () => {
    const [lean] = paceChoicesFor("bulk", null, "metric");
    expect(lean!.label).toBe("Lean bulk");
    expect(lean!.detail).toBe("0.1–0.25 %/week");
  });

  it("hides the pace choice for recomp and maintain", () => {
    expect(goalKindHasPace("recomp")).toBe(false);
    expect(goalKindHasPace("maintain")).toBe(false);
    expect(paceChoicesFor("recomp", 80, "metric")).toEqual([]);
    expect(paceChoicesFor("maintain", 80, "metric")).toEqual([]);
  });

  it("attaches honest notes to the risky modes only", () => {
    const bulk = paceChoicesFor("bulk", 80, "metric");
    expect(bulk[0]!.note).toContain("no plan can guarantee muscle-only gain");
    expect(bulk[1]!.note).toBeNull();
    expect(bulk[2]!.note).toContain("fat");
    const cut = paceChoicesFor("cut", 80, "metric");
    expect(cut[0]!.note).toBeNull();
    expect(cut[2]!.note).toContain("standard cut");
  });
});
