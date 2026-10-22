import { describe, expect, it } from "vitest";
import type { StoredFoodEntry, UserId } from "@mizyun/core";

import {
  localDayIso,
  localIsoWithOffset,
  summariseFoodEntriesByLocalDay,
} from "./local-time.js";

const entry = (id: string, consumedAt: string): StoredFoodEntry => ({
  id,
  userId: "00000000-0000-4000-8000-000000000001" as UserId,
  name: id,
  consumedAt: new Date(consumedAt),
  caloriesKcal: 100,
  proteinG: 10,
  carbohydrateG: 10,
  fatG: 5,
  details: {},
  source: "manual",
  confidence: null,
  confirmedByUser: true,
  createdAt: new Date(consumedAt),
  updatedAt: new Date(consumedAt),
});

describe("Coach local time", () => {
  // Bratislava falls back from +02:00 to +01:00 at 01:00 UTC on 25 Oct 2026.
  it("sums food by the user's calendar day across the DST change", () => {
    const days = summariseFoodEntriesByLocalDay(
      [
        entry("sat-late", "2026-10-24T21:30:00.000Z"), // 23:30 +02:00, 24th
        entry("sun-early", "2026-10-24T22:30:00.000Z"), // 00:30 +02:00, 25th
        entry("sun-late", "2026-10-25T22:30:00.000Z"), // 23:30 +01:00, 25th
        entry("mon-early", "2026-10-25T23:30:00.000Z"), // 00:30 +01:00, 26th
      ],
      { from: "2026-10-24", to: "2026-10-26", timeZone: "Europe/Bratislava" },
    );
    expect(
      days.map(({ date, entryCount, caloriesKcal }) => ({
        date,
        entryCount,
        caloriesKcal,
      })),
    ).toEqual([
      { date: "2026-10-24", entryCount: 1, caloriesKcal: 100 },
      { date: "2026-10-25", entryCount: 2, caloriesKcal: 200 },
      { date: "2026-10-26", entryCount: 1, caloriesKcal: 100 },
    ]);
  });

  it("falls back to UTC for a zone Intl does not know", () => {
    const date = new Date("2026-09-09T22:30:00.000Z");
    expect(localDayIso(date, "Foo/Bar")).toBe("2026-09-09");
    expect(localIsoWithOffset(date, "Foo/Bar")).toBe(
      "2026-09-09T22:30:00+00:00",
    );
  });
});
