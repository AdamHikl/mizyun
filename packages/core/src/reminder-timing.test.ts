import { describe, expect, it } from "vitest";

import {
  learnEveningReminderTime,
  learnFirstMealReminderTime,
  shouldSuggestReminderTime,
} from "./reminder-timing";

const NOW = new Date("2026-10-15T12:00:00Z");

/** Build instants for local days back from 2026-10-14 in a UTC-based zone. */
const atUtc = (dayOffset: number, hh: number, mm = 0): string =>
  new Date(Date.UTC(2026, 9, 14 - dayOffset, hh, mm)).toISOString();

describe("learnFirstMealReminderTime", () => {
  it("uses the median of each day's first meal, rounds to 15 and leads by 15", () => {
    const meals = [
      atUtc(0, 7, 40),
      atUtc(0, 12, 30),
      atUtc(1, 7, 50),
      atUtc(2, 7, 44),
      atUtc(3, 8, 10),
      atUtc(4, 7, 46),
    ];
    const learned = learnFirstMealReminderTime(meals, "UTC", { now: NOW });
    // firsts: 460, 470, 464, 490, 466 -> median 466 -> 465 (7:45) -> 7:30
    expect(learned).toMatchObject({
      hour: 7,
      minute: 30,
      usualHour: 7,
      usualMinute: 45,
      sampleDays: 5,
    });
  });

  it("returns null with fewer than five logged days", () => {
    const meals = [0, 1, 2, 3].map((d) => atUtc(d, 8));
    expect(learnFirstMealReminderTime(meals, "UTC", { now: NOW })).toBeNull();
  });

  it("ignores days outside the 14 day window and future instants", () => {
    const meals = [
      ...[0, 1, 2, 3].map((d) => atUtc(d, 8)),
      atUtc(20, 8),
      atUtc(30, 8),
      new Date(NOW.getTime() + 3_600_000).toISOString(),
    ];
    expect(learnFirstMealReminderTime(meals, "UTC", { now: NOW })).toBeNull();
    meals.push(atUtc(5, 8));
    expect(
      learnFirstMealReminderTime(meals, "UTC", { now: NOW })?.sampleDays,
    ).toBe(5);
  });

  it("is robust to one late-night outlier and ignores pre-04:00 logs", () => {
    const meals = [
      atUtc(0, 8),
      atUtc(1, 8),
      atUtc(2, 8),
      atUtc(3, 8),
      atUtc(4, 8),
      atUtc(5, 11, 30),
      atUtc(1, 1, 0),
    ];
    expect(
      learnFirstMealReminderTime(meals, "UTC", { now: NOW }),
    ).toMatchObject({ hour: 7, minute: 45 });
  });

  it("returns null when the usual first meal is not a morning pattern", () => {
    const meals = [0, 1, 2, 3, 4, 5].map((d) => atUtc(d, 15));
    expect(learnFirstMealReminderTime(meals, "UTC", { now: NOW })).toBeNull();
  });

  it("evaluates days and clock times in the supplied time zone", () => {
    // 20:30Z is 07:30 the next morning in Sydney (UTC+11 during DST).
    const meals = [0, 1, 2, 3, 4].map((d) => atUtc(d, 20, 30));
    const learned = learnFirstMealReminderTime(meals, "Australia/Sydney", {
      now: new Date("2026-10-15T20:00:00Z"),
    });
    expect(learned).toMatchObject({ usualHour: 7, usualMinute: 30 });
    // The same instants read as 20:30 (not a morning pattern) in UTC.
    expect(learnFirstMealReminderTime(meals, "UTC", { now: NOW })).toBeNull();
  });

  it("keeps local wall-clock time across a DST change", () => {
    // New York leaves DST on 2026-11-01; 08:00 local is 12:00Z then 13:00Z.
    const meals = [
      "2026-10-28T12:00:00Z",
      "2026-10-29T12:00:00Z",
      "2026-10-30T12:00:00Z",
      "2026-11-02T13:00:00Z",
      "2026-11-03T13:00:00Z",
    ];
    const learned = learnFirstMealReminderTime(meals, "America/New_York", {
      now: new Date("2026-11-04T15:00:00Z"),
    });
    expect(learned).toMatchObject({ usualHour: 8, usualMinute: 0 });
  });

  it("returns null for an unknown zone or unusable data", () => {
    const meals = [0, 1, 2, 3, 4].map((d) => atUtc(d, 8));
    expect(
      learnFirstMealReminderTime(meals, "Not/AZone", { now: NOW }),
    ).toBeNull();
    expect(
      learnFirstMealReminderTime(["nope", NaN, Infinity], "UTC", { now: NOW }),
    ).toBeNull();
    expect(learnFirstMealReminderTime([], "UTC", { now: NOW })).toBeNull();
  });
});

describe("learnEveningReminderTime", () => {
  it("uses the median of each completed day's last meal plus 60 minutes", () => {
    const meals = [
      atUtc(0, 12),
      atUtc(0, 19, 5),
      atUtc(1, 19, 10),
      atUtc(2, 19, 0),
      atUtc(3, 18, 50),
      atUtc(4, 19, 20),
    ];
    // lasts 1145, 1150, 1140, 1130, 1160 -> median 1145 -> 1140 (19:00) -> 20:00
    expect(learnEveningReminderTime(meals, "UTC", { now: NOW })).toMatchObject({
      hour: 20,
      minute: 0,
      usualHour: 19,
      usualMinute: 0,
      sampleDays: 5,
    });
  });

  it("excludes the in-progress current day", () => {
    const meals = [atUtc(-1, 9), ...[1, 2, 3, 4].map((d) => atUtc(d, 19))];
    const now = new Date("2026-10-15T23:00:00Z");
    expect(learnEveningReminderTime(meals, "UTC", { now })).toBeNull();
  });

  it("clamps to a sane evening range", () => {
    const early = [1, 2, 3, 4, 5].map((d) => atUtc(d, 13));
    expect(learnEveningReminderTime(early, "UTC", { now: NOW })).toMatchObject({
      hour: 18,
      minute: 0,
    });
    const late = [1, 2, 3, 4, 5].map((d) => atUtc(d, 22, 30));
    expect(learnEveningReminderTime(late, "UTC", { now: NOW })).toMatchObject({
      hour: 22,
      minute: 30,
    });
  });

  it("returns null with sparse data", () => {
    const meals = [1, 2, 3, 4].map((d) => atUtc(d, 19));
    expect(learnEveningReminderTime(meals, "UTC", { now: NOW })).toBeNull();
  });
});

describe("shouldSuggestReminderTime", () => {
  it("requires at least a 30 minute difference", () => {
    const current = { hour: 8, minute: 30 };
    expect(shouldSuggestReminderTime(current, { hour: 8, minute: 0 })).toBe(
      true,
    );
    expect(shouldSuggestReminderTime(current, { hour: 8, minute: 15 })).toBe(
      false,
    );
    expect(shouldSuggestReminderTime(current, { hour: 9, minute: 0 })).toBe(
      true,
    );
    expect(shouldSuggestReminderTime(current, { hour: 8, minute: 30 })).toBe(
      false,
    );
  });
});
