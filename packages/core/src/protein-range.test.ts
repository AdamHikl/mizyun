import { describe, expect, it } from "vitest";
import { dailyProteinRange, proteinProgressStatus } from "./protein-range";

describe("dailyProteinRange", () => {
  it("uses the coaching-plan minimum per kilogram for maintenance", () => {
    expect(
      dailyProteinRange({
        targetProteinG: 112,
        weightKg: 70,
        goalKind: "maintain",
      }),
    ).toEqual({ lowG: 98, targetG: 112 });
  });

  it("uses the higher minimum for cut, recomp and bulk goals", () => {
    for (const goalKind of ["cut", "recomp", "bulk"] as const) {
      expect(
        dailyProteinRange({ targetProteinG: 140, weightKg: 70, goalKind })
          ?.lowG,
      ).toBe(112);
    }
  });

  it("treats a missing goal as maintenance", () => {
    expect(
      dailyProteinRange({ targetProteinG: 112, weightKg: 70, goalKind: null })
        ?.lowG,
    ).toBe(98);
  });

  it("never places the lower end above the target", () => {
    expect(
      dailyProteinRange({ targetProteinG: 90, weightKg: 70, goalKind: "cut" }),
    ).toEqual({ lowG: 90, targetG: 90 });
  });

  it("keeps the target without a lower end when weight is unknown", () => {
    for (const weightKg of [null, 0, Number.NaN]) {
      expect(
        dailyProteinRange({ targetProteinG: 120, weightKg, goalKind: "cut" }),
      ).toEqual({ lowG: null, targetG: 120 });
    }
  });

  it("returns null without a usable target", () => {
    for (const targetProteinG of [null, 0, -5, Number.NaN]) {
      expect(
        dailyProteinRange({ targetProteinG, weightKg: 70, goalKind: "cut" }),
      ).toBeNull();
    }
  });
});

describe("proteinProgressStatus", () => {
  const range = { lowG: 98, targetG: 112 };

  it("is in range from the lower end", () => {
    expect(proteinProgressStatus(98, range)).toBe("in_range");
    expect(proteinProgressStatus(130, range)).toBe("in_range");
  });

  it("is building below the lower end, including zero", () => {
    expect(proteinProgressStatus(97, range)).toBe("building");
    expect(proteinProgressStatus(0, range)).toBe("building");
  });

  it("falls back to the target when the lower end is unknown", () => {
    expect(proteinProgressStatus(100, { lowG: null, targetG: 112 })).toBe(
      "building",
    );
    expect(proteinProgressStatus(112, { lowG: null, targetG: 112 })).toBe(
      "in_range",
    );
  });

  it("keeps unknown intake or range unknown", () => {
    expect(proteinProgressStatus(null, range)).toBe("unknown");
    expect(proteinProgressStatus(Number.NaN, range)).toBe("unknown");
    expect(proteinProgressStatus(50, null)).toBe("unknown");
  });
});
