import { afterEach, describe, expect, it, vi } from "vitest";

import {
  formatPickerTime,
  fromDateInputValue,
  fromTimeInputValue,
  localDateToPickerBound,
  localDateToPickerDate,
  pickerDateRange,
  pickerDateToLocalDate,
  pickerDateToTime,
  timeToPickerDate,
  toDateInputValue,
  toTimeInputValue,
  uses24HourClock,
  withinLocalDateRange,
} from "./native-date-time-values";

/** ICU may separate "PM" with a narrow no-break space. */
const plain = (text: string) => text.replace(/\s/g, " ");

const originalTz = process.env.TZ;

afterEach(() => {
  process.env.TZ = originalTz;
});

// Zones far either side of UTC, where a UTC/local mix-up shifts the day.
const ZONES = [
  "Pacific/Kiritimati",
  "America/Los_Angeles",
  "Europe/Bratislava",
];

describe("native date/time picker values", () => {
  it("round-trips a local time through the picker date", () => {
    const base = new Date(2026, 9, 19, 15, 42, 10, 5);
    const date = timeToPickerDate(19, 30, base);
    expect(date.getFullYear()).toBe(2026);
    expect(date.getDate()).toBe(19);
    expect(pickerDateToTime(date)).toEqual({ hour: 19, minute: 30 });
    expect(date.getSeconds()).toBe(0);
    expect(timeToPickerDate(25, -3, base).getHours()).toBe(23);
    expect(timeToPickerDate(25, -3, base).getMinutes()).toBe(0);
  });

  it.each(ZONES)("keeps the calendar day on each platform in %s", (zone) => {
    process.env.TZ = zone;
    const day = { year: 2026, month: 3, day: 29 };
    for (const platform of ["ios", "android", "web"] as const) {
      expect(
        pickerDateToLocalDate(localDateToPickerDate(day, platform), platform),
      ).toEqual(day);
    }
    // The Android Material date dialog selects UTC midnight of the day.
    expect(localDateToPickerDate(day, "android").toISOString()).toBe(
      "2026-03-29T00:00:00.000Z",
    );
    expect(
      pickerDateToLocalDate(new Date("2026-03-29T00:00:00.000Z"), "android"),
    ).toEqual(day);
  });

  it("would shift the day if Android were given local noon", () => {
    // Guards the reason for the Android branch: at UTC+14 local noon is
    // the previous UTC day, which the Material dialog would select.
    process.env.TZ = "Pacific/Kiritimati";
    const day = { year: 2026, month: 3, day: 29 };
    const localNoon = localDateToPickerDate(day, "ios");
    expect(pickerDateToLocalDate(localNoon, "android").day).toBe(28);
  });

  it("bounds cover the whole local day", () => {
    const day = { year: 2026, month: 10, day: 19 };
    const start = localDateToPickerBound(day, "start");
    const end = localDateToPickerBound(day, "end");
    expect([start.getDate(), start.getHours(), start.getMinutes()]).toEqual([
      19, 0, 0,
    ]);
    expect([end.getDate(), end.getHours(), end.getMinutes()]).toEqual([
      19, 23, 59,
    ]);
    expect(localDateToPickerDate(day, "ios") > start).toBe(true);
    expect(localDateToPickerDate(day, "ios") < end).toBe(true);
  });

  it("keeps a time inside today's spring-forward gap", () => {
    process.env.TZ = "Europe/Bratislava";
    // 02:30 does not exist on 29 March 2026 in Bratislava; a picker value
    // built on today's date would move it to 03:30.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-29T08:00:00Z"));
    try {
      const naive = new Date();
      naive.setHours(2, 30, 0, 0);
      expect(naive.getHours()).toBe(3);
      expect(pickerDateToTime(timeToPickerDate(2, 30))).toEqual({
        hour: 2,
        minute: 30,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops an inverted iOS range instead of trapping", () => {
    const min = { year: 2026, month: 10, day: 19 };
    const max = { year: 2026, month: 10, day: 18 };
    expect(pickerDateRange()).toBeUndefined();
    expect(pickerDateRange(min, max)).toBeUndefined();
    const range = pickerDateRange(max, min);
    expect(range?.start?.getDate()).toBe(18);
    expect(range?.end?.getDate()).toBe(19);
    expect(pickerDateRange(undefined, min)?.start).toBeUndefined();
  });

  it("checks inclusive date bounds", () => {
    const min = { year: 2026, month: 1, day: 1 };
    const max = { year: 2026, month: 10, day: 19 };
    expect(withinLocalDateRange(min, min, max)).toBe(true);
    expect(withinLocalDateRange(max, min, max)).toBe(true);
    expect(
      withinLocalDateRange({ year: 2026, month: 10, day: 20 }, min, max),
    ).toBe(false);
    expect(withinLocalDateRange({ year: 2025, month: 12, day: 31 }, min)).toBe(
      false,
    );
    expect(withinLocalDateRange({ year: 2030, month: 1, day: 1 })).toBe(true);
  });

  it("reads and writes web input values", () => {
    expect(toTimeInputValue(7, 5)).toBe("07:05");
    expect(fromTimeInputValue("19:30")).toEqual({ hour: 19, minute: 30 });
    expect(fromTimeInputValue("7:30")).toEqual({ hour: 7, minute: 30 });
    expect(fromTimeInputValue("10:00:00")).toEqual({ hour: 10, minute: 0 });
    expect(fromTimeInputValue("24:00")).toBeNull();
    expect(fromTimeInputValue("7:3")).toBeNull();
    expect(fromTimeInputValue("")).toBeNull();
    expect(toDateInputValue({ year: 2026, month: 3, day: 9 })).toBe(
      "2026-03-09",
    );
    expect(fromDateInputValue("2026-02-28")).toEqual({
      year: 2026,
      month: 2,
      day: 28,
    });
    expect(fromDateInputValue("2026-02-30")).toBeNull();
    expect(fromDateInputValue("")).toBeNull();
  });

  it("formats a time on the chosen clock, not the locale's", () => {
    expect(uses24HourClock("en-US")).toBe(false);
    expect(uses24HourClock("en-GB")).toBe(true);
    // A UK phone with "Use 24-hour format" off, and a US phone with it on.
    expect(
      plain(formatPickerTime(19, 30, { locale: "en-GB", uses24Hour: false })),
    ).toMatch(/^7:30 pm$/i);
    expect(
      formatPickerTime(19, 30, { locale: "en-US", uses24Hour: true }),
    ).toBe("19:30");
    expect(formatPickerTime(0, 5, { locale: "en-US", uses24Hour: true })).toBe(
      "00:05",
    );
    expect(
      plain(formatPickerTime(0, 5, { locale: "en-US", uses24Hour: false })),
    ).toBe("12:05 AM");
  });

  it("follows the locale's clock when no setting is given", () => {
    expect(plain(formatPickerTime(8, 0, { locale: "en-US" }))).toBe("8:00 AM");
    expect(formatPickerTime(8, 0, { locale: "en-GB" })).toMatch(/^0?8:00$/);
  });

  it("keeps the chosen clock when the engine ignores hourCycle", () => {
    const real = Intl.DateTimeFormat;
    // An engine that answers in the locale's own hour cycle.
    const ignoring = function (this: unknown, locale?: string) {
      return new real(locale, { hour: "numeric", minute: "2-digit" });
    } as unknown as typeof Intl.DateTimeFormat;
    vi.stubGlobal("Intl", { ...Intl, DateTimeFormat: ignoring });
    try {
      expect(
        formatPickerTime(19, 30, { locale: "en-US", uses24Hour: true }),
      ).toBe("19:30");
      expect(
        plain(formatPickerTime(19, 30, { locale: "en-GB", uses24Hour: false })),
      ).toBe("7:30 PM");
      // h11 and h24 defaults are on the right clock but read "0:30" and "24:05".
      expect(
        plain(
          formatPickerTime(12, 30, {
            locale: "ja-u-hc-h11",
            uses24Hour: false,
          }),
        ),
      ).toBe("12:30 PM");
      expect(
        formatPickerTime(0, 5, { locale: "en-US-u-hc-h24", uses24Hour: true }),
      ).toBe("00:05");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
