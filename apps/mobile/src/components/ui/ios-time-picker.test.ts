import { describe, expect, it } from "vitest";

import {
  formatTime12,
  getWeekdayLabel,
  to12Hour,
  WEEKDAYS,
} from "./ios-time-picker-utils";

describe("ios-time-picker-utils helpers", () => {
  it("converts 24-hour hour into 12-hour hour and AM/PM period", () => {
    expect(to12Hour(0)).toEqual({ hour12: 12, period: "AM" });
    expect(to12Hour(1)).toEqual({ hour12: 1, period: "AM" });
    expect(to12Hour(8)).toEqual({ hour12: 8, period: "AM" });
    expect(to12Hour(11)).toEqual({ hour12: 11, period: "AM" });
    expect(to12Hour(12)).toEqual({ hour12: 12, period: "PM" });
    expect(to12Hour(13)).toEqual({ hour12: 1, period: "PM" });
    expect(to12Hour(19)).toEqual({ hour12: 7, period: "PM" });
    expect(to12Hour(23)).toEqual({ hour12: 11, period: "PM" });
  });

  it("formats 24-hour time into 12-hour display string", () => {
    expect(formatTime12(8, 0)).toBe("8:00 AM");
    expect(formatTime12(19, 30)).toBe("7:30 PM");
    expect(formatTime12(0, 5)).toBe("12:05 AM");
    expect(formatTime12(12, 45)).toBe("12:45 PM");
    expect(formatTime12(23, 59)).toBe("11:59 PM");
  });

  it("maps weekday IDs correctly to short and full labels", () => {
    expect(WEEKDAYS).toHaveLength(7);
    expect(getWeekdayLabel(1, "full")).toBe("Sunday");
    expect(getWeekdayLabel(1, "short")).toBe("Sun");
    expect(getWeekdayLabel(2, "full")).toBe("Monday");
    expect(getWeekdayLabel(7, "full")).toBe("Saturday");
    expect(getWeekdayLabel(7, "short")).toBe("Sat");
    expect(getWeekdayLabel(99, "full")).toBe("Sunday");
  });
});
