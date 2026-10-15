import { describe, expect, it } from "vitest";
import {
  canSkipToday,
  describeNextOccurrence,
  nextRecurringOccurrence,
  timeZoneNote,
  weekdayInZone,
} from "./recurring-meal-schedule";

const base = {
  localTime: "08:00",
  timeZone: "UTC",
  weekdays: [0, 1, 2, 3, 4, 5, 6],
  enabled: true,
};
// 2026-10-14 is a Wednesday.
const wed10 = new Date("2026-10-14T10:00:00Z");

describe("weekdayInZone", () => {
  it("uses the zone's calendar day across midnight", () => {
    const now = new Date("2026-10-14T22:30:00Z"); // Wed UTC
    expect(weekdayInZone("UTC", now)).toBe(3);
    expect(weekdayInZone("Europe/Helsinki", now)).toBe(4); // Thu 01:30
    expect(weekdayInZone("America/Los_Angeles", now)).toBe(3);
    expect(weekdayInZone("Pacific/Auckland", now)).toBe(4);
    expect(
      weekdayInZone("Pacific/Honolulu", new Date("2026-10-14T05:00:00Z")),
    ).toBe(2);
  });
  it("returns null for an unknown zone", () => {
    expect(weekdayInZone("Not/AZone", wed10)).toBeNull();
  });
});

describe("canSkipToday", () => {
  it("requires an active schedule running on today's weekday in its own zone", () => {
    const now = new Date("2026-10-14T22:30:00Z");
    expect(canSkipToday({ ...base, weekdays: [3] }, now)).toBe(true);
    expect(canSkipToday({ ...base, weekdays: [4] }, now)).toBe(false);
    expect(
      canSkipToday(
        { ...base, weekdays: [4], timeZone: "Europe/Helsinki" },
        now,
      ),
    ).toBe(true);
    expect(canSkipToday({ ...base, enabled: false }, now)).toBe(false);
    expect(canSkipToday({ ...base, timeZone: "Bad/Zone" }, now)).toBe(false);
  });
});

describe("nextRecurringOccurrence", () => {
  it("is today when the time is still ahead, otherwise the next scheduled day", () => {
    expect(describeNextOccurrence({ ...base, localTime: "12:00" }, wed10)).toBe(
      "Next: Today 12:00",
    );
    expect(describeNextOccurrence(base, wed10)).toBe("Next: Tomorrow 08:00");
    expect(describeNextOccurrence({ ...base, localTime: "10:00" }, wed10)).toBe(
      "Next: Tomorrow 10:00",
    );
  });
  it("skips unscheduled weekdays and labels later days and the following week", () => {
    expect(describeNextOccurrence({ ...base, weekdays: [1] }, wed10)).toBe(
      "Next: Mon 08:00",
    );
    expect(describeNextOccurrence({ ...base, weekdays: [3] }, wed10)).toBe(
      "Next: Next Wed 08:00",
    );
  });
  it("returns nothing for paused, empty or invalid schedules", () => {
    expect(
      describeNextOccurrence({ ...base, enabled: false }, wed10),
    ).toBeNull();
    expect(describeNextOccurrence({ ...base, weekdays: [] }, wed10)).toBeNull();
    expect(
      describeNextOccurrence({ ...base, localTime: "25:00" }, wed10),
    ).toBeNull();
    expect(
      describeNextOccurrence({ ...base, timeZone: "Bad/Zone" }, wed10),
    ).toBeNull();
  });
  it("uses the schedule zone across midnight", () => {
    // 22:30Z Wed = Thu 01:30 in Helsinki; 08:00 Thursday is still ahead there.
    const now = new Date("2026-10-14T22:30:00Z");
    expect(
      nextRecurringOccurrence({ ...base, timeZone: "Europe/Helsinki" }, now),
    ).toMatchObject({ dayOffset: 0, weekday: 4, localDate: "2026-10-15" });
    expect(nextRecurringOccurrence(base, now)).toMatchObject({
      dayOffset: 1,
      localDate: "2026-10-15",
    });
  });
  it("keeps wall-clock time across the America/New_York fall-back (2026-11-01)", () => {
    const sched = { ...base, timeZone: "America/New_York", localTime: "08:00" };
    // Sat 2026-10-31 20:00 EDT = 2026-11-01T00:00Z; next is Sun 08:00 EST.
    const before = nextRecurringOccurrence(
      sched,
      new Date("2026-11-01T00:00:00Z"),
    );
    expect(before).toMatchObject({
      dayOffset: 1,
      localDate: "2026-11-01",
      localTime: "08:00",
    });
    // Sun 2026-11-01 07:30 EST = 12:30Z (25h day): 08:00 is still today.
    expect(
      nextRecurringOccurrence(sched, new Date("2026-11-01T12:30:00Z")),
    ).toMatchObject({ dayOffset: 0, localDate: "2026-11-01" });
    // Sun 08:30 EST: next is Monday 08:00.
    expect(
      nextRecurringOccurrence(sched, new Date("2026-11-01T13:30:00Z")),
    ).toMatchObject({ dayOffset: 1, localDate: "2026-11-02", weekday: 1 });
  });
  it("keeps wall-clock time across the Europe/Helsinki fall-back (2026-10-25)", () => {
    const sched = { ...base, timeZone: "Europe/Helsinki", localTime: "03:30" };
    // 03:30 occurs twice on 25 Oct; at 00:10Z (03:10 EEST) it is still today.
    expect(
      nextRecurringOccurrence(sched, new Date("2026-10-25T00:10:00Z")),
    ).toMatchObject({ dayOffset: 0, localDate: "2026-10-25" });
    // At 01:10Z (03:10 EET after fall-back) 03:30 is still ahead.
    expect(
      nextRecurringOccurrence(sched, new Date("2026-10-25T01:10:00Z")),
    ).toMatchObject({ dayOffset: 0 });
    // At 02:00Z (04:00 EET) the next occurrence is tomorrow.
    expect(
      nextRecurringOccurrence(sched, new Date("2026-10-25T02:00:00Z")),
    ).toMatchObject({ dayOffset: 1, localDate: "2026-10-26" });
  });
  it("does not drift over a Helsinki fall-back weekend for a Monday schedule", () => {
    const sched = {
      ...base,
      timeZone: "Europe/Helsinki",
      weekdays: [1],
      localTime: "08:00",
    };
    // Sat 2026-10-24 12:00Z.
    expect(
      nextRecurringOccurrence(sched, new Date("2026-10-24T12:00:00Z")),
    ).toMatchObject({ dayOffset: 2, localDate: "2026-10-26", weekday: 1 });
  });
});

describe("timeZoneNote", () => {
  it("appears only when the schedule zone differs from the device", () => {
    expect(timeZoneNote("Europe/Helsinki", "Europe/Helsinki")).toBeNull();
    expect(timeZoneNote("Europe/Helsinki", "America/New_York")).toBe(
      "Schedule time zone: Europe/Helsinki",
    );
  });
});
