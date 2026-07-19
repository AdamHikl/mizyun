import { describe, expect, it } from "vitest";

import {
  foodEntryListQuerySchema,
  foodEntrySummaryQuerySchema,
} from "./food-entry";

describe("food-entry local-day queries", () => {
  it("coerces a valid UTC offset from query-string input", () => {
    expect(
      foodEntryListQuerySchema.parse({
        from: "2026-07-10",
        to: "2026-07-10",
        utcOffsetMinutes: "120",
      }).utcOffsetMinutes,
    ).toBe(120);
  });

  it("rejects offsets outside the civil-time range", () => {
    expect(
      foodEntrySummaryQuerySchema.safeParse({
        date: "2026-07-10",
        utcOffsetMinutes: 841,
      }).success,
    ).toBe(false);
  });
});
