import { describe, expect, it } from "vitest";

import {
  ADULTS_ONLY_MESSAGE,
  checkAdultBirthYear,
  needsTurned18Answer,
  storedBirthYearIsUnderage,
} from "./adult-age";

describe("adult birth-year check (PRIV-02)", () => {
  it("accepts a clearly adult birth year without asking", () => {
    expect(checkAdultBirthYear("1990", null, 2026)).toEqual({
      kind: "ok",
      birthYear: 1990,
    });
    expect(needsTurned18Answer("1990", 2026)).toBe(false);
  });

  it("refuses a birth year that makes the user under 18", () => {
    for (const year of ["2009", "2013", "2026"]) {
      expect(checkAdultBirthYear(year, true, 2026)).toEqual({
        kind: "underage",
        message: ADULTS_ONLY_MESSAGE,
      });
    }
  });

  it("asks only for the boundary year and uses the answer", () => {
    expect(needsTurned18Answer("2008", 2026)).toBe(true);
    expect(checkAdultBirthYear("2008", null, 2026).kind).toBe("ask_turned_18");
    expect(checkAdultBirthYear("2008", false, 2026).kind).toBe("underage");
    expect(checkAdultBirthYear("2008", true, 2026)).toEqual({
      kind: "ok",
      birthYear: 2008,
    });
  });

  it("rejects malformed or future years as invalid, not underage", () => {
    for (const raw of ["", "abc", "1899", "2027", "1990.5"]) {
      expect(checkAdultBirthYear(raw, null, 2026).kind).toBe("invalid");
    }
  });

  it("flags stored under-18 years only", () => {
    expect(storedBirthYearIsUnderage(2009, 2026)).toBe(true);
    expect(storedBirthYearIsUnderage(2008, 2026)).toBe(false);
    expect(storedBirthYearIsUnderage(null, 2026)).toBe(false);
  });
});
