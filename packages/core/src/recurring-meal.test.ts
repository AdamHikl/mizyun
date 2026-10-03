import { describe, expect, it } from "vitest";
import {
  isRecurringMealLocalDate,
  recurringMealLocalDateAt,
  validateRecurringMealSchedule,
} from "./recurring-meal";
const valid = {
  localTime: "10:00",
  timeZone: "Europe/Bratislava",
  weekdays: [0, 6],
};
describe("recurring meal calendar rules", () => {
  it("validates named zones and calendar weekdays", () => {
    expect(validateRecurringMealSchedule(valid)).toBe(true);
    expect(validateRecurringMealSchedule({ ...valid, timeZone: "UTC" })).toBe(
      true,
    );
    expect(
      validateRecurringMealSchedule({ ...valid, timeZone: "America/New_York" }),
    ).toBe(true);
    expect(validateRecurringMealSchedule({ ...valid, weekdays: [] })).toBe(
      false,
    );
    expect(validateRecurringMealSchedule({ ...valid, weekdays: [1, 1] })).toBe(
      false,
    );
    expect(validateRecurringMealSchedule({ ...valid, weekdays: [7] })).toBe(
      false,
    );
    expect(
      validateRecurringMealSchedule({ ...valid, timeZone: "+02:00" }),
    ).toBe(false);
    expect(
      validateRecurringMealSchedule({ ...valid, localTime: "24:00" }),
    ).toBe(false);
  });
  it("rejects date rollover while accepting genuine leap dates", () => {
    expect(isRecurringMealLocalDate("2026-02-29")).toBe(false);
    expect(isRecurringMealLocalDate("2028-02-29")).toBe(true);
    expect(isRecurringMealLocalDate("2026-04-31")).toBe(false);
    expect(isRecurringMealLocalDate("0000-01-01")).toBe(false);
    expect(isRecurringMealLocalDate("0001-01-01")).toBe(true);
  });
  it("uses the pinned zone across midnight and daylight-saving offsets", () => {
    expect(
      recurringMealLocalDateAt(
        new Date("2026-10-03T00:30:00Z"),
        "America/New_York",
      ),
    ).toBe("2026-10-02");
    expect(
      recurringMealLocalDateAt(
        new Date("2026-03-29T00:30:00Z"),
        "Europe/Bratislava",
      ),
    ).toBe("2026-03-29");
    expect(
      recurringMealLocalDateAt(
        new Date("2026-10-25T01:30:00Z"),
        "Europe/Bratislava",
      ),
    ).toBe("2026-10-25");
  });
});
