import { describe, expect, it } from "vitest";

import {
  FONT_GRADES,
  fontGradeFromRank,
  fontGradeRank,
  isFontGrade,
  normaliseFontGrade,
} from "./bouldering-grades.js";

describe("Font grades", () => {
  it("has 23 grades ordered by rank and round-trips", () => {
    expect(FONT_GRADES).toHaveLength(23);
    FONT_GRADES.forEach((grade, index) => {
      expect(fontGradeRank(grade)).toBe(index);
      expect(fontGradeFromRank(index)).toBe(grade);
    });
    expect(fontGradeRank("6A")).toBeLessThan(fontGradeRank("6A+"));
    expect(fontGradeRank("6C+")).toBeLessThan(fontGradeRank("7A"));
  });
  it("rejects out-of-range ranks", () => {
    for (const rank of [-1, 23, 1.5, Number.NaN])
      expect(fontGradeFromRank(rank)).toBeNull();
  });
  it("normalises case and whitespace", () => {
    expect(normaliseFontGrade("6a+")).toBe("6A+");
    expect(normaliseFontGrade(" 7b ")).toBe("7B");
    expect(normaliseFontGrade("4+")).toBe("4+");
  });
  it("rejects off-scale input", () => {
    for (const bad of ["6A++", "9A", "V5", "", "  ", "2", "6D", "3+"])
      expect(normaliseFontGrade(bad)).toBeNull();
    expect(isFontGrade("6a")).toBe(false);
    expect(isFontGrade(6)).toBe(false);
    expect(isFontGrade("6A")).toBe(true);
  });
});
