import { describe, expect, it } from "vitest";
import {
  recurringMealCreateSchema,
  recurringMealPatchSchema,
  recurringMealSkipSchema,
} from "./recurring-meal";

const input = {
  id: "00000000-0000-4000-8000-000000000001",
  sourceEntryId: "00000000-0000-4000-8000-000000000002",
  localTime: "10:00",
  timeZone: "Europe/Bratislava",
  weekdays: [5, 1],
};
describe("recurring meal contracts", () => {
  it("accepts and canonicalizes valid explicit schedules", () => {
    expect(recurringMealCreateSchema.parse(input).weekdays).toEqual([1, 5]);
  });
  it.each(["24:00", "9:00", "10:60", "10:00:00", "10:00Z"])(
    "rejects invalid local time %s",
    (localTime) => {
      expect(
        recurringMealCreateSchema.safeParse({ ...input, localTime }).success,
      ).toBe(false);
    },
  );
  it.each(["not/a-zone", "+02:00", " Europe/Bratislava", ""])(
    "rejects invalid zone %s",
    (timeZone) => {
      expect(
        recurringMealCreateSchema.safeParse({ ...input, timeZone }).success,
      ).toBe(false);
    },
  );
  it.each([[], [1, 1], [7], [-1], [1.5]])(
    "rejects invalid weekdays %s",
    (...weekdays) => {
      expect(
        recurringMealCreateSchema.safeParse({ ...input, weekdays }).success,
      ).toBe(false);
    },
  );
  it("rejects forged ownership, nutrients, identity changes and empty patches", () => {
    expect(
      recurringMealCreateSchema.safeParse({ ...input, userId: input.id })
        .success,
    ).toBe(false);
    expect(
      recurringMealCreateSchema.safeParse({ ...input, caloriesKcal: 100 })
        .success,
    ).toBe(false);
    expect(
      recurringMealPatchSchema.safeParse({ id: input.id, enabled: false })
        .success,
    ).toBe(false);
    expect(recurringMealPatchSchema.safeParse({}).success).toBe(false);
    expect(recurringMealPatchSchema.parse({ enabled: false })).toEqual({
      enabled: false,
    });
  });
  it.each([
    "2026-02-29",
    "2026-04-31",
    "2026-13-01",
    "2026-1-01",
    "0000-01-01",
  ])("rejects nonexistent date %s", (localDate) => {
    expect(recurringMealSkipSchema.safeParse({ localDate }).success).toBe(
      false,
    );
  });
  it("accepts leap dates and rejects unknown skip fields", () => {
    expect(recurringMealSkipSchema.parse({ localDate: "2028-02-29" })).toEqual({
      localDate: "2028-02-29",
    });
    expect(
      recurringMealSkipSchema.safeParse({
        localDate: "2028-02-29",
        userId: input.id,
      }).success,
    ).toBe(false);
  });
});
