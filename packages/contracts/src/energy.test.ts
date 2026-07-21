import { describe, expect, it } from "vitest";

import { energySummaryQuerySchema } from "./energy";

describe("energy summary local-day query", () => {
  it("coerces a valid UTC offset from query-string input", () => {
    expect(
      energySummaryQuerySchema.parse({ utcOffsetMinutes: "120" })
        .utcOffsetMinutes,
    ).toBe(120);
  });

  it("rejects offsets outside the civil-time range", () => {
    expect(
      energySummaryQuerySchema.safeParse({ utcOffsetMinutes: -841 }).success,
    ).toBe(false);
  });
});
