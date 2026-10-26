import { describe, expect, it } from "vitest";
import { monthlyAllowanceMessage } from "./ai-allowance";

describe("monthlyAllowanceMessage", () => {
  const now = Date.parse("2026-10-26T12:00:00.000Z");

  it("names the renewal date when the reset is more than a day away", () => {
    expect(monthlyAllowanceMessage("2026-11-01T00:00:00.000Z", now)).toBe(
      "You've used this month's AI allowance. It renews on 1 November.",
    );
  });

  it("leaves daily resets and missing values to the caller", () => {
    expect(monthlyAllowanceMessage("2026-10-27T00:00:00.000Z", now)).toBeNull();
    expect(monthlyAllowanceMessage(undefined, now)).toBeNull();
    expect(monthlyAllowanceMessage("not a date", now)).toBeNull();
  });
});
